# Bug Report: Issue #3 - Parallel Routing Conflict

**Status:** Root Cause Identified
**Severity:** Critical (P0)
**Date:** 2025-11-24

## Summary

When an agent outputs multiple `[NEXT:xxx]` directives (e.g., `[NEXT:Sarah] [NEXT:Max]`), the system may experience routing conflicts, causing confusion about who should execute next.

## Root Cause Analysis

### The Problem

The `MessageRouter.parseMessage()` method extracts **ALL** `[NEXT:]` directives from a message and returns them as an array:

```typescript
// src/services/MessageRouter.ts:44-56
while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
  const addresseeList = match[1];
  if (addresseeList && addresseeList.trim()) {
    const names = addresseeList
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);

    addressees.push(...names);  // ← Accumulates ALL addressees
  }
}
```

Then `ConversationCoordinator.routeToNext()` attempts to route to **ALL** resolved members:

```typescript
// src/services/ConversationCoordinator.ts:308-319
for (const member of resolvedMembers) {
  const delivery = this.prepareDelivery(member, message.content);

  if (member.type === 'ai') {
    await this.sendToAgent(member, delivery.content);
  } else {
    // 人类接收者，暂停对话
    this.waitingForRoleId = member.id;
    this.status = 'paused';
    this.notifyStatusChange();
  }
}
```

### Evidence from UAT

**From temp.md:**

**Line 365, 393, 454:**
```
Line 365: [NEXT:max]
Line 393: [NEXT:Sarah]
Line 454: [NEXT:Sarah]
```

These are separate `[NEXT:]` markers from different points in the conversation, but if they appeared in a single message like:

```
"I finished my work [NEXT:Sarah] and also [NEXT:Max]"
```

The system would:
1. Extract both `["Sarah", "Max"]`
2. Attempt to route to **both** Sarah AND Max
3. Execute **both in sequence** (line 308-319)

### Current Behavior

**Sequential Execution:** The loop at line 308 uses `await`, so agents are started **one at a time**:

```typescript
for (const member of resolvedMembers) {
  if (member.type === 'ai') {
    await this.sendToAgent(member, delivery.content);  // ← Waits for completion
  }
}
```

This means:
- Agent 1 executes completely
- Then Agent 2 executes
- Then Agent 3 executes, etc.

**Is this correct behavior?** ❓

## Scenarios

### Scenario 1: Multiple Addressees in One Directive

```
[NEXT: Alice, Bob]
```

**Expected:** Both Alice and Bob receive the message and can respond (parallel conversation branches?)

**Current:** Alice executes, completes, then Bob executes

### Scenario 2: Multiple Directives in One Message

```
Part 1 [NEXT:Alice] Part 2 [NEXT:Bob]
```

**Expected:** Unclear! Should this be:
- Alice responds to Part 1, then Bob responds to Part 2? (sequential)
- Only the LAST directive matters? (Bob only)
- Error: multiple directives not allowed?

**Current:** Both Alice and Bob in extracted array `["Alice", "Bob"]`, both execute sequentially

### Scenario 3: Agent Changes Mind Mid-Stream

```
Stream chunk 1: "Let me hand this to Alice [NEXT:Alice]"
Stream chunk 2: "Wait, actually Bob is better [NEXT:Bob]"
```

**Expected:** Only Bob should receive (the last/final decision)

**Current:** If routing happens after completion (Issue #4 fix), both `[NEXT:Alice]` and `[NEXT:Bob]` are in the final text, so both `["Alice", "Bob"]` are extracted and execute sequentially

## Questions for Architecture Committee

❓ **Q1:** **Product Intent:** What is the intended behavior when multiple `[NEXT:]` directives exist?
- **Option A:** Use ONLY the last `[NEXT:]` (most recent decision)
- **Option B:** Route to ALL addressees sequentially
- **Option C:** Route to ALL addressees in parallel (not currently supported)
- **Option D:** Treat as error and pause conversation

❓ **Q2:** **Product Intent:** Should `[NEXT: Alice, Bob]` be different from `[NEXT:Alice] [NEXT:Bob]`?
- **Option A:** They're equivalent (both route to Alice and Bob)
- **Option B:** Different:
  - `[NEXT: Alice, Bob]` = parallel (both receive same message)
  - `[NEXT:Alice] [NEXT:Bob]` = error or use last one

❓ **Q3:** **Technical:** Should we support parallel conversation branches?
- Example: Alice and Bob both work on different aspects simultaneously
- Current architecture sends messages sequentially with `await`
- Would need refactoring to support true parallelism

## Proposed Solutions

### Option 1: Use Only Last `[NEXT:]` (Recommended)

**Rationale:**
- Agents may change their mind during response
- Last directive represents final decision
- Simplest to implement and reason about

**Implementation:**
```typescript
// In MessageRouter.parseMessage()
const addressees: string[] = [];
let lastDirectiveAddressees: string[] = [];

while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
  const addresseeList = match[1];
  if (addresseeList && addresseeList.trim()) {
    lastDirectiveAddressees = addresseeList
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);
  }
}

// Only return the LAST directive's addressees
return {
  addressees: lastDirectiveAddressees,
  cleanContent,
  isDone
};
```

**Pros:**
- Handles "change of mind" gracefully
- Predictable behavior
- No sequential execution confusion

**Cons:**
- Cannot intentionally route to multiple people
- May surprise users who expected all directives to be honored

### Option 2: Enforce Single `[NEXT:]` Directive

**Rationale:**
- Make the rule explicit: ONE directive only
- Easier for agents and users to understand
- Prevents ambiguity

**Implementation:**
```typescript
// In MessageRouter.parseMessage()
const allMatches = [...message.matchAll(this.NEXT_PATTERN)];

if (allMatches.length > 1) {
  throw new Error(
    `Multiple [NEXT:] directives detected. Use only ONE [NEXT:] per message. ` +
    `Found: ${allMatches.map(m => m[0]).join(', ')}`
  );
}
```

**Pros:**
- Clear, unambiguous rule
- Forces agents to make a single routing decision
- Easy to debug

**Cons:**
- Breaks if agent outputs multiple directives (error state)
- Less flexible
- Need to handle error gracefully in UI

### Option 3: Support Comma-Separated List Only

**Rationale:**
- `[NEXT: Alice, Bob, Carol]` is explicit multi-routing
- Multiple `[NEXT:]` blocks treated as error

**Implementation:**
```typescript
// In MessageRouter.parseMessage()
const allMatches = [...message.matchAll(this.NEXT_PATTERN)];

if (allMatches.length > 1) {
  // Use LAST directive only, ignore others
  const lastMatch = allMatches[allMatches.length - 1];
  const addresseeList = lastMatch[1];
  addressees = addresseeList
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);
} else if (allMatches.length === 1) {
  // Normal single directive
  const addresseeList = allMatches[0][1];
  addressees = addresseeList
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);
}
```

**Pros:**
- Supports intentional multi-routing via commas
- Handles multiple directives gracefully (uses last)
- Flexible for both use cases

**Cons:**
- Slightly more complex logic
- Need to decide: sequential or parallel execution for comma-separated list?

## Recommended Fix

**Use Option 3 (Support comma-list, use last directive)**

### Implementation Steps:

1. **Modify `MessageRouter.parseMessage()`:**
   ```typescript
   parseMessage(message: string): ParseResult {
     let addressees: string[] = [];
     let isDone = false;

     // Check for [DONE]
     if (/\[DONE\]/i.test(message)) {
       isDone = true;
     }

     // Extract ALL [NEXT:] directives
     this.NEXT_PATTERN.lastIndex = 0;
     const allMatches: RegExpExecArray[] = [];
     let match;
     while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
       allMatches.push(match);
     }

     // Use LAST [NEXT:] directive only
     if (allMatches.length > 0) {
       const lastMatch = allMatches[allMatches.length - 1];
       const addresseeList = lastMatch[1];
       if (addresseeList && addresseeList.trim()) {
         addressees = addresseeList
           .split(',')
           .map(name => name.trim())
           .filter(name => name.length > 0);
       }
     }

     const cleanContent = this.stripMarkers(message);

     return {
       addressees,
       cleanContent,
       isDone
     };
   }
   ```

2. **Update system instructions for agents:**
   ```
   Use [NEXT: member] to route to the next speaker.
   - Place [NEXT:] at the END of your response
   - Use comma-separated list for multiple recipients: [NEXT: Alice, Bob]
   - If you output multiple [NEXT:] directives, only the LAST one will be used
   ```

3. **Add test coverage:**
   ```typescript
   it('uses last [NEXT:] when multiple directives present', () => {
     const message = 'Part 1 [NEXT:Alice] Part 2 [NEXT:Bob]';
     const result = router.parseMessage(message);
     expect(result.addressees).toEqual(['Bob']);  // Only last one
   });

   it('supports comma-separated addressees', () => {
     const message = 'Done [NEXT: Alice, Bob, Carol]';
     const result = router.parseMessage(message);
     expect(result.addressees).toEqual(['Alice', 'Bob', 'Carol']);
   });
   ```

4. **Document behavior:**
   - Add to README: routing behavior with multiple directives
   - Add examples showing comma-separated lists

## Decision Needed

**Architecture Committee:** Please decide on the execution model for comma-separated lists:

**Option A: Sequential Execution (Current)**
```
[NEXT: Alice, Bob]
→ Alice executes and completes
→ Then Bob executes
```

**Option B: Parallel Execution (Requires Refactoring)**
```
[NEXT: Alice, Bob]
→ Alice starts
→ Bob starts (before Alice completes)
→ Both work simultaneously
```

**Option C: Broadcast Model**
```
[NEXT: Alice, Bob]
→ Alice receives message, responds
→ Bob receives message, responds
→ Their responses are both added to conversation
→ Next routing decision needed
```

**Recommendation:** Start with **Option A (Sequential)** for simplicity, consider parallel execution in future versions if needed.

## Related Issues

- **Issue #4:** Premature routing trigger (must be fixed first)
- This issue depends on Issue #4 being resolved to ensure routing happens at the right time
