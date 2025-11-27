# Session Persistence & Restoration - High Level Design

**Version:** 1.1
**Status:** Revised per Architecture Review Round 1
**Date:** 2025-11-27
**Reference:** [session-persistence-architecture.md](./session-persistence-architecture.md)

---

## 1. Executive Summary

本文档定义了 agent-chatter 对话会话持久化与恢复功能的详细设计。目标是允许用户在应用重启后恢复之前的对话，保留完整上下文（消息历史、teamTask）。

### 1.1 设计原则

| 原则 | 说明 |
|------|------|
| **Context-Centric** | 持久化 ContextManager 的状态快照，而非仅消息列表 |
| **Ready-Idle State** | 恢复后清空执行状态（routingQueue），处于 paused 等待人类输入 |
| **Explicit Control** | 恢复必须是用户显式选择，不隐式恢复 |
| **No Todos** | Todo 不持久化，不纳入 snapshot（架构决定） |
| **Context-Only Restore** | **仅恢复上下文数据**（messages/teamTask），**不恢复运行时状态**（routingQueue/currentExecutingMember/status 等） |

### 1.2 Scope

**In Scope:**
- Session snapshot 文件存储与读取
- Coordinator 恢复逻辑
- REPL 交互式恢复提示
- CLI `--resume` 参数支持
- 成员一致性检查与警告

**Out of Scope:**
- Todo 列表持久化（**显式排除**：todos 是 UI 层状态，不在 context 中）
- Session 文件加密
- 远程/云存储
- 多设备同步
- 运行时状态持久化（routingQueue, currentExecutingMember 等）

---

## 2. Data Model

### 2.1 ContextManager 对齐原则

**重要**：`SessionSnapshot.context` 直接使用 `ContextManager.exportSnapshot()` 的返回结构，不定义平行结构。

现有 `ContextSnapshot` 定义（`src/context/types.ts`）：
```typescript
interface ContextSnapshot {
  messages: ConversationMessage[];
  teamTask: string | null;
  timestamp: number;
  version: 1;  // 内部数据结构版本
}
```

持久化时：
- `context` 字段 = `ContextManager.exportSnapshot()` 返回值
- 包含 `timestamp` 和 `version` 字段，用于恢复时校验
- **不包含 todos**（todos 是 UI 层状态，不在 ContextManager 管理范围内）

### 2.2 SessionSnapshot Schema

```typescript
/**
 * 持久化的会话快照
 * 存储路径: ~/.agent-chatter/sessions/<teamId>/<timestamp>-<sessionId>.json
 */
interface SessionSnapshot {
  /** Schema version for file format migration, e.g., "1.0" */
  schemaVersion: string;

  /** Team identifier (must match current team on restore) */
  teamId: string;

  /** Unique session identifier */
  sessionId: string;

  /** ISO 8601 timestamps */
  createdAt: string;   // e.g., "2025-11-27T10:30:00.000Z"
  updatedAt: string;

  /**
   * Core context data - 直接来自 ContextManager.exportSnapshot()
   * 注意：不包含 todos（todos 是 UI 状态，不持久化）
   */
  context: ContextSnapshot;  // 复用现有类型，不定义平行结构

  /** Additional metadata for restore logic */
  metadata: {
    /** Last speaker's roleId (for display/debug) */
    lastSpeakerId?: string;

    /** Total message count (for quick display without parsing messages) */
    messageCount: number;

    /** Human-readable summary for restore prompt */
    summary?: string;
  };
}
```

**Schema Version vs Context Version**：
- `schemaVersion: string` - 文件格式版本（如 "1.0"），用于未来文件格式迁移
- `context.version: number` - ContextSnapshot 内部版本（当前固定为 1），用于 importSnapshot 校验

### 2.3 与现有类型的关系

| 现有类型 | 用途 | 与 SessionSnapshot 关系 |
|----------|------|-------------------------|
| `ContextSnapshot` (types.ts) | ContextManager 内部快照 | **直接作为 `context` 字段类型** |
| `ConversationSession` | 运行时会话对象 | 恢复时重建此对象 |
| `ConversationMessage` | 消息记录 | 存储在 `context.messages` |

### 2.4 存储路径规范

```
~/.agent-chatter/
└── sessions/
    └── <teamId>/
        ├── 1732700400000-session-abc123.json   # timestamp-sessionId.json
        ├── 1732786800000-session-def456.json
        └── ...
```

- **目录按 teamId 分隔**: 便于按团队查找历史会话
- **文件名含时间戳**: 便于按时间排序，找到最近会话
- **JSON 格式**: 人类可读，便于调试

---

## 3. Component Design

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Presentation Layer                            │
├─────────────────────────────────────────────────────────────────────────┤
│  ReplModeInk                           CLI                              │
│  ┌─────────────────────────┐          ┌─────────────────────────┐      │
│  │ /team deploy <config>   │          │ --resume [sessionId]    │      │
│  │ → detectHistorySession()│          │ → explicit restore      │      │
│  │ → prompt [R]/[N]        │          │                         │      │
│  └───────────┬─────────────┘          └───────────┬─────────────┘      │
│              │                                     │                    │
│              └──────────────┬──────────────────────┘                    │
│                             ▼                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                            Core Layer                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  ConversationCoordinator                                                │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ setTeam(team, options?: { resumeSessionId?: string })       │       │
│  │   ├─ If resumeSessionId → loadAndRestore()                  │       │
│  │   └─ Else → fresh start                                     │       │
│  │                                                              │       │
│  │ Private: loadAndRestore(sessionId)                          │       │
│  │   ├─ Load snapshot from SessionStorageService               │       │
│  │   ├─ Validate teamId match                                  │       │
│  │   ├─ Check member consistency (warn if mismatch)            │       │
│  │   ├─ contextManager.importSnapshot()                        │       │
│  │   ├─ Rebuild ConversationSession                            │       │
│  │   └─ Reset: routingQueue=[], status='paused'                │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                             │                                           │
│                             ▼                                           │
│  ContextManager                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ exportSnapshot(): ContextSnapshot  ← 已实现                  │       │
│  │ importSnapshot(snapshot): void     ← 已实现                  │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                             │                                           │
├─────────────────────────────┼───────────────────────────────────────────┤
│                             ▼                                           │
│                      Infrastructure Layer                               │
├─────────────────────────────────────────────────────────────────────────┤
│  SessionStorageService (NEW)                                            │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ saveSession(teamId, snapshot): Promise<void>                │       │
│  │ loadSession(teamId, sessionId): Promise<SessionSnapshot>    │       │
│  │ getLatestSession(teamId): Promise<SessionSnapshot | null>   │       │
│  │ listSessions(teamId): Promise<SessionSummary[]>             │       │
│  │ deleteSession(teamId, sessionId): Promise<void>             │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                             │                                           │
│                             ▼                                           │
│  File System                                                            │
│  ~/.agent-chatter/sessions/<teamId>/<timestamp>-<sessionId>.json        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 SessionStorageService (New)

#### 3.2.1 接口抽象（支持依赖注入）

```typescript
// src/infrastructure/ISessionStorage.ts

export interface SessionSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
}

/**
 * Session 存储接口 - 支持依赖注入和测试替换
 */
export interface ISessionStorage {
  saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void>;
  loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null>;
  getLatestSession(teamId: string): Promise<SessionSnapshot | null>;
  listSessions(teamId: string): Promise<SessionSummary[]>;
  deleteSession(teamId: string, sessionId: string): Promise<void>;
}
```

#### 3.2.2 文件系统实现

```typescript
// src/infrastructure/SessionStorageService.ts

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ISessionStorage, SessionSummary } from './ISessionStorage.js';

const CURRENT_SCHEMA_VERSION = '1.0';

export class SessionStorageService implements ISessionStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(os.homedir(), '.agent-chatter', 'sessions');
  }

  /**
   * Save a session snapshot to disk
   */
  async saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void> {
    const teamDir = this.getTeamDir(teamId);
    await this.ensureDir(teamDir);

    const filename = `${Date.now()}-${snapshot.sessionId}.json`;
    const filePath = path.join(teamDir, filename);

    // Update timestamp before save
    snapshot.updatedAt = new Date().toISOString();

    await fs.promises.writeFile(
      filePath,
      JSON.stringify(snapshot, null, 2),
      'utf-8'
    );
  }

  /**
   * Load a specific session by ID
   * Returns null if not found or file is corrupted/incompatible
   */
  async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
    const teamDir = this.getTeamDir(teamId);
    if (!fs.existsSync(teamDir)) {
      return null;
    }

    const files = await fs.promises.readdir(teamDir);
    const matchingFile = files.find(f => f.includes(sessionId) && f.endsWith('.json'));

    if (!matchingFile) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(
        path.join(teamDir, matchingFile),
        'utf-8'
      );
      const snapshot = JSON.parse(content) as SessionSnapshot;

      // Schema version 校验
      if (!this.isSchemaVersionCompatible(snapshot.schemaVersion)) {
        console.warn(
          `⚠️  Session file has incompatible schema version: ${snapshot.schemaVersion} (expected: ${CURRENT_SCHEMA_VERSION}). Skipping.`
        );
        return null;
      }

      return snapshot;
    } catch (err) {
      // 文件损坏或格式错误
      console.warn(`⚠️  Failed to load session file: ${matchingFile}. Skipping.`);
      return null;
    }
  }

  /**
   * Get the most recent session for a team
   * Skips corrupted/incompatible files
   */
  async getLatestSession(teamId: string): Promise<SessionSnapshot | null> {
    const teamDir = this.getTeamDir(teamId);
    if (!fs.existsSync(teamDir)) {
      return null;
    }

    const files = await fs.promises.readdir(teamDir);
    const jsonFiles = files
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();  // Most recent first (timestamp prefix)

    // Try files in order until we find a valid one
    for (const file of jsonFiles) {
      try {
        const content = await fs.promises.readFile(
          path.join(teamDir, file),
          'utf-8'
        );
        const snapshot = JSON.parse(content) as SessionSnapshot;

        if (this.isSchemaVersionCompatible(snapshot.schemaVersion)) {
          return snapshot;
        }
        // Incompatible version, try next file
      } catch {
        // Corrupted file, try next
      }
    }

    return null;
  }

  /**
   * List all sessions for a team (summaries only)
   * Skips corrupted/incompatible files
   */
  async listSessions(teamId: string): Promise<SessionSummary[]> {
    const teamDir = this.getTeamDir(teamId);
    if (!fs.existsSync(teamDir)) {
      return [];
    }

    const files = await fs.promises.readdir(teamDir);
    const summaries: SessionSummary[] = [];

    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const content = await fs.promises.readFile(
          path.join(teamDir, file),
          'utf-8'
        );
        const snapshot = JSON.parse(content) as SessionSnapshot;

        // Skip incompatible versions
        if (!this.isSchemaVersionCompatible(snapshot.schemaVersion)) {
          continue;
        }

        summaries.push({
          sessionId: snapshot.sessionId,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          messageCount: snapshot.metadata.messageCount,
          summary: snapshot.metadata.summary,
        });
      } catch {
        // Skip corrupted files silently
      }
    }

    return summaries.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Delete a session
   */
  async deleteSession(teamId: string, sessionId: string): Promise<void> {
    const teamDir = this.getTeamDir(teamId);
    if (!fs.existsSync(teamDir)) {
      return;
    }

    const files = await fs.promises.readdir(teamDir);
    const matchingFile = files.find(f => f.includes(sessionId) && f.endsWith('.json'));

    if (matchingFile) {
      await fs.promises.unlink(path.join(teamDir, matchingFile));
    }
  }

  /**
   * Check if schema version is compatible
   * Currently only supports exact match; future: semver comparison
   */
  private isSchemaVersionCompatible(version: string): boolean {
    return version === CURRENT_SCHEMA_VERSION;
  }

  private getTeamDir(teamId: string): string {
    // Sanitize teamId for filesystem safety
    const safeTeamId = teamId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return path.join(this.baseDir, safeTeamId);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }
}
```

#### 3.2.3 内存实现（用于单元测试）

```typescript
// src/infrastructure/InMemorySessionStorage.ts

export class InMemorySessionStorage implements ISessionStorage {
  private sessions: Map<string, Map<string, SessionSnapshot>> = new Map();

  async saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void> {
    if (!this.sessions.has(teamId)) {
      this.sessions.set(teamId, new Map());
    }
    this.sessions.get(teamId)!.set(snapshot.sessionId, { ...snapshot });
  }

  async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
    return this.sessions.get(teamId)?.get(sessionId) ?? null;
  }

  async getLatestSession(teamId: string): Promise<SessionSnapshot | null> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions || teamSessions.size === 0) return null;

    return [...teamSessions.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }

  async listSessions(teamId: string): Promise<SessionSummary[]> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions) return [];

    return [...teamSessions.values()]
      .map(s => ({
        sessionId: s.sessionId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.metadata.messageCount,
        summary: s.metadata.summary,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async deleteSession(teamId: string, sessionId: string): Promise<void> {
    this.sessions.get(teamId)?.delete(sessionId);
  }

  // Test helper
  clear(): void {
    this.sessions.clear();
  }
}
```

### 3.3 ConversationCoordinator Changes

#### 3.3.1 setTeam 改为 async

**重要变更**：`setTeam()` 方法从同步改为异步（`async`），以支持恢复操作中的文件读取。

**调用方必须 await**：
```typescript
// ❌ 错误：可能导致恢复未完成就进入对话
coordinator.setTeam(team, { resumeSessionId: sessionId });
setMode('conversation');

// ✅ 正确：等待恢复完成
await coordinator.setTeam(team, { resumeSessionId: sessionId });
setMode('conversation');
```

**影响范围**：
- `ReplModeInk.tsx` 中的 `/team deploy` 处理需要 `await`
- `cli.ts` 中的团队部署逻辑需要 `await`
- 所有调用 `coordinator.setTeam()` 的地方都需要检查

#### 3.3.2 接口定义

```typescript
// 修改 src/services/ConversationCoordinator.ts

export interface SetTeamOptions {
  /** Session ID to restore (if provided, will attempt restore) */
  resumeSessionId?: string;
}

export class ConversationCoordinator {
  private sessionStorage: SessionStorageService;

  constructor(
    private agentManager: AgentManager,
    private messageRouter: MessageRouter,
    private options: ConversationCoordinatorOptions = {}
  ) {
    // ... existing init ...
    this.sessionStorage = new SessionStorageService();
  }

  /**
   * Set team with optional session restore
   *
   * ⚠️ BREAKING CHANGE: 此方法现在是 async，调用方必须 await
   */
  async setTeam(team: Team, options?: SetTeamOptions): Promise<void> {
    this.team = team;
    this.session = null;
    this.waitingForRoleId = null;
    this.routingQueue = [];
    this.contextManager.clear();

    if (options?.resumeSessionId) {
      await this.restoreSession(options.resumeSessionId);
    }
  }

  /**
   * Restore a previous session
   */
  private async restoreSession(sessionId: string): Promise<void> {
    if (!this.team) {
      throw new Error('Team must be set before restoring session');
    }

    // 1. Load snapshot
    const snapshot = await this.sessionStorage.loadSession(this.team.id, sessionId);
    if (!snapshot) {
      throw new Error(`Session ${sessionId} not found for team ${this.team.id}`);
    }

    // 2. Validate teamId match
    if (snapshot.teamId !== this.team.id) {
      throw new Error(
        `Session teamId mismatch: snapshot has '${snapshot.teamId}', current team is '${this.team.id}'`
      );
    }

    // 3. Check member consistency
    this.checkMemberConsistency(snapshot);

    // 4. Restore ContextManager
    this.contextManager.importSnapshot({
      messages: snapshot.context.messages,
      teamTask: snapshot.context.teamTask,
      timestamp: Date.now(),
      version: 1,
    });

    // 5. Rebuild ConversationSession
    this.session = this.rebuildSession(snapshot);

    // 6. Reset execution state (Ready-Idle)
    this.routingQueue = [];
    this.status = 'paused';
    this.waitingForRoleId = this.getFirstHumanMemberId();

    // 7. Notify status change
    this.notifyStatusChange();
  }

  /**
   * Check if historical speakers still exist in current team
   * Warn if mismatch, but don't block restore
   */
  private checkMemberConsistency(snapshot: SessionSnapshot): void {
    const currentMemberIds = new Set(this.team!.members.map(m => m.id));
    const historicalSpeakers = new Set(
      snapshot.context.messages.map(m => m.speaker.roleId)
    );

    const missing: string[] = [];
    for (const speakerId of historicalSpeakers) {
      if (speakerId !== 'system' && !currentMemberIds.has(speakerId)) {
        const msg = snapshot.context.messages.find(m => m.speaker.roleId === speakerId);
        missing.push(msg?.speaker.roleName ?? speakerId);
      }
    }

    if (missing.length > 0) {
      // User-visible warning (显示原名)
      console.warn(
        `⚠️  Warning: Some speakers in history are not in current team: ${missing.join(', ')}\n` +
        `   Their messages will be displayed with original names.`
      );
    }
  }

  /**
   * Rebuild ConversationSession from snapshot
   */
  private rebuildSession(snapshot: SessionSnapshot): ConversationSession {
    return {
      id: snapshot.sessionId,
      teamId: snapshot.teamId,
      teamName: this.team!.name,
      title: `Restored - ${new Date(snapshot.updatedAt).toLocaleString()}`,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      status: 'paused',  // Always start paused
      teamTask: snapshot.context.teamTask,
      messages: [...snapshot.context.messages],
      stats: {
        totalMessages: snapshot.context.messages.length,
        messagesByRole: this.calculateMessagesByRole(snapshot.context.messages),
        duration: Date.now() - new Date(snapshot.createdAt).getTime(),
      },
    };
  }

  private calculateMessagesByRole(messages: ConversationMessage[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const msg of messages) {
      const roleId = msg.speaker.roleId;
      result[roleId] = (result[roleId] || 0) + 1;
    }
    return result;
  }

  private getFirstHumanMemberId(): string | null {
    const human = this.team?.members.find(m => m.type === 'human');
    return human?.id ?? null;
  }

  /**
   * Save current session (called on turn.completed or stop)
   */
  async saveCurrentSession(): Promise<void> {
    if (!this.session || !this.team) {
      return;
    }

    const contextSnapshot = this.contextManager.exportSnapshot();

    const snapshot: SessionSnapshot = {
      schemaVersion: '1.0',
      teamId: this.team.id,
      sessionId: this.session.id,
      createdAt: this.session.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
      context: {
        teamTask: contextSnapshot.teamTask,
        messages: contextSnapshot.messages,
      },
      metadata: {
        lastSpeakerId: this.getLastSpeakerId(),
        messageCount: contextSnapshot.messages.length,
        summary: this.generateSummary(contextSnapshot.messages),
      },
    };

    await this.sessionStorage.saveSession(this.team.id, snapshot);
  }

  private getLastSpeakerId(): string | undefined {
    const messages = this.contextManager.getMessages();
    return messages.length > 0 ? messages[messages.length - 1].speaker.roleId : undefined;
  }

  private generateSummary(messages: ConversationMessage[]): string {
    if (messages.length === 0) return 'Empty conversation';
    const firstMsg = messages[0];
    const preview = firstMsg.content.substring(0, 50);
    return `${messages.length} messages - "${preview}${firstMsg.content.length > 50 ? '...' : ''}"`;
  }
}
```

---

## 4. Save Trigger Points

根据架构决定，保存在以下两种场景触发：

### 4.1 Turn Completed (AI → Human)

当 AI Agent 完成执行，控制权返回人类时保存。

```typescript
// 在 ConversationCoordinator.processRoutingQueue() 中

if (member.type === 'human') {
  // Human member - pause queue processing
  this.waitingForRoleId = member.id;
  this.status = 'paused';
  this.notifyStatusChange();

  // ✅ AUTO-SAVE on turn completion
  await this.saveCurrentSession();

  break;
}
```

### 4.2 Conversation End (/end, /exit, stop)

当用户显式结束对话时保存。

```typescript
// 在 ConversationCoordinator.stop() 中

stop(): void {
  // ✅ AUTO-SAVE before cleanup
  this.saveCurrentSession().catch(err => {
    console.error('Failed to save session on stop:', err);
  });

  this.handleConversationComplete();
}
```

### 4.3 User Cancellation (ESC)

取消 Agent 执行时也保存当前状态。

```typescript
// 在 ConversationCoordinator.handleUserCancellation() 中

handleUserCancellation(): void {
  // ... existing cancellation logic ...

  // ✅ AUTO-SAVE on cancellation
  this.saveCurrentSession().catch(err => {
    console.error('Failed to save session on cancellation:', err);
  });
}
```

---

## 5. REPL Integration

### 5.1 `/team deploy` Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  User: /team deploy my-team                                      │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  1. Load team config                                             │
│  2. Check for existing sessions:                                 │
│     sessionStorage.getLatestSession(team.id)                     │
└───────────────────────────────┬──────────────────────────────────┘
                                ▼
              ┌─────────────────┴─────────────────┐
              │ Has historical session?           │
              └─────────────────┬─────────────────┘
                    ┌───────────┴───────────┐
                    ▼                       ▼
             ┌──────────┐            ┌──────────┐
             │   YES    │            │    NO    │
             └────┬─────┘            └────┬─────┘
                  ▼                       ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  Display session summary:   │  │  Fresh start                │
│  ┌────────────────────────┐ │  │  setTeam(team)              │
│  │ Found previous session │ │  └─────────────────────────────┘
│  │ (2 hours ago, 15 msgs) │ │
│  │                        │ │
│  │ [R] Resume             │ │
│  │ [N] Start New          │ │
│  └────────────────────────┘ │
└─────────────┬───────────────┘
              ▼
       ┌──────┴──────┐
       │ User choice │
       └──────┬──────┘
        ┌─────┴─────┐
        ▼           ▼
   ┌────────┐  ┌────────┐
   │   R    │  │   N    │
   └───┬────┘  └───┬────┘
       ▼           ▼
┌──────────────┐ ┌──────────────┐
│ setTeam(     │ │ setTeam(     │
│   team,      │ │   team       │
│   {resume:   │ │ )            │
│    sessionId}│ │              │
│ )            │ │              │
└──────────────┘ └──────────────┘
```

### 5.2 UI Implementation

```tsx
// 新增状态
const [pendingRestore, setPendingRestore] = useState<{
  team: Team;
  session: SessionSummary;
} | null>(null);

// 在 /team deploy 处理中
async function handleTeamDeploy(teamName: string) {
  const team = await loadTeamConfig(teamName);
  const latestSession = await sessionStorage.getLatestSession(team.id);

  if (latestSession) {
    // Show restore prompt
    setPendingRestore({
      team,
      session: {
        sessionId: latestSession.sessionId,
        createdAt: latestSession.createdAt,
        updatedAt: latestSession.updatedAt,
        messageCount: latestSession.metadata.messageCount,
        summary: latestSession.metadata.summary,
      },
    });
  } else {
    // Fresh start
    await coordinator.setTeam(team);
    setMode('conversation');
  }
}

// Restore prompt component
function RestorePrompt({ pending, onChoice }: {
  pending: { team: Team; session: SessionSummary };
  onChoice: (restore: boolean) => void;
}) {
  const ago = formatTimeAgo(pending.session.updatedAt);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">Found previous session ({ago}, {pending.session.messageCount} messages)</Text>
      {pending.session.summary && (
        <Text dimColor>  {pending.session.summary}</Text>
      )}
      <Box marginTop={1}>
        <Text>[R] Resume  [N] Start New</Text>
      </Box>
    </Box>
  );
}

// Handle user input
useInput((input, key) => {
  if (pendingRestore) {
    if (input.toLowerCase() === 'r') {
      coordinator.setTeam(pendingRestore.team, {
        resumeSessionId: pendingRestore.session.sessionId
      });
      setPendingRestore(null);
      setMode('conversation');
    } else if (input.toLowerCase() === 'n') {
      coordinator.setTeam(pendingRestore.team);
      setPendingRestore(null);
      setMode('conversation');
    }
    return;
  }
  // ... existing input handling
});
```

---

## 6. CLI Integration

### 6.1 `--resume` Flag

```typescript
// 修改 src/cli.ts

program
  .option('--resume [sessionId]', 'Resume a previous session (latest if no ID specified)')
  .action(async (options) => {
    // ... existing setup ...

    if (options.resume) {
      const teamId = options.team;  // Assume --team is required with --resume
      const sessionStorage = new SessionStorageService();

      let sessionId: string;
      if (options.resume === true) {
        // --resume without ID: use latest
        const latest = await sessionStorage.getLatestSession(teamId);
        if (!latest) {
          console.error(`No previous sessions found for team '${teamId}'`);
          process.exit(1);
        }
        sessionId = latest.sessionId;
      } else {
        // --resume <sessionId>
        sessionId = options.resume;
      }

      await coordinator.setTeam(team, { resumeSessionId: sessionId });
    } else {
      // Fresh start (default for CI/scripts)
      await coordinator.setTeam(team);
    }
  });
```

### 6.2 Non-Interactive Behavior

**关键设计决定**：未指定 `--resume` 时，**始终新建会话**，即使存在历史会话也不恢复。

| 场景 | 行为 |
|------|------|
| `--resume` 指定 | 恢复指定/最近会话 |
| `--resume` 未指定，有历史会话 | **新建会话**（不阻塞 CI，不提示） |
| `--resume` 未指定，无历史会话 | 新建会话 |

**理由**：
- CI/CD 场景需要可预测的行为
- 隐式恢复可能导致状态污染
- 用户必须显式选择恢复（Explicit Control 原则）

---

## 7. Member Consistency Handling

### 7.1 策略（架构决定）

**警告并继续**：显示警告，保留历史消息，该成员显示为原名。

### 7.2 实现细节

```typescript
private checkMemberConsistency(snapshot: SessionSnapshot): void {
  const currentMemberIds = new Set(this.team!.members.map(m => m.id));
  const historicalSpeakers = new Set(
    snapshot.context.messages.map(m => m.speaker.roleId)
  );

  const missingMembers: Array<{ roleId: string; roleName: string }> = [];
  for (const speakerId of historicalSpeakers) {
    // Skip system messages
    if (speakerId === 'system') continue;

    if (!currentMemberIds.has(speakerId)) {
      // Find original name from message
      const msg = snapshot.context.messages.find(m => m.speaker.roleId === speakerId);
      missingMembers.push({
        roleId: speakerId,
        roleName: msg?.speaker.roleName ?? speakerId
      });
    }
  }

  if (missingMembers.length > 0) {
    const names = missingMembers.map(m => m.roleName).join(', ');

    // ⚠️ 用户可见警告 - 使用 output 接口确保在 REPL/CLI 中都能看到
    // 不使用 console.warn（可能被 UI 框架吞掉）
    this.options.output?.warn(
      `⚠️  Warning: Some speakers in history are not in current team: ${names}\n` +
      `   Their messages will be displayed with original names.`
    );

    // 同时触发回调，让 UI 层可以显示更友好的提示
    if (this.options.onMemberConsistencyWarning) {
      this.options.onMemberConsistencyWarning(missingMembers);
    }
  }
}
```

### 7.3 警告可见性

**关键要求**：成员不一致警告必须对用户可见，不能只是 `console.warn`。

实现方式：
1. **使用 IOutput 接口**：通过 `this.options.output?.warn()` 输出，确保在 REPL 和 CLI 中都能显示
2. **回调通知 UI**：新增 `onMemberConsistencyWarning` 回调，让 UI 层可以显示更友好的提示
3. **不静默失败**：缺失成员不会被替换为 "Unknown"，保持原名，避免无提示的混淆

### 7.4 Prompt Context 处理

历史消息中被删除成员的消息在 prompt context 中：
- **保留原样**: `speaker.roleName` 使用消息中存储的原名（不做映射）
- **不替换**: 不改为 "Unknown Member"，保持历史真实性
- **AI 可理解**: AI 看到的上下文包含完整对话历史，即使某成员不再存在
- **roleId 原样保留**: 不尝试映射到当前团队的成员

---

## 8. Error Handling

### 8.1 存储错误

| 错误场景 | 处理 |
|----------|------|
| 写入失败 (磁盘满/权限) | Log error, continue execution (don't crash) |
| 读取失败 (文件损坏) | Return null, let caller decide (fresh start or error) |
| 目录不存在 | Auto-create with `mkdir -p` |

### 8.2 恢复错误

| 错误场景 | 处理 |
|----------|------|
| Session not found | Throw error with clear message |
| TeamId mismatch | Throw error, require correct team |
| Schema version mismatch | Future: migration logic; Now: throw error |
| Member consistency issue | Warn and continue |

---

## 9. Files to Modify/Create

| File | Action | Description |
|------|--------|-------------|
| `src/infrastructure/SessionStorageService.ts` | **Create** | 新的 session 存储服务 |
| `src/services/ConversationCoordinator.ts` | **Modify** | 添加 restore/save 逻辑 |
| `src/repl/ReplModeInk.tsx` | **Modify** | 添加恢复提示 UI |
| `src/cli.ts` | **Modify** | 添加 `--resume` 参数 |
| `src/models/SessionSnapshot.ts` | **Create** | SessionSnapshot 类型定义 |

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// tests/unit/sessionStorageService.test.ts
describe('SessionStorageService', () => {
  it('should save and load session snapshot');
  it('should get latest session by timestamp');
  it('should list sessions sorted by updatedAt');
  it('should handle missing directory gracefully');
  it('should sanitize teamId for filesystem');
});

// tests/unit/conversationCoordinator.restore.test.ts
describe('ConversationCoordinator - Session Restore', () => {
  it('should restore session with valid snapshot');
  it('should throw on teamId mismatch');
  it('should warn on member consistency issues');
  it('should reset routingQueue and status on restore');
  it('should rebuild ConversationSession correctly');
});
```

### 10.2 Integration Tests

```typescript
// tests/integration/sessionPersistence.test.ts
describe('Session Persistence E2E', () => {
  it('should save session on turn completion');
  it('should save session on /end');
  it('should restore and continue conversation');
  it('should include restored context in AI prompt');
});
```

---

## 11. Success Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | Session saved on AI→Human turn | Check file created in ~/.agent-chatter/sessions/ |
| 2 | Session saved on /end or exit | Check file updated |
| 3 | REPL shows restore prompt | Deploy team with existing session |
| 4 | [R] restores conversation context | Verify messages in prompt |
| 5 | [N] starts fresh (no history) | Verify empty messages |
| 6 | --resume works in CLI | Run with flag, check context |
| 7 | Member mismatch shows warning | Remove member, restore, check warning |
| 8 | Missing session returns clear error | --resume with invalid ID |

---

## 12. Implementation Roadmap

### Phase 1: Infrastructure
1. Create `SessionSnapshot` type definition
2. Implement `SessionStorageService`
3. Add unit tests for storage service

### Phase 2: Core Logic
4. Extend `ConversationCoordinator.setTeam()` with restore option
5. Implement `restoreSession()` with validation
6. Add save triggers (turn completion, stop, cancel)
7. Add unit tests for restore logic

### Phase 3: UI Integration
8. Add restore prompt to ReplModeInk
9. Handle [R]/[N] user input
10. Add `--resume` CLI flag

### Phase 4: Testing & Polish
11. Integration tests: save → restart → restore → verify context
12. Edge case handling (corruption, permission errors)
13. Documentation update

---

## 13. Speaker 字段对齐 Schema 1.2

### 13.1 问题描述

当前 `ConversationMessage.speaker` 使用历史字段命名：
```typescript
// 当前实现 (src/models/ConversationMessage.ts)
speaker: {
  roleId: string;      // 历史字段名
  roleName: string;    // 历史字段名
  roleTitle: string;   // 历史字段名
  type: 'ai' | 'human' | 'system';
}
```

而 Team schema 1.2 中 Member 使用：
```typescript
// Team Member (src/models/Team.ts)
{
  id: string;
  name: string;
  displayName: string;
  type: 'ai' | 'human';
}
```

### 13.2 对齐方案

**目标**：统一消息中的 speaker 结构与 team 成员一致。

**新的 Speaker 结构**：
```typescript
speaker: {
  id: string;          // 对应 Member.id (原 roleId)
  name: string;        // 对应 Member.name (原 roleName)
  displayName: string; // 对应 Member.displayName (原 roleTitle)
  type: 'ai' | 'human' | 'system';
}
```

### 13.3 读写策略（迁移策略）

**核心原则**：**写入只用新字段，读取兼容旧字段并映射**

| 操作 | 字段使用 | 说明 |
|------|----------|------|
| **写入快照** | 仅使用新字段 `id/name/displayName` | 新写入的快照不再包含 `roleId/roleName/roleTitle` |
| **读取旧快照** | 映射旧字段到新字段 | 检测 `roleId` 存在时自动转换为 `id` |

### 13.4 恢复旧快照的映射

当恢复包含旧字段名的快照时，执行迁移映射：

```typescript
function migrateMessageSpeaker(speaker: any): SpeakerInfo {
  // 检测旧格式（有 roleId 但无 id）
  if ('roleId' in speaker && !('id' in speaker)) {
    return {
      id: speaker.roleId,
      name: speaker.roleName,
      displayName: speaker.roleTitle ?? speaker.roleName,
      type: speaker.type
    };
  }
  // 新格式，直接返回
  return speaker;
}

// 在 importSnapshot 时应用
function importSnapshot(snapshot: ContextSnapshot): void {
  const migratedMessages = snapshot.messages.map(msg => ({
    ...msg,
    speaker: migrateMessageSpeaker(msg.speaker)
  }));
  // ... 继续恢复
}
```

**重要**：旧字段 `roleId/roleName/roleTitle` 仅用于兼容读取历史快照，实现按此执行。

### 13.5 缺失成员处理

恢复时如果 speaker.id 不在当前团队中：
- **沿用原值**：id, name, displayName 保持不变
- **显示警告**：通过 IOutput 接口通知用户
- **不阻断恢复**：允许继续，历史对话保持可读性

---

## 14. JSON Schema 文件与校验

### 14.1 Schema 文件规范

**存放路径**：`schemas/<name>-v<version>.json`

| Schema 文件 | 说明 |
|-------------|------|
| `schemas/team-config-v1.2.json` | Team configuration schema |
| `schemas/agent-registry-v1.1.json` | Agent registry schema |
| `schemas/cli-config-v1.2.json` | CLI/Team config schema |
| `schemas/session-snapshot-v1.0.json` | Session snapshot schema |

### 14.2 TypeScript 类型生成

两种方案可选：
1. **json-schema-to-typescript**：从 JSON Schema 自动生成 TS 类型
2. **手写 TS 类型**：保持现有 `src/models/*.ts`，JSON Schema 作为运行时校验

**建议方案**：保持现有 TS 类型文件为 source of truth，JSON Schema 用于运行时校验和文档。

### 14.3 加载时强制校验

**关键要求**：加载 team/registry/snapshot 时 **必须** 调用 JSON Schema 校验。

```typescript
// src/utils/SchemaValidator.ts
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import cliConfigSchema from '../../schemas/cli-config-v1.2.json';
import agentRegistrySchema from '../../schemas/agent-registry-v1.1.json';
import sessionSnapshotSchema from '../../schemas/session-snapshot-v1.0.json';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv); // 支持 date-time 等格式

// 编译 schema
const validators = {
  cliConfig: ajv.compile(cliConfigSchema),
  agentRegistry: ajv.compile(agentRegistrySchema),
  sessionSnapshot: ajv.compile(sessionSnapshotSchema),
};

/**
 * 通用校验函数
 */
function validateWithSchema<T>(
  data: unknown,
  validator: Ajv.ValidateFunction,
  schemaName: string
): T {
  if (!validator(data)) {
    const errors = validator.errors
      ?.map(e => `  - ${e.instancePath || '/'}: ${e.message}`)
      .join('\n');
    throw new Error(
      `Invalid ${schemaName}:\n${errors}\n\n` +
      `Please check the schema: schemas/${schemaName}.json`
    );
  }
  return data as T;
}

export function validateTeamConfig(content: unknown): CLIConfig {
  return validateWithSchema(content, validators.cliConfig, 'cli-config-v1.2');
}

export function validateAgentRegistry(content: unknown): AgentRegistryData {
  return validateWithSchema(content, validators.agentRegistry, 'agent-registry-v1.1');
}

export function validateSessionSnapshot(content: unknown): SessionSnapshot {
  return validateWithSchema(content, validators.sessionSnapshot, 'session-snapshot-v1.0');
}
```

### 14.4 集成到加载路径

| 加载点 | 调用的校验函数 | 失败行为 |
|--------|---------------|----------|
| `TeamManager.loadTeamConfig()` | `validateTeamConfig()` | 抛出错误，拒绝加载 |
| `RegistryStorage.loadRegistry()` | `validateAgentRegistry()` | 抛出错误，拒绝加载 |
| `SessionStorageService.loadSession()` | `validateSessionSnapshot()` | 返回 null，跳过损坏文件 |

```typescript
// TeamManager.ts - 加载团队配置
async loadTeamConfig(filePath: string): Promise<CLIConfig> {
  const content = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
  return validateTeamConfig(content);  // 校验失败直接抛错
}

// SessionStorageService.ts - 加载快照
async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
  try {
    const content = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
    return validateSessionSnapshot(content);  // 校验失败返回 null
  } catch (err) {
    console.warn(`⚠️  Failed to load session: ${err.message}`);
    return null;
  }
}
```

### 14.5 版本检查与错误处理策略

| schemaVersion | 行为 | 错误信息 |
|---------------|------|----------|
| 未来版本 (> 当前) | 拒绝加载 | "Schema version X.X is not supported. Please upgrade agent-chatter." |
| 当前版本 | 正常加载 | - |
| 旧版本 (< 1.1 for team) | 拒绝加载 | "Schema version X.X is deprecated. Please migrate to version 1.2." |

```typescript
// 版本检查逻辑
function checkSchemaVersion(version: string, config: { min: string; max: string; name: string }): void {
  if (semver.gt(version, config.max)) {
    throw new Error(
      `Schema version ${version} for ${config.name} is not supported.\n` +
      `Please upgrade agent-chatter to the latest version.`
    );
  }
  if (semver.lt(version, config.min)) {
    throw new Error(
      `Schema version ${version} for ${config.name} is deprecated.\n` +
      `Please migrate to version ${config.max}.`
    );
  }
}
```

### 14.6 测试策略

使用 `schemas/__tests__/` 目录下的样例文件验证 Schema 校验逻辑：

```typescript
// tests/unit/schemaValidator.test.ts
import { validateTeamConfig, validateSessionSnapshot } from '../src/utils/SchemaValidator';

describe('Schema Validation', () => {
  describe('valid samples', () => {
    it('should accept cli-config-minimal.json', () => {
      const content = require('../../schemas/__tests__/valid/cli-config-minimal.json');
      expect(() => validateTeamConfig(content)).not.toThrow();
    });

    it('should accept cli-config-full.json', () => {
      const content = require('../../schemas/__tests__/valid/cli-config-full.json');
      expect(() => validateTeamConfig(content)).not.toThrow();
    });

    it('should accept session-snapshot with legacy speaker format', () => {
      const content = require('../../schemas/__tests__/valid/session-snapshot-legacy.json');
      expect(() => validateSessionSnapshot(content)).not.toThrow();
    });

    it('should accept session-snapshot with new speaker format', () => {
      const content = require('../../schemas/__tests__/valid/session-snapshot-new-format.json');
      expect(() => validateSessionSnapshot(content)).not.toThrow();
    });
  });

  describe('invalid samples', () => {
    it('should reject cli-config-missing-team.json', () => {
      const content = require('../../schemas/__tests__/invalid/cli-config-missing-team.json');
      expect(() => validateTeamConfig(content)).toThrow(/team/);
    });

    it('should reject cli-config-wrong-schema-version.json', () => {
      const content = require('../../schemas/__tests__/invalid/cli-config-wrong-schema-version.json');
      expect(() => validateTeamConfig(content)).toThrow(/schemaVersion/);
    });

    it('should reject session-snapshot-invalid-speaker.json', () => {
      const content = require('../../schemas/__tests__/invalid/session-snapshot-invalid-speaker.json');
      expect(() => validateSessionSnapshot(content)).toThrow();
    });
  });
});
```

**测试样例文件结构**：
```
schemas/__tests__/
├── valid/
│   ├── cli-config-minimal.json     # 最小有效配置
│   ├── cli-config-full.json        # 包含所有可选字段
│   ├── agent-registry.json         # 有效 registry
│   ├── session-snapshot-legacy.json    # 旧格式 speaker (roleId/roleName/roleTitle)
│   └── session-snapshot-new-format.json # 新格式 speaker (id/name/displayName)
└── invalid/
    ├── cli-config-missing-team.json       # 缺少 team 字段
    ├── cli-config-wrong-schema-version.json  # 无效版本号
    ├── cli-config-ai-missing-agentType.json  # AI 成员缺少 agentType
    ├── cli-config-single-member.json      # 少于 2 个成员
    ├── agent-registry-wrong-version.json  # 无效版本号
    ├── agent-registry-missing-required.json  # 缺少必需字段
    ├── session-snapshot-missing-context.json # 缺少 context
    └── session-snapshot-invalid-speaker.json # speaker 格式错误
```

---

## 15. Future Considerations

以下功能不在当前 scope 内，但记录作为后续优化方向：

### 15.1 超长历史处理

恢复后的消息历史仍受 `contextWindowSize` 和 `maxBytes` 限制。对于超长对话：
- 当前：ContextManager 自动截断超出窗口的历史消息
- 后续可考虑：
  - 保存时生成摘要（summarizer）
  - 持久化摘要以便恢复时保留更长期上下文
  - 分层存储：完整历史 + 摘要

### 15.2 存储保留策略

防止 `~/.agent-chatter/sessions/` 目录无限膨胀：
- **建议策略**：每个 team 保留最近 N 个会话（如 N=10）
- **实现方式**：在 `saveSession()` 后清理旧文件
- **可配置**：通过配置文件或环境变量控制保留数量

### 15.3 其他

- Session 文件加密（敏感数据保护）
- 跨设备同步（云存储）
- Session 导出/导入（用户迁移）

---

**Document Version:** 1.3
**Author:** Claude (Development Agent)
**Status:** Revised per Architecture Review Round 3 - Ready for LLD
