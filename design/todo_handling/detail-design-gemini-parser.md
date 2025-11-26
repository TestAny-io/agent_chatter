# Detailed Design: GeminiParser - write_todos Handling

**Parent Document**: [high-level-design.md](./high-level-design.md)
**Target File**: `src/events/parsers/GeminiParser.ts`
**Status**: Pending Architecture Committee Review

---

## 1. Overview

Update GeminiParser to:
1. Parse `write_todos` tool calls and emit unified `TodoListEvent`
2. **Suppress** emitting `tool.started` for `write_todos` to avoid UI redundancy

---

## 2. Gemini Native Schema

Gemini emits todo lists via `tool_use` events:

```typescript
// tool_use event
{
  "type": "tool_use",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tool_name": "write_todos",
  "tool_id": "call_123",
  "parameters": {
    "todos": [
      { "description": "Research existing metrics", "status": "pending" },
      { "description": "Design the system", "status": "in_progress" }
    ]
  }
}

// tool_result event (not used for todo parsing)
{
  "type": "tool_result",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tool_id": "call_123",
  "status": "success",
  "output": "Successfully updated the todo list..."
}
```

---

## 3. Transformation Logic

### 3.1 Event Mapping

| Native Event | Condition | Emit |
|--------------|-----------|------|
| `tool_use` | `tool_name === 'write_todos'` | `TodoListEvent` only (NOT `tool.started`) |
| `tool_use` | `tool_name !== 'write_todos'` | `tool.started` (existing behavior) |

### 3.2 Field Mapping

```typescript
// Gemini native -> Unified TodoItem
function mapGeminiTodoItem(item: { description: string; status: string }): TodoItem {
  return {
    text: item.description,  // Gemini uses 'description', we use 'text'
    status: item.status as TodoStatus  // Gemini status matches our enum
  };
}
```

### 3.3 TodoId Generation

Use `tool_id` from Gemini as `todoId`:
```typescript
todoId: json.tool_id ?? json.id  // e.g., "call_123"
```

---

## 4. Code Changes

### 4.1 Add Import

```typescript
import type { AgentEvent, AgentType, TodoItem, TodoStatus } from '../AgentEvent.js';
import { isValidTodoItem } from '../AgentEvent.js';
```

### 4.2 Update jsonToEvent Method - tool_use case

Current code emits `tool.started` for all tool_use events. We need to check for `write_todos` and emit `TodoListEvent` instead.

**Before**:
```typescript
case 'tool_use':
  return {
    ...base,
    type: 'tool.started',
    toolName: json.tool_name ?? json.name,
    toolId: json.tool_id ?? json.id,
    input: json.parameters ?? json.input ?? {}
  };
```

**After**:
```typescript
case 'tool_use': {
  const toolName = json.tool_name ?? json.name;

  // Check for write_todos - emit TodoListEvent instead of tool.started
  if (toolName === 'write_todos') {
    return this.parseWriteTodosEvent(json, base);
  }

  return {
    ...base,
    type: 'tool.started',
    toolName,
    toolId: json.tool_id ?? json.id,
    input: json.parameters ?? json.input ?? {}
  };
}
```

### 4.3 Add parseWriteTodosEvent Helper

```typescript
/**
 * Parse Gemini write_todos tool call into unified TodoListEvent.
 * Validates items and skips invalid ones.
 */
private parseWriteTodosEvent(json: any, base: any): AgentEvent | null {
  const parameters = json.parameters ?? json.input;
  if (!parameters || !Array.isArray(parameters.todos)) {
    return null;
  }

  const items: TodoItem[] = [];
  for (const todoItem of parameters.todos) {
    const mapped: TodoItem = {
      text: todoItem.description,  // Gemini uses 'description'
      status: todoItem.status as TodoStatus
    };
    if (isValidTodoItem(mapped)) {
      items.push(mapped);
    }
  }

  return {
    ...base,
    type: 'todo_list',
    todoId: json.tool_id ?? json.id ?? randomUUID(),
    items
  };
}
```

---

## 5. Complete Updated File

```typescript
import { randomUUID } from 'crypto';
import type { AgentEvent, AgentType, TodoItem, TodoStatus } from '../AgentEvent.js';
import { isValidTodoItem } from '../AgentEvent.js';
import type { StreamParser } from '../StreamParser.js';
import type { TeamContext } from '../../models/Team.js';

export class GeminiParser implements StreamParser {
  private buffer = '';
  private readonly agentType: AgentType = 'google-gemini';

  constructor(private agentId: string, private teamContext: TeamContext) {}

  parseChunk(chunk: Buffer): AgentEvent[] {
    this.buffer += chunk.toString('utf-8');
    const events: AgentEvent[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        const ev = this.jsonToEvent(json);
        if (ev) events.push(ev);
      } catch (err: any) {
        events.push({
          type: 'error',
          eventId: randomUUID(),
          agentId: this.agentId,
          agentType: this.agentType,
          teamMetadata: this.teamContext,
          timestamp: Date.now(),
          error: `Failed to parse JSONL: ${err?.message ?? String(err)}`,
          code: 'JSONL_PARSE_ERROR'
        });
      }
    }
    return events;
  }

  flush(): AgentEvent[] {
    if (this.buffer.trim()) {
      const text = this.buffer;
      this.buffer = '';
      try {
        const json = JSON.parse(text);
        const ev = this.jsonToEvent(json);
        if (ev) return [ev];
      } catch {
        // fall through
      }
      return [{
        type: 'text',
        eventId: randomUUID(),
        agentId: this.agentId,
        agentType: this.agentType,
        teamMetadata: this.teamContext,
        timestamp: Date.now(),
        text
      }];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }

  private jsonToEvent(json: any): AgentEvent | null {
    const base = {
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now()
    };

    switch (json.type) {
      case 'init':
        return { ...base, type: 'session.started' };

      case 'message':
        if (json.role === 'user') {
          return null;
        }
        return {
          ...base,
          type: 'text',
          text: json.content,
          role: ['assistant', 'system'].includes(json.role) ? json.role as 'assistant' | 'system' : undefined,
          category: json.role === 'assistant' ? 'message' : undefined
        };

      case 'tool_use': {
        const toolName = json.tool_name ?? json.name;

        // Check for write_todos - emit TodoListEvent instead of tool.started
        if (toolName === 'write_todos') {
          return this.parseWriteTodosEvent(json, base);
        }

        return {
          ...base,
          type: 'tool.started',
          toolName,
          toolId: json.tool_id ?? json.id,
          input: json.parameters ?? json.input ?? {}
        };
      }

      case 'tool_result':
        return {
          ...base,
          type: 'tool.completed',
          toolId: json.tool_id ?? json.tool_use_id,
          output: typeof json.output === 'string' ? json.output : json.output?.text ?? undefined,
          error: json.status && json.status !== 'success' ? json.status : undefined
        };

      case 'result':
        return {
          ...base,
          type: 'turn.completed',
          finishReason: json.status === 'success' ? 'done' : 'error'
        };

      default:
        return null;
    }
  }

  /**
   * Parse Gemini write_todos tool call into unified TodoListEvent.
   */
  private parseWriteTodosEvent(json: any, base: any): AgentEvent | null {
    const parameters = json.parameters ?? json.input;
    if (!parameters || !Array.isArray(parameters.todos)) {
      return null;
    }

    const items: TodoItem[] = [];
    for (const todoItem of parameters.todos) {
      const mapped: TodoItem = {
        text: todoItem.description,
        status: todoItem.status as TodoStatus
      };
      if (isValidTodoItem(mapped)) {
        items.push(mapped);
      }
    }

    return {
      ...base,
      type: 'todo_list',
      todoId: json.tool_id ?? json.id ?? randomUUID(),
      items
    };
  }
}
```

---

## 6. Key Design Decisions

### 6.1 Suppression of tool.started

Per architecture committee feedback, `write_todos` should NOT emit `tool.started` to avoid UI redundancy. The `TodoListEvent` is the only event emitted.

### 6.2 Field Mapping

- Gemini uses `description`, we map to `text`
- Gemini's status values (`'pending'`, `'in_progress'`, `'completed'`, `'cancelled'`) match our `TodoStatus` enum directly

### 6.3 Parameters Access

Gemini may use either `parameters` or `input` for tool arguments. We check both:
```typescript
const parameters = json.parameters ?? json.input;
```

---

## 7. Test Cases

1. `tool_use` with `tool_name: 'write_todos'` emits `TodoListEvent`
2. `tool_use` with `tool_name: 'write_todos'` does NOT emit `tool.started`
3. `tool_use` with other `tool_name` values still emits `tool.started`
4. `description` field maps to `text`
5. Status values map directly: `pending`, `in_progress`, `completed`, `cancelled`
6. Invalid todo items (empty description) are skipped
7. `todoId` is taken from `tool_id` or `id`
8. Works with both `parameters` and `input` field names

---

**Document Version**: 1.0
**Author**: Claude (Development Agent)
**Status**: Pending Architecture Committee Review
