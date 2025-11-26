# Todo List Handling - High Level Design

**Version**: 1.1
**Status**: Pending Architecture Committee Review (Round 2)

---

## 1. Problem Statement

### 1.1 Current Issues

1. **Codex todo_list not displayed**: CodexParser ignores `todo_list` events, causing UI to show only the raw `⏺ todo_list` indicator from Codex CLI without actual todo items.

2. **Claude todo duplicated**: ClaudeCodeParser emits todo events, but ReplModeInk appends each update to the static output history, resulting in multiple copies of the todo list instead of in-place updates.

3. **Gemini todo not parsed**: GeminiParser does not handle `WriteTodos` tool calls, so todo lists are not displayed.

4. **No unified handling**: Each agent has different JSONL schema for todos, but there's no unified AgentEvent type for todo lists.

5. **Agent-Chatter JSONL schema incomplete**: Our own JSONL output schema does not include todo events.

### 1.2 User Experience Goal

Users should see a **single, real-time updating todo list** for the currently executing agent:

```
📋 Plan (Max):                    ← Member name in themeColor
⭕ Research existing metrics tracking
✅ Design the metrics collection system
⭕ Implement core functionality
```

- `⭕` - pending / in_progress task
- `✅` - completed task
- Updates in-place as tasks complete
- Member name displayed in their `themeColor`
- Persists with all items marked ✅ until:
  - Next member starts executing, OR
  - Same member creates a new todo list

---

## 2. Native Todo Schemas by Agent

### 2.1 Codex (OpenAI)

**Source**: `codex-rs/exec/src/exec_events.rs`

Codex emits three event types for todo lists:

```typescript
// item.started - First creation
{
  "type": "item.started",
  "item": {
    "id": "item_0",
    "type": "todo_list",
    "items": [
      { "text": "Research existing metrics", "completed": false },
      { "text": "Design the system", "completed": false }
    ]
  }
}

// item.updated - Progress update
{
  "type": "item.updated",
  "item": {
    "id": "item_0",
    "type": "todo_list",
    "items": [
      { "text": "Research existing metrics", "completed": true },
      { "text": "Design the system", "completed": false }
    ]
  }
}

// item.completed - Turn ends
{
  "type": "item.completed",
  "item": {
    "id": "item_0",
    "type": "todo_list",
    "items": [...]
  }
}
```

**TodoItem Schema**:
| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Task description |
| `completed` | boolean | Whether task is done |

### 2.2 Claude Code

**Source**: Claude's `tool_use` events with `name: "TodoWrite"`

Claude emits todo as tool calls:

```typescript
// tool_use event
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

**TodoItem Schema**:
| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Task description |
| `status` | `"pending"` \| `"in_progress"` \| `"completed"` | Task state |
| `activeForm` | string | Present continuous form (optional) |

### 2.3 Gemini CLI

**Source**: `gemini-cli/packages/core/src/tools/write-todos.ts`

Gemini emits todo via `tool_use` and `tool_result` events:

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

// tool_result event (contains the final todo list)
{
  "type": "tool_result",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tool_id": "call_123",
  "status": "success",
  "output": "Successfully updated the todo list..."
}
```

**TodoItem Schema**:
| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Task description |
| `status` | `"pending"` \| `"in_progress"` \| `"completed"` \| `"cancelled"` | Task state |

---

## 3. Architecture Overview

### 3.1 ETL Pattern

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Agent CLI      │    │  Parser (T)     │    │  ReplModeInk    │
│  (Extract)      │───▶│  (Transform)    │───▶│  (Load/Render)  │
│                 │    │                 │    │                 │
│ - Claude JSONL  │    │ - ClaudeParser  │    │ - Subscribe to  │
│ - Codex JSONL   │    │ - CodexParser   │    │   AgentEvents   │
│ - Gemini JSONL  │    │ - GeminiParser  │    │ - Render UI     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Key Principle**: Parsers transform agent-specific JSONL into unified `AgentEvent` schema. REPL only consumes unified events.

### 3.2 Unified Todo Event Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Transform Layer                          │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ ClaudeParser    │ CodexParser     │ GeminiParser                │
│                 │                 │                             │
│ tool_use with   │ item.started    │ tool_use with               │
│ TodoWrite ───▶  │ item.updated    │ write_todos ───▶            │
│                 │ item.completed  │                             │
│                 │ (type:todo_list)│                             │
└────────┬────────┴────────┬────────┴──────────────┬──────────────┘
         │                 │                       │
         ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Unified TodoListEvent                          │
│  {                                                              │
│    type: 'todo_list',                                           │
│    todoId: string,                                              │
│    items: [{ text: string, status: TodoStatus }]                │
│  }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Load Layer                               │
├─────────────────────────────────────────────────────────────────┤
│  ReplModeInk                                                    │
│                                                                 │
│  ┌─────────────────────────────────────┐                        │
│  │  <Static> output history            │  ← Immutable           │
│  └─────────────────────────────────────┘                        │
│  ┌─────────────────────────────────────┐                        │
│  │  <TodoListView> (dynamic state)     │  ← Mutable, in-place   │
│  │  📋 Plan (MemberName):              │     updates            │
│  │  ⭕ Task 1                          │                        │
│  │  ✅ Task 2                          │                        │
│  └─────────────────────────────────────┘                        │
│  ┌─────────────────────────────────────┐                        │
│  │  <ThinkingIndicator>                │                        │
│  └─────────────────────────────────────┘                        │
│  ┌─────────────────────────────────────┐                        │
│  │  <TextInput>                        │                        │
│  └─────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Unified Event Schema

### 4.1 TodoStatus Enum

```typescript
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
```

### 4.2 TodoItem Interface

```typescript
export interface TodoItem {
  /** Task description (required, non-empty) */
  text: string;
  /** Current status of the task */
  status: TodoStatus;
}
```

### 4.3 TodoListEvent Interface

```typescript
export interface TodoListEvent extends AgentEventBase {
  type: 'todo_list';
  /** Unique identifier for this todo list instance */
  todoId: string;
  /** Complete list of todo items (replaces previous list) */
  items: TodoItem[];
}
```

**Note**: We use a single `'todo_list'` type rather than `started/updated/completed` variants because:
1. Each event carries the full item list (not deltas)
2. Simplifies REPL logic - just replace the current list
3. Turn completion is already signaled by `turn.completed` event

### 4.4 Agent-Chatter JSONL Output Schema

Update our JSONL output to include todo events:

```typescript
// New JSONL event type for agent-chatter output
{
  "type": "todo_list",
  "eventId": "uuid",
  "agentId": "member-id",
  "agentType": "claude-code" | "openai-codex" | "google-gemini",
  "timestamp": 1234567890,
  "todoId": "todo_123",
  "items": [
    { "text": "Task description", "status": "pending" }
  ]
}
```

---

## 5. Parser Transformation Rules

### 5.1 CodexParser

| Native Event | Condition | Emit |
|--------------|-----------|------|
| `item.started` | `item.type === 'todo_list'` | `TodoListEvent` |
| `item.updated` | `item.type === 'todo_list'` | `TodoListEvent` |
| `item.completed` | `item.type === 'todo_list'` | `TodoListEvent` |

**Mapping**:
```typescript
items: json.item.items.map(i => ({
  text: i.text,
  status: i.completed ? 'completed' : 'pending'
}))
```

### 5.2 ClaudeCodeParser

| Native Event | Condition | Emit |
|--------------|-----------|------|
| `assistant` (tool_use) | `name === 'TodoWrite'` | `TodoListEvent` |

**Mapping**:
```typescript
items: input.todos.map(t => ({
  text: t.content,
  status: t.status  // already matches our enum
}))
```

**Suppression**: Do NOT emit `tool.started` for TodoWrite - only emit `TodoListEvent`.

### 5.3 GeminiParser

| Native Event | Condition | Emit |
|--------------|-----------|------|
| `tool_use` | `tool_name === 'write_todos'` | `TodoListEvent` |

**Mapping**:
```typescript
items: parameters.todos.map(t => ({
  text: t.description,
  status: t.status  // already matches our enum
}))
```

**Suppression**: Do NOT emit `tool.started` for write_todos - only emit `TodoListEvent`.

---

## 6. REPL State Management

### 6.1 State Definition

```typescript
interface ActiveTodoList {
  todoId: string;
  agentId: string;
  memberDisplayName: string;
  memberThemeColor: string;
  items: TodoItem[];
}

const [activeTodoList, setActiveTodoList] = useState<ActiveTodoList | null>(null);
```

### 6.2 Event Handling Rules

```typescript
// When TodoListEvent received:
if (ev.type === 'todo_list') {
  const member = activeTeam?.members.find(m => m.id === ev.agentId);
  setActiveTodoList({
    todoId: ev.todoId,
    agentId: ev.agentId,
    memberDisplayName: member?.displayName || ev.agentId,
    memberThemeColor: member?.themeColor || 'cyan',
    items: ev.items
  });
  return null; // Don't add to static output
}
```

### 6.3 Lifecycle Rules

| Event | Action |
|-------|--------|
| `todo_list` from same agent | Replace `activeTodoList` with new items |
| `todo_list` from different agent | Replace `activeTodoList` (new agent takes over) |
| `turn.completed` | Mark all items as `completed`, keep displaying |
| Agent starts (onAgentStarted) | If different agent, clear `activeTodoList` |

**Rationale for "completed = keep displaying"**: User wants to see the final state of the todo list after agent finishes, until next agent starts or same agent creates new todos.

---

## 7. UI Component

### 7.1 TodoListView

```tsx
function TodoListView({ todoList }: { todoList: ActiveTodoList }) {
  const statusEmoji = (status: TodoStatus) => {
    switch (status) {
      case 'completed': return '✅';
      case 'cancelled': return '❌';
      default: return '⭕';  // pending, in_progress
    }
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={todoList.memberThemeColor}>
        📋 Plan ({todoList.memberDisplayName}):
      </Text>
      {todoList.items.map((item, idx) => (
        <Text key={`${todoList.todoId}-${idx}`} color={item.status === 'completed' ? 'green' : 'yellow'}>
          {statusEmoji(item.status)} {item.text}
        </Text>
      ))}
    </Box>
  );
}
```

### 7.2 Key Stability

Use `${todoId}-${index}` as key. While index-based keys can cause issues with reordering, todo lists are always replaced entirely (not reordered), so this is acceptable.

---

## 8. Files to Modify

| File | Changes |
|------|---------|
| `src/events/AgentEvent.ts` | Add `TodoStatus`, `TodoItem`, `TodoListEvent` types |
| `src/events/parsers/CodexParser.ts` | Parse `todo_list` item events |
| `src/events/parsers/ClaudeCodeParser.ts` | Parse `TodoWrite` tool calls, suppress `tool.started` |
| `src/events/parsers/GeminiParser.ts` | Parse `write_todos` tool calls, suppress `tool.started` |
| `src/repl/ReplModeInk.tsx` | Add `activeTodoList` state, `TodoListView` component |
| `src/utils/JsonlMessageFormatter.ts` | Add `todo_list` event to JSONL output schema |

---

## 9. Validation Rules

### 9.1 TodoItem Validation

- `text` must be non-empty string
- `status` must be valid enum value
- If validation fails, skip the invalid item (don't crash)

### 9.2 Empty Todo List

- If `items` is empty array, clear `activeTodoList` (treat as "todo list cleared")

---

## 10. Error Handling

### 10.1 Malformed Events

- Log warning, skip the event
- Don't crash the parser or UI

### 10.2 Cleanup on Error/Cancel

Clear `activeTodoList` when:
- Agent execution cancelled (ESC)
- Agent execution errors
- Conversation ends

---

## 11. Success Criteria

1. ✅ Codex todo list items visible with ⭕/✅ indicators
2. ✅ Claude todo list updates in-place (no duplicates)
3. ✅ Gemini todo list visible with ⭕/✅ indicators
4. ✅ Member name displayed in themeColor
5. ✅ Todo list persists after turn completion (all marked ✅)
6. ✅ Todo list clears when new member starts
7. ✅ Agent-Chatter JSONL output includes todo events
8. ✅ No duplicate todo lists in static output history
9. ✅ Cancelled tasks show ❌ emoji

---

## 12. Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Multi-agent concurrent todos | Show only current executing agent's todo |
| Completed lifecycle | Keep displaying with all ✅ until next agent or new todo |
| Gemini support | Supported via `write_todos` tool parsing |
| JSONL schema | Will be updated to include `todo_list` events |

---

**Document Version**: 1.1
**Author**: Claude (Development Agent)
**Status**: Pending Architecture Committee Review (Round 2)
