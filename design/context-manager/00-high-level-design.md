# ContextManager High-Level Design

## 1. Overview

### 1.1 Background

The current `ConversationCoordinator` class has grown to 850+ lines with mixed responsibilities:
- Session state management
- Message storage
- Routing logic (NEXT marker handling, queue management)
- Context building (from multiple sources)
- Prompt assembly
- Agent lifecycle management

This document proposes extracting context-related logic into a dedicated `ContextManager` module to achieve:
- Single Responsibility Principle (SRP)
- High cohesion, low coupling
- Easier testing and maintenance

### 1.2 Scope

This refactoring focuses on:
1. **In Scope**: Context building, message storage, prompt context preparation
2. **Out of Scope**: Routing logic, agent process management, UI/REPL integration

---

## 2. Architecture Diagrams

### 2.1 Component Diagram - Current State (AS-IS)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AS-IS Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ConversationCoordinator (850 lines)               │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │   │
│  │  │Session State │ │ Routing      │ │ Context      │ │ Agent       │ │   │
│  │  │Management    │ │ Logic        │ │ Building     │ │ Dispatch    │ │   │
│  │  │              │ │              │ │ (scattered)  │ │             │ │   │
│  │  │ - session    │ │ - routeToNext│ │ - getRecent  │ │ - sendTo    │ │   │
│  │  │ - status     │ │ - queue      │ │   Messages   │ │   Agent     │ │   │
│  │  │ - teamTask   │ │ - resolve    │ │ - getRecent  │ │ - build     │ │   │
│  │  │              │ │   Addressees │ │   Context    │ │   Prompt    │ │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────┘ │   │
│  └───────────────────────────┬─────────────────────────────────────────┘   │
│                              │                                              │
│          ┌───────────────────┼───────────────────┐                         │
│          ▼                   ▼                   ▼                          │
│  ┌───────────────┐   ┌───────────────┐   ┌─────────────────────┐           │
│  │ AgentManager  │   │ MessageRouter │   │ContextEventCollector│           │
│  │ (process mgmt)│   │ (parse NEXT)  │   │ (stream events)     │           │
│  └───────────────┘   └───────────────┘   └─────────────────────┘           │
│                                                  │                          │
│                                                  │ Rarely used!             │
│                                                  ▼                          │
│                                          ┌─────────────┐                   │
│                                          │ summaries   │                   │
│                                          │ (wasted)    │                   │
│                                          └─────────────┘                   │
│                                                                             │
│  Problems:                                                                  │
│  1. Context sources scattered (session.messages vs contextCollector)       │
│  2. Deduplication logic hardcoded in sendToAgent()                        │
│  3. getRecentContext() exists but unused                                   │
│  4. Agent-specific prompt formatting mixed with coordination logic         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Diagram - Target State (TO-BE)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TO-BE Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                  ConversationCoordinator (~400 lines)                  │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐ │ │
│  │  │  Session State   │  │   Routing Logic  │  │   Agent Dispatch     │ │ │
│  │  │  (simplified)    │  │   (simplified)   │  │   (delegates to      │ │ │
│  │  │                  │  │                  │  │    ContextManager)   │ │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘ │ │
│  └────────────────────────────────┬──────────────────────────────────────┘ │
│                                   │                                         │
│        ┌──────────────────────────┼──────────────────────────┐             │
│        ▼                          ▼                          ▼              │
│  ┌───────────────┐        ┌───────────────┐         ┌───────────────┐      │
│  │ AgentManager  │        │ContextManager │         │ MessageRouter │      │
│  │               │        │   (NEW)       │         │               │      │
│  └───────────────┘        └───────┬───────┘         └───────────────┘      │
│                                   │                                         │
│                    ┌──────────────┼──────────────┐                         │
│                    │              │              │                          │
│                    ▼              ▼              ▼                          │
│           ┌────────────┐  ┌────────────┐  ┌────────────┐                   │
│           │ Claude     │  │ Codex      │  │ Gemini     │                   │
│           │ Context    │  │ Context    │  │ Context    │                   │
│           │ Assembler  │  │ Assembler  │  │ Assembler  │                   │
│           └────────────┘  └────────────┘  └────────────┘                   │
│                    │              │              │                          │
│                    └──────────────┼──────────────┘                         │
│                                   ▼                                         │
│                           ┌─────────────┐                                  │
│                           │MessageStore │                                  │
│                           │(messages[]) │                                  │
│                           └─────────────┘                                  │
│                                                                             │
│  Benefits:                                                                  │
│  1. Single source of truth for context (ContextManager)                    │
│  2. Agent-specific formatting isolated in separate assemblers              │
│  3. Deduplication logic centralized                                        │
│  4. Easier to test each component independently                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Class Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Class Diagram                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        <<interface>>                                 │   │
│  │                      IContextProvider                                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  + getContextForAgent(agentId: string, agentType: AgentType):       │   │
│  │      PromptContext                                                  │   │
│  │  + addMessage(message: ConversationMessage): void                   │   │
│  │  + getLatestMessage(): ConversationMessage | null                   │   │
│  │  + setTeamTask(task: string): void                                  │   │
│  │  + getTeamTask(): string | null                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    △                                        │
│                                    │ implements                             │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         ContextManager                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  - messages: ConversationMessage[]                                  │   │
│  │  - teamTask: string | null                                          │   │
│  │  - contextWindowSize: number                                        │   │
│  │  - assemblers: Map<AgentType, IContextAssembler>                    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  + constructor(options: ContextManagerOptions)                      │   │
│  │  + addMessage(msg: ConversationMessage): void                       │   │
│  │  + getLatestMessage(): ConversationMessage | null                   │   │
│  │  + getContextForAgent(agentId, agentType): PromptContext            │   │
│  │  + setTeamTask(task: string): void                                  │   │
│  │  + getTeamTask(): string | null                                     │   │
│  │  + getMessages(): ConversationMessage[]  // for session persistence │   │
│  │  + clear(): void                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    │ uses                                   │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        <<interface>>                                 │   │
│  │                      IContextAssembler                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  + assemble(input: AssemblerInput): PromptContext                   │   │
│  │  + getAgentType(): AgentType                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    △                                        │
│          ┌─────────────────────────┼─────────────────────────┐             │
│          │                         │                         │              │
│  ┌───────┴───────┐        ┌───────┴───────┐        ┌───────┴───────┐      │
│  │ ClaudeContext │        │ CodexContext  │        │ GeminiContext │      │
│  │ Assembler     │        │ Assembler     │        │ Assembler     │      │
│  ├───────────────┤        ├───────────────┤        ├───────────────┤      │
│  │ - Uses        │        │ - Inline      │        │ - Plain text  │      │
│  │   systemFlag  │        │   [SYSTEM]    │        │   format      │      │
│  │ - [TEAM_TASK] │        │ - [TEAM_TASK] │        │ - No markers  │      │
│  │   [CONTEXT]   │        │   [CONTEXT]   │        │ - "Convo so   │      │
│  │   [MESSAGE]   │        │   [MESSAGE]   │        │    far:" style│      │
│  └───────────────┘        └───────────────┘        └───────────────┘      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          PromptContext                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  + prompt: string               // Main prompt text                 │   │
│  │  + systemFlag?: string          // Claude --append-system-prompt    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         AssemblerInput                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  + contextMessages: PromptContextMessage[]  // History (excl. last) │   │
│  │  + currentMessage: string                   // Latest message       │   │
│  │  + teamTask: string | null                                          │   │
│  │  + systemInstruction?: string               // Member's instruction │   │
│  │  + instructionFileText?: string             // From file            │   │
│  │  + maxBytes?: number                        // Token budget         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Sequence Diagram - Parallel NEXT Routing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│         Sequence: User sends "[NEXT:max] [NEXT:sarah] [NEXT:carol] Hi"      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User        Coordinator      ContextManager     Assembler      Agent      │
│   │               │                │                │             │         │
│   │──"[NEXT:...]"─▶               │                │             │         │
│   │               │                │                │             │         │
│   │               │──addMessage()─▶│                │             │         │
│   │               │                │ messages=[     │             │         │
│   │               │                │   {kailai:"Hi"}│             │         │
│   │               │                │ ]              │             │         │
│   │               │                │                │             │         │
│   │               │──queue: [max, sarah, carol]    │             │         │
│   │               │                │                │             │         │
│   │               │                │                │             │         │
│   │  ═══════════════════ Process Max ═══════════════════════════  │         │
│   │               │                │                │             │         │
│   │               │──getContext    │                │             │         │
│   │               │  ForAgent(max)─▶                │             │         │
│   │               │                │──assemble()───▶│             │         │
│   │               │                │  contextMsgs=[]│             │         │
│   │               │                │  currentMsg=   │             │         │
│   │               │                │    "Hi"        │             │         │
│   │               │◀──PromptCtx────│◀───────────────│             │         │
│   │               │                │                │             │         │
│   │               │────────────────────────────────────send()────▶│         │
│   │               │                │                │             │         │
│   │               │◀───────────────────────────────────response───│         │
│   │               │  "我建议..."   │                │             │         │
│   │               │                │                │             │         │
│   │               │──addMessage()─▶│                │             │         │
│   │               │                │ messages=[     │             │         │
│   │               │                │   {kailai:"Hi"}│             │         │
│   │               │                │   {max:"我建议"}│             │         │
│   │               │                │ ]              │             │         │
│   │               │                │                │             │         │
│   │  ═══════════════════ Process Sarah ═════════════════════════  │         │
│   │               │                │                │             │         │
│   │               │──getContext    │                │             │         │
│   │               │  ForAgent(sarah)                │             │         │
│   │               │                │──assemble()───▶│             │         │
│   │               │                │  contextMsgs=[ │             │         │
│   │               │                │    {kailai}    │             │         │
│   │               │                │  ]             │             │         │
│   │               │                │  currentMsg=   │             │         │
│   │               │                │    "我建议..." │             │         │
│   │               │◀──PromptCtx────│◀───────────────│             │         │
│   │               │                │                │             │         │
│   │               │────────────────────────────────────send()────▶│         │
│   │               │                │                │             │         │
│   │               │◀───────────────────────────────────response───│         │
│   │               │  "技术上..."   │                │             │         │
│   │               │                │                │             │         │
│   │               │──addMessage()─▶│                │             │         │
│   │               │                │ messages=[     │             │         │
│   │               │                │   {kailai:"Hi"}│             │         │
│   │               │                │   {max:"我建议"}│             │         │
│   │               │                │   {sarah:"技术"}│             │         │
│   │               │                │ ]              │             │         │
│   │               │                │                │             │         │
│   │  ═══════════════════ Process Carol ═════════════════════════  │         │
│   │               │                │                │             │         │
│   │               │──getContext    │                │             │         │
│   │               │  ForAgent(carol)                │             │         │
│   │               │                │──assemble()───▶│             │         │
│   │               │                │  contextMsgs=[ │             │         │
│   │               │                │    {kailai},   │             │         │
│   │               │                │    {max}       │             │         │
│   │               │                │  ]             │             │         │
│   │               │                │  currentMsg=   │             │         │
│   │               │                │    "技术上..." │             │         │
│   │               │◀──PromptCtx────│◀───────────────│             │         │
│   │               │                │                │             │         │
│   │                                                                         │
│  Key Points:                                                                │
│  1. contextMessages = all messages EXCEPT the last one                     │
│  2. currentMessage = the LAST message in messages[]                        │
│  3. Each agent's response is added to messages[] before next agent         │
│  4. Assembler is agent-type specific (Claude/Codex/Gemini)                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module Dependencies

### 3.1 Upstream Dependencies (Who calls ContextManager)

| Caller | Method Called | Purpose |
|--------|---------------|---------|
| `ConversationCoordinator.sendMessage()` | `addMessage()` | Store user message |
| `ConversationCoordinator.sendToAgent()` | `getContextForAgent()` | Get prompt context |
| `ConversationCoordinator.sendToAgent()` | After agent response: `addMessage()` | Store agent response |
| `ConversationCoordinator.updateTeamTask()` | `setTeamTask()` | Update team task |
| `ReplModeInk` (future) | `getMessages()` | Display conversation history |

### 3.2 Downstream Dependencies (What ContextManager calls)

| Dependency | Purpose | Notes |
|------------|---------|-------|
| `ConversationMessage` | Message data structure | From `models/ConversationMessage.ts` |
| `PromptContextMessage` | Context message format | From `utils/PromptBuilder.ts` |
| `MessageRouter.stripAllMarkersForContext()` | Clean markers from context | Avoid [NEXT] duplication |
| `IContextAssembler` implementations | Agent-specific formatting | Claude/Codex/Gemini |

### 3.3 Peer Dependencies (Siblings, not direct dependency)

| Component | Relationship | Notes |
|-----------|--------------|-------|
| `AgentManager` | Coordinator uses both | No direct interaction |
| `MessageRouter` | Used by Coordinator for parsing | Assemblers may reuse for cleanup |
| `ContextEventCollector` | **TBD: May be deprecated** | See Open Questions |

---

## 4. Sub-Module Design

### 4.1 File Structure

```
src/
├── context/
│   ├── ContextManager.ts           # Main class, implements IContextProvider
│   ├── IContextProvider.ts         # Interface definition
│   ├── IContextAssembler.ts        # Assembler interface
│   ├── assemblers/
│   │   ├── ClaudeContextAssembler.ts   # Claude-specific formatting
│   │   ├── CodexContextAssembler.ts    # Codex-specific formatting
│   │   ├── GeminiContextAssembler.ts   # Gemini-specific formatting
│   │   └── PlainTextAssembler.ts       # Fallback for unknown agent types
│   └── index.ts                    # Public exports
```

### 4.2 Assembler Responsibilities

Each assembler encapsulates agent-specific prompt formatting logic:

| Assembler | System Instruction | Context Format | Special Features |
|-----------|-------------------|----------------|------------------|
| **ClaudeContextAssembler** | Via `systemFlag` (--append-system-prompt) | `[TEAM_TASK]`, `[CONTEXT]`, `[MESSAGE]` | Separates system from prompt |
| **CodexContextAssembler** | Inline `[SYSTEM]` | `[SYSTEM]`, `[TEAM_TASK]`, `[CONTEXT]`, `[MESSAGE]` | All in single prompt |
| **GeminiContextAssembler** | Inline "Instructions:" | Plain text, "Conversation so far:" | No bracketed markers |
| **PlainTextAssembler** | Inline (no header) | Plain text list | Fallback for unknown types |

### 4.3 Cohesion & Coupling Guidelines

**High Cohesion**:
- Each assembler only knows about one agent type
- ContextManager only manages message storage and delegates formatting
- No business logic leakage between assemblers

**Low Coupling**:
- Assemblers don't know about each other
- ContextManager uses interface, not concrete assemblers directly
- Assemblers receive all needed data via `AssemblerInput`, no external dependencies

---

## 5. Key Decisions (CONFIRMED)

### D1: Message & TeamTask Ownership

**Decision**: ContextManager is the **single source of truth** for messages and teamTask.

- `ConversationSession`/`SessionUtils` no longer stores messages/teamTask directly
- Session becomes a serialization shell for persistence (export/import snapshots)
- API: `addMessage`, `getMessages`, `setTeamTask`, `getTeamTask`
- Provide `exportSnapshot()`/`importSnapshot()` for persistence compatibility

### D2: ContextEventCollector Disposition

**Decision**: **Remove from prompt path**, optionally keep for logging only.

- Prompt building **always** uses ContextManager's messages
- ContextEventCollector no longer participates in context building
- If logging/audit use case exists, keep as "log-only" component
- **No dual-source selection** - single source of truth

### D3: Deduplication Logic (AI→AI)

**Decision**: Deduplicate **only when current sender is AI**.

**Rule**:
- Deduplication happens **after** marker stripping, **before** assembler formatting
- Only triggered when `currentMessage.speaker.type === 'ai'`
- Check order: ID match first, then speaker+content match
- If `contextMessages` last item matches, remove it

**Algorithm** (executed in `getContextForAgent()`):

```typescript
function deduplicateContext(
  contextMessages: PromptContextMessage[],  // Already stripped
  currentMessage: ConversationMessage       // The message being sent
): PromptContextMessage[] {
  // Step 1: Only deduplicate for AI senders
  if (currentMessage.speaker.type !== 'ai') {
    return contextMessages;
  }

  // Step 2: Check if there's anything to deduplicate
  if (contextMessages.length === 0) {
    return contextMessages;
  }

  const last = contextMessages[contextMessages.length - 1];
  const currentContent = stripMarkers(currentMessage.content);  // Already stripped

  // Step 3: Check by ID first (most reliable)
  const lastMessageId = last.messageId;  // If we track original message ID
  if (lastMessageId && lastMessageId === currentMessage.id) {
    return contextMessages.slice(0, -1);
  }

  // Step 4: Fallback to speaker + content match
  // Note: last.from is speaker name, currentMessage.speaker.roleName is speaker name
  if (last.from === currentMessage.speaker.roleName && last.content === currentContent) {
    return contextMessages.slice(0, -1);
  }

  // Step 5: No match, return unchanged
  return contextMessages;
}
```

**When Deduplication Triggers** (typical scenario):
```
User: "Hi" → stored as messages[0]
Max (AI) responds: "Hello!" → stored as messages[1]
Route to Sarah (AI):
  - contextMessages = [messages[0], messages[1]] (after windowing)
  - currentMessage = messages[1] (Max's response)
  - Max's response appears in BOTH contextMessages AND currentMessage
  - Dedup removes messages[1] from contextMessages
  - Sarah receives: context=[User:"Hi"], message="Hello!"
```

**When Deduplication Does NOT Trigger**:
- Human sends message (currentMessage.speaker.type === 'human')
- No overlap between context and current message
- Different speaker in last context vs current message

### D4: Prompt Assembly & Token Budget

**Decision**: **Assembler formats, shared utility trims**.

- Each agent-type Assembler only handles format assembly (SYSTEM/TEAM_TASK/CONTEXT/MESSAGE)
- Token/byte budget trimming stays in shared utility (existing `PromptBuilder` logic)
- Assemblers call the shared trimming utility
- **No duplicate budget trimming code** - avoid double/missed trimming

### D5: Context Window Size

**Decision**: **Global config now, per-agent override later**.

- Global `contextWindowSize` (default 5), owned by ContextManager
- Reserve parameter for future per-agent override, but don't implement dynamic/adaptive strategy now

### D6: TeamTask Behavior

**Decision**: ContextManager owns teamTask with **5KB limit and truncation warning**.

- Logic moves from Coordinator to ContextManager
- Assembler reads teamTask from ContextManager
- Session no longer holds teamTask independently

### D7: Session Persistence & UI/History

**Decision**: **UI/persistence reads from ContextManager**.

- UI/persistence uses `getMessages()` or `exportSnapshot()`
- **Do NOT** directly access `Session.messages`
- State restoration via `importSnapshot()` to reload into ContextManager

---

## 6. Boundaries & Constraints (For Detail Design)

The following points **MUST** be addressed in detail design to avoid implementation rework.

### 6.1 Empty State & Error Behavior

| Scenario | Expected Behavior |
|----------|-------------------|
| No messages, `getContextForAgent()` called | Return `{ contextMessages: [], currentMessage: '', teamTask: null }` |
| No team set | **Throw Error** - ContextManager requires team context for member lookup |
| Unknown agentType (no assembler) | **Fallback to PlainTextAssembler** + log warning (see below) |
| `addMessage()` with invalid message | Throw Error, do not store |

**PlainTextAssembler Fallback**:
- Used when agentType is not `claude-code`, `openai-codex`, or `google-gemini`
- Format: No bracketed markers, simple concatenation
- Output: `{systemInstruction}\n\n{context}\n\n{message}`
- Logs warning: `[ContextManager] Unknown agentType "${type}", using PlainTextAssembler`

### 6.2 Marker Stripping Location

**Decision**: ContextManager strips markers **once** when generating context.

- `getContextForAgent()` calls `MessageRouter.stripAllMarkersForContext()` on each message
- Assemblers receive **already-cleaned** messages, do NOT strip again
- Avoids double-stripping or missed stripping

### 6.3 Message Append Semantics

**Decision**: Append is **non-rollback**.

| Scenario | Behavior |
|----------|----------|
| `addMessage()` succeeds | Message stored with generated `id`, returned |
| `addMessage()` fails (validation) | Throw Error, nothing stored |
| Agent execution fails after message stored | Message remains (may add error marker in future) |
| User cancellation mid-execution | Partial messages may exist, caller decides cleanup |

**Parallel/Cancellation**: ContextManager operations are synchronous. Caller (Coordinator) must ensure sequential `addMessage()` calls even in async agent execution.

### 6.4 System Instruction Priority & Trim Rules

**Decision**: Concatenate in order: `systemInstruction` + `instructionFileText`.

```typescript
function buildSystemBody(systemInstruction?: string, instructionFileText?: string): string {
  // Step 1: Filter out empty/whitespace-only strings
  const parts = [systemInstruction, instructionFileText]
    .map(s => s?.trim())           // Trim each part
    .filter(s => s && s.length > 0);  // Remove empty strings

  // Step 2: Join with double newline separator
  const body = parts.join('\n\n');

  // Step 3: Final trim (handles edge cases)
  return body.trim();
}
```

**Trim Rules**:
| Input | Output |
|-------|--------|
| Both empty/undefined | `''` (empty string, no system section) |
| Only systemInstruction | `systemInstruction.trim()` |
| Only instructionFileText | `instructionFileText.trim()` |
| Both present | `systemInstruction.trim() + '\n\n' + instructionFileText.trim()` |
| Whitespace-only strings | Treated as empty, skipped |

**Empty Section Handling** (applies to all sections):
- If a section body is empty after trim, **do not emit the section at all**
- Example: Empty teamTask → no `[TEAM_TASK]` section, not `[TEAM_TASK]\n\n`
- Assemblers must check for empty before adding section headers

### 6.5 Token Budget Source

**Decision**: `maxBytes` comes from **global config with default fallback**.

| Priority | Source | Default |
|----------|--------|---------|
| 1 | `ContextManagerOptions.maxBytes` | - |
| 2 | Global config (future) | - |
| 3 | Hardcoded default | **768KB** (768 * 1024 bytes) |

**Note**: 768KB matches existing `PromptBuilder.ts` implementation (`DEFAULT_MAX_BYTES = 768 * 1024`).

- Assembler receives `maxBytes` from `getContextForAgent()` output
- **Callers do NOT pass maxBytes** - ContextManager is the authority
- Budget includes: systemInstruction + teamTask + context + message

### 6.6 Lifecycle & Reset

**Decision**: **One ContextManager instance per conversation session**.

| Method | Semantics |
|--------|-----------|
| `constructor()` | Create empty instance |
| `clear()` / `reset()` | Clear all messages and teamTask, ready for new conversation |
| Instance disposal | When Coordinator ends session, dispose ContextManager |

**Coordinator Lifecycle**:
```
setTeam() → new ContextManager()
conversation...
stop() → contextManager.clear() or dispose
```

### 6.7 Logging & Event Hooks

**Decision**: Provide optional event hooks for REPL/logging layer.

```typescript
interface ContextManagerOptions {
  contextWindowSize?: number;
  maxBytes?: number;
  onMessageAdded?: (msg: ConversationMessage) => void;  // Hook for logging
  onTeamTaskChanged?: (task: string | null) => void;    // Hook for logging
}
```

- Hooks are optional, default to no-op
- Replaces ContextEventCollector's role in context path
- REPL can subscribe to display updates

### 6.8 Interface Contract Summary

```typescript
interface IContextProvider {
  // Message management
  addMessage(msg: Omit<ConversationMessage, 'id'>): ConversationMessage;
  getMessages(): ConversationMessage[];
  getLatestMessage(): ConversationMessage | null;

  // TeamTask management
  setTeamTask(task: string): void;  // 5KB limit enforced internally
  getTeamTask(): string | null;

  // Context for agents
  getContextForAgent(
    agentId: string,
    agentType: AgentType,
    options?: { windowSizeOverride?: number }
  ): AssemblerInput;

  // Lifecycle
  clear(): void;

  // Persistence
  exportSnapshot(): ContextSnapshot;
  importSnapshot(snapshot: ContextSnapshot): void;
}

interface AssemblerInput {
  contextMessages: PromptContextMessage[];  // Already stripped, deduplicated
  currentMessage: string;
  teamTask: string | null;
  systemInstruction?: string;
  instructionFileText?: string;
  maxBytes: number;
}

interface AssemblerOutput {
  prompt: string;
  systemFlag?: string;  // For Claude --append-system-prompt
}
```

---

## 7. Migration Plan

### Phase 1: Create ContextManager (Non-breaking)

1. Create `src/context/` directory structure
2. Implement `ContextManager` class with full interface
3. Implement 3 assemblers: Claude, Codex, Gemini
4. Add comprehensive unit tests (see Section 8)
5. **Do NOT wire to Coordinator yet** - standalone implementation

**Deliverables**:
- `src/context/ContextManager.ts`
- `src/context/IContextProvider.ts`
- `src/context/IContextAssembler.ts`
- `src/context/assemblers/ClaudeContextAssembler.ts`
- `src/context/assemblers/CodexContextAssembler.ts`
- `src/context/assemblers/GeminiContextAssembler.ts`
- `tests/unit/context/ContextManager.test.ts`
- `tests/unit/context/assemblers/*.test.ts`

### Phase 2: Integrate with Coordinator

1. Inject `ContextManager` into `ConversationCoordinator`
2. Replace message operations:
   - `session.messages.push()` → `contextManager.addMessage()`
   - `session.messages` read → `contextManager.getMessages()`
   - `session.teamTask` → `contextManager.setTeamTask()`/`getTeamTask()`
3. Replace prompt building:
   - `getRecentMessages()` + `buildPrompt()` → `contextManager.getContextForAgent()` + Assembler
4. Update `SessionUtils` to use `exportSnapshot()`/`importSnapshot()`
5. Verify all existing tests pass

**Breaking Changes**: None expected if interfaces match

### Phase 3: Cleanup

1. Remove from `ConversationCoordinator`:
   - `getRecentMessages()` method
   - `getRecentContext()` method (unused)
   - `prepareDelivery()` method (unused after Bug 7 fix)
   - Direct `session.messages` manipulation
2. Remove from prompt path:
   - `ContextEventCollector` references in context building
   - Keep only if logging use case confirmed
3. Update `ConversationSession` model:
   - Remove `messages` array (or mark deprecated)
   - Remove `teamTask` field (or mark deprecated)
4. Update all UI/REPL code to read from ContextManager
5. Update design documentation

---

## 8. Testing Strategy

### 8.1 Unit Tests - ContextManager

**File**: `tests/unit/context/ContextManager.test.ts`

| Test Case | Description |
|-----------|-------------|
| `addMessage stores and returns message with id` | Basic add/retrieve |
| `getLatestMessage returns null when empty` | Empty state |
| `getLatestMessage returns last message` | Basic retrieval |
| `getMessages returns all messages in order` | Order preservation |
| `setTeamTask stores task` | Basic teamTask |
| `setTeamTask truncates at 5KB with warning` | Size limit enforcement |
| `getTeamTask returns null initially` | Empty state |
| `clear removes all messages and teamTask` | Reset behavior |
| `exportSnapshot returns serializable state` | Persistence |
| `importSnapshot restores state` | Persistence |
| `getContextForAgent returns empty context when no messages` | Empty state |
| `getContextForAgent applies windowSize limit` | Window trimming |
| `getContextForAgent deduplicates AI→AI` | Dedup rule |
| `getContextForAgent does NOT deduplicate human messages` | Dedup rule |
| `getContextForAgent strips markers from context` | Marker stripping |
| `onMessageAdded hook is called` | Event hook |
| `onTeamTaskChanged hook is called` | Event hook |

### 8.2 Unit Tests - Assemblers

**Files**: `tests/unit/context/assemblers/*.test.ts`

| Assembler | Test Cases |
|-----------|------------|
| **ClaudeContextAssembler** | systemFlag separation, [TEAM_TASK]/[CONTEXT]/[MESSAGE] format, empty sections |
| **CodexContextAssembler** | inline [SYSTEM], full section order, empty sections |
| **GeminiContextAssembler** | "Instructions:"/"Conversation so far:"/"User message:" format, no brackets |
| **All** | maxBytes passed to trimmer, empty input handling, unknown agent fallback |

### 8.3 Integration Tests

**File**: `tests/integration/contextManager.integration.test.ts`

| Test Case | Description |
|-----------|-------------|
| `parallel NEXT routing: each agent gets correct context` | Verify Bug 7 fix works with new architecture |
| `AI→AI deduplication in routing chain` | Max → Sarah → Carol, each gets previous response |
| `teamTask injection across all agents` | All agents receive teamTask |
| `token budget trimming drops oldest context` | Large context trimmed correctly |
| `context marker stripping prevents duplication` | [NEXT] markers not in context |

### 8.4 Regression Tests

| Test Suite | Expectation |
|------------|-------------|
| `routingQueue.integration.test.ts` | All 4 tests pass |
| `jsonlMessageFormatter.test.ts` | All tests pass |
| Existing UAT scenarios | No behavior change |

### 8.5 Edge Case Coverage

| Edge Case | Test Location |
|-----------|---------------|
| teamTask exactly 5KB | ContextManager unit test |
| teamTask > 5KB truncation | ContextManager unit test |
| Empty systemInstruction AND instructionFileText | Assembler unit tests |
| Only systemInstruction | Assembler unit tests |
| Only instructionFileText | Assembler unit tests |
| Whitespace-only systemInstruction | Assembler unit tests |
| Context window = 0 | ContextManager unit test |
| Single message (no context) | ContextManager unit test |
| Unknown agentType → PlainTextAssembler | ContextManager unit test |
| AI→AI dedup with same ID | ContextManager unit test |
| AI→AI dedup with same speaker+content | ContextManager unit test |
| AI→AI no dedup (different speaker) | ContextManager unit test |
| Human message no dedup | ContextManager unit test |
| Empty section not emitted | Assembler unit tests |

---

## 9. Appendix

### A. Current Code References

| File | Relevant Code | Line Numbers |
|------|---------------|--------------|
| `ConversationCoordinator.ts` | `getRecentMessages()` | 698-705 |
| `ConversationCoordinator.ts` | `getRecentContext()` | 710-731 |
| `ConversationCoordinator.ts` | `sendToAgent()` context building | 519-540 |
| `PromptBuilder.ts` | `buildPrompt()` | 123-184 |
| `PromptBuilder.ts` | `buildGeminiPrompt()` | 83-121 |
| `ContextEventCollector.ts` | Full file | 1-149 |

### B. Agent Type Differences

| Feature | Claude | Codex | Gemini |
|---------|--------|-------|--------|
| System prompt | `--append-system-prompt` flag | Inline `[SYSTEM]` | Inline "Instructions:" |
| Context format | `[CONTEXT]` with markers | `[CONTEXT]` with markers | "Conversation so far:" |
| Message format | `[MESSAGE]` | `[MESSAGE]` | "User message:" |
| Stream parser | `ClaudeCodeParser` | `CodexParser` | `GeminiParser` |
| Output filtering | N/A | N/A | Filter `role=user` messages |
