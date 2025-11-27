# LLD: Session Storage Service

**Version:** 1.0
**Date:** 2025-11-27
**Reference:** [high-level-design.md](./high-level-design.md) Section 3.2

---

## 1. Overview

本文档定义 Session 存储服务的详细设计，包括接口抽象、文件系统实现、内存实现（用于测试）。

## 2. File Locations

```
src/infrastructure/ISessionStorage.ts      # 接口定义
src/infrastructure/SessionStorageService.ts # 文件系统实现
src/infrastructure/InMemorySessionStorage.ts # 内存实现（测试用）
```

## 3. Interface Definition

### 3.1 ISessionStorage

```typescript
// src/infrastructure/ISessionStorage.ts

import type { SessionSnapshot, SessionSummary } from '../models/SessionSnapshot.js';

/**
 * Session storage interface
 *
 * Supports dependency injection for testing:
 * - Production: FileSystemSessionStorage
 * - Testing: InMemorySessionStorage
 */
export interface ISessionStorage {
  /**
   * Save a session snapshot
   *
   * @param teamId - Team identifier (used for directory grouping)
   * @param snapshot - Complete session snapshot to persist
   * @throws Error if write fails (disk full, permission denied, etc.)
   */
  saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void>;

  /**
   * Load a specific session by ID
   *
   * @param teamId - Team identifier
   * @param sessionId - Session identifier
   * @returns SessionSnapshot if found and valid, null otherwise
   *
   * Returns null for:
   * - Session not found
   * - File corrupted (invalid JSON)
   * - Schema version incompatible
   */
  loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null>;

  /**
   * Get the most recent session for a team
   *
   * @param teamId - Team identifier
   * @returns Most recent valid SessionSnapshot, or null if none exist
   *
   * Skips corrupted/incompatible files and returns next valid one.
   */
  getLatestSession(teamId: string): Promise<SessionSnapshot | null>;

  /**
   * List all sessions for a team (summaries only)
   *
   * @param teamId - Team identifier
   * @returns Array of SessionSummary, sorted by updatedAt descending (newest first)
   *
   * Skips corrupted/incompatible files silently.
   */
  listSessions(teamId: string): Promise<SessionSummary[]>;

  /**
   * Delete a session
   *
   * @param teamId - Team identifier
   * @param sessionId - Session identifier
   *
   * No-op if session doesn't exist (idempotent).
   */
  deleteSession(teamId: string, sessionId: string): Promise<void>;
}
```

## 4. FileSystem Implementation

### 4.1 Class Definition

```typescript
// src/infrastructure/SessionStorageService.ts

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ISessionStorage } from './ISessionStorage.js';
import type { SessionSnapshot, SessionSummary } from '../models/SessionSnapshot.js';
import { validateSessionSnapshot } from '../utils/SchemaValidator.js';

const CURRENT_SCHEMA_VERSION = '1.0';

export class SessionStorageService implements ISessionStorage {
  private readonly baseDir: string;

  /**
   * @param baseDir - Override base directory (default: ~/.agent-chatter/sessions)
   */
  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(os.homedir(), '.agent-chatter', 'sessions');
  }

  // ... methods below
}
```

### 4.2 Storage Path Convention

```
~/.agent-chatter/
└── sessions/
    └── <teamId>/
        ├── <timestamp>-<sessionId>.json
        ├── 1732700400000-a1b2c3d4.json
        └── 1732786800000-e5f6g7h8.json
```

**Path Components:**

| Component | Description | Example |
|-----------|-------------|---------|
| `baseDir` | Root storage directory | `~/.agent-chatter/sessions` |
| `teamId` | Team identifier (sanitized) | `code-review-team` |
| `timestamp` | Unix milliseconds | `1732700400000` |
| `sessionId` | Session UUID | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |

### 4.3 saveSession

```typescript
async saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void> {
  const teamDir = this.getTeamDir(teamId);
  await this.ensureDir(teamDir);

  // Filename: <timestamp>-<sessionId>.json
  const timestamp = Date.now();
  const filename = `${timestamp}-${snapshot.sessionId}.json`;
  const filePath = path.join(teamDir, filename);

  // Update timestamp before save
  const snapshotToSave: SessionSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };

  // Write atomically (write to temp, then rename)
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(
    tempPath,
    JSON.stringify(snapshotToSave, null, 2),
    'utf-8'
  );
  await fs.promises.rename(tempPath, filePath);
}
```

**Error Handling:**

| Error | Behavior |
|-------|----------|
| `ENOSPC` (disk full) | Throw, let caller handle |
| `EACCES` (permission denied) | Throw, let caller handle |
| `ENOENT` (parent dir missing) | Auto-create via `ensureDir` |

### 4.4 loadSession

```typescript
async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
  const teamDir = this.getTeamDir(teamId);

  if (!fs.existsSync(teamDir)) {
    return null;
  }

  // Find file matching sessionId
  const files = await fs.promises.readdir(teamDir);
  const matchingFile = files.find(f =>
    f.includes(sessionId) && f.endsWith('.json')
  );

  if (!matchingFile) {
    return null;
  }

  const filePath = path.join(teamDir, matchingFile);

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const rawData = JSON.parse(content);

    // Validate schema
    const snapshot = validateSessionSnapshot(rawData);

    // Check schema version compatibility
    if (!this.isSchemaVersionCompatible(snapshot.schemaVersion)) {
      console.warn(
        `⚠️  Session ${sessionId} has incompatible schema version: ${snapshot.schemaVersion}`
      );
      return null;
    }

    return snapshot;
  } catch (err) {
    // JSON parse error or validation error
    console.warn(`⚠️  Failed to load session ${sessionId}: ${(err as Error).message}`);
    return null;
  }
}
```

### 4.5 getLatestSession

```typescript
async getLatestSession(teamId: string): Promise<SessionSnapshot | null> {
  const teamDir = this.getTeamDir(teamId);

  if (!fs.existsSync(teamDir)) {
    return null;
  }

  const files = await fs.promises.readdir(teamDir);

  // Sort by timestamp prefix (descending = newest first)
  const jsonFiles = files
    .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
    .sort()
    .reverse();

  // Try files in order until we find a valid one
  for (const file of jsonFiles) {
    const filePath = path.join(teamDir, file);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const rawData = JSON.parse(content);
      const snapshot = validateSessionSnapshot(rawData);

      if (this.isSchemaVersionCompatible(snapshot.schemaVersion)) {
        return snapshot;
      }
      // Incompatible version, try next file
    } catch {
      // Corrupted file, try next
      continue;
    }
  }

  return null;
}
```

### 4.6 listSessions

```typescript
async listSessions(teamId: string): Promise<SessionSummary[]> {
  const teamDir = this.getTeamDir(teamId);

  if (!fs.existsSync(teamDir)) {
    return [];
  }

  const files = await fs.promises.readdir(teamDir);
  const summaries: SessionSummary[] = [];

  for (const file of files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))) {
    const filePath = path.join(teamDir, file);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const rawData = JSON.parse(content);
      const snapshot = validateSessionSnapshot(rawData);

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
      continue;
    }
  }

  // Sort by updatedAt descending (newest first)
  return summaries.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}
```

### 4.7 deleteSession

```typescript
async deleteSession(teamId: string, sessionId: string): Promise<void> {
  const teamDir = this.getTeamDir(teamId);

  if (!fs.existsSync(teamDir)) {
    return; // Nothing to delete
  }

  const files = await fs.promises.readdir(teamDir);
  const matchingFile = files.find(f =>
    f.includes(sessionId) && f.endsWith('.json')
  );

  if (matchingFile) {
    await fs.promises.unlink(path.join(teamDir, matchingFile));
  }
}
```

### 4.8 Helper Methods

```typescript
/**
 * Check if schema version is compatible with current version
 * Currently: exact match only
 * Future: semver comparison for backwards compatibility
 */
private isSchemaVersionCompatible(version: string): boolean {
  return version === CURRENT_SCHEMA_VERSION;
}

/**
 * Get team directory path
 * Sanitizes teamId for filesystem safety
 */
private getTeamDir(teamId: string): string {
  // Replace unsafe characters with underscores
  const safeTeamId = teamId.replace(/[^a-zA-Z0-9\-_]/g, '_');
  return path.join(this.baseDir, safeTeamId);
}

/**
 * Ensure directory exists (mkdir -p equivalent)
 */
private async ensureDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}
```

## 5. InMemory Implementation (Testing)

```typescript
// src/infrastructure/InMemorySessionStorage.ts

import type { ISessionStorage } from './ISessionStorage.js';
import type { SessionSnapshot, SessionSummary } from '../models/SessionSnapshot.js';

/**
 * In-memory session storage for unit testing
 *
 * Features:
 * - No file I/O
 * - Fast execution
 * - Isolated per test (via clear())
 */
export class InMemorySessionStorage implements ISessionStorage {
  // Map<teamId, Map<sessionId, SessionSnapshot>>
  private sessions: Map<string, Map<string, SessionSnapshot>> = new Map();

  async saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void> {
    if (!this.sessions.has(teamId)) {
      this.sessions.set(teamId, new Map());
    }

    // Clone to prevent external mutations
    const cloned: SessionSnapshot = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
      context: { ...snapshot.context },
      metadata: { ...snapshot.metadata },
    };

    this.sessions.get(teamId)!.set(snapshot.sessionId, cloned);
  }

  async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions) return null;

    const snapshot = teamSessions.get(sessionId);
    return snapshot ? { ...snapshot } : null;
  }

  async getLatestSession(teamId: string): Promise<SessionSnapshot | null> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions || teamSessions.size === 0) return null;

    // Find most recent by updatedAt
    const sorted = [...teamSessions.values()].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return sorted[0] ? { ...sorted[0] } : null;
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
      .sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  async deleteSession(teamId: string, sessionId: string): Promise<void> {
    this.sessions.get(teamId)?.delete(sessionId);
  }

  // Test helpers

  /**
   * Clear all sessions (call in beforeEach)
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get total session count (for assertions)
   */
  getSessionCount(teamId?: string): number {
    if (teamId) {
      return this.sessions.get(teamId)?.size ?? 0;
    }
    let total = 0;
    for (const teamSessions of this.sessions.values()) {
      total += teamSessions.size;
    }
    return total;
  }
}
```

## 6. Dependency Injection

### 6.1 In ConversationCoordinator

```typescript
// src/services/ConversationCoordinator.ts

export interface ConversationCoordinatorOptions {
  // ... existing options ...

  /**
   * Session storage implementation
   * Default: SessionStorageService (file-based)
   */
  sessionStorage?: ISessionStorage;
}

export class ConversationCoordinator {
  private readonly sessionStorage: ISessionStorage;

  constructor(
    agentManager: AgentManager,
    messageRouter: MessageRouter,
    options: ConversationCoordinatorOptions = {}
  ) {
    // Use provided storage or default to file-based
    this.sessionStorage = options.sessionStorage ?? new SessionStorageService();

    // ... rest of constructor
  }
}
```

### 6.2 In Tests

```typescript
// tests/unit/conversationCoordinator.restore.test.ts

import { InMemorySessionStorage } from '../../src/infrastructure/InMemorySessionStorage.js';

describe('ConversationCoordinator - Session Restore', () => {
  let storage: InMemorySessionStorage;
  let coordinator: ConversationCoordinator;

  beforeEach(() => {
    storage = new InMemorySessionStorage();
    coordinator = new ConversationCoordinator(
      mockAgentManager,
      mockMessageRouter,
      { sessionStorage: storage }
    );
  });

  afterEach(() => {
    storage.clear();
  });

  it('should restore session with valid snapshot', async () => {
    // Arrange: save a session
    await storage.saveSession('team-1', mockSnapshot);

    // Act: restore
    await coordinator.setTeam(mockTeam, { resumeSessionId: mockSnapshot.sessionId });

    // Assert
    expect(coordinator.getSession()?.id).toBe(mockSnapshot.sessionId);
  });
});
```

## 7. Error Handling

### 7.1 Error Categories

| Category | Examples | Handling |
|----------|----------|----------|
| **Transient** | Disk full, network timeout | Throw, let caller retry |
| **Permanent** | Permission denied, path too long | Throw, log error |
| **Data Corruption** | Invalid JSON, schema mismatch | Return null, log warning |
| **Not Found** | Session doesn't exist | Return null (not an error) |

### 7.2 Logging

```typescript
// Use console.warn for recoverable issues
console.warn(`⚠️  Session ${sessionId} has incompatible schema version: ${version}`);
console.warn(`⚠️  Failed to load session ${sessionId}: ${error.message}`);

// Use console.error for unexpected failures (save failures)
console.error(`❌  Failed to save session: ${error.message}`);
```

## 8. Concurrency Considerations

### 8.1 Atomic Writes

File writes use atomic pattern (write to `.tmp`, then rename):

```typescript
const tempPath = `${filePath}.tmp`;
await fs.promises.writeFile(tempPath, content, 'utf-8');
await fs.promises.rename(tempPath, filePath);  // Atomic on most filesystems
```

### 8.2 Multiple Instances

Multiple agent-chatter instances writing to same session:
- **Risk**: Last write wins, potential data loss
- **Mitigation**: Each save creates new file (timestamp prefix), so no overwrite
- **Future**: Consider file locking for single-file updates

## 9. Test Cases

```typescript
describe('SessionStorageService', () => {
  describe('saveSession', () => {
    it('should create team directory if not exists');
    it('should write JSON with 2-space indentation');
    it('should update updatedAt timestamp');
    it('should use atomic write pattern');
    it('should throw on disk full');
  });

  describe('loadSession', () => {
    it('should return null for non-existent team');
    it('should return null for non-existent session');
    it('should return null for corrupted JSON');
    it('should return null for incompatible schema version');
    it('should return valid snapshot');
  });

  describe('getLatestSession', () => {
    it('should return null for empty team');
    it('should return most recent by timestamp');
    it('should skip corrupted files');
    it('should skip incompatible versions');
  });

  describe('listSessions', () => {
    it('should return empty array for non-existent team');
    it('should return summaries sorted by updatedAt desc');
    it('should skip corrupted files');
  });

  describe('deleteSession', () => {
    it('should remove file');
    it('should be idempotent (no error if missing)');
  });

  describe('getTeamDir', () => {
    it('should sanitize special characters');
    it('should preserve alphanumeric and hyphens');
  });
});

describe('InMemorySessionStorage', () => {
  it('should behave identically to file-based for all operations');
  it('should isolate data between clear() calls');
});
```

---

**Document Version:** 1.0
**Author:** Claude (Development Agent)
