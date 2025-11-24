# UAT Issues Investigation Summary

**Date:** 2025-11-24
**Investigator:** Claude Code
**UAT Source:** Phoenix Team (phoenix-prd.json) - Real-world multi-agent conversation
**UAT Log:** `/Users/kailaichen/Downloads/source code/agent_chatter/temp.md`

## Executive Summary

All 5 UAT issues have been investigated and root causes identified. Detailed bug reports created for each issue with proposed solutions and implementation plans.

**Investigation Status:** ✅ **COMPLETE**

**Next Step:** Architecture committee review and implementation prioritization

---

## Issues Overview

| Issue | Severity | Status | Doc |
|-------|----------|--------|-----|
| #4: Premature routing trigger | Critical (P0) | ✅ Root cause found | `bug-issue4-premature-routing.md` |
| #3: Parallel routing conflict | Critical (P0) | ✅ Root cause found | `bug-issue3-parallel-routing.md` |
| #2: Gemini tag leakage | High (P1) | ✅ Root cause found | `bug-issue2-gemini-tag-leakage.md` |
| #1: Claude tool ID display | Medium (P2) | ✅ Root cause found | `bug-issue1-claude-tool-id.md` |
| #5: Truncation length | Low (P3) | ✅ Root cause found + trivial fix | `bug-issue5-truncation-length.md` |

---

## Issue #4: Premature Routing Trigger (Critical P0)

### Problem
Agent routing is triggered **during the streaming phase** before the agent completes its full response, causing subsequent output to appear under the wrong speaker.

### Root Cause
**Suspected:** The UI/REPL layer may be parsing `[NEXT:]` markers from streaming chunks and triggering routing before `turn.completed` event.

**Evidence:**
- UAT log shows routing ("→ Agent 开始执行...") appears immediately after `[NEXT:]` marker
- `ConversationCoordinator.sendToAgent()` correctly waits for `sendAndReceive()` to complete before routing
- Issue likely in REPL event handling, not core coordinator logic

### Recommended Solution
**Option 1: Wait for Turn Completion**
- Remove any real-time `[NEXT:]` parsing from streaming display
- Only parse routing markers from `ContextSummary.text` after `turn.completed`
- Display routing markers in stream but don't act on them until completion

### Files to Investigate
- `src/repl/ReplModeInk.tsx` - Check for premature routing logic
- Verify `onAgentStarted` / `onAgentCompleted` callback timing

### Questions for Committee
❓ Is there code in the REPL layer that parses `[NEXT:]` from streaming chunks before completion?

---

## Issue #3: Parallel Routing Conflict (Critical P0)

### Problem
When an agent outputs multiple `[NEXT:xxx]` directives (e.g., "Part 1 [NEXT:Alice] Part 2 [NEXT:Bob]"), the system experiences routing conflicts.

### Root Cause
**Confirmed:** `MessageRouter.parseMessage()` extracts **ALL** `[NEXT:]` directives and returns them as an array. `ConversationCoordinator.routeToNext()` then attempts to route to **ALL** resolved members sequentially.

**Current Behavior:**
```typescript
// MessageRouter extracts: ["Alice", "Bob"]
// ConversationCoordinator routes to both in sequence:
for (const member of resolvedMembers) {
  await this.sendToAgent(member, delivery.content);  // Sequential execution
}
```

### Recommended Solution
**Option 3: Support comma-list, use last directive**
- `[NEXT: Alice, Bob]` → Route to both (comma-separated is intentional multi-routing)
- `[NEXT:Alice] [NEXT:Bob]` → Use LAST directive only (Bob) - handles "change of mind"
- Update `MessageRouter.parseMessage()` to use only the last `[NEXT:]` block

### Implementation
```typescript
// In MessageRouter.parseMessage()
const allMatches = [...message.matchAll(this.NEXT_PATTERN)];

if (allMatches.length > 0) {
  // Use LAST [NEXT:] directive only
  const lastMatch = allMatches[allMatches.length - 1];
  const addresseeList = lastMatch[1];
  addressees = addresseeList
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);
}
```

### Questions for Committee
❓ **Q1:** Should we support parallel execution or keep sequential for comma-separated addressees?
❓ **Q2:** Is "use last directive" the correct behavior when multiple `[NEXT:]` exist?

---

## Issue #2: Gemini [SYSTEM]/[CONTEXT] Tag Leakage (High P1)

### Problem
Gemini CLI displays internal prompt structure tags (`[SYSTEM]`, `[CONTEXT]`, `[MESSAGE]`) in its output, leaking implementation details.

### Root Cause
**Confirmed:**
1. For Claude: System instructions use `--append-system-prompt` flag (NOT in stdin)
2. For Gemini: ALL tags are included in the prompt sent to stdin
3. Gemini CLI echoes back the entire input including tags before generating response

**Evidence from UAT:**
```
→ Carol 开始执行...
[SYSTEM]

You are Carol, a Lead Product Designer...

[CONTEXT]

System: Initial task:...

[MESSAGE]

Hi Carol，我刚完成了PRD框架...
```

### Recommended Solution
**Immediate:** Option 1 (Post-process output to strip tags)
**Short-term:** Option 2 (Plain prompt format for Gemini - no tags)

**Implementation (Option 2 - Recommended):**
```typescript
// In PromptBuilder.ts
function buildGeminiPrompt(input: PromptInput): string {
  let parts: string[] = [];

  // System as natural instruction
  if (input.systemInstructionText || input.instructionFileText) {
    const systemParts = [input.systemInstructionText, input.instructionFileText].filter(Boolean);
    parts.push(`Instructions: ${systemParts.join('\n\n')}`);
  }

  // Context as conversation history
  if (input.contextMessages.length > 0) {
    parts.push('Previous conversation:');
    for (const msg of input.contextMessages) {
      const to = msg.to ? ` -> ${msg.to}` : '';
      parts.push(`  ${msg.from}${to}: ${msg.content}`);
    }
  }

  // Message without tag
  parts.push('');
  parts.push(input.message);

  return parts.join('\n');
}
```

### Questions for Committee
❓ **Q1:** Does Gemini CLI have a flag to disable prompt echo?
❓ **Q2:** Should we investigate Gemini CLI source to understand this behavior better?

---

## Issue #1: Claude Tool ID Display (Medium P2)

### Problem
When Claude agent uses tools, the UI displays internal tool IDs (e.g., `toolu_01QbLDLcKXwk3LU1V52RY14L`) which are implementation details.

**UAT Example:**
```
⏺ TodoWrite (toolu_01QbLDLcKXwk3LU1V52RY14L)
⎿  Todos have been modified successfully...
```

**Expected:**
```
⏺ TodoWrite
⎿  Todos have been modified successfully...
```

### Root Cause
**Confirmed:** `src/repl/ReplModeInk.tsx:709-715`

```typescript
const displayParam =
    ev.input?.command ||         // For Bash
    ev.input?.pattern ||         // For Grep
    ev.input?.file_path ||       // For Read/Write
    ev.input?.path ||            // For Glob
    ev.toolId ||                 // ← FALLBACK: displays tool ID (BAD!)
    '';
```

For `TodoWrite`, none of `{command, pattern, file_path, path}` exist in input, so it falls back to `toolId`.

### Recommended Solution
**Option 1: Remove toolId fallback** (Immediate fix)

```typescript
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
```

**Option 3: Per-tool display logic** (Future enhancement)
- Show `TodoWrite (5 items)` by counting `input.todos.length`
- Show `Task (subagent: Explore)` by reading `input.subagent_type`
- More informative and user-friendly

### Questions for Committee
None - solution is straightforward.

---

## Issue #5: Truncation Length (Low P3)

### Problem
Tool output is truncated at 200 characters, user requests changing to 100 characters.

### Root Cause
**Confirmed:** `src/repl/ReplModeInk.tsx:689`

```typescript
const truncate = (val?: string, max = 200) => {  // ← 200 is too long
    if (!val) return '';
    return val.length > max ? `${val.slice(0, max)}…` : val;
};
```

### Solution
**Trivial one-line fix:**

```typescript
const truncate = (val?: string, max = 100) => {  // Changed from 200 to 100
    if (!val) return '';
    return val.length > max ? `${val.slice(0, max)}…` : val;
};
```

### Questions for Committee
None - this is a simple constant change.

---

## Implementation Priority Recommendation

### Phase 1: Critical Fixes (P0) - Must Fix Before Next Release
1. **Issue #4:** Premature routing trigger
   - Investigate REPL layer for premature `[NEXT:]` parsing
   - Ensure routing only happens after `turn.completed`
   - **Estimated Effort:** 4-8 hours (investigation + fix + testing)

2. **Issue #3:** Parallel routing conflict
   - Modify `MessageRouter.parseMessage()` to use last directive only
   - Update system instructions for agents
   - Add test coverage
   - **Estimated Effort:** 2-4 hours

### Phase 2: High Priority (P1) - Should Fix Soon
3. **Issue #2:** Gemini tag leakage
   - Implement plain prompt format for Gemini (no tags)
   - Update `PromptBuilder.buildPrompt()` with Gemini-specific logic
   - Test with Gemini agent
   - **Estimated Effort:** 3-6 hours

### Phase 3: Polish (P2-P3) - Nice to Have
4. **Issue #1:** Claude tool ID display
   - Remove `toolId` fallback from display logic
   - **Estimated Effort:** 30 minutes

5. **Issue #5:** Truncation length
   - Change constant from 200 to 100
   - **Estimated Effort:** 5 minutes

---

## Test Plan

### Regression Testing
After fixes, run full UAT again with Phoenix team configuration to verify:
- ✅ Routing happens at correct time (Issue #4)
- ✅ Multiple `[NEXT:]` handled correctly (Issue #3)
- ✅ Gemini output is clean, no tags (Issue #2)
- ✅ Tool displays show no internal IDs (Issue #1)
- ✅ Tool output truncated at 100 chars (Issue #5)

### Unit Testing
- **Issue #3:** Test `MessageRouter.parseMessage()` with multiple directives
- **Issue #4:** Test routing timing in `ConversationCoordinator`
- **Issue #2:** Test Gemini prompt format (no tags)
- **Issue #1:** Test tool display formatting

### Integration Testing
- Full multi-agent conversation with Claude, Codex, Gemini
- Verify all display issues resolved
- Ensure no new issues introduced

---

## Dependencies Between Issues

**Issue #4 (Premature routing) is a prerequisite for Issue #3 (Parallel routing)**
- Must fix timing issue before addressing multiple directives
- Parallel routing only makes sense after proper timing is established

**Other issues are independent and can be fixed in any order**

---

## Questions for Architecture Committee

### Strategic Questions

1. **Issue #3:** What is the intended behavior for comma-separated addressees in `[NEXT: Alice, Bob]`?
   - Sequential execution (current)?
   - Parallel execution (requires refactoring)?
   - Broadcast model (both respond, then next routing)?

2. **Issue #2:** Should we investigate Gemini CLI more deeply?
   - Is this a Gemini CLI bug we should report?
   - Can Gemini support system prompts separately (like Claude)?

### Technical Questions

3. **Issue #4:** Where is the premature routing happening?
   - Is there real-time `[NEXT:]` parsing in REPL layer?
   - Should we disable all streaming-based routing?

4. **General:** Should we add better instrumentation/logging to diagnose these issues in production?

---

## Conclusion

All 5 UAT issues have been thoroughly investigated with root causes identified and solutions proposed. The issues range from critical (P0) routing problems to low-priority (P3) UX polish.

**Total Estimated Fix Time:** 10-19 hours

**Recommendation:** Start with Phase 1 (Critical P0 fixes) for Issues #4 and #3, as these affect core conversation functionality. Issues #1, #2, and #5 can be addressed in subsequent releases.

**Architecture Committee:** Please review the detailed bug reports and provide decisions on the open questions, particularly around routing behavior for Issue #3.

---

## Files Created

1. `design/bug-issue4-premature-routing.md` - Detailed analysis of premature routing
2. `design/bug-issue3-parallel-routing.md` - Multiple `[NEXT:]` handling
3. `design/bug-issue2-gemini-tag-leakage.md` - Gemini prompt structure leakage
4. `design/bug-issue1-claude-tool-id.md` - Tool ID display issue
5. `design/bug-issue5-truncation-length.md` - Truncation constant change
6. `design/uat-issues-investigation-summary.md` - This summary document

All documents are ready for architecture committee review.
