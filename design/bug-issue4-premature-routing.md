# Bug Report: Issue #4 - Premature Routing Trigger

**Status:** Root Cause Identified
**Severity:** Critical (P0)
**Date:** 2025-11-24

## Summary

Agent routing is triggered **during the streaming phase** before the agent completes its full response. This causes subsequent output to appear under the wrong speaker and creates display chaos.

## Root Cause Analysis

### The Problem

The current architecture has **TWO PARALLEL PATHS** for routing:

1. **Stream-based routing (ACTIVE):**
   - Parses `[NEXT:xxx]` markers from streamed chunks in real-time
   - Triggers routing **immediately** when marker is detected
   - Located in: `ConversationCoordinator.sendToAgent()` lines 423-442

2. **Summary-based routing (INTENDED BUT BROKEN):**
   - Should wait for `turn.completed` event
   - Should parse complete summary text for routing
   - Currently acts as a **fallback only** (line 423: "if (summary)")

### Evidence from Code

**File:** `src/services/ConversationCoordinator.ts`

```typescript
// Line 403-421: sendAndReceive waits for turn.completed
const response = await this.agentManager.sendAndReceive(
  member.id,
  prompt.prompt,
  { maxTimeout, systemFlag: prompt.systemFlag, teamContext }
);

// Line 410-420: Agent stopped and marked complete
await this.agentManager.stopAgent(member.id);
if (this.options.onAgentCompleted) {
  this.options.onAgentCompleted(member);
}

// Line 423-442: THEN routing happens (GOOD PATH)
const summary = this.contextCollector?.getRecentSummaries(1).find(s => s.agentId === member.id);
if (summary) {
  const parsed = this.messageRouter.parseMessage(summary.text);
  const messageEntry: ConversationMessage = MessageUtils.createMessage(
    member.id,
    member.name,
    member.displayName,
    member.type,
    parsed.cleanContent,
    {
      rawNextMarkers: parsed.addressees,
      resolvedAddressees: [],
      isDone: parsed.isDone
    }
  );
  this.session = SessionUtils.addMessageToSession(this.session!, messageEntry);
  this.notifyMessage(messageEntry);
  await this.routeToNext(messageEntry);  // ← Routing here (GOOD!)
  return;
}

// Line 445-455: Fallback to round-robin
const nextMember = this.getNextSpeaker(member.id);
// ...
```

**So far, this looks CORRECT!** Routing happens AFTER `sendAndReceive` completes.

### But Where Is the Premature Routing Coming From?

Looking at the UAT log (`temp.md`):

**Line 87-96:**
```
[NEXT:Carol]

Hi Carol，我刚完成了PRD框架的搭建。你能否先帮我整理一下iOS原生天气应用的**核心交互流程和UI设计规范**？特别是：
1. **视觉设计**：配色方案、动态背景规则、卡片层级
2. **交互模式**：手势操作、页面切换动画
3. **信息层级**：首页各模块的展示优先级

这些信息会帮助我更精确地定义功能的验收标准。完成后我会结合Kailai的产品战略和Sarah的技术建议，输出完整PRD。
✓ Max 完成
→ Carol 开始执行...
```

**Observation:** The routing happens at line 96 (`→ Carol 开始执行...`) **IMMEDIATELY** after line 87 shows `[NEXT:Carol]`.

**Line 645-648:**
```
[NEXT: Kailai]
✓ Sarah 完成
[Status] paused
→ Sarah 开始执行...
```

**Observation:** Line 645 shows `[NEXT: Kailai]`, line 646 shows "Sarah 完成", but then line 648 shows **"Sarah 开始执行"** again! This is the routing confusion.

### Hypothesis: The UI Layer is Parsing `[NEXT:]` Too Early

The premature routing is NOT happening in `ConversationCoordinator` but in the **UI/REPL layer**.

Let me check the REPL code for streaming display logic:

**File:** `src/repl/ReplModeInk.tsx`

Need to search for where streaming events are displayed and where `[NEXT:]` is detected.

## Investigation Findings

### Key Files to Examine:

1. **`src/repl/ReplModeInk.tsx`** - Line 1653 mentions `[NEXT:xxx]` directive parsing
2. **Streaming event handlers** - Where `agent-event` events are processed
3. **Display logic** - Where "✓ Agent 完成" and "→ Agent 开始执行..." messages are shown

### Questions for Architecture Committee

❓ **Q1:** Is there any code in the REPL layer that parses `[NEXT:]` markers from streaming chunks and triggers routing before `turn.completed`?

❓ **Q2:** Where is the "→ Agent 开始执行..." message generated? Is it triggered by:
   - `onAgentStarted` callback?
   - Detection of `[NEXT:]` marker in stream?
   - `turn.completed` event?

❓ **Q3:** Should we disable real-time `[NEXT:]` parsing and ONLY route after `turn.completed`?

## Proposed Solution

### Option 1: Wait for Turn Completion (Recommended)

**Changes:**
1. Remove any real-time `[NEXT:]` parsing from streaming display
2. Only parse routing markers from `ContextSummary.text` after `turn.completed`
3. Display routing markers in stream but don't act on them until completion

**Pros:**
- Agent sees complete message content before routing
- No race conditions
- Cleaner separation of concerns

**Cons:**
- Slight delay before routing (user sees `[NEXT:]` before it takes effect)

### Option 2: Defer Routing Until Stream Ends (Complex)

**Changes:**
1. Allow real-time `[NEXT:]` detection
2. Buffer detected routing markers
3. Only execute routing after `turn.completed` event
4. Use LAST detected `[NEXT:]` if multiple exist

**Pros:**
- Can show routing intent immediately
- Handles multiple `[NEXT:]` gracefully (uses last one)

**Cons:**
- More complex state management
- Still needs to handle race conditions

### Option 3: Prohibit Multiple `[NEXT:]` (Strict)

**Changes:**
1. Add validation: throw error if agent outputs multiple `[NEXT:]`
2. Add system instruction to agents: "Use only ONE [NEXT:] directive at the END"
3. Parse routing only from final summary

**Pros:**
- Simplest solution
- Forces agents to be explicit about routing

**Cons:**
- Limits agent flexibility
- Requires agent instruction updates

## Recommended Fix

**Use Option 1 (Wait for Turn Completion)**

### Implementation Steps:

1. **Verify ConversationCoordinator is correct** ✓ (Already confirmed above)

2. **Remove premature routing from REPL/UI layer:**
   - Search `ReplModeInk.tsx` for `[NEXT:]` parsing
   - Remove any routing logic triggered by streaming events
   - Only respond to `onAgentStarted` / `onAgentCompleted` callbacks

3. **Add test coverage:**
   ```typescript
   it('should NOT route until agent completes', async () => {
     // Agent outputs: "Part 1 [NEXT:Bob] Part 2"
     // Assert: Bob does NOT start until after "Part 2" is output
   });
   ```

4. **Update system instructions:**
   ```
   Place [NEXT:member] at the END of your response, after all your output is complete.
   ```

## Next Steps

1. Search `ReplModeInk.tsx` for premature routing logic
2. Confirm hypothesis with architecture committee
3. Implement fix
4. Add regression tests
5. Update agent system instructions

## Related Issues

- **Issue #3:** Parallel routing conflict (multiple `[NEXT:]` in one message)
- This issue is a **prerequisite** for fixing Issue #3 properly
