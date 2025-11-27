# LLD: ConversationCoordinator Session Restore

**Version:** 1.0
**Date:** 2025-11-27
**Reference:** [high-level-design.md](./high-level-design.md) Section 3.3, 4, 7

---

## 1. Overview

本文档定义 `ConversationCoordinator` 中会话恢复与保存逻辑的详细设计。

## 2. File Location

```
src/services/ConversationCoordinator.ts
```

## 3. Interface Changes

### 3.1 SetTeamOptions

```typescript
/**
 * Options for setTeam method
 */
export interface SetTeamOptions {
  /**
   * Session ID to restore
   * If provided, will attempt to restore from saved snapshot
   */
  resumeSessionId?: string;
}
```

### 3.2 ConversationCoordinatorOptions Extension

```typescript
export interface ConversationCoordinatorOptions {
  // ... existing options ...

  /**
   * Session storage implementation
   * Default: SessionStorageService (file-based)
   */
  sessionStorage?: ISessionStorage;

  /**
   * Output interface for user-visible warnings
   * Used for member consistency warnings
   */
  output?: IOutput;

  /**
   * Callback when member consistency issues detected
   * UI layer can use this to show friendly notifications
   */
  onMemberConsistencyWarning?: (missingMembers: MissingMember[]) => void;
}

/**
 * Missing member info for consistency warnings
 */
export interface MissingMember {
  id: string;
  name: string;
}
```

## 4. Method: setTeam (Modified)

### 4.1 Signature Change

```typescript
// BEFORE (sync)
setTeam(team: Team): void

// AFTER (async)
async setTeam(team: Team, options?: SetTeamOptions): Promise<void>
```

**Breaking Change:** All callers must now `await` this method.

### 4.2 Implementation

```typescript
/**
 * Set team with optional session restore
 *
 * ⚠️ ASYNC - Callers must await
 *
 * @param team - Team configuration
 * @param options - Optional settings including resumeSessionId
 */
async setTeam(team: Team, options?: SetTeamOptions): Promise<void> {
  // 1. Reset state
  this.team = team;
  this.session = null;
  this.waitingForRoleId = null;
  this.routingQueue = [];
  this.status = 'idle';
  this.contextManager.clear();

  // 2. Attempt restore if requested
  if (options?.resumeSessionId) {
    await this.restoreSession(options.resumeSessionId);
  }

  // 3. Emit team ready event (if needed by UI)
  this.emit('team:ready', { team, restored: !!options?.resumeSessionId });
}
```

## 5. Method: restoreSession (New)

### 5.1 Flow Diagram

```
restoreSession(sessionId)
         │
         ▼
┌─────────────────────────┐
│ 1. Validate team exists │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. Load snapshot from   │
│    SessionStorage       │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     │  Not Found? │
     └──────┬──────┘
            │ Yes
            ▼
   ┌────────────────┐
   │ Throw Error    │
   │ "Session not   │
   │  found"        │
   └────────────────┘
            │ No (found)
            ▼
┌─────────────────────────┐
│ 3. Validate teamId      │
│    matches current team │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     │  Mismatch?  │
     └──────┬──────┘
            │ Yes
            ▼
   ┌────────────────┐
   │ Throw Error    │
   │ "TeamId        │
   │  mismatch"     │
   └────────────────┘
            │ No (matches)
            ▼
┌─────────────────────────┐
│ 4. Check member         │
│    consistency          │
│    (warn if mismatch)   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 5. Migrate speaker      │
│    fields (if legacy)   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 6. Import context via   │
│    ContextManager       │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 7. Rebuild              │
│    ConversationSession  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 8. Reset execution      │
│    state (Ready-Idle)   │
│    - routingQueue = []  │
│    - status = 'paused'  │
│    - waitingFor = human │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 9. Notify status change │
└─────────────────────────┘
```

### 5.2 Implementation

```typescript
/**
 * Restore a previous session from storage
 *
 * @param sessionId - Session ID to restore
 * @throws Error if session not found or teamId mismatch
 */
private async restoreSession(sessionId: string): Promise<void> {
  // 1. Validate team exists
  if (!this.team) {
    throw new Error('Team must be set before restoring session');
  }

  // 2. Load snapshot
  const snapshot = await this.sessionStorage.loadSession(this.team.id, sessionId);
  if (!snapshot) {
    throw new Error(
      `Session '${sessionId}' not found for team '${this.team.id}'.\n` +
      `Use --resume without ID to restore the latest session, or start a new session.`
    );
  }

  // 3. Validate teamId match
  if (snapshot.teamId !== this.team.id) {
    throw new Error(
      `Session teamId mismatch: snapshot is for team '${snapshot.teamId}', ` +
      `but current team is '${this.team.id}'.\n` +
      `Please use the correct team configuration.`
    );
  }

  // 4. Check member consistency (warn, don't block)
  this.checkMemberConsistency(snapshot);

  // 5. Migrate speaker fields if legacy format
  const migratedMessages = this.migrateMessagesIfNeeded(snapshot.context.messages);

  // 6. Import context
  this.contextManager.importSnapshot({
    messages: migratedMessages,
    teamTask: snapshot.context.teamTask,
    timestamp: Date.now(),
    version: 1,
  });

  // 7. Rebuild ConversationSession
  this.session = this.rebuildSession(snapshot, migratedMessages);

  // 8. Reset execution state (Ready-Idle principle)
  this.routingQueue = [];
  this.currentExecutingMember = null;
  this.status = 'paused';
  this.waitingForRoleId = this.getFirstHumanMemberId();

  // 9. Notify
  this.notifyStatusChange();
  this.emit('session:restored', {
    sessionId,
    messageCount: migratedMessages.length,
  });
}
```

## 6. Method: checkMemberConsistency (New)

### 6.1 Purpose

检查历史消息中的发言者是否仍存在于当前团队配置中。如果有缺失，显示警告但不阻止恢复。

### 6.2 Implementation

```typescript
/**
 * Check if historical speakers still exist in current team
 * Warns if mismatch, but does not block restore
 *
 * @param snapshot - Session snapshot to check
 */
private checkMemberConsistency(snapshot: SessionSnapshot): void {
  const currentMemberIds = new Set(this.team!.members.map(m => m.id));

  // Collect unique speakers from history
  const speakerMap = new Map<string, string>(); // id -> name
  for (const msg of snapshot.context.messages) {
    const speaker = msg.speaker;
    // Handle both legacy (roleId) and new (id) format
    const speakerId = speaker.id ?? (speaker as any).roleId;
    const speakerName = speaker.name ?? (speaker as any).roleName;

    if (speakerId && speakerId !== 'system') {
      speakerMap.set(speakerId, speakerName ?? speakerId);
    }
  }

  // Find missing members
  const missingMembers: MissingMember[] = [];
  for (const [id, name] of speakerMap) {
    if (!currentMemberIds.has(id)) {
      missingMembers.push({ id, name });
    }
  }

  if (missingMembers.length > 0) {
    const names = missingMembers.map(m => m.name).join(', ');

    // User-visible warning via output interface
    this.options.output?.warn(
      `⚠️  Some speakers in history are not in current team: ${names}\n` +
      `   Their messages will be displayed with original names.`
    );

    // Callback for UI layer
    this.options.onMemberConsistencyWarning?.(missingMembers);
  }
}
```

## 7. Method: migrateMessagesIfNeeded (New)

详细设计见 [lld-speaker-migration.md](./lld-speaker-migration.md)

```typescript
/**
 * Migrate messages from legacy speaker format if needed
 *
 * Legacy: roleId, roleName, roleTitle
 * New: id, name, displayName
 *
 * @param messages - Messages to migrate
 * @returns Migrated messages (new array, original unchanged)
 */
private migrateMessagesIfNeeded(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map(msg => ({
    ...msg,
    speaker: migrateMessageSpeaker(msg.speaker),
  }));
}
```

## 8. Method: rebuildSession (New)

### 8.1 Purpose

从快照重建 `ConversationSession` 对象，用于 UI 显示和状态管理。

### 8.2 Implementation

```typescript
/**
 * Rebuild ConversationSession from snapshot
 *
 * @param snapshot - Source snapshot
 * @param messages - Migrated messages
 * @returns Rebuilt session object
 */
private rebuildSession(
  snapshot: SessionSnapshot,
  messages: ConversationMessage[]
): ConversationSession {
  return {
    id: snapshot.sessionId,
    teamId: snapshot.teamId,
    teamName: this.team!.name,
    title: this.generateRestoredTitle(snapshot),
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    status: 'paused', // Always start paused
    teamTask: snapshot.context.teamTask,
    messages: [...messages],
    stats: {
      totalMessages: messages.length,
      messagesByRole: this.calculateMessagesByRole(messages),
      duration: Date.now() - new Date(snapshot.createdAt).getTime(),
    },
  };
}

/**
 * Generate title for restored session
 */
private generateRestoredTitle(snapshot: SessionSnapshot): string {
  const date = new Date(snapshot.updatedAt);
  const formatted = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Restored - ${formatted}`;
}

/**
 * Calculate message count by role
 */
private calculateMessagesByRole(messages: ConversationMessage[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const msg of messages) {
    const roleId = msg.speaker.id;
    result[roleId] = (result[roleId] ?? 0) + 1;
  }
  return result;
}
```

## 9. Method: getFirstHumanMemberId (Helper)

```typescript
/**
 * Get first human member's ID
 * Used to set waitingForRoleId after restore
 *
 * @returns Human member ID, or null if no human members
 */
private getFirstHumanMemberId(): string | null {
  const human = this.team?.members.find(m => m.type === 'human');
  return human?.id ?? null;
}
```

## 10. Save Triggers

### 10.1 Save Points

| Trigger | Location | Timing |
|---------|----------|--------|
| Turn Completed (AI → Human) | `processRoutingQueue()` | When `waitingForRoleId` set to human |
| Conversation End | `stop()` | Before cleanup |
| User Cancellation | `handleUserCancellation()` | After cancel confirmed |

### 10.2 Method: saveCurrentSession

```typescript
/**
 * Save current session to storage
 * Called automatically at save trigger points
 *
 * Non-blocking: errors are logged but don't interrupt flow
 */
async saveCurrentSession(): Promise<void> {
  if (!this.session || !this.team) {
    return; // Nothing to save
  }

  try {
    const contextSnapshot = this.contextManager.exportSnapshot();

    const snapshot = createSessionSnapshot(this.session, contextSnapshot);

    await this.sessionStorage.saveSession(this.team.id, snapshot);

    this.emit('session:saved', { sessionId: this.session.id });
  } catch (err) {
    // Log error but don't throw - save failure shouldn't crash the app
    console.error(`❌  Failed to save session: ${(err as Error).message}`);
  }
}
```

### 10.3 Integration: processRoutingQueue

```typescript
// In processRoutingQueue(), after setting waitingForRoleId to human:

if (member.type === 'human') {
  this.waitingForRoleId = member.id;
  this.status = 'paused';
  this.notifyStatusChange();

  // ✅ AUTO-SAVE on turn completion
  // Fire-and-forget (don't await, don't block queue)
  this.saveCurrentSession().catch(() => {
    // Error already logged in saveCurrentSession
  });

  break;
}
```

### 10.4 Integration: stop

```typescript
async stop(): Promise<void> {
  // ✅ AUTO-SAVE before cleanup
  await this.saveCurrentSession();

  // Existing cleanup logic
  this.handleConversationComplete();
}
```

### 10.5 Integration: handleUserCancellation

```typescript
async handleUserCancellation(): Promise<void> {
  // Existing cancellation logic
  this.cancelCurrentExecution();

  // ✅ AUTO-SAVE on cancellation
  await this.saveCurrentSession();
}
```

## 11. Error Handling

### 11.1 Restore Errors

| Error | Type | User Message |
|-------|------|--------------|
| Session not found | `Error` | "Session 'X' not found for team 'Y'" |
| TeamId mismatch | `Error` | "Session teamId mismatch: snapshot is for team 'X', current team is 'Y'" |
| Member missing | Warning | "Some speakers in history are not in current team: ..." |
| Schema invalid | `Error` (from storage) | "Invalid session snapshot: ..." |

### 11.2 Save Errors

| Error | Type | Behavior |
|-------|------|----------|
| Disk full | Logged | Continue execution, don't crash |
| Permission denied | Logged | Continue execution, don't crash |
| Any storage error | Logged | Continue execution, don't crash |

## 12. Events

### 12.1 New Events

```typescript
interface CoordinatorEvents {
  // Existing events...

  /**
   * Emitted when session restored successfully
   */
  'session:restored': {
    sessionId: string;
    messageCount: number;
  };

  /**
   * Emitted when session saved successfully
   */
  'session:saved': {
    sessionId: string;
  };

  /**
   * Emitted when team is ready (after setTeam completes)
   */
  'team:ready': {
    team: Team;
    restored: boolean;
  };
}
```

## 13. Test Cases

```typescript
describe('ConversationCoordinator - Session Restore', () => {
  describe('setTeam with restore', () => {
    it('should restore session when resumeSessionId provided');
    it('should start fresh when resumeSessionId not provided');
    it('should clear previous state before restore');
  });

  describe('restoreSession', () => {
    it('should throw if team not set');
    it('should throw if session not found');
    it('should throw if teamId mismatch');
    it('should warn on member consistency issues');
    it('should migrate legacy speaker fields');
    it('should import context correctly');
    it('should rebuild session with correct stats');
    it('should reset to Ready-Idle state');
  });

  describe('checkMemberConsistency', () => {
    it('should not warn when all members exist');
    it('should warn with missing member names');
    it('should skip system messages');
    it('should call onMemberConsistencyWarning callback');
  });

  describe('saveCurrentSession', () => {
    it('should save snapshot to storage');
    it('should not throw on save error');
    it('should emit session:saved event');
  });

  describe('save triggers', () => {
    it('should save on turn completion (AI → Human)');
    it('should save on stop()');
    it('should save on user cancellation');
  });
});
```

---

**Document Version:** 1.0
**Author:** Claude (Development Agent)
