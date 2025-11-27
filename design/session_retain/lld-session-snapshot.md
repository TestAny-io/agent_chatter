# LLD: SessionSnapshot Data Model

**Version:** 1.0
**Date:** 2025-11-27
**Reference:** [high-level-design.md](./high-level-design.md) Section 2

---

## 1. Overview

本文档定义 `SessionSnapshot` 数据模型的详细设计，包括类型定义、字段规范、与现有类型的关系。

## 2. File Location

```
src/models/SessionSnapshot.ts
```

## 3. Type Definitions

### 3.1 SessionSnapshot

```typescript
import type { ContextSnapshot } from '../context/types.js';

/**
 * Metadata for session display and restore logic
 */
export interface SessionMetadata {
  /**
   * Last speaker's ID (for display/debug)
   * Uses new field name 'id' (not legacy 'roleId')
   */
  lastSpeakerId?: string;

  /**
   * Total message count (for quick display without parsing messages)
   */
  messageCount: number;

  /**
   * Human-readable summary for restore prompt
   * Format: "{count} messages - \"{preview}...\""
   */
  summary?: string;
}

/**
 * Persisted session snapshot
 * Storage path: ~/.agent-chatter/sessions/<teamId>/<timestamp>-<sessionId>.json
 */
export interface SessionSnapshot {
  /**
   * Schema version for file format migration
   * Current: "1.0"
   */
  schemaVersion: '1.0';

  /**
   * Team identifier
   * Must match current team on restore
   */
  teamId: string;

  /**
   * Unique session identifier
   * Format: UUID v4
   */
  sessionId: string;

  /**
   * Session creation timestamp
   * Format: ISO 8601 (e.g., "2025-11-27T10:30:00.000Z")
   */
  createdAt: string;

  /**
   * Last update timestamp
   * Format: ISO 8601
   */
  updatedAt: string;

  /**
   * Core context data from ContextManager.exportSnapshot()
   *
   * Note: This directly uses ContextSnapshot type.
   * Does NOT include todos (todos are UI state, not persisted).
   */
  context: ContextSnapshot;

  /**
   * Additional metadata for restore logic and display
   */
  metadata: SessionMetadata;
}
```

### 3.2 SessionSummary

```typescript
/**
 * Lightweight session info for listing
 * Used by listSessions() to avoid loading full snapshots
 */
export interface SessionSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
}
```

## 4. Field Specifications

### 4.1 schemaVersion

| Property | Value |
|----------|-------|
| Type | `'1.0'` (literal) |
| Required | Yes |
| Purpose | File format versioning for future migrations |
| Validation | Must be exactly `"1.0"` for current version |

**Version History:**
- `1.0`: Initial version (current)

### 4.2 teamId

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | Yes |
| Validation | Non-empty, must match `Team.id` on restore |
| Filesystem | Sanitized for directory name (alphanumeric, `-`, `_`) |

### 4.3 sessionId

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | Yes |
| Format | UUID v4 (e.g., `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`) |
| Source | From `ConversationSession.id` |

### 4.4 createdAt / updatedAt

| Property | Value |
|----------|-------|
| Type | `string` |
| Required | Yes |
| Format | ISO 8601 with timezone (e.g., `"2025-11-27T10:30:00.000Z"`) |
| Generation | `new Date().toISOString()` |

### 4.5 context

| Property | Value |
|----------|-------|
| Type | `ContextSnapshot` (from `src/context/types.ts`) |
| Required | Yes |
| Source | `ContextManager.exportSnapshot()` |
| Contains | `messages`, `teamTask`, `timestamp`, `version` |

**Important:** `context.version` is internal data version (always `1`), different from `schemaVersion`.

### 4.6 metadata

| Property | Value |
|----------|-------|
| Type | `SessionMetadata` |
| Required | Yes |
| Purpose | Quick access to session info without parsing context |

## 5. Relationship with Existing Types

```
┌─────────────────────────────────────────────────────────────┐
│                      SessionSnapshot                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ context: ContextSnapshot                             │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │ messages: ConversationMessage[]              │    │   │
│  │  │  ┌─────────────────────────────────────┐    │    │   │
│  │  │  │ speaker: SpeakerInfo                 │    │    │   │
│  │  │  │  - id: string                        │    │    │   │
│  │  │  │  - name: string                      │    │    │   │
│  │  │  │  - displayName: string               │    │    │   │
│  │  │  │  - type: 'ai' | 'human' | 'system'   │    │    │   │
│  │  │  └─────────────────────────────────────┘    │    │   │
│  │  │ teamTask: string | null                      │    │   │
│  │  │ timestamp: number                            │    │   │
│  │  │ version: 1                                   │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
│  metadata: SessionMetadata                                  │
└─────────────────────────────────────────────────────────────┘
```

## 6. Factory Functions

### 6.1 createSessionSnapshot

```typescript
/**
 * Create a new SessionSnapshot from current session state
 */
export function createSessionSnapshot(
  session: ConversationSession,
  contextSnapshot: ContextSnapshot
): SessionSnapshot {
  const messages = contextSnapshot.messages;
  const lastMessage = messages[messages.length - 1];

  return {
    schemaVersion: '1.0',
    teamId: session.teamId,
    sessionId: session.id,
    createdAt: session.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
    context: contextSnapshot,
    metadata: {
      lastSpeakerId: lastMessage?.speaker.id,
      messageCount: messages.length,
      summary: generateSummary(messages),
    },
  };
}

/**
 * Generate human-readable summary from messages
 */
function generateSummary(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return 'Empty conversation';
  }

  const firstMsg = messages[0];
  const preview = firstMsg.content.substring(0, 50);
  const ellipsis = firstMsg.content.length > 50 ? '...' : '';

  return `${messages.length} messages - "${preview}${ellipsis}"`;
}
```

### 6.2 extractSessionSummary

```typescript
/**
 * Extract SessionSummary from SessionSnapshot
 * For use in listSessions() to avoid returning full context
 */
export function extractSessionSummary(snapshot: SessionSnapshot): SessionSummary {
  return {
    sessionId: snapshot.sessionId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    messageCount: snapshot.metadata.messageCount,
    summary: snapshot.metadata.summary,
  };
}
```

## 7. Validation

### 7.1 Runtime Validation

Use JSON Schema validation (see [lld-schema-validator.md](./lld-schema-validator.md)):

```typescript
import { validateSessionSnapshot } from '../utils/SchemaValidator.js';

// Throws if invalid
const snapshot = validateSessionSnapshot(rawData);
```

### 7.2 TypeScript Compile-time

Type definitions provide compile-time safety. No runtime overhead.

## 8. Serialization

### 8.1 To JSON (Save)

```typescript
const json = JSON.stringify(snapshot, null, 2);
```

### 8.2 From JSON (Load)

```typescript
const rawData = JSON.parse(fileContent);
const snapshot = validateSessionSnapshot(rawData);
```

## 9. Example

```json
{
  "schemaVersion": "1.0",
  "teamId": "code-review-team",
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "createdAt": "2025-11-27T10:00:00.000Z",
  "updatedAt": "2025-11-27T14:30:00.000Z",
  "context": {
    "messages": [
      {
        "id": "msg-001",
        "timestamp": "2025-11-27T10:00:00.000Z",
        "speaker": {
          "id": "claude",
          "name": "claude",
          "displayName": "Claude Code",
          "type": "ai"
        },
        "content": "I'll review the authentication module...",
        "routing": {
          "rawNextMarkers": ["[NEXT:human]"],
          "resolvedAddressees": [
            { "identifier": "human", "roleId": "human", "roleName": "human" }
          ]
        }
      }
    ],
    "teamTask": "Review authentication module for security issues",
    "timestamp": 1732712400000,
    "version": 1
  },
  "metadata": {
    "lastSpeakerId": "claude",
    "messageCount": 1,
    "summary": "1 messages - \"I'll review the authentication module...\""
  }
}
```

## 10. Test Cases

```typescript
describe('SessionSnapshot', () => {
  describe('createSessionSnapshot', () => {
    it('should create snapshot with correct schemaVersion');
    it('should include all context fields');
    it('should calculate correct messageCount');
    it('should generate summary from first message');
    it('should handle empty messages array');
  });

  describe('extractSessionSummary', () => {
    it('should extract only summary fields');
    it('should not include context');
  });
});
```

---

**Document Version:** 1.0
**Author:** Claude (Development Agent)
