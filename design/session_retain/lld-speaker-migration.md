# LLD: Speaker Field Migration

**Version:** 1.0
**Date:** 2025-11-27
**Reference:** [high-level-design.md](./high-level-design.md) Section 13

---

## 1. Overview

本文档定义 Speaker 字段从旧格式（roleId/roleName/roleTitle）迁移到新格式（id/name/displayName）的详细设计。

## 2. Problem Statement

### 2.1 Current State

`ConversationMessage.speaker` 使用历史字段命名：

```typescript
// src/models/ConversationMessage.ts (current)
speaker: {
  roleId: string;
  roleName: string;
  roleTitle: string;
  type: 'ai' | 'human' | 'system';
}
```

而 `Team.Member` 使用新字段命名：

```typescript
// src/models/Team.ts
{
  id: string;
  name: string;
  displayName: string;
  type: 'ai' | 'human';
}
```

### 2.2 Goal

统一 speaker 结构与 Team Member 一致：

```typescript
// Target state
speaker: {
  id: string;          // was roleId
  name: string;        // was roleName
  displayName: string; // was roleTitle
  type: 'ai' | 'human' | 'system';
}
```

## 3. Migration Strategy

### 3.1 Core Principle

**写入只用新字段，读取兼容旧字段并映射**

| Operation | Field Usage |
|-----------|-------------|
| **Write** | Only new fields (`id`, `name`, `displayName`) |
| **Read Legacy** | Map old fields to new (`roleId` → `id`) |

### 3.2 File Locations

```
src/models/SpeakerInfo.ts           # New type definition
src/utils/speakerMigration.ts       # Migration utilities
```

## 4. Type Definitions

### 4.1 SpeakerInfo (New)

```typescript
// src/models/SpeakerInfo.ts

/**
 * Speaker information for messages
 * Uses new field naming convention aligned with Team.Member
 */
export interface SpeakerInfo {
  /**
   * Speaker identifier
   * Maps to Team.Member.id
   */
  id: string;

  /**
   * Speaker name (internal identifier)
   * Maps to Team.Member.name
   */
  name: string;

  /**
   * Display name for UI
   * Maps to Team.Member.displayName
   */
  displayName: string;

  /**
   * Speaker type
   */
  type: 'ai' | 'human' | 'system';
}

/**
 * Legacy speaker format (for backwards compatibility)
 * @deprecated Use SpeakerInfo instead
 */
export interface LegacySpeakerInfo {
  roleId: string;
  roleName: string;
  roleTitle: string;
  type: 'ai' | 'human' | 'system';
}

/**
 * Union type for reading (accepts both formats)
 */
export type SpeakerInfoInput = SpeakerInfo | LegacySpeakerInfo;
```

### 4.2 Update ConversationMessage

```typescript
// src/models/ConversationMessage.ts

import type { SpeakerInfo } from './SpeakerInfo.js';

export interface ConversationMessage {
  id: string;
  timestamp: string;
  speaker: SpeakerInfo;  // Changed from inline type
  content: string;
  routing?: RoutingInfo;
}
```

## 5. Migration Utilities

### 5.1 Module: speakerMigration.ts

```typescript
// src/utils/speakerMigration.ts

import type { SpeakerInfo, LegacySpeakerInfo, SpeakerInfoInput } from '../models/SpeakerInfo.js';

/**
 * Check if speaker info is in legacy format
 */
export function isLegacySpeaker(speaker: unknown): speaker is LegacySpeakerInfo {
  if (typeof speaker !== 'object' || speaker === null) {
    return false;
  }
  const s = speaker as Record<string, unknown>;
  return 'roleId' in s && !('id' in s);
}

/**
 * Check if speaker info is in new format
 */
export function isNewSpeaker(speaker: unknown): speaker is SpeakerInfo {
  if (typeof speaker !== 'object' || speaker === null) {
    return false;
  }
  const s = speaker as Record<string, unknown>;
  return 'id' in s && 'name' in s && 'displayName' in s;
}

/**
 * Migrate speaker from legacy format to new format
 *
 * @param speaker - Speaker info (legacy or new format)
 * @returns Speaker in new format
 *
 * If already new format, returns as-is.
 * If legacy format, maps fields:
 *   roleId → id
 *   roleName → name
 *   roleTitle → displayName
 */
export function migrateMessageSpeaker(speaker: SpeakerInfoInput): SpeakerInfo {
  // Already new format
  if (isNewSpeaker(speaker)) {
    return speaker;
  }

  // Legacy format - migrate
  if (isLegacySpeaker(speaker)) {
    return {
      id: speaker.roleId,
      name: speaker.roleName,
      displayName: speaker.roleTitle ?? speaker.roleName,
      type: speaker.type,
    };
  }

  // Unknown format - should not happen, but handle gracefully
  console.warn('⚠️  Unknown speaker format, attempting fallback');
  const s = speaker as Record<string, unknown>;
  return {
    id: String(s.roleId ?? s.id ?? 'unknown'),
    name: String(s.roleName ?? s.name ?? 'unknown'),
    displayName: String(s.roleTitle ?? s.displayName ?? s.roleName ?? s.name ?? 'Unknown'),
    type: (s.type as 'ai' | 'human' | 'system') ?? 'ai',
  };
}

/**
 * Migrate all messages in an array
 *
 * @param messages - Array of messages (may contain mixed formats)
 * @returns New array with all speakers in new format
 */
export function migrateMessages(messages: Array<{ speaker: SpeakerInfoInput; [key: string]: unknown }>): Array<{ speaker: SpeakerInfo; [key: string]: unknown }> {
  return messages.map(msg => ({
    ...msg,
    speaker: migrateMessageSpeaker(msg.speaker),
  }));
}
```

### 5.2 Factory: createSpeakerInfo

```typescript
// src/utils/speakerMigration.ts (continued)

import type { Member } from '../models/Team.js';

/**
 * Create SpeakerInfo from Team Member
 * Used when creating new messages
 *
 * @param member - Team member
 * @returns SpeakerInfo in new format
 */
export function createSpeakerFromMember(member: Member): SpeakerInfo {
  return {
    id: member.id,
    name: member.name,
    displayName: member.displayName,
    type: member.type,
  };
}

/**
 * Create system speaker info
 */
export function createSystemSpeaker(): SpeakerInfo {
  return {
    id: 'system',
    name: 'system',
    displayName: 'System',
    type: 'system',
  };
}
```

## 6. Integration Points

### 6.1 Message Creation (Write Path)

```typescript
// src/services/ConversationCoordinator.ts

import { createSpeakerFromMember } from '../utils/speakerMigration.js';

// When creating a new message
function createMessage(member: Member, content: string): ConversationMessage {
  return {
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    speaker: createSpeakerFromMember(member),  // ✅ New format only
    content,
  };
}
```

### 6.2 Session Restore (Read Path)

```typescript
// src/services/ConversationCoordinator.ts

import { migrateMessages } from '../utils/speakerMigration.js';

private async restoreSession(sessionId: string): Promise<void> {
  const snapshot = await this.sessionStorage.loadSession(this.team!.id, sessionId);

  // Migrate messages from legacy format if needed
  const migratedMessages = migrateMessages(snapshot.context.messages);

  // Import with migrated messages
  this.contextManager.importSnapshot({
    ...snapshot.context,
    messages: migratedMessages,
  });
}
```

### 6.3 Prompt Building

```typescript
// src/utils/PromptBuilder.ts

// Messages are already in new format after migration
// PromptBuilder uses speaker.name and speaker.displayName directly
function formatMessage(msg: ConversationMessage): string {
  return `[${msg.speaker.displayName}]: ${msg.content}`;
}
```

## 7. Schema Support

### 7.1 JSON Schema (session-snapshot-v1.0.json)

Schema supports both formats via `oneOf`:

```json
{
  "SpeakerInfo": {
    "type": "object",
    "required": ["type"],
    "oneOf": [
      {
        "required": ["roleId", "roleName", "roleTitle", "type"],
        "description": "Legacy format"
      },
      {
        "required": ["id", "name", "displayName", "type"],
        "description": "New format"
      }
    ]
  }
}
```

### 7.2 Validation

Schema validation accepts both formats. Migration happens after validation.

## 8. Migration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WRITE PATH                                   │
│                                                                      │
│  Member ──► createSpeakerFromMember() ──► SpeakerInfo (new format)  │
│                                                ↓                     │
│                                         ConversationMessage          │
│                                                ↓                     │
│                                         ContextManager               │
│                                                ↓                     │
│                                         exportSnapshot()             │
│                                                ↓                     │
│                                         SessionSnapshot              │
│                                         (new format only)            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         READ PATH                                    │
│                                                                      │
│  SessionSnapshot ──► loadSession() ──► Raw messages                 │
│  (may be legacy)                            ↓                        │
│                                    migrateMessages()                 │
│                                            ↓                         │
│                                    SpeakerInfo (new format)          │
│                                            ↓                         │
│                                    importSnapshot()                  │
│                                            ↓                         │
│                                    ContextManager                    │
│                                    (new format only)                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 9. Affected Files

### 9.1 Files to Modify

| File | Changes |
|------|---------|
| `src/models/ConversationMessage.ts` | Update speaker type to `SpeakerInfo` |
| `src/services/ConversationCoordinator.ts` | Use `createSpeakerFromMember()` for new messages |
| `src/context/ContextManager.ts` | No change (works with new format) |
| `src/utils/PromptBuilder.ts` | Update field references (`roleId` → `id`, etc.) |

### 9.2 Files to Create

| File | Purpose |
|------|---------|
| `src/models/SpeakerInfo.ts` | Type definitions |
| `src/utils/speakerMigration.ts` | Migration utilities |

## 10. Backwards Compatibility

### 10.1 Existing Sessions

- Legacy sessions can still be loaded
- Migration happens transparently on load
- No manual migration required

### 10.2 Runtime Behavior

- All in-memory messages use new format
- All new saves use new format
- Legacy format only exists in old files on disk

### 10.3 API Stability

- TypeScript types enforce new format at compile time
- Runtime migration handles legacy at load time
- External consumers (if any) should migrate to new types

## 11. Test Cases

```typescript
describe('Speaker Migration', () => {
  describe('isLegacySpeaker', () => {
    it('should return true for legacy format');
    it('should return false for new format');
    it('should return false for invalid input');
  });

  describe('isNewSpeaker', () => {
    it('should return true for new format');
    it('should return false for legacy format');
    it('should return false for invalid input');
  });

  describe('migrateMessageSpeaker', () => {
    it('should migrate roleId to id');
    it('should migrate roleName to name');
    it('should migrate roleTitle to displayName');
    it('should preserve type field');
    it('should return new format unchanged');
    it('should handle missing roleTitle (fallback to roleName)');
  });

  describe('migrateMessages', () => {
    it('should migrate all messages in array');
    it('should handle mixed formats');
    it('should return new array (no mutation)');
  });

  describe('createSpeakerFromMember', () => {
    it('should create SpeakerInfo from Member');
    it('should use new field names');
  });

  describe('Integration', () => {
    it('should load legacy session and migrate speakers');
    it('should save new sessions with new format only');
    it('should round-trip correctly (save → load → compare)');
  });
});
```

## 12. Rollout Plan

### Phase 1: Add New Code (Non-Breaking)
1. Add `SpeakerInfo.ts` type definitions
2. Add `speakerMigration.ts` utilities
3. Add tests for migration functions

### Phase 2: Update Write Path
1. Update `ConversationCoordinator` to use `createSpeakerFromMember()`
2. Update any other message creation points

### Phase 3: Update Read Path
1. Add migration to session restore
2. Ensure all loaded messages are in new format

### Phase 4: Update Types (Breaking for Internal)
1. Change `ConversationMessage.speaker` type
2. Update `PromptBuilder` field references
3. Fix any TypeScript errors

---

**Document Version:** 1.0
**Author:** Claude (Development Agent)
