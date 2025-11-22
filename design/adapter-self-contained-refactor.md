# Adapter Self-Contained Refactor - Design (Finalized)

**Status:** Revision 4.1  
**Date:** 2025-11-22  
**Author:** Product Team  
**Reviewer:** Architecture Committee  

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-21 | Initial proposal |
| 2.0 | 2025-11-21 | Clarified AdapterFactory, ProcessManager integration, and interface extensions |
| 3.0 | 2025-11-21 | Added migration plan and fixed spawn/send timing notes |
| 3.1 | 2025-11-22 | PromptBuilder replaces `prepareMessage()`; adapters narrowed to spawn/validate/getDefaultArgs |
| 4.0 | 2025-11-21 | Fixed systemInstruction storage and customStreams handling in ProcessManager |
| 4.1 | 2025-11-22 | Final prompt flow: `[SYSTEM][CONTEXT][MESSAGE]` via PromptBuilder, 768 KB cap, no `[TASK]` or endMarker logic; stateless Claude injects `-p --append-system-prompt` |

---

## Executive Summary

Adapters are now self-contained and rely on PromptBuilder for prompt construction. System instructions are always delivered (config + instruction file merged), prompts are capped at 768 KB UTF-8, and JSONL completion replaces legacy end-marker logic. Claude stateless calls inject `-p --append-system-prompt`, while Codex/Gemini inline the full prompt string.

---

## Problem Analysis

- Codex/Gemini previously relied on wrapper scripts for systemInstruction/endMarker that were not shipped with the npm package.  
- Prompt assembly was split across Coordinator/Adapter, causing missing system prompts when files failed to load.  
- Stateless Claude could launch the interactive TUI without `-p`/`--append-system-prompt`.  
- Documentation still referenced `[TASK]`, `endMarker`, and `prepareMessage()` which no longer exist in code.  

---

## Final Design

### Design Principles
1. Self-contained adapters (no wrapper requirement).  
2. PromptBuilder owns prompt assembly (`[SYSTEM][CONTEXT][MESSAGE]`), no `[TASK]`.  
3. Unified UTF-8 limit **768 KB**; trim context from oldest first, summarize system file only when needed.  
4. CLI differences isolated: Claude uses systemFlag + `-p`; Codex/Gemini inline string prompts.  
5. Completion detection uses JSONL events (`turn.completed` / `result` / `reuslt`), not `[DONE]`.  

### Adapter Responsibilities
- `spawn(config)`: start process; may return `customStreams` when interception is needed (default passthrough).  
- `validate()`: ensure CLI is available.  
- `getDefaultArgs()`: adapter-specific defaults.  
- `executeOneShot?()`: stateless adapters only.  
- ❌ No `prepareMessage()` / `getDefaultEndMarker()`.  

### Prompt Handling (PromptBuilder)
- Inputs: systemInstruction (config) + instructionFile text, recent N messages with from/to, current message.  
- Template: `[SYSTEM]\n...\n[CONTEXT]\n...\n[MESSAGE]\n...` (no `[TASK]`).  
- Length control: total UTF-8 < 768 KB. If exceeded → summarize/truncate instruction file portion, then drop oldest context messages as whole entries; if still too large, throw a clear error asking user to shorten input.  
- Output: `prompt` + optional `systemFlag`. Claude uses `systemFlag` + `-p`; Codex/Gemini use `prompt` only.  

### AgentManager Integration
- Stateless Claude: add `-p` to avoid TUI; pass `--append-system-prompt ${systemFlag}` when present; append prompt as final arg.  
- Stateless Codex/Gemini: inline prompt as final arg.  
- Stateful: send prompt via `processManager.sendAndReceive(processId, prompt)`.  
- System instruction stored on AgentInstance (not child process).  

### ProcessManager Integration
- Listen to JSONL completion events; end-marker logic removed.  
- Use adapter-provided `customStreams` when present; otherwise default stdout/stderr.  

### Wrapper Scripts
- Now examples only; product does not depend on them.  

---

## Migration Status (0.0.21+)

- PromptBuilder merged into runtime flow; system instruction + file combined; unified template and 768 KB cap with time-ordered context trimming.  
- AgentManager stateless Claude path injects `-p --append-system-prompt`; Codex/Gemini inline prompts; stateful path unchanged (stdin).  
- Adapters no longer expose `prepareMessage/getDefaultEndMarker`; wrapper dependency removed.  
- Tests: PromptBuilder unit coverage; AgentManager stateless Claude systemFlag; JSONL formatter tests cover completion parsing.  
- Docs: prompt-builder.md and agent-adapter-architecture-zh.md aligned; this file reflects final architecture.  

---

## Architecture Decision Record (Summary)

1. Adapters are self-contained; wrapper scripts are optional examples.  
2. PromptBuilder owns prompt assembly and length control; `[TASK]` removed.  
3. Claude system prompts via `--append-system-prompt`; Codex/Gemini inline string prompts.  
4. Completion detection uses JSONL events only; endMarker logic removed.  
5. Context trimming removes oldest messages first; minimal summarization applied to system section when oversized.  

---

## Open Questions (Closed/Tracked Elsewhere)

- System summarization heuristic may evolve (currently simple truncation/summary when oversized).  
- Context filtering beyond time-order trimming can be revisited if needed.  
