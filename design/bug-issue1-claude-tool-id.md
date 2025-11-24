# Bug Report: Issue #1 - Claude Tool ID Display

**Status:** Root Cause Identified
**Severity:** Medium (P2)
**Date:** 2025-11-24

## Summary

When Claude agent uses tools, the UI displays internal tool IDs (e.g., `toolu_01QbLDLcKXwk3LU1V52RY14L`) in parentheses, which are implementation details that should not be shown to users.

## Evidence from UAT

**From temp.md, line 15-16:**

```
⏺ TodoWrite (toolu_01QbLDLcKXwk3LU1V52RY14L)
⎿  Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable
```

**Problem:** The tool ID `toolu_01QbLDLcKXwk3LU1V52RY14L` should not be displayed to users.

**Expected:** Show task contents from the input:
```
⏺ TodoWrite (Review code, Run tests, Deploy to production)
⎿  Todos have been modified successfully...
```

Or if no meaningful info available, just show tool name:
```
⏺ TodoWrite
⎿  Todos have been modified successfully...
```

## Root Cause Analysis

**File:** `src/repl/ReplModeInk.tsx`, lines 707-720

```typescript
case 'tool.started':
  {
    const displayParam =
        ev.input?.command ||         // For Bash tool
        ev.input?.pattern ||         // For Grep tool
        ev.input?.file_path ||       // For Read/Write tools
        ev.input?.path ||            // For Glob tool
        ev.toolId ||                 // ← FALLBACK: displays tool ID (BAD!)
        '';
    return (
        <Text key={key} color="yellow">
            ⏺ {ev.toolName ?? 'tool'} ({displayParam})
        </Text>
    );
  }
```

### The Logic

The code tries to find a meaningful parameter to display:
1. **Bash tool:** Shows `command` (e.g., "ls", "npm test")
2. **Grep tool:** Shows `pattern` (e.g., "TODO", "function.*export")
3. **Read/Write tools:** Shows `file_path` (e.g., "/path/to/file.ts")
4. **Glob tool:** Shows `path` (e.g., "src/**/*.ts")
5. **FALLBACK:** Shows `toolId` if none of the above exist ← **BUG!**

### Why This is Wrong

**For TodoWrite tool:**
- `ev.input` contains: `{ todos: [...] }`
- None of `command`, `pattern`, `file_path`, `path` exist in input
- Falls back to `ev.toolId` which is `toolu_01QbLDLcKXwk3LU1V52RY14L`
- This internal ID is displayed to user

**Same issue for other tools without these specific parameters:**
- `AskUserQuestion` (input: `{ questions: [...] }`)
- `Task` (input: `{ prompt: "...", subagent_type: "..." }`)
- `NotebookEdit` (input: `{ notebook_path: "...", new_source: "..." }`)
- Any custom tools that don't follow the parameter naming convention

## Analysis: When is displayParam Useful?

### Tools where displayParam is USEFUL:

**Bash:**
```
⏺ Bash (npm test)                    ← Good! Shows what command
⎿  Test results...
```

**Grep:**
```
⏺ Grep (TODO)                        ← Good! Shows search pattern
⎿  Found 5 files
```

**Read:**
```
⏺ Read (/path/to/file.ts)            ← Good! Shows which file
⎿  File contents...
```

**Write:**
```
⏺ Write (/path/to/file.ts)           ← Good! Shows which file
⎿  File written successfully
```

**Glob:**
```
⏺ Glob (src/**/*.ts)                 ← Good! Shows pattern
⎿  Found 42 files
```

### Tools where displayParam is NOT useful:

**TodoWrite:**
```
⏺ TodoWrite                           ← Tool name is enough
⎿  Todos updated
```

**AskUserQuestion:**
```
⏺ AskUserQuestion                     ← Tool name is enough
⎿  [User answers shown below]
```

**Task (spawning agent):**
```
⏺ Task                                ← Tool name is enough (or could show subagent_type?)
⎿  Agent result...
```

## Proposed Solutions

### Option 1: Remove Fallback to toolId (Recommended)

**Rationale:**
- Tool ID is never useful to users
- Better to show nothing than an opaque ID
- Tool name alone is often sufficient

**Implementation:**
```typescript
case 'tool.started':
  {
    const displayParam =
        ev.input?.command ||
        ev.input?.pattern ||
        ev.input?.file_path ||
        ev.input?.path ||
        '';  // ← Remove ev.toolId fallback

    return (
        <Text key={key} color="yellow">
            {displayParam
              ? `⏺ ${ev.toolName ?? 'tool'} (${displayParam})`
              : `⏺ ${ev.toolName ?? 'tool'}`
            }
        </Text>
    );
  }
```

**Result:**
```
⏺ Bash (npm test)                    ← Has param, show it
⏺ TodoWrite                           ← No param, just name
⏺ Read (/path/to/file.ts)            ← Has param, show it
⏺ AskUserQuestion                     ← No param, just name
```

**Pros:**
- Clean, no opaque IDs
- Tool name is descriptive enough
- Simple fix

**Cons:**
- Loses potential diagnostic info (but toolId isn't diagnostic anyway)

### Option 2: Smart Parameter Selection (Extended)

**Rationale:**
- Add more intelligent parameter detection
- Show meaningful info for more tool types
- Fallback to nothing (not toolId)

**Implementation:**
```typescript
case 'tool.started':
  {
    // Smarter parameter detection
    const displayParam =
        ev.input?.command ||                          // Bash
        ev.input?.pattern ||                          // Grep
        ev.input?.file_path ||                        // Read/Write
        ev.input?.path ||                             // Glob
        ev.input?.notebook_path ||                    // NotebookEdit
        (ev.input?.subagent_type ? `(${ev.input.subagent_type})` : '') ||  // Task
        '';

    return (
        <Text key={key} color="yellow">
            {displayParam
              ? `⏺ ${ev.toolName ?? 'tool'} (${displayParam})`
              : `⏺ ${ev.toolName ?? 'tool'}`
            }
        </Text>
    );
  }
```

**Pros:**
- Shows useful info for more tools
- Still avoids toolId
- More informative

**Cons:**
- Need to maintain list of parameter names
- May still miss some tools

### Option 3: Per-Tool Display Logic (Most Flexible)

**Rationale:**
- Different tools need different display strategies
- Some tools have complex input that needs formatting
- Centralized mapping of tool → display logic

**Implementation:**
```typescript
function getToolDisplayParam(ev: AgentEvent): string {
  const toolName = ev.toolName;
  const input = ev.input;

  // Tool-specific display logic
  switch (toolName) {
    case 'Bash':
      return input?.command || '';
    case 'Grep':
      return input?.pattern || '';
    case 'Read':
    case 'Write':
    case 'Edit':
      return input?.file_path || '';
    case 'Glob':
      return input?.path || input?.pattern || '';
    case 'NotebookEdit':
      return input?.notebook_path || '';
    case 'Task':
      return input?.subagent_type ? `subagent: ${input.subagent_type}` : '';
    case 'TodoWrite':
      if (input?.todos && Array.isArray(input.todos)) {
        const contents = input.todos.map((t: any) => t.content).filter(Boolean);
        return contents.length > 0 ? contents.join(', ') : '';
      }
      return '';
    case 'AskUserQuestion':
      return input?.questions ? `${input.questions.length} questions` : '';
    // Default: no param
    default:
      return '';
  }
}

case 'tool.started':
  {
    const displayParam = getToolDisplayParam(ev);

    return (
        <Text key={key} color="yellow">
            {displayParam
              ? `⏺ ${ev.toolName ?? 'tool'} (${displayParam})`
              : `⏺ ${ev.toolName ?? 'tool'}`
            }
        </Text>
    );
  }
```

**Result:**
```
⏺ Bash (npm test)
⏺ TodoWrite (Review code, Run tests, Deploy to production)  ← Shows task contents!
⏺ AskUserQuestion (2 questions)      ← Informative!
⏺ Task (subagent: Explore)           ← Informative!
⏺ Read (/path/to/file.ts)
```

**Pros:**
- Most informative and user-friendly
- Flexible for different tool types
- Can format complex inputs nicely

**Cons:**
- More code to maintain
- Need to update when adding new tools
- Could be extracted to separate helper

## Recommended Fix

**Use Option 1 (Remove toolId fallback) for immediate fix**

**Consider Option 3 (Per-tool logic) for future enhancement**

### Immediate Fix (Option 1)

This is the minimal fix to remove the bug:

```typescript
// src/repl/ReplModeInk.tsx:707-720
case 'tool.started':
  {
    const displayParam =
        ev.input?.command ||
        ev.input?.pattern ||
        ev.input?.file_path ||
        ev.input?.path ||
        '';  // Remove ev.toolId

    const toolLabel = ev.toolName ?? 'tool';
    const display = displayParam
      ? `${toolLabel} (${displayParam})`
      : toolLabel;

    return (
        <Text key={key} color="yellow">
            ⏺ {display}
        </Text>
    );
  }
```

### Future Enhancement (Option 3)

Extract helper function for cleaner code:

```typescript
// src/utils/ToolDisplayFormatter.ts (new file)
export function formatToolDisplay(toolName: string | undefined, input: any): string {
  if (!toolName) return 'tool';

  const param = getToolDisplayParam(toolName, input);
  return param ? `${toolName} (${param})` : toolName;
}

function getToolDisplayParam(toolName: string, input: any): string {
  // Implementation from Option 3
}
```

## Test Plan

1. **Unit test:** Helper function formats tool displays correctly
   ```typescript
   expect(formatToolDisplay('Bash', { command: 'ls' })).toBe('Bash (ls)');
   expect(formatToolDisplay('TodoWrite', { todos: [] })).toBe('TodoWrite');
   expect(formatToolDisplay('Read', { file_path: '/foo/bar.ts' })).toBe('Read (/foo/bar.ts)');
   ```

2. **Integration test:** Tool events display correctly in REPL
3. **UAT:** Run phoenix team again, verify tool displays are clean
4. **Regression:** Verify all existing tool displays still work

## Related Issues

- None directly

## Impact Assessment

**User Impact:** Low-Medium
- Issue is cosmetic (doesn't affect functionality)
- But degrades professional appearance
- Users may be confused by tool IDs

**Fix Complexity:** Low
- Simple one-line change to remove toolId
- Low risk of breaking anything
- Easy to test

**Priority:** P2 (Medium)
- Not blocking functionality
- But important for UX polish
- Should fix before major release
