# Detailed Design: ContextEventCollector - Todo List JSONL Schema

**Parent Document**: [high-level-design.md](./high-level-design.md)
**Target File**: `src/services/ContextEventCollector.ts`
**Status**: Pending Architecture Committee Review

---

## 1. Overview

The `ContextEventCollector` already handles JSONL output correctly by directly serializing `AgentEvent` objects. This document confirms:
1. No code changes needed for basic JSONL output (already works via `JSON.stringify`)
2. Optional enhancement: Include todo list in summary for context building

---

## 2. Current Architecture

### 2.1 Event Flow

```
AgentEvent (emitted) → ContextEventCollector.handleEvent() → JSONL file
                                    ↓
                              buildSummary() → summary JSONL file
```

### 2.2 Current JSONL Output

Events are written to `.agent-chatter/logs/{sessionId}.jsonl`:

```typescript
// Line 94
fs.appendFile(this.eventsFilePath, JSON.stringify(event) + '\n', () => {});
```

Since `TodoListEvent` extends `AgentEventBase` and is part of the `AgentEvent` union, it will be serialized correctly without code changes.

---

## 3. TodoListEvent JSONL Schema

When a `TodoListEvent` is emitted, the JSONL output will be:

```json
{
  "type": "todo_list",
  "eventId": "uuid-string",
  "agentId": "member-id",
  "agentType": "claude-code",
  "timestamp": 1234567890,
  "teamMetadata": {
    "teamId": "team-123",
    "sessionId": "session-456",
    "teamName": "My Team",
    "memberDisplayName": "Max"
  },
  "todoId": "toolu_01ABC",
  "items": [
    { "text": "Research existing metrics", "status": "in_progress" },
    { "text": "Design the system", "status": "pending" }
  ]
}
```

---

## 4. Summary Enhancement (Optional)

### 4.1 Current Summary Schema

```typescript
interface ContextSummary {
  agentId: string;
  agentName?: string;
  finishReason?: 'done' | 'error' | 'cancelled' | 'timeout';
  text: string;
  tools: Array<{...}>;
  errors: string[];
  timestamp: number;
}
```

### 4.2 Enhanced Summary Schema (Optional)

Per architecture committee feedback, we may want to include todo list in summary for context:

```typescript
interface ContextSummary {
  agentId: string;
  agentName?: string;
  finishReason?: 'done' | 'error' | 'cancelled' | 'timeout';
  text: string;
  tools: Array<{...}>;
  errors: string[];
  timestamp: number;
  // NEW: Optional todo list at turn completion
  todos?: Array<{
    text: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  }>;
}
```

### 4.3 buildSummary Enhancement (Optional)

```typescript
private buildSummary(events: AgentEvent[], finishReason?: ContextSummary['finishReason']): ContextSummary {
  const texts: string[] = [];
  const tools: ContextSummary['tools'] = [];
  const errors: string[] = [];
  let ts = Date.now();
  let agentName: string | undefined;
  let lastTodos: ContextSummary['todos'];  // NEW

  for (const ev of events) {
    ts = ev.timestamp || ts;
    if (!agentName) {
      agentName = ev.teamMetadata?.memberDisplayName || ev.agentId;
    }
    if (ev.type === 'text' && ev.text) {
      texts.push(ev.text);
    } else if (ev.type === 'tool.started') {
      tools.push({ name: ev.toolName, id: ev.toolId, input: ev.input });
    } else if (ev.type === 'tool.completed') {
      tools.push({ name: 'tool-result', id: ev.toolId, output: ev.output, error: ev.error });
    } else if (ev.type === 'error' && ev.error) {
      errors.push(ev.error);
    } else if (ev.type === 'todo_list') {  // NEW
      lastTodos = ev.items;
    }
  }

  return {
    agentId: events[0]?.agentId ?? '',
    agentName,
    finishReason: finishReason ?? 'done',
    text: texts.join('\n'),
    tools,
    errors,
    timestamp: ts,
    todos: lastTodos  // NEW: Include final todo state in summary
  };
}
```

---

## 5. Backward Compatibility

Per architecture committee feedback:

> JSONL schema：更新 AgentEvent 类型及 JsonlMessageFormatter 时，确保 Context/日志消费者忽略该新事件或平滑兼容

The design ensures backward compatibility:

1. **New event type**: Consumers that don't recognize `type: 'todo_list'` can safely ignore it
2. **Summary field**: The `todos` field is optional, existing consumers won't break
3. **No breaking changes**: All existing fields remain unchanged

---

## 6. Summary of Changes

| Change | Required | Description |
|--------|----------|-------------|
| Raw JSONL output | No changes | Already works via `JSON.stringify(event)` |
| Summary `todos` field | Optional | Add final todo state to summary for context |
| `buildSummary` update | Optional | Capture `todo_list` events in summary |

---

## 7. Decision

**Architecture Committee Decision**: Option A - No changes needed for now.

**Rationale**:
- `getRecentSummaries()` is currently not called by any code
- Summary is only used for logging, not for context building
- Can add `todos` field later if needed for context building

---

## 8. Test Cases

1. `TodoListEvent` is written to JSONL file correctly
2. `TodoListEvent` JSON includes all required fields (todoId, items)
3. Items array contains `text` and `status` for each item
4. (If Option B) Summary includes final todo state at turn completion
5. Backward compatible: existing JSONL parsers don't break on new event type

---

**Document Version**: 1.0
**Author**: Claude (Development Agent)
**Status**: Pending Architecture Committee Review
