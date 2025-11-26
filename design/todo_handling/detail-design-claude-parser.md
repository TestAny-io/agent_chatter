# Detailed Design: ClaudeCodeParser - TodoWrite Handling

**Parent Document**: [high-level-design.md](./high-level-design.md)
**Target File**: `src/events/parsers/ClaudeCodeParser.ts`
**Status**: Pending Architecture Committee Review

---

## 1. Overview

Update ClaudeCodeParser to:
1. Parse `TodoWrite` tool calls and emit unified `TodoListEvent`
2. **Suppress** emitting `tool.started` for `TodoWrite` to avoid UI redundancy

---

## 2. Claude Native Schema

Claude emits todo lists via `tool_use` events:

```typescript
// assistant message with tool_use
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "id": "toolu_01ABC",
      "name": "TodoWrite",
      "input": {
        "todos": [
          { "content": "Research existing metrics", "status": "in_progress", "activeForm": "Researching..." },
          { "content": "Design the system", "status": "pending", "activeForm": "Designing..." }
        ]
      }
    }]
  }
}
```

---

## 3. Transformation Logic

### 3.1 Event Mapping

| Native Event | Condition | Emit |
|--------------|-----------|------|
| `assistant` (tool_use) | `name === 'TodoWrite'` | `TodoListEvent` only (NOT `tool.started`) |
| `assistant` (tool_use) | `name !== 'TodoWrite'` | `tool.started` (existing behavior) |

### 3.2 Field Mapping

```typescript
// Claude native -> Unified TodoItem
function mapClaudeTodoItem(item: { content: string; status: string; activeForm?: string }): TodoItem {
  return {
    text: item.content,
    status: item.status as TodoStatus  // Claude status already matches our enum
  };
}
```

### 3.3 TodoId Generation

Use `tool_use.id` from Claude as `todoId`:
```typescript
todoId: item.id  // e.g., "toolu_01ABC"
```

---

## 4. Code Changes

### 4.1 Add Import

```typescript
import type { AgentEvent, AgentType, TodoItem, TodoListEvent, TodoStatus } from '../AgentEvent.js';
import { isValidTodoItem } from '../AgentEvent.js';
```

### 4.2 Update jsonToEvents Method - assistant case

Current code emits `tool.started` for all tool_use items. We need to check for `TodoWrite` and emit `TodoListEvent` instead.

**Before**:
```typescript
case 'assistant': {
  const content = json.message?.content || [];
  const evs: AgentEvent[] = [];
  for (const item of content) {
    if (item.type === 'text') {
      evs.push({ ...base, eventId: randomUUID(), type: 'text', text: item.text, role: 'assistant', category: 'assistant-message' });
    } else if (item.type === 'tool_use') {
      evs.push({
        ...base,
        eventId: randomUUID(),
        type: 'tool.started',
        toolName: item.name,
        toolId: item.id,
        input: item.input || {}
      });
    }
  }
  return evs;
}
```

**After**:
```typescript
case 'assistant': {
  const content = json.message?.content || [];
  const evs: AgentEvent[] = [];
  for (const item of content) {
    if (item.type === 'text') {
      evs.push({ ...base, eventId: randomUUID(), type: 'text', text: item.text, role: 'assistant', category: 'assistant-message' });
    } else if (item.type === 'tool_use') {
      // Check for TodoWrite - emit TodoListEvent instead of tool.started
      if (item.name === 'TodoWrite') {
        const todoEvent = this.parseTodoWriteEvent(item, base);
        if (todoEvent) {
          evs.push(todoEvent);
        }
        // Do NOT emit tool.started for TodoWrite
      } else {
        evs.push({
          ...base,
          eventId: randomUUID(),
          type: 'tool.started',
          toolName: item.name,
          toolId: item.id,
          input: item.input || {}
        });
      }
    }
  }
  return evs;
}
```

### 4.3 Update jsonToEvents Method - tool_use case (top-level)

The parser also has a separate `tool_use` case. Apply same logic:

**Before**:
```typescript
case 'tool_use':
  return [{
    ...base,
    type: 'tool.started',
    toolName: json.name,
    toolId: json.id,
    input: json.input || {}
  }];
```

**After**:
```typescript
case 'tool_use':
  // Check for TodoWrite - emit TodoListEvent instead of tool.started
  if (json.name === 'TodoWrite') {
    const todoEvent = this.parseTodoWriteEvent(json, base);
    return todoEvent ? [todoEvent] : [];
  }
  return [{
    ...base,
    type: 'tool.started',
    toolName: json.name,
    toolId: json.id,
    input: json.input || {}
  }];
```

### 4.4 Add parseTodoWriteEvent Helper

```typescript
/**
 * Parse Claude TodoWrite tool call into unified TodoListEvent.
 * Validates items and skips invalid ones.
 */
private parseTodoWriteEvent(item: any, base: any): TodoListEvent | null {
  const input = item.input;
  if (!input || !Array.isArray(input.todos)) {
    return null;
  }

  const items: TodoItem[] = [];
  for (const todoItem of input.todos) {
    const mapped: TodoItem = {
      text: todoItem.content,
      status: todoItem.status as TodoStatus
    };
    if (isValidTodoItem(mapped)) {
      items.push(mapped);
    }
  }

  return {
    ...base,
    eventId: randomUUID(),
    type: 'todo_list',
    todoId: item.id || randomUUID(),
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

export class ClaudeCodeParser implements StreamParser {
  private buffer = '';
  private readonly agentType: AgentType = 'claude-code';

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
        const evs = this.jsonToEvents(json);
        if (evs.length) events.push(...evs);
      } catch (err: any) {
        events.push(this.parseErrorEvent(err));
        events.push(this.fallbackTextEvent(line));
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
        const evs = this.jsonToEvents(json);
        if (evs.length) return evs;
      } catch {
        // fall through to text event
      }
      return [this.fallbackTextEvent(text)];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }

  private jsonToEvents(json: any): AgentEvent[] {
    const base = {
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now()
    };

    switch (json.type) {
      case 'system':
        if (json.subtype === 'init') {
          return [{ ...base, type: 'session.started' }];
        }
        return [];

      case 'content_block_delta':
        if (json.delta?.type === 'text_delta') {
          return [{ ...base, type: 'text', text: json.delta.text, role: 'assistant', category: 'assistant-message' }];
        }
        return [];

      case 'assistant': {
        const content = json.message?.content || [];
        const evs: AgentEvent[] = [];
        for (const item of content) {
          if (item.type === 'text') {
            evs.push({ ...base, eventId: randomUUID(), type: 'text', text: item.text, role: 'assistant', category: 'assistant-message' });
          } else if (item.type === 'tool_use') {
            // Check for TodoWrite - emit TodoListEvent instead of tool.started
            if (item.name === 'TodoWrite') {
              const todoEvent = this.parseTodoWriteEvent(item, base);
              if (todoEvent) {
                evs.push(todoEvent);
              }
              // Do NOT emit tool.started for TodoWrite (suppression)
            } else {
              evs.push({
                ...base,
                eventId: randomUUID(),
                type: 'tool.started',
                toolName: item.name,
                toolId: item.id,
                input: item.input || {}
              });
            }
          }
        }
        return evs;
      }

      case 'user': {
        const content = json.message?.content || [];
        const evs: AgentEvent[] = [];
        for (const item of content) {
          if (item.type === 'tool_result') {
            evs.push({
              ...base,
              eventId: randomUUID(),
              type: 'tool.completed',
              toolId: item.tool_use_id,
              output: item.content || '',
              error: item.is_error ? item.content : undefined
            });
          }
        }
        return evs;
      }

      case 'tool_use':
        // Check for TodoWrite - emit TodoListEvent instead of tool.started
        if (json.name === 'TodoWrite') {
          const todoEvent = this.parseTodoWriteEvent(json, base);
          return todoEvent ? [todoEvent] : [];
        }
        return [{
          ...base,
          type: 'tool.started',
          toolName: json.name,
          toolId: json.id,
          input: json.input || {}
        }];

      case 'tool_result':
        return [{
          ...base,
          type: 'tool.completed',
          toolId: json.tool_use_id,
          output: typeof json.content === 'string' ? json.content : undefined,
          error: json.is_error ? json.content : undefined
        }];

      case 'result': {
        const evs: AgentEvent[] = [];
        if (json.result && typeof json.result === 'string') {
          evs.push({
            ...base,
            eventId: randomUUID(),
            type: 'text',
            text: json.result,
            role: 'assistant',
            category: 'result'
          });
        }
        evs.push({
          ...base,
          eventId: randomUUID(),
          type: 'turn.completed',
          finishReason: json.is_error ? 'error' : 'done'
        });
        return evs;
      }

      case 'message_stop':
        return [];

      default:
        return [];
    }
  }

  /**
   * Parse Claude TodoWrite tool call into unified TodoListEvent.
   */
  private parseTodoWriteEvent(item: any, base: any): AgentEvent | null {
    const input = item.input;
    if (!input || !Array.isArray(input.todos)) {
      return null;
    }

    const items: TodoItem[] = [];
    for (const todoItem of input.todos) {
      const mapped: TodoItem = {
        text: todoItem.content,
        status: todoItem.status as TodoStatus
      };
      if (isValidTodoItem(mapped)) {
        items.push(mapped);
      }
    }

    return {
      ...base,
      eventId: randomUUID(),
      type: 'todo_list',
      todoId: item.id || randomUUID(),
      items
    };
  }

  private fallbackTextEvent(text: string): AgentEvent {
    return {
      type: 'text',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      text,
      category: 'result'
    };
  }

  private parseErrorEvent(err: any): AgentEvent {
    return {
      type: 'error',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      error: `Failed to parse JSONL: ${err?.message ?? String(err)}`,
      code: 'JSONL_PARSE_ERROR'
    };
  }
}
```

---

## 6. Key Design Decisions

### 6.1 Suppression of tool.started

Per architecture committee feedback, `TodoWrite` should NOT emit `tool.started` to avoid UI redundancy. The `TodoListEvent` is the only event emitted.

### 6.2 Status Mapping

Claude's status values (`'pending'`, `'in_progress'`, `'completed'`) match our `TodoStatus` enum directly. No conversion needed.

### 6.3 Ignoring activeForm

Claude's `activeForm` field is not used in our unified schema. We only use `content` -> `text` and `status` -> `status`.

---

## 7. Test Cases

1. `assistant` with `tool_use` name `TodoWrite` emits `TodoListEvent`
2. `assistant` with `tool_use` name `TodoWrite` does NOT emit `tool.started`
3. `assistant` with other `tool_use` names still emits `tool.started`
4. Top-level `tool_use` with name `TodoWrite` emits `TodoListEvent`
5. Status values map directly: `pending` -> `pending`, `in_progress` -> `in_progress`, `completed` -> `completed`
6. `content` field maps to `text`
7. Invalid todo items (empty content) are skipped
8. `todoId` is taken from `item.id`

---

**Document Version**: 1.0
**Author**: Claude (Development Agent)
**Status**: Pending Architecture Committee Review
