# Detailed Design: ReplModeInk - TodoListView Component

**Parent Document**: [high-level-design.md](./high-level-design.md)
**Target File**: `src/repl/ReplModeInk.tsx`
**Status**: Pending Architecture Committee Review

---

## 1. Overview

Update ReplModeInk to:
1. Add `activeTodoList` state for dynamic in-place rendering
2. Add `TodoListView` component for rendering todo lists
3. Handle `todo_list` events without adding to Static output
4. Clear todo list on agent switch, cancel, error, or new todo creation

---

## 2. Current Architecture

```
┌─────────────────────────────────────────────┐
│  ReplModeInk                                │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  <WelcomeScreen />                    │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <Static items={output}>              │  │ ← Immutable history
│  │    ... output history ...             │  │
│  │  </Static>                            │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <ThinkingIndicator />                │  │ ← Dynamic (during execution)
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <TextInput />                        │  │ ← User input
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 3. Proposed Architecture

```
┌─────────────────────────────────────────────┐
│  ReplModeInk                                │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  <WelcomeScreen />                    │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <Static items={output}>              │  │ ← Immutable history
│  │    ... output history ...             │  │
│  │  </Static>                            │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <TodoListView /> (NEW)               │  │ ← Dynamic (in-place updates)
│  │  📋 Plan (MemberName):                │  │
│  │  ⭕ Task 1                            │  │
│  │  ✅ Task 2                            │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <ThinkingIndicator />                │  │ ← Dynamic (during execution)
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  <TextInput />                        │  │ ← User input
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 4. New Types

### 4.1 ActiveTodoList Interface

```typescript
import type { TodoItem, TodoStatus } from '../events/AgentEvent.js';

interface ActiveTodoList {
  /** Unique identifier for this todo list instance */
  todoId: string;
  /** Agent/member ID that owns this todo list */
  agentId: string;
  /** Display name of the member (for UI) */
  memberDisplayName: string;
  /** Theme color of the member (for UI) */
  memberThemeColor: string;
  /** Current list of todo items */
  items: TodoItem[];
}
```

---

## 5. State Changes

### 5.1 Add activeTodoList State

```typescript
// Inside ReplModeInk function component
const [activeTodoList, setActiveTodoList] = useState<ActiveTodoList | null>(null);
```

---

## 6. Event Handling Changes

### 6.1 Update renderEvent Function

The `renderEvent` function should NOT render `todo_list` events. Instead, we handle them separately to update `activeTodoList` state.

```typescript
const renderEvent = (ev: AgentEvent): React.ReactNode | null => {
    const key = `stream-${ev.eventId || `${ev.agentId}-${ev.timestamp}`}-${getNextKey()}`;
    switch (ev.type) {
        case 'session.started':
            return null;
        case 'text':
            if (ev.category === 'result') {
                return null;
            }
            return (
                <Box key={key} flexDirection="column" marginTop={0}>
                    <Text color={ev.category === 'reasoning' ? 'gray' : undefined}>
                        {ev.text}
                    </Text>
                </Box>
            );
        case 'tool.started':
            // ... existing code ...
        case 'tool.completed':
            // ... existing code ...
        case 'turn.completed':
            return null;
        case 'error':
            // ... existing code ...
        case 'todo_list':
            // IMPORTANT: Do NOT render here - handled separately
            return null;
        default:
            return null;
    }
};
```

### 6.2 Update Event Listener

Update the event listener to intercept `todo_list` events before they reach `renderEvent`:

```typescript
const listener = (ev: AgentEvent) => {
    // Handle todo_list events separately - update state, don't add to output
    if (ev.type === 'todo_list') {
        handleTodoListEvent(ev);
        return; // Don't add to pending events queue
    }

    pendingEventsRef.current.push(ev);
    scheduleStreamFlush();
};
```

### 6.3 Add handleTodoListEvent Function

```typescript
/**
 * Handle todo_list events by updating activeTodoList state.
 * This enables in-place updates instead of appending to Static output.
 */
const handleTodoListEvent = (ev: AgentEvent & { type: 'todo_list' }) => {
    // Find the member to get display name and theme color
    const member = activeTeam?.members.find(m => m.id === ev.agentId);

    // If items is empty, treat as "todo cleared"
    if (ev.items.length === 0) {
        setActiveTodoList(null);
        return;
    }

    setActiveTodoList({
        todoId: ev.todoId,
        agentId: ev.agentId,
        memberDisplayName: member?.displayName || ev.agentId,
        memberThemeColor: member?.themeColor || 'cyan',
        items: ev.items
    });
};
```

---

## 7. Lifecycle Management

### 7.1 Clear on Agent Switch

When a new agent starts executing, clear the previous agent's todo list:

```typescript
// In onAgentStarted callback (around line 650)
const onAgentStarted = async (member: Member) => {
    // Clear previous todo list when new agent starts
    if (activeTodoList && activeTodoList.agentId !== member.id) {
        setActiveTodoList(null);
    }

    setExecutingAgent(member);
    // ... rest of existing code ...
};
```

### 7.2 Mark All Completed on Turn End

When turn completes, mark all items as completed but keep displaying:

```typescript
// In onAgentCompleted callback (around line 660)
const onAgentCompleted = async (member: Member, message: ConversationMessage) => {
    // Mark all todo items as completed when turn ends
    if (activeTodoList && activeTodoList.agentId === member.id) {
        setActiveTodoList(prev => {
            if (!prev) return null;
            return {
                ...prev,
                items: prev.items.map(item => ({
                    ...item,
                    status: 'completed' as TodoStatus
                }))
            };
        });
    }

    setExecutingAgent(null);
    // ... rest of existing code ...
};
```

### 7.3 Clear on Cancel/Error

Clear todo list when agent is cancelled or errors:

```typescript
// In ESC key handler (around line 876)
if (key.escape) {
    if (mode === 'conversation' && activeCoordinator && executingAgent && currentConfig) {
        const allowEscCancel = currentConfig.conversation?.allowEscCancel ?? true;
        if (allowEscCancel) {
            activeCoordinator.handleUserCancellation();
            setActiveTodoList(null);  // Clear todo list on cancel
            appendOutput(<Text key={`agent-cancelled-${getNextKey()}`} color="yellow">Agent execution cancelled by user (ESC)</Text>);
            return;
        }
    }
}

// In Ctrl+C handler (around line 889)
if (key.ctrl && inputChar === 'c') {
    if (mode === 'conversation' && activeCoordinator) {
        activeCoordinator.stop();
        setActiveTodoList(null);  // Clear todo list
        setMode('normal');
        // ... rest of existing code ...
    }
}

// Also clear on error events in listener
const listener = (ev: AgentEvent) => {
    if (ev.type === 'todo_list') {
        handleTodoListEvent(ev);
        return;
    }

    // Clear todo list on error
    if (ev.type === 'error') {
        setActiveTodoList(null);
    }

    pendingEventsRef.current.push(ev);
    scheduleStreamFlush();
};
```

---

## 8. TodoListView Component

### 8.1 Component Definition

```tsx
/**
 * Renders the active todo list with in-place updates.
 * Shows member name in their theme color.
 */
function TodoListView({ todoList }: { todoList: ActiveTodoList }) {
    const statusEmoji = (status: TodoStatus): string => {
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
                <Text
                    key={`${todoList.todoId}-${idx}`}
                    color={item.status === 'completed' ? 'green' : 'yellow'}
                >
                    {statusEmoji(item.status)} {item.text}
                </Text>
            ))}
        </Box>
    );
}
```

### 8.2 Key Stability

Per architecture committee feedback:
- Current: `${todoId}-${index}` is acceptable since lists are replaced entirely
- Future consideration: Use `hash(item.text)` if reordering issues arise

---

## 9. JSX Structure Changes

### 9.1 Updated Return Statement

Insert `TodoListView` between `<Static>` and `<ThinkingIndicator>`:

```tsx
return (
    <Box flexDirection="column">
        {/* Welcome screen */}
        {(mode === 'normal' || mode === 'conversation') && <WelcomeScreen />}

        {/* Output history: Static renders once, avoids re-rendering with input */}
        <Static items={output}>
            {(item, idx) => <Box key={`output-${idx}`}>{item}</Box>}
        </Static>

        {/* NEW: Todo list - dynamic, in-place updates */}
        {mode === 'conversation' && activeTodoList && (
            <TodoListView todoList={activeTodoList} />
        )}

        {/* ThinkingIndicator - Show when agent is executing */}
        {mode === 'conversation' && executingAgent && currentConfig &&
         currentConfig.conversation?.showThinkingTimer !== false && (
            <ThinkingIndicator
                member={executingAgent}
                maxTimeoutMs={currentConfig.conversation?.maxAgentResponseTime ?? 1800000}
                allowEscCancel={currentConfig.conversation?.allowEscCancel ?? true}
            />
        )}

        {/* ... rest of existing JSX ... */}
    </Box>
);
```

---

## 10. Import Changes

```typescript
// Add TodoStatus import
import type { AgentEvent, TodoStatus, TodoItem } from '../events/AgentEvent.js';
```

---

## 11. Summary of Changes

| Location | Change |
|----------|--------|
| State declarations | Add `activeTodoList` state |
| `renderEvent` | Add `case 'todo_list': return null;` |
| Event listener | Intercept `todo_list` events, call `handleTodoListEvent` |
| `handleTodoListEvent` | New function to update `activeTodoList` state |
| `onAgentStarted` | Clear todo if different agent starts |
| `onAgentCompleted` | Mark all items as completed |
| ESC handler | Clear todo on cancel |
| Ctrl+C handler | Clear todo on stop |
| Error handling | Clear todo on error |
| JSX return | Add `<TodoListView>` component |
| Imports | Add `TodoStatus`, `TodoItem` types |

---

## 12. Test Cases

1. `todo_list` event updates `activeTodoList` state
2. `todo_list` event does NOT add to Static output history
3. Todo list displays member name in `themeColor`
4. Todo list updates in-place when new `todo_list` event arrives
5. Todo list clears when different agent starts
6. All items marked completed when turn ends
7. Todo list clears on ESC (user cancel)
8. Todo list clears on Ctrl+C (stop)
9. Todo list clears on error event
10. Empty items array clears todo list
11. `⭕` shows for pending/in_progress, `✅` for completed, `❌` for cancelled

---

**Document Version**: 1.0
**Author**: Claude (Development Agent)
**Status**: Pending Architecture Committee Review
