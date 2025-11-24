# Bug Report: Issue #2 - Gemini [SYSTEM]/[CONTEXT] Tag Leakage

**Status:** Root Cause Identified
**Severity:** High (P1)
**Date:** 2025-11-24

## Summary

Gemini CLI displays internal prompt structure tags (`[SYSTEM]`, `[CONTEXT]`, `[MESSAGE]`) in its output, leaking implementation details to the user interface.

## Evidence from UAT

**From temp.md, lines 97-185:**

```
→ Carol 开始执行...
[SYSTEM]

You are Carol, a Lead Product Designer focused on provide world class UI/UX for software. You have Max (Senior BA), Sarah (Tech Lead) and Kailai (Product
Director) on your team to collaborate with. You MUST always use [NEXT:<team_member_name>] when you want someone to respond next.

[CONTEXT]

System: Initial task:
兄弟姐妹们，来活儿了。公司要开发一个鸿蒙版的天气应用，复刻iOS上原生的天气应用到鸿蒙系统上。请你们写一份完整的PRD交给我和产品委员会审批。
你们自己讨论、分工合作吧。 文档就写在我们的工作目录里。从你开始吧, Max。
max -> Carol: 收到！我先理解一下这个项目的核心诉求...

[MESSAGE]

Hi Carol，我刚完成了PRD框架的搭建...
```

**Problem:** The tags `[SYSTEM]`, `[CONTEXT]`, and `[MESSAGE]` are visible in the output.

## Root Cause Analysis

### How Prompts Are Built

**File:** `src/utils/PromptBuilder.ts`

```typescript
// Lines 71-88
const systemSection = systemBody ? buildSection('[SYSTEM]', systemBody) : '';
const messageSection = buildSection('[MESSAGE]', input.message.trim());
const { contextSection, trimmed } = trimContext(systemSection, input.contextMessages, messageSection, maxBytes);

if (input.agentType === 'claude-code' && systemSection) {
  // Claude: use system flag when available; prompt carries context+message
  systemFlag = systemBody;
  prompt = `${contextSection}${messageSection}`.trim();
} else {
  // Inline for others (including Gemini)
  prompt = `${systemSection}${contextSection}${messageSection}`.trim();
}
```

### The Issue

1. **For Claude Code:** System instructions are passed via `--append-system-prompt` flag (NOT in stdin), so Claude never sees `[SYSTEM]` tag
2. **For Gemini and Codex:** ALL tags (`[SYSTEM]`, `[CONTEXT]`, `[MESSAGE]`) are included in the prompt sent to stdin
3. **Gemini CLI behavior:** Echoes back the ENTIRE input (including tags) before generating response

### Why This Happens

**Hypothesis #1: Gemini CLI Echo Behavior**

Gemini CLI may be configured to echo the input prompt back to stdout, similar to verbose mode. This would explain why we see the exact prompt structure in the output.

**Hypothesis #2: Gemini Interprets Tags as Content**

Gemini may not recognize these tags as special instructions and treats them as part of the conversation content, then references them in its response.

**Hypothesis #3: Stream-JSON Format Issue**

The `--output-format stream-json` flag might be causing Gemini to include the full prompt in the output stream.

## Investigation Findings

### Gemini Adapter Configuration

**From `phoenix-prd.json` (UAT team config):**
```json
{
  "name": "gemini",
  "args": ["--yolo", "--output-format", "stream-json"]
}
```

### Gemini Args in ConversationStarter

**File:** `src/utils/ConversationStarter.ts:177-179`

```typescript
if (agentType === 'gemini') {
  // Gemini: enforce bypass + JSON stream output
  args = ['--yolo', '--output-format', 'stream-json'];
}
```

**`--yolo` flag:** Bypasses safety checks (not related to prompt echo)

### Gemini Parser

**File:** `src/events/parsers/GeminiParser.ts:81-88`

```typescript
case 'message':
  return {
    ...base,
    type: 'text',
    text: json.content,  // ← Directly uses content from Gemini output
    role: ['assistant', 'system'].includes(json.role) ? json.role as 'assistant' | 'system' : undefined,
    category: json.role === 'assistant' ? 'message' : undefined
  };
```

The parser extracts `json.content` without filtering prompt echo.

## Questions for Architecture Committee

❓ **Q1:** Does Gemini CLI have a flag to disable prompt echo?
- Check documentation for `--no-echo`, `--quiet`, or similar flags
- May need to test Gemini CLI directly to observe behavior

❓ **Q2:** Is this Gemini CLI bug or expected behavior?
- Is Gemini CLI designed to echo prompts in `stream-json` mode?
- Should we report this to Google Gemini CLI team?

❓ **Q3:** Can Gemini CLI support system prompts separately (like Claude's `--append-system-prompt`)?
- This would avoid including `[SYSTEM]` in the message body
- Check Gemini CLI documentation for system message support

❓ **Q4:** Should we use different prompt format for Gemini?
- Perhaps Gemini expects a different structure (no tags)?
- Or use plain text without section markers?

## Proposed Solutions

### Option 1: Post-Process Gemini Output (Quick Fix)

**Rationale:**
- Strip the prompt echo from Gemini's output before displaying
- Detect and remove `[SYSTEM]`, `[CONTEXT]`, `[MESSAGE]` sections

**Implementation:**
```typescript
// In GeminiParser.jsonToEvent() for type 'message'
case 'message':
  let text = json.content;

  // Strip prompt structure if it appears at start of response
  text = text.replace(/^\[SYSTEM\]\s+[\s\S]*?\n\n/, '');
  text = text.replace(/^\[CONTEXT\]\s+[\s\S]*?\n\n/, '');
  text = text.replace(/^\[MESSAGE\]\s+[\s\S]*?\n\n/, '');

  return {
    ...base,
    type: 'text',
    text,
    role: ...,
    category: ...
  };
```

**Pros:**
- Quick fix, works immediately
- No external dependencies on Gemini CLI changes
- Handles current behavior

**Cons:**
- Fragile (depends on exact tag format)
- May accidentally strip legitimate content
- Doesn't address root cause

### Option 2: Use Plain Prompt Format for Gemini (Recommended)

**Rationale:**
- Remove `[SYSTEM]`, `[CONTEXT]`, `[MESSAGE]` tags for Gemini
- Use natural language formatting instead
- Similar to how we handle Claude's system flag

**Implementation:**
```typescript
// In PromptBuilder.ts
function buildPromptForGemini(input: PromptInput): string {
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
  parts.push('');  // blank line
  parts.push(input.message);

  return parts.join('\n');
}

// In buildPrompt():
if (input.agentType === 'google-gemini') {
  prompt = buildPromptForGemini(input);
} else if (input.agentType === 'claude-code' && systemSection) {
  systemFlag = systemBody;
  prompt = `${contextSection}${messageSection}`.trim();
} else {
  prompt = `${systemSection}${contextSection}${messageSection}`.trim();
}
```

**Pros:**
- Clean, natural-looking prompts
- No visible tags to leak
- More maintainable
- Better user experience if Gemini echoes prompt

**Cons:**
- Requires testing to ensure Gemini understands the format
- Different prompt format per agent (more complexity)

### Option 3: Investigate Gemini CLI Flags (Best Long-term)

**Rationale:**
- Check if Gemini CLI has flags to prevent prompt echo
- Or use a different output format (not `stream-json`)

**Investigation Steps:**
1. Run `gemini --help` to see all available flags
2. Test different output formats:
   - `--output-format text`
   - `--output-format json` (not stream)
   - No output format flag (default)
3. Test with/without `--yolo` flag
4. Check Gemini CLI documentation/source code

**Pros:**
- Addresses root cause
- Cleanest solution if flag exists
- Works for all prompts

**Cons:**
- May not be possible if Gemini CLI doesn't support it
- Depends on Gemini CLI behavior/features

### Option 4: Use Gemini API Directly (Future Enhancement)

**Rationale:**
- Bypass Gemini CLI entirely
- Use Google Gemini API with proper SDK
- Full control over prompt formatting and response parsing

**Pros:**
- Complete control
- No CLI quirks
- Better integration

**Cons:**
- Major architecture change
- Requires API keys management
- More complex implementation
- Deviates from "CLI wrapper" architecture

## Recommended Fix

**Immediate:** Use **Option 1** (Post-process output) as a quick fix to unblock UAT

**Short-term:** Implement **Option 2** (Plain prompt format for Gemini) for better UX

**Long-term:** Investigate **Option 3** (Gemini CLI flags) to see if there's a cleaner solution

## Implementation Steps (Option 2 - Recommended)

1. **Create Gemini-specific prompt builder:**
   ```typescript
   // In PromptBuilder.ts
   function buildGeminiPrompt(input: PromptInput): string {
     // Natural language format without tags
   }
   ```

2. **Update buildPrompt() to use Gemini formatter:**
   ```typescript
   if (input.agentType === 'google-gemini') {
     prompt = buildGeminiPrompt(input);
     return { prompt };  // No systemFlag for Gemini
   }
   ```

3. **Add test coverage:**
   ```typescript
   it('builds prompt without tags for Gemini', () => {
     const prompt = buildPrompt({
       agentType: 'google-gemini',
       systemInstructionText: 'You are an assistant',
       contextMessages: [{ from: 'User', content: 'Hello' }],
       message: 'Continue'
     });

     expect(prompt.prompt).not.toContain('[SYSTEM]');
     expect(prompt.prompt).not.toContain('[CONTEXT]');
     expect(prompt.prompt).not.toContain('[MESSAGE]');
     expect(prompt.prompt).toContain('Instructions:');
     expect(prompt.prompt).toContain('Previous conversation:');
   });
   ```

4. **Run UAT again with Gemini to verify fix**

## Test Plan

1. **Unit test:** Prompt builder generates clean format for Gemini
2. **Integration test:** Full conversation with Gemini doesn't leak tags
3. **UAT:** Run phoenix team again, verify Carol (Gemini) output is clean
4. **Regression:** Ensure Claude and Codex still work correctly

## Related Issues

- None directly, but affects overall UX quality
