# Bug Report: Issue #5 - Tool Output Truncation Length

**Status:** Root Cause Identified - Simple Fix
**Severity:** Low (P3)
**Date:** 2025-11-24

## Summary

Tool output is truncated at 200 characters, which is too long. User requests changing it to 100 characters for cleaner display.

## Root Cause

**File:** `src/repl/ReplModeInk.tsx`, line 689

```typescript
const truncate = (val?: string, max = 200) => {
    if (!val) return '';
    return val.length > max ? `${val.slice(0, max)}…` : val;
};
```

The default `max` parameter is `200`, which controls how much tool output is shown.

**Usage:** Line 725

```typescript
case 'tool.completed':
    return (
        <Box key={key} flexDirection="column">
            <Text color="green">⎿  {truncate(ev.output)}</Text>
            {ev.error && <Text color="red">    error: {ev.error}</Text>}
        </Box>
    );
```

`truncate(ev.output)` uses the default `max=200`.

## Fix

**Change default from 200 to 100:**

```typescript
const truncate = (val?: string, max = 100) => {  // Changed from 200 to 100
    if (!val) return '';
    return val.length > max ? `${val.slice(0, max)}…` : val;
};
```

## Test Plan

1. **Manual test:** Run a conversation with tool use, verify output is truncated at 100 chars
2. **Visual inspection:** Confirm that 100 chars provides cleaner display
3. **Edge cases:**
   - Output < 100 chars: should display fully
   - Output = 100 chars: should display fully
   - Output > 100 chars: should show first 100 + "…"

## Implementation

This is a trivial one-line change. Can be implemented immediately.

**No test coverage needed** - this is a UI display constant, not business logic.

## Impact

- **User Impact:** Positive - cleaner, more concise tool output display
- **Risk:** Very low - simple constant change
- **Breaking Changes:** None
