# Detailed Design: AgentEvent.ts - Todo Types

**Parent Document**: [high-level-design.md](./high-level-design.md)
**Target File**: `src/events/AgentEvent.ts`
**Status**: Pending Architecture Committee Review

---

## 1. Overview

Add unified todo list types to the AgentEvent schema to support parsing todo events from all three agents (Claude, Codex, Gemini).

---

## 2. New Types

### 2.1 TodoStatus

```typescript
/**
 * Status of a todo item.
 * - 'pending': Task not yet started
 * - 'in_progress': Task currently being worked on
 * - 'completed': Task finished successfully
 * - 'cancelled': Task was cancelled (Gemini only)
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
```

### 2.2 TodoItem

```typescript
/**
 * A single todo item in a todo list.
 */
export interface TodoItem {
  /** Task description (required, non-empty) */
  text: string;
  /** Current status of the task */
  status: TodoStatus;
}
```

**Design Decisions**:
- Use `text` (not `content` or `description`) as unified field name for simplicity
- Architecture committee suggestion: Consider using `hash(text)` as stable key in future if reordering issues arise

### 2.3 TodoListEvent

```typescript
/**
 * Event emitted when an agent updates its todo list.
 * Each event carries the full list of items (not deltas).
 * UI should replace the previous list entirely.
 */
export interface TodoListEvent extends AgentEventBase {
  type: 'todo_list';
  /** Unique identifier for this todo list instance */
  todoId: string;
  /** Complete list of todo items (replaces previous list) */
  items: TodoItem[];
}
```

**Design Decisions**:
- Single `'todo_list'` type instead of `started/updated/completed` variants
- Full replacement model (not delta/patch) for simplicity
- `todoId` allows tracking same list across updates

---

## 3. Updated AgentEvent Union

```typescript
export type AgentEvent =
  | SessionStartedEvent
  | TextEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | TurnCompletedEvent
  | ErrorEvent
  | TodoListEvent;  // NEW
```

---

## 4. Validation Helper (Optional)

```typescript
/**
 * Validate a TodoItem. Returns true if valid.
 * Invalid items should be skipped (not crash).
 */
export function isValidTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.text !== 'string' || obj.text.trim() === '') return false;
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(obj.status as string)) return false;
  return true;
}
```

---

## 5. Complete File After Changes

```typescript
import type { TeamContext } from '../models/Team.js';

export type AgentType = 'claude-code' | 'openai-codex' | 'google-gemini';

export interface AgentEventBase {
  eventId: string;
  agentId: string;
  agentType: AgentType;
  timestamp: number;
  teamMetadata: TeamContext;
}

export interface SessionStartedEvent extends AgentEventBase {
  type: 'session.started';
}

export interface TextEvent extends AgentEventBase {
  type: 'text';
  text: string;
  role?: 'assistant' | 'system';
  category?: string;
}

export interface ToolStartedEvent extends AgentEventBase {
  type: 'tool.started';
  toolName: string;
  toolId: string;
  input: Record<string, any>;
}

export interface ToolCompletedEvent extends AgentEventBase {
  type: 'tool.completed';
  toolId: string;
  output?: string;
  error?: string;
}

export interface TurnCompletedEvent extends AgentEventBase {
  type: 'turn.completed';
  finishReason: 'done' | 'error' | 'cancelled' | 'timeout';
}

export interface ErrorEvent extends AgentEventBase {
  type: 'error';
  error: string;
  code?: string;
  stack?: string;
}

// ===== NEW: Todo List Types =====

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  text: string;
  status: TodoStatus;
}

export interface TodoListEvent extends AgentEventBase {
  type: 'todo_list';
  todoId: string;
  items: TodoItem[];
}

export function isValidTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.text !== 'string' || obj.text.trim() === '') return false;
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(obj.status as string)) return false;
  return true;
}

// ===== END NEW =====

export type AgentEvent =
  | SessionStartedEvent
  | TextEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | TurnCompletedEvent
  | ErrorEvent
  | TodoListEvent;
```

---

## 6. Impact Analysis

| Consumer | Impact | Action Required |
|----------|--------|-----------------|
| Parsers (Claude, Codex, Gemini) | Must emit `TodoListEvent` | Covered in parser detail designs |
| ReplModeInk | Must handle `todo_list` event | Covered in REPL detail design |
| JsonlMessageFormatter | Must serialize `todo_list` | Covered in formatter detail design |
| Existing event handlers | No impact | Union type is backward compatible |

---

## 7. Test Cases

1. `TodoStatus` type accepts all valid values
2. `TodoItem` requires non-empty `text` and valid `status`
3. `isValidTodoItem` returns false for invalid items
4. `TodoListEvent` serializes/deserializes correctly
5. Empty `items` array is valid (represents cleared todo)

---

**Document Version**: 1.0
**Author**: Claude (Development Agent)
**Status**: Pending Architecture Committee Review
