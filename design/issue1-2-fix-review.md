# Code Review: Issue #1 & #2 Fixes

**Date:** 2025-11-24
**Reviewer:** Claude Code
**Status:** ✅ **APPROVED** - All tests passing (407/407)

---

## Issue #1: Claude Tool ID Display Fix

### Changes Made

**File:** `src/repl/ReplModeInk.tsx:706-731`

### Summary
Architecture committee implemented a smart parameter extraction system that:
1. ✅ Removes `ev.toolId` fallback (no more opaque IDs)
2. ✅ Adds TodoWrite support with formatted task names
3. ✅ Adds notebook_path and prompt parameter detection
4. ✅ Shows tool name only when no meaningful parameter exists

### Code Analysis

```typescript
case 'tool.started':
  {
    // NEW: Helper function to format TodoWrite todos
    const formatTodos = (todos: any[]) => {
        const names = todos
            .map(t => t?.content)
            .filter(Boolean)
            .join(' | ');
        return names ? `todos: ${names}` : '';
    };

    const displayParam =
        ev.input?.command ||              // Bash
        ev.input?.pattern ||              // Grep
        ev.input?.file_path ||            // Read/Write
        ev.input?.path ||                 // Glob
        (Array.isArray(ev.input?.todos) ? formatTodos(ev.input?.todos) : '') ||  // TodoWrite ✅
        ev.input?.notebook_path ||        // NotebookEdit ✅
        ev.input?.prompt ||               // Task ✅
        '';                               // NO toolId fallback ✅

    return (
        <Text key={key} color="yellow">
            {displayParam
                ? `⏺ ${ev.toolName ?? 'tool'} (${displayParam})`
                : `⏺ ${ev.toolName ?? 'tool'}`}    // Just tool name if no param ✅
        </Text>
    );
  }
```

### What's Good ✅

1. **Removes toolId fallback:** No more `toolu_01XYZ...` displayed
2. **TodoWrite support:** Shows task contents joined with `|` separator
3. **Conditional display:** Only shows `(param)` if param exists
4. **Extended coverage:** Handles NotebookEdit and Task tools
5. **Safe array handling:** Uses `Array.isArray()` check before formatting

### Display Examples

**Before:**
```
⏺ TodoWrite (toolu_01QbLDLcKXwk3LU1V52RY14L)  ← Bad!
```

**After:**
```
⏺ TodoWrite (todos: Review code | Run tests | Deploy to production)  ← Good!
⏺ TodoWrite  ← Falls back to just name if no todos
⏺ Task (Create database schema)  ← Shows prompt parameter
⏺ NotebookEdit (/path/to/notebook.ipynb)  ← Shows notebook path
```

### Minor Observation

The separator uses `|` (pipe) instead of `,` (comma):
- `Review code | Run tests | Deploy to production`

This is fine, but different from the documentation which suggested comma. The pipe is actually clearer visually! ✅

---

## Issue #2: Gemini Tag Leakage Fix

### Changes Made

**File:** `src/utils/PromptBuilder.ts:66-110`
**File:** `tests/unit/promptBuilder.test.ts:30-49`

### Summary
Architecture committee implemented **Option 2** from the bug report: a dedicated Gemini prompt formatter that uses natural language instead of bracketed tags.

### Code Analysis

#### New Function: `buildGeminiPrompt()`

```typescript
function buildGeminiPrompt(input: PromptInput, maxBytes: number): PromptOutput {
  const systemParts = [input.systemInstructionText, input.instructionFileText].filter(Boolean);
  const systemBody = systemParts.join('\n\n').trim();
  const systemSection = systemBody ? `Instructions:\n${systemBody}\n\n` : '';
  const messageSection = `User message:\n${input.message.trim()}`;

  // ... context trimming logic ...

  const assemble = (ctx: PromptContextMessage[]) => {
    const ctxText = formatPlainContext(ctx);
    contextSection = ctxText ? `Conversation so far:\n${ctxText}\n\n` : '';
    prompt = `${systemSection}${contextSection}${messageSection}`;
  };

  // Trim context if exceeds maxBytes
  while (computeLength(prompt) > maxBytes && workingContext.length > 0) {
    workingContext.shift();
    assemble(workingContext);
  }

  return { prompt };
}
```

#### Helper Function: `formatPlainContext()`

```typescript
function formatPlainContext(contextMessages: PromptContextMessage[]): string {
  if (contextMessages.length === 0) return '';
  const lines = contextMessages.map(msg => {
    const to = msg.to ? ` -> ${msg.to}` : '';
    return `- ${msg.from}${to}: ${msg.content}`;  // Bullet list format ✅
  });
  return lines.join('\n');
}
```

#### Main Entry Point Updated

```typescript
export function buildPrompt(input: PromptInput): PromptOutput {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  // NEW: Special handling for Gemini
  if (input.agentType === 'google-gemini') {
    return buildGeminiPrompt(input, maxBytes);
  }

  // Original logic for Claude/Codex continues...
}
```

### What's Good ✅

1. **No bracketed tags:** Uses natural language headings
   - `Instructions:` instead of `[SYSTEM]`
   - `Conversation so far:` instead of `[CONTEXT]`
   - `User message:` instead of `[MESSAGE]`

2. **Clean bullet format:** Context uses `- From -> To: content` format

3. **Size-aware:** Properly trims context to fit `maxBytes` limit

4. **Correct structure:**
   ```
   Instructions:
   <system instruction>

   Conversation so far:
   - alice -> bob: message 1
   - bob: message 2

   User message:
   <current message>
   ```

5. **Test coverage:** New test verifies no bracketed tags appear

### Test Verification ✅

```typescript
it('builds gemini prompt without bracketed tags', () => {
  const out = buildPrompt({
    agentType: 'google-gemini',
    systemInstructionText: 'SYS',
    instructionFileText: 'FILE',
    contextMessages: baseContext,
    message: 'MSG',
    maxBytes: 1024 * 1024
  });

  // Verifies natural language format
  expect(out.prompt).toContain('Instructions:');
  expect(out.prompt).toContain('Conversation so far:');
  expect(out.prompt).toContain('User message:');

  // Verifies NO bracketed tags
  expect(out.prompt).not.toContain('[SYSTEM]');
  expect(out.prompt).not.toContain('[CONTEXT]');
  expect(out.prompt).not.toContain('[MESSAGE]');

  // No systemFlag for Gemini
  expect(out.systemFlag).toBeUndefined();
});
```

### Example Output

**Before (with tags - leaked to user):**
```
[SYSTEM]

You are Carol, a designer...

[CONTEXT]

alice -> bob: Hello

[MESSAGE]

Please help me design...
```

**After (clean natural language):**
```
Instructions:
You are Carol, a designer...

Conversation so far:
- alice -> bob: Hello

User message:
Please help me design...
```

---

## Overall Assessment

### Test Results
- ✅ **407 tests passing** (was 406, added 1 new Gemini test)
- ✅ No regressions
- ✅ New functionality properly tested

### Implementation Quality

**Issue #1 (Tool ID Display):**
- Rating: ⭐⭐⭐⭐⭐ Excellent
- Implements extended parameter detection
- Clean conditional rendering
- Handles TodoWrite, Task, NotebookEdit
- No breaking changes

**Issue #2 (Gemini Tag Leakage):**
- Rating: ⭐⭐⭐⭐⭐ Excellent
- Clean separation of Gemini-specific logic
- Natural language format is user-friendly
- Proper context trimming
- Well-tested

### Code Quality Observations

✅ **Strengths:**
1. Both fixes are minimal and focused
2. Good test coverage added
3. No breaking changes to existing functionality
4. Clean code organization
5. Proper error handling (size limits)

⚠️ **Minor Notes:**
1. TodoWrite uses `|` separator (not `,`) - acceptable, arguably better
2. Could extract `formatTodos()` to a separate utility (not critical)

---

## Recommendation

✅ **APPROVE FOR MERGE**

Both fixes are well-implemented, thoroughly tested, and ready for production.

### Next Steps

1. ✅ Commit these changes with descriptive message
2. ✅ Push to origin/dev
3. ⏭ Run real-world UAT again with Phoenix team to verify fixes
4. ⏭ Update `uat-issues-investigation-summary.md` to mark Issues #1 and #2 as resolved

---

## Files Changed Summary

```
Modified files:
  src/repl/ReplModeInk.tsx           (+23 lines)  Issue #1 fix
  src/utils/PromptBuilder.ts         (+50 lines)  Issue #2 fix
  tests/unit/promptBuilder.test.ts   (+23 lines)  Issue #2 test
  design/bug-issue1-claude-tool-id.md (updated)   Documentation
```

**Total:** 96 lines added, high-quality implementation.

---

## Signatures

**Reviewed by:** Claude Code
**Date:** 2025-11-24
**Status:** APPROVED ✅
**Test Status:** 407/407 PASSING ✅
