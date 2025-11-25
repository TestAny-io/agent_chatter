# Conversation First Message Refactor - Requirements & Design

**Version:** 4.0
**Status:** Architecture Committee Review - Round 5 (Final Review)
**Last Updated:** 2025-11-25

## Overview
Remove the special "initial message" concept and treat the first message as a regular message in the conversation flow. Introduce `[FROM:xxx]` and `[TEAM_TASK:xxx]` markers for better conversation control.

## Current Problems

1. **Special Initial Message Handling**: `/start` command creates artificial distinction between first and subsequent messages
2. **Implicit First Speaker**: System assumes first speaker without explicit user control
3. **No Team-Level Context**: Missing mechanism to set persistent team-wide task context
4. **Human Member Ambiguity**: In multi-human teams, unclear which human is speaking
5. **AI First Speaker Allowed**: Current implementation allows AI to start conversation via `/start` command with AI member specified

## Product Decision (PM)

**Hard Constraint:** AI members can NO LONGER start conversations. First message MUST come from a human member.

## Requirements

### REQ-1: Remove Initial Message Concept

**What to Remove:**
- `ConversationSession.initialMessage` field
- `ConversationSession.firstSpeakerId` field
- "System: Initial task: xxx" system message injection
- Special handling in `startConversation()` method

**What to Keep:**
- `ConversationSession` as container for message history
- First message stored as regular message in `messages[]` array

**Migration:**
- Existing sessions can derive first speaker from `messages[0].speaker.roleId`
- `initialMessage` becomes `messages[0].content`

### REQ-2: First Message Must Be From Human (Hard Constraint)

**Constraint:**
- Conversation MUST start with human member input
- System MUST reject attempts to start conversation with AI member
- After first message, normal routing rules apply

**Implementation:**
- Check `session.messages.length === 0` to detect first message
- Validate sender is human member (`type === 'human'`)
- Throw error if AI attempts to send first message

### REQ-3: `[FROM:xxx]` Marker

**Purpose:**
1. Explicitly specify which human member is speaking
2. Allow "buzzing in" to change active human speaker

**Scope:**
- Applies to ALL human member messages (first and subsequent)
- Only affects human members (AI members always identified by process)

**Syntax:**
```
[FROM:xxx] Message content
```

**Matching Rules:**
- Same as `[NEXT:xxx]`: fuzzy match on `name`, `displayName`, or `id`
- Case-insensitive, ignore spaces/hyphens/underscores

**Behavior - Single Human Team:**
- If team has exactly 1 human member:
  - `[FROM:xxx]` is optional
  - System auto-adds `[FROM:only_human_name]` if missing
  - User can still explicitly specify (no error)

**Behavior - Multi-Human Team:**
- If team has 2+ human members:
  - First message MUST include `[FROM:xxx]`
  - Subsequent messages: If missing, use current `waitingForRoleId`
  - If present, overrides `waitingForRoleId` (allows "buzzing in")

**Error Handling:**
- Invalid member name: Show error with list of valid human members
- Non-human member in `[FROM:xxx]`: Show error "Cannot use [FROM:xxx] for AI members"

**Example Flow:**
```
Team: Kailai (human), Bob (human), Max (AI)

User input: "[FROM:kailai] Let's discuss the new feature [NEXT:max]"
→ Kailai sends message, routes to Max

Max responds: "Here's my analysis [NEXT:bob]"
→ Max sends message, routes to Bob
→ System sets waitingForRoleId = bob

User input: "[FROM:kailai] Wait, I have more context"
→ Kailai "buzzes in", overriding Bob's turn
→ System clears waitingForRoleId, processes as Kailai's message
```

### REQ-4: `[TEAM_TASK:xxx]` Marker

**Purpose:**
- Set persistent team-wide task context
- Visible to all agents in all subsequent messages
- Separate from individual message content

**Syntax:**
```
[TEAM_TASK:Task description here]
```

**Lifecycle:**
- Set once, persists for entire conversation
- Can be updated by any member (human or AI)
- New `[TEAM_TASK:xxx]` overwrites previous value
- Remains until explicitly changed or conversation ends

**Prompt Assembly:**

Current format:
```
[SYSTEM]
{agent system instruction}

[CONTEXT]
{recent messages}

[MESSAGE]
{current message}
```

New format:
```
[SYSTEM]
{agent system instruction}

[TEAM_TASK]
{persistent team task}

[CONTEXT]
{recent messages}

[MESSAGE]
{current message}
```

**Storage:**
- Add `teamTask: string | null` field to `ConversationSession`
- Update when `[TEAM_TASK:xxx]` detected in any message
- Include in prompt for ALL agents in ALL messages after set

**Content Handling:**
- `[TEAM_TASK:xxx]` remains in message content (not stripped)
- Rationale: Provides context in conversation history

**Example:**
```
User: "[FROM:kailai][TEAM_TASK:Design user authentication system] Let's start [NEXT:max]"
→ Session.teamTask = "Design user authentication system"
→ Message content = "[FROM:kailai][TEAM_TASK:Design user authentication system] Let's start [NEXT:max]"

Max's prompt:
[SYSTEM]
You are Max, a Lead Business Analyst...

[TEAM_TASK]
Design user authentication system

[CONTEXT]
(empty - first message)

[MESSAGE]
Let's start

Max responds: "I'll create a PRD. [TEAM_TASK:Design OAuth2-based authentication]"
→ Session.teamTask updated to "Design OAuth2-based authentication"
→ Subsequent agents see updated team task
```

**Multiple `[TEAM_TASK]` in Single Message:**
```
Input: "[TEAM_TASK:Task A] some text [TEAM_TASK:Task B] more text"
Behavior: Parse all occurrences, use LAST value
Result: Session.teamTask = "Task B"
```

## Design Changes

### ConversationSession Model

**Before:**
```typescript
interface ConversationSession {
  id: string;
  teamId: string;
  teamName: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'paused' | 'completed';
  initialMessage: string;        // ← Remove
  firstSpeakerId: string;        // ← Remove
  messages: ConversationMessage[];
  stats: { ... };
}
```

**After:**
```typescript
interface ConversationSession {
  id: string;
  teamId: string;
  teamName: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'paused' | 'completed';
  teamTask: string | null;       // ← Add
  messages: ConversationMessage[];
  stats: { ... };
}
```

### MessageRouter Changes

**Add to ParseResult:**
```typescript
interface ParseResult {
  addressees: string[];
  isDone: boolean;
  cleanContent: string;
  fromMember?: string;           // ← Add: Parsed from [FROM:xxx]
  teamTask?: string;             // ← Add: Parsed from [TEAM_TASK:xxx]
}
```

**New Parsing Logic:**
```typescript
class MessageRouter {
  private readonly FROM_PATTERN = /\[FROM:\s*([^\]]+)\]/gi;
  private readonly TEAM_TASK_PATTERN = /\[TEAM_TASK:\s*([^\]]+)\]/gi;
  private readonly NEXT_PATTERN = /\[NEXT:\s*([^\]]+)\]/gi;
  private readonly DONE_PATTERN = /\[DONE\]/gi;

  parseMessage(message: string): ParseResult {
    // 1. Extract [FROM:xxx]
    this.FROM_PATTERN.lastIndex = 0;
    const fromMatch = this.FROM_PATTERN.exec(message);
    const fromMember = fromMatch?.[1]?.trim();

    // 2. Extract [TEAM_TASK:xxx] - last occurrence wins
    this.TEAM_TASK_PATTERN.lastIndex = 0;
    let teamTask: string | undefined;
    let match;
    while ((match = this.TEAM_TASK_PATTERN.exec(message)) !== null) {
      teamTask = match[1]?.trim();
    }

    // 3. Extract [NEXT:xxx] - all occurrences
    this.NEXT_PATTERN.lastIndex = 0;
    const addressees: string[] = [];
    while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
      const addrList = match[1]?.trim();
      if (addrList) {
        addressees.push(...addrList.split(',').map(s => s.trim()));
      }
    }

    // 4. Check [DONE]
    this.DONE_PATTERN.lastIndex = 0;
    const isDone = this.DONE_PATTERN.test(message);

    // 5. Strip ONLY [NEXT] and [DONE] markers
    // Keep [FROM] and [TEAM_TASK] for conversation history context
    const cleanContent = this.stripNextAndDoneMarkers(message);

    return { addressees, isDone, cleanContent, fromMember, teamTask };
  }

  /**
   * Remove ONLY [NEXT:xxx] and [DONE] markers
   * Preserve [FROM:xxx] and [TEAM_TASK:xxx] for history context
   * Preserve original line structure (don't compress multi-line content)
   */
  private stripNextAndDoneMarkers(message: string): string {
    let result = message;

    // Remove [NEXT:xxx] markers
    this.NEXT_PATTERN.lastIndex = 0;
    result = result.replace(this.NEXT_PATTERN, '');

    // Remove [DONE] markers
    this.DONE_PATTERN.lastIndex = 0;
    result = result.replace(this.DONE_PATTERN, '');

    // Clean up whitespace ONLY at marker positions
    // Preserve intentional newlines and formatting (code blocks, lists, etc.)
    result = result
      .split('\n')
      .map(line => {
        // Only collapse multiple spaces within a line, preserve line structure
        return line.replace(/\s{2,}/g, ' ').trim();
      })
      .filter(line => line.length > 0)  // Remove blank lines created by marker removal
      .join('\n')
      .trim();

    return result;
  }

  /**
   * Strip ALL markers including FROM and TEAM_TASK
   * Used when building context history to avoid duplication
   * (TEAM_TASK appears in dedicated section, shouldn't repeat in history)
   * Preserve original line structure for readability
   */
  stripAllMarkersForContext(message: string): string {
    let result = message;

    this.FROM_PATTERN.lastIndex = 0;
    this.TEAM_TASK_PATTERN.lastIndex = 0;
    this.NEXT_PATTERN.lastIndex = 0;
    this.DONE_PATTERN.lastIndex = 0;

    result = result.replace(this.FROM_PATTERN, '');
    result = result.replace(this.TEAM_TASK_PATTERN, '');
    result = result.replace(this.NEXT_PATTERN, '');
    result = result.replace(this.DONE_PATTERN, '');

    // Same whitespace cleanup: preserve line structure
    result = result
      .split('\n')
      .map(line => line.replace(/\s{2,}/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();

    return result;
  }
}
```

**Strip Examples:**
```typescript
// Input: "[FROM:kailai][TEAM_TASK:Design auth][NEXT:max] Let's start"
// After parseMessage:
//   cleanContent = "[FROM:kailai][TEAM_TASK:Design auth] Let's start"
// After stripAllMarkersForContext:
//   result = "Let's start"
```

### ConversationCoordinator Changes

**Remove:**
- `startConversation(team, initialMessage, firstSpeakerId)` method

**Add/Modify:**
```typescript
class ConversationCoordinator {
  private team: Team | null = null;
  private session: ConversationSession | null = null;
  private waitingForRoleId: string | null = null;
  private routingQueue: Array<{ member: Member; content: string }> = [];

  // New method: Set team without starting conversation
  setTeam(team: Team): void {
    this.team = team;
    this.session = null;
    this.waitingForRoleId = null;
    this.routingQueue = [];
  }

  hasActiveSession(): boolean {
    return this.session !== null;
  }

  // New unified message sending (replaces startConversation)
  async sendMessage(content: string, explicitSenderId?: string): Promise<void> {
    // AUTO-INITIALIZE SESSION ON FIRST MESSAGE
    if (!this.session) {
      if (!this.team) {
        throw new Error('No team loaded. Use /team deploy <config> first');
      }
      this.session = SessionUtils.createSession(this.team.id, this.team.name);

      if (process.env.DEBUG) {
        console.error(`[Debug][Session] Created new session ${this.session.id}`);
      }
    }

    // Parse message markers
    const parsed = this.messageRouter.parseMessage(content);

    // Resolve sender (throws on error for multi-human without [FROM])
    const sender = this.resolveSender(explicitSenderId, parsed.fromMember);

    // FIRST MESSAGE VALIDATION
    if (this.session.messages.length === 0) {
      if (sender.type !== 'human') {
        throw new Error('First message must be from a human member');
      }
      if (process.env.DEBUG) {
        console.error(`[Debug][Session] First speaker: ${sender.name} (${sender.id})`);
      }
    }

    // Update team task if marker present
    if (parsed.teamTask) {
      this.updateTeamTask(parsed.teamTask);
    }

    // Create and store message
    const message = this.createMessage(sender, parsed);
    this.session = SessionUtils.addMessageToSession(this.session, message);

    // Route to next member(s)
    await this.routeToNext(message);
  }

  private resolveSender(
    explicitSenderId?: string,
    fromMarker?: string
  ): Member {
    // Priority: explicitSenderId > [FROM:xxx] > waitingForRoleId > single-human > ERROR

    // PRIORITY 1: Explicit sender ID (programmatic calls)
    if (explicitSenderId) {
      const member = this.team!.members.find(m => m.id === explicitSenderId);
      if (!member) throw new Error(`Internal error: Member ID ${explicitSenderId} not found`);
      return member;
    }

    // PRIORITY 2: [FROM:xxx] marker (user-specified, allows buzzing in)
    if (fromMarker) {
      const member = this.resolveMemberFromIdentifier(fromMarker);

      if (!member) {
        const humans = this.team!.members.filter(m => m.type === 'human');
        throw new Error(
          `Error: Member '${fromMarker}' not found.\n` +
          `Available human members: ${humans.map(h => h.name).join(', ')}`
        );
      }

      if (member.type !== 'human') {
        throw new Error(
          `Error: Cannot use [FROM:${fromMarker}]. ${member.displayName} is an AI agent.\n` +
          `[FROM:xxx] is only for human members.`
        );
      }

      // Clear waitingForRoleId when buzzing in
      this.waitingForRoleId = null;

      if (process.env.DEBUG) {
        console.error(`[Debug][Sender] Resolved from [FROM:${fromMarker}] → ${member.name}`);
      }

      return member;
    }

    // PRIORITY 3: waitingForRoleId (system set from previous routing)
    if (this.waitingForRoleId) {
      const member = this.team!.members.find(m => m.id === this.waitingForRoleId);
      if (member && member.type === 'human') {
        if (process.env.DEBUG) {
          console.error(`[Debug][Sender] Using waitingForRoleId → ${member.name}`);
        }
        return member;
      }
    }

    // PRIORITY 4: Single human auto-select
    const humans = this.team!.members.filter(m => m.type === 'human');
    if (humans.length === 1) {
      if (process.env.DEBUG) {
        console.error(`[Debug][Sender] Auto-selected single human → ${humans[0].name}`);
      }
      return humans[0];
    }

    // PRIORITY 5: Multi-human without [FROM] → ERROR
    throw new Error(
      `Error: Multiple human members detected. Please specify sender with [FROM:xxx]\n` +
      `Available members: ${humans.map(h => h.name).join(', ')}\n\n` +
      `Example: [FROM:${humans[0].name}] Your message here`
    );
  }

  private updateTeamTask(newTask: string): void {
    const MAX_TEAM_TASK_BYTES = 5 * 1024; // 5KB limit (from PM decision)
    const taskBytes = Buffer.byteLength(newTask, 'utf-8');

    if (taskBytes > MAX_TEAM_TASK_BYTES) {
      // Truncate and warn
      this.session!.teamTask = this.truncateToBytes(newTask, MAX_TEAM_TASK_BYTES - 3) + '...';

      // User-visible warning (not just DEBUG)
      console.warn(
        `Warning: Team task truncated from ${taskBytes} bytes to ${MAX_TEAM_TASK_BYTES} bytes (5KB limit).`
      );

      if (process.env.DEBUG) {
        console.error(
          `[Debug][TEAM_TASK] Full task: ${newTask.substring(0, 200)}...`
        );
      }
    } else {
      this.session!.teamTask = newTask;
    }
  }

  private truncateToBytes(str: string, maxBytes: number): string {
    let bytes = 0;
    let truncated = '';

    for (const char of str) {
      const charBytes = Buffer.byteLength(char, 'utf-8');
      if (bytes + charBytes > maxBytes) break;
      truncated += char;
      bytes += charBytes;
    }

    return truncated;
  }

  private async routeToNext(message: ConversationMessage): Promise<void> {
    // REUSE PARSED ROUTING from message.routing
    // Avoid re-parsing: ConversationMessage already contains routing metadata
    const addressees = message.routing.resolvedAddressees || [];

    if (process.env.DEBUG) {
      console.error(`[Debug][Routing] From ${message.speaker.roleName} addressees=${JSON.stringify(addressees)}`);
    }

    // 1. PRE-SEED ROUTING QUEUE from already-resolved addressees
    if (addressees.length > 0) {
      for (const addressee of addressees) {
        // Find member by resolved name (resolveAddressees already did fuzzy match)
        const member = this.team!.members.find(m =>
          m.name === addressee || m.id === addressee || m.displayName === addressee
        );

        if (member) {
          // Use cleanContent from routing (markers already stripped)
          const cleanContent = this.stripMarkersFromContent(message.content);
          const delivery = this.prepareDelivery(member, cleanContent);
          this.routingQueue.push({ member, content: delivery.content });

          if (process.env.DEBUG) {
            console.error(`[Debug][Routing] Queued ${member.name}`);
          }
        }
      }
    }

    // 2. PROCESS ROUTING QUEUE (AI chains handled here)
    if (this.routingQueue.length > 0) {
      await this.processRoutingQueue();
      return;
    }

    // 3. NO QUEUE - fallback to first human
    const firstHuman = this.team!.members.find(m => m.type === 'human');
    if (firstHuman) {
      this.waitingForRoleId = firstHuman.id;

      if (process.env.DEBUG) {
        console.error(`[Debug][Routing] No queue, waiting for ${firstHuman.name}`);
      }
    }
  }

  private stripMarkersFromContent(content: string): string {
    // Reuse MessageRouter's strip logic
    return this.messageRouter.stripNextAndDoneMarkers(content);
  }

  private async processRoutingQueue(): Promise<void> {
    while (this.routingQueue.length > 0) {
      const { member, content } = this.routingQueue.shift()!;

      if (process.env.DEBUG) {
        console.error(`[Debug][Queue] Processing ${member.name} (${member.type})`);
      }

      if (member.type === 'ai') {
        await this.sendToAgent(member, content);
        // AI response may add more to queue, loop continues
      } else {
        // Human member - pause queue processing
        this.waitingForRoleId = member.id;

        if (process.env.DEBUG) {
          console.error(`[Debug][Queue] Paused for human ${member.name}`);
        }

        return; // Exit, wait for human input via next sendMessage() call
      }
    }

    // Queue empty after all AI processing
    this.waitingForRoleId = null;
  }

  private async sendToAgent(member: Member, content: string): Promise<void> {
    // Build prompt with TEAM_TASK section
    const prompt = this.promptBuilder.buildPrompt({
      systemInstruction: member.systemPrompt || '',
      teamTask: this.session!.teamTask,
      contextMessages: this.session!.messages,
      message: content,
      maxBytes: 100_000
    });

    // Send to agent
    const response = await this.agentManager.sendAndReceive(
      member.agentConfigId!,
      prompt.prompt
    );

    // Parse AI response for [NEXT] markers
    const responseParsed = this.messageRouter.parseMessage(response);

    // Create message for AI response
    const aiMessage = this.createMessage(member, responseParsed);
    this.session = SessionUtils.addMessageToSession(this.session!, aiMessage);

    // ENQUEUE NEW ADDRESSEES from AI response (AI摘要路由 preserved)
    if (responseParsed.addressees.length > 0) {
      const resolved = this.resolveAddressees(responseParsed.addressees);

      for (const nextMember of resolved) {
        const delivery = this.prepareDelivery(nextMember, responseParsed.cleanContent);
        this.routingQueue.push({ member: nextMember, content: delivery.content });

        if (process.env.DEBUG) {
          console.error(`[Debug][AI Response] Queued ${nextMember.name} from ${member.name}'s output`);
        }
      }
    }
    // NOTE: processRoutingQueue() loop continues and processes new items
  }
}
```

### PromptBuilder Changes

**Add TEAM_TASK section with proper token budget:**
```typescript
interface PromptInput {
  systemInstruction: string;
  teamTask: string | null;  // ← NEW: From session.teamTask
  contextMessages: ConversationMessage[];
  message: string;
  maxBytes: number;
}

interface PromptOutput {
  prompt: string;
  trimmedContext: {
    totalMessages: number;
    includedMessages: number;
    bytesUsed: number;
    bytesAvailable: number;
  };
}

function buildPrompt(input: PromptInput): PromptOutput {
  let totalBytes = 0;

  // 1. [SYSTEM] section
  const systemSection = buildSection('[SYSTEM]', input.systemInstruction);
  const systemBytes = Buffer.byteLength(systemSection, 'utf-8');
  totalBytes += systemBytes;

  // 2. [TEAM_TASK] section (if present)
  let teamTaskSection = '';
  let teamTaskBytes = 0;
  if (input.teamTask) {
    teamTaskSection = buildSection('[TEAM_TASK]', input.teamTask);
    // teamTaskBytes includes header "[TEAM_TASK]\n" + content
    teamTaskBytes = Buffer.byteLength(teamTaskSection, 'utf-8');
    totalBytes += teamTaskBytes;
  }

  // 3. [MESSAGE] section (current message)
  const messageSection = buildSection('[MESSAGE]', input.message);
  const messageBytes = Buffer.byteLength(messageSection, 'utf-8');
  totalBytes += messageBytes;

  // 4. [CONTEXT] section - fill remaining budget
  const availableForContext = input.maxBytes - totalBytes;

  const { contextSection, stats } = buildContextSection(
    input.contextMessages,
    availableForContext
  );

  // Final assembly: DIRECT ORDER (no reordering, no magic indexes)
  // Order: SYSTEM → TEAM_TASK → CONTEXT → MESSAGE
  const sections = [
    systemSection,
    ...(input.teamTask ? [teamTaskSection] : []),  // Conditionally include
    contextSection,
    messageSection
  ];

  return {
    prompt: sections.join('\n\n'),
    trimmedContext: {
      totalMessages: input.contextMessages.length,
      includedMessages: stats.included,
      bytesUsed: stats.bytesUsed,
      bytesAvailable: availableForContext
    }
  };
}

function buildSection(header: string, content: string): string {
  return `${header}\n${content}`;
}

interface ContextStats {
  included: number;
  bytesUsed: number;
}

function buildContextSection(
  messages: ConversationMessage[],
  maxBytes: number
): { contextSection: string; stats: ContextStats } {

  if (messages.length === 0) {
    return {
      contextSection: '[CONTEXT]\n(No prior messages)',
      stats: { included: 0, bytesUsed: 0 }
    };
  }

  const messageRouter = new MessageRouter();
  const formattedMessages: string[] = [];
  let totalBytes = 0;
  const headerBytes = Buffer.byteLength('[CONTEXT]\n', 'utf-8');
  let availableBytes = maxBytes - headerBytes;

  // Reverse iteration: Include most recent messages first
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    // Strip ALL markers for context to avoid duplication
    // TEAM_TASK appears in dedicated section, shouldn't repeat in history
    const cleanContent = messageRouter.stripAllMarkersForContext(msg.content);

    const formatted = `${msg.speaker.roleName}: ${cleanContent}`;
    const msgBytes = Buffer.byteLength(formatted + '\n', 'utf-8');

    if (totalBytes + msgBytes > availableBytes) {
      // Would exceed budget, stop here
      break;
    }

    formattedMessages.unshift(formatted);  // Preserve chronological order
    totalBytes += msgBytes;
  }

  const contextBody = formattedMessages.join('\n');
  const contextSection = `[CONTEXT]\n${contextBody}`;

  return {
    contextSection,
    stats: {
      included: formattedMessages.length,
      bytesUsed: totalBytes + headerBytes
    }
  };
}
```

**Token Budget Example:**
```typescript
// Scenario: Agent with 100KB budget
const input: PromptInput = {
  systemInstruction: "You are Max...",  // 2,000 bytes
  teamTask: "Design OAuth2 auth",       // 500 bytes
  message: "What are requirements?",    // 150 bytes
  contextMessages: [...],               // 50 previous messages
  maxBytes: 100_000
};

// Budget calculation:
// SYSTEM:  2,000 bytes (includes "[SYSTEM]\n" header)
// TEAM_TASK:  500 bytes (includes "[TEAM_TASK]\n" header)
// MESSAGE:  150 bytes (includes "[MESSAGE]\n" header)
// Section separators: 3 × 2 bytes ("\n\n") = 6 bytes
// Total overhead: 2,656 bytes
// Available for CONTEXT: 100,000 - 2,656 = 97,344 bytes

// buildContextSection() will:
// 1. Iterate messages from newest to oldest
// 2. Strip ALL markers via stripAllMarkersForContext()
//    (TEAM_TASK from history to avoid duplication)
// 3. Include as many as fit within 97,344 bytes
// 4. Stop when budget exceeded
//
// Result: 43 out of 50 messages included (7 oldest trimmed)
```

**IMPORTANT: TEAM_TASK Deduplication Strategy**

`buildContextSection()` **ALWAYS** uses `stripAllMarkersForContext()` to remove TEAM_TASK markers from historical messages. This ensures TEAM_TASK appears only once in the dedicated `[TEAM_TASK]` section, not repeated in `[CONTEXT]`.

```typescript
// Example: Message with TEAM_TASK marker
session.messages[0].content = "[FROM:kailai][TEAM_TASK:Design auth] Let's start";

// When building context for next agent:
// Original message.content preserved in session (for audit)
// But stripAllMarkersForContext() removes it for prompt:
const cleanContent = messageRouter.stripAllMarkersForContext(message.content);
// cleanContent = "Let's start"

// Final prompt structure:
// [SYSTEM]
// You are Max...
//
// [TEAM_TASK]        ← From session.teamTask (appears ONCE)
// Design auth
//
// [CONTEXT]
// kailai: Let's start   ← TEAM_TASK removed (no duplication)
//
// [MESSAGE]
// (current message to Max)
```

### REPL Changes

**Remove `/start` command and update conversation input handling:**

```typescript
// ReplModeInk.tsx

// REMOVE this command handler:
case '/start':
  // ... (delete entire block)

// UPDATE conversation mode input handling:
function handleConversationInput(input: string) {
  // Conversation mode - directly send message
  // Session auto-initializes on first call
  await coordinator.sendMessage(input);
}

// UPDATE /team deploy handler:
case '/team':
  if (args[0] === 'deploy') {
    const configPath = args[1];
    const team = await loadTeamConfig(configPath);

    // Set team (don't start session yet)
    coordinator.setTeam(team);

    setMode('conversation');
    setOutput(prev => [...prev,
      <Text color="green">✓ Team "{team.name}" loaded</Text>,
      <Text dimColor>Type your first message to begin conversation...</Text>
    ]);
  }
  break;

// UPDATE /help command output:
case '/help':
  setOutput([
    <Text key="help-1">Available commands:</Text>,
    <Text key="help-2">  /team deploy &lt;config.json&gt; - Load team and enter conversation mode</Text>,
    <Text key="help-3" dimColor>    (Type messages directly after loading team)</Text>,
    <Text key="help-4">  /team list - List loaded team members</Text>,
    <Text key="help-5">  /exit - Exit conversation mode</Text>,
    <Text key="help-6">  /help - Show this help</Text>,
    <Text key="help-7"></Text>,
    <Text key="help-8">Message markers:</Text>,
    <Text key="help-9">  [FROM:name] - Specify human sender (multi-human teams)</Text>,
    <Text key="help-10">  [NEXT:name] - Route message to specific member</Text>,
    <Text key="help-11">  [TEAM_TASK:description] - Set team-wide task context</Text>,
    <Text key="help-12">  [DONE] - Mark conversation complete</Text>,
  ]);
  break;
```

**Example User Flows:**

**Single human team:**
```
agent-chatter> /team deploy myteam.json
✓ Team "Development Team" loaded
Type your first message to begin conversation...

agent-chatter> Design a login page [NEXT:max]
→ Max (AI): I'll create a design mockup...

agent-chatter> Looks good, add dark mode [NEXT:max]
→ Max (AI): Adding dark mode support...
```

**Multi-human team (no [FROM] → error):**
```
agent-chatter> /team deploy multi-human-team.json
✓ Team "Multi-Human Team" loaded
Type your first message to begin conversation...

agent-chatter> Design a login page
Error: Multiple human members detected. Please specify sender with [FROM:xxx]
Available members: kailai, bob

Example: [FROM:kailai] Your message here

agent-chatter> [FROM:kailai] Design a login page [NEXT:max]
→ kailai: Design a login page
→ Max (AI): I'll create a design mockup...

agent-chatter> [FROM:bob] Let's add OAuth support [NEXT:max]
→ bob: Let's add OAuth support (buzzing in)
→ Max (AI): Adding OAuth2 support...
```

**Team task workflow:**
```
agent-chatter> [FROM:kailai][TEAM_TASK:Redesign authentication UI] Start with login page [NEXT:max]
✓ Team task set: "Redesign authentication UI"
→ Max (AI): For the authentication UI redesign, I'll start with...

agent-chatter> Next do signup [NEXT:max]
→ Max (AI): [Sees team task in prompt] Continuing the authentication UI redesign...
```

**Migration Impact:**
- **BREAKING:** `/start` command removed entirely
- Users must type messages directly after `/team deploy`
- Multi-human teams now require `[FROM:xxx]` on first message
- Help text updated to reflect new workflow

## Migration Guide

### For Existing Code

#### 1. ConversationCoordinator API Changes

**Replace `startConversation()` calls:**
```typescript
// BEFORE (v0.1.x)
await coordinator.startConversation(team, initialMessage, firstSpeakerId);

// AFTER (v0.2.0+)
coordinator.setTeam(team);
await coordinator.sendMessage(initialMessage);
```

**Affected files:**
- `src/services/ConversationStarter.ts`
- `src/repl/ReplModeInk.tsx`
- `tests/unit/conversationCoordinator.test.ts` (~52 tests)
- `tests/integration/conversationStarter.test.ts` (~15 tests)

#### 2. SessionUtils.createSession() Signature Change

**Update test fixtures:**
```typescript
// BEFORE (4 parameters)
const session = SessionUtils.createSession(
  teamId, teamName, initialMessage, firstSpeakerId
);

// AFTER (2 parameters)
const session = SessionUtils.createSession(teamId, teamName);
session.teamTask = null;  // Initialize new field

// If test needs first message in history:
const firstMsg = MessageUtils.createMessage(
  'human-1', 'kailai', 'Kailai', 'human',
  'Build a feature',
  { rawNextMarkers: ['max'], resolvedAddressees: [], isDone: false }
);
session.messages.push(firstMsg);
```

**Affected files:**
- `src/utils/SessionUtils.ts` (implementation)
- `tests/unit/sessionUtils.test.ts` (~12 tests)
- All test files using session fixtures (~110 tests)

#### 3. Test Migration Inventory

**Unit Tests (110 total):**
| File | Tests | Changes | Hours |
|------|-------|---------|-------|
| `conversationCoordinator.test.ts` | 52 | Replace startConversation, update fixtures | 4h |
| `messageRouter.test.ts` | 28 | Add [FROM]/[TEAM_TASK] parsing tests | 2h |
| `promptBuilder.test.ts` | 18 | Add token budget tests | 2h |
| `sessionUtils.test.ts` | 12 | Update createSession signature | 1h |

**Integration Tests (45 total):**
| File | Tests | Changes | Hours |
|------|-------|---------|-------|
| `conversationStarter.test.ts` | 15 | Update API calls | 2h |
| `cli/start.test.ts` | 12 | Remove /start, add direct input tests | 3h |
| `repl/conversation.test.ts` | 18 | Update conversation flows | 2h |

**New Tests (+46 total):**
| Category | Tests | Hours |
|----------|-------|-------|
| [FROM] validation & resolution | 15 | 3h |
| [TEAM_TASK] persistence | 12 | 2h |
| Single-human auto-sender | 5 | 1h |
| Multi-human [FROM] requirement | 8 | 2h |
| Buzzing in scenarios | 6 | 1.5h |

**Total: 155 existing + 46 new = 201 tests**
**Estimated effort: 25.5 hours**

#### 4. Automated Migration Script

```bash
#!/bin/bash
# scripts/migrate-tests.sh

echo "=== Test Migration Tool ==="
files=$(grep -rl "startConversation\|SessionUtils.createSession" tests/)

for file in $files; do
  echo "Processing: $file"
  cp "$file" "$file.backup"

  # Pattern 1: startConversation → setTeam + sendMessage
  sed -i.tmp -E 's/await coordinator\.startConversation\(([^,]+), "([^"]+)", "[^"]+"\);/coordinator.setTeam(\1);\n    await coordinator.sendMessage("\2");/g' "$file"

  # Pattern 2: SessionUtils.createSession(4 params) → (2 params)
  sed -i.tmp -E 's/SessionUtils\.createSession\(([^,]+), ([^,]+), [^,]+, [^)]+\)/SessionUtils.createSession(\1, \2)/g' "$file"

  rm "$file.tmp"
  echo "  ✓ Migrated: $file"
done

echo "Migration complete! Review changes: git diff tests/"
```

#### 5. Manual Review Checklist

After running automated script:

**Per-file tasks:**
- [ ] Verify `SessionUtils.createSession()` updated to 2-param version
- [ ] Add `session.teamTask = null` initialization
- [ ] Replace `session.initialMessage` assertions → `session.messages[0].content`
- [ ] Replace `session.firstSpeakerId` assertions → `session.messages[0].speaker.roleId`

**Test logic updates:**
- [ ] Tests expecting AI first speaker → Update to expect error throw
- [ ] Multi-human team tests → Add `[FROM:xxx]` to first message
- [ ] Integration tests using `/start` → Update to direct message input

**New test coverage:**
- [ ] Add `[FROM]` parsing tests (MessageRouter)
- [ ] Add sender resolution tests (ConversationCoordinator)
- [ ] Add `[TEAM_TASK]` section tests (PromptBuilder)
- [ ] Add E2E flows for single/multi-human scenarios

### For Users

**Breaking Change:**
- `/start` command removed
- First message entered directly in conversation mode
- Multi-human teams must use `[FROM:xxx]` on first message

**Migration:**
```
# Old workflow
/start Design authentication [NEXT:max]

# New workflow (single human)
Design authentication [NEXT:max]

# New workflow (multi-human)
[FROM:kailai] Design authentication [NEXT:max]
```

## Testing Strategy

### Unit Tests

1. **MessageRouter:**
   - Parse `[FROM:xxx]` with various formats
   - Parse `[TEAM_TASK:xxx]`
   - Handle multiple `[TEAM_TASK]` markers (use last)
   - Preserve markers in cleanContent

2. **ConversationCoordinator:**
   - First message must be human
   - Auto-select sender in single-human team
   - Require `[FROM:xxx]` in multi-human team
   - Update `session.teamTask` when marker detected
   - Handle "buzzing in" with `[FROM:xxx]`

3. **PromptBuilder:**
   - Include `[TEAM_TASK]` section when present
   - Omit section when null
   - Correct byte counting with TEAM_TASK section

### Integration Tests

1. **Single Human Team Flow:**
   - Start conversation without `[FROM]`
   - Verify auto-sender resolution
   - Verify routing works

2. **Multi-Human Team Flow:**
   - Attempt start without `[FROM]` → Error
   - Start with `[FROM:xxx]` → Success
   - "Buzz in" with different `[FROM:xxx]` → Override

3. **Team Task Persistence:**
   - Set `[TEAM_TASK:xxx]` in first message
   - Verify appears in subsequent agent prompts
   - Update team task mid-conversation
   - Verify new value used in subsequent prompts

## Open Questions

None. Requirements clarified with PM.

## Implementation Phases

### Phase 1: Core Refactor (High Priority)
- Remove `initialMessage` and `firstSpeakerId` from model
- Add `teamTask` field to session
- Implement `sendMessage()` unified method
- Remove `/start` command

### Phase 2: Markers (High Priority)
- Implement `[FROM:xxx]` parsing and resolution
- Implement `[TEAM_TASK:xxx]` parsing and persistence
- Update PromptBuilder to include TEAM_TASK section

### Phase 3: Polish (Medium Priority)
- Comprehensive error messages
- Migration guide documentation
- Test coverage

## Success Criteria

- [ ] No special first message handling in code
- [ ] `[FROM:xxx]` works for all human messages
- [ ] Multi-human teams enforce `[FROM:xxx]` on first message
- [ ] Single-human teams auto-add `[FROM:xxx]`
- [ ] `[TEAM_TASK:xxx]` persists across conversation
- [ ] All agents see team task in prompts
- [ ] Existing tests updated and passing
- [ ] New integration tests cover all flows

---

## Architecture Committee Review - Round 1 Responses

### HIGH PRIORITY ISSUES

#### 1. Routing Queue & New Entry Point Alignment

**Issue:** Current `startConversation()` pre-seeds routing queue from initial message's `[NEXT]` markers. Switching to `sendMessage()` requires clarification on queue initialization.

**Resolution:**

**Queue Initialization Flow:**
```typescript
async sendMessage(content: string, senderId?: string): Promise<void> {
  // 1. Parse message for all markers
  const parsed = this.messageRouter.parseMessage(content);
  
  // 2. Determine sender (with [FROM] support)
  const sender = this.resolveSender(senderId, parsed.fromMember);
  
  // 3. Create message entry
  const message = this.createMessage(sender, parsed);
  this.session.messages.push(message);
  
  // 4. Route: Pre-seed queue from [NEXT] markers, then process
  if (parsed.addressees.length > 0) {
    const resolved = this.resolveAddressees(parsed.addressees);
    for (const member of resolved) {
      this.routingQueue.push({ member, content: parsed.cleanContent });
    }
  }
  
  // 5. Process routing queue (AI→AI chains handled here)
  await this.processRoutingQueue();
}
```

**AI→AI Summary Routing:** Preserved. When AI completes:
1. ContextCollector captures summary
2. Parse summary for `[NEXT]` markers
3. Create ConversationMessage from summary
4. Enqueue addressees
5. Call `processRoutingQueue()`

**State Transition Diagram:**
```
[User Input] 
    ↓
[Parse: FROM, TEAM_TASK, NEXT, DONE]
    ↓
[Resolve Sender (Human)]
    ↓
[Create Message → Session]
    ↓
[Enqueue NEXT Addressees]
    ↓
[Process Queue: AI or Human?]
    ├─ AI → sendToAgent() → Wait for completion → Parse AI output → Enqueue → Loop
    └─ Human → Set waitingForRoleId → Pause → Wait for next sendMessage()
```

#### 2. MessageRouter Strip Rules

**Issue:** Documentation unclear on which markers are stripped from `cleanContent`.

**Resolution:**

**New Strip Behavior:**
- **Strip:** `[NEXT:xxx]`, `[DONE]`
- **Preserve:** `[FROM:xxx]`, `[TEAM_TASK:xxx]`

**Rationale:**
- `[NEXT]`/`[DONE]` are routing control flow, not message content
- `[FROM]` and `[TEAM_TASK]` provide conversational context and should remain in history

**Updated MessageRouter:**
```typescript
class MessageRouter {
  private readonly FROM_PATTERN = /\[FROM:\s*([^\]]*)\]/gi;
  private readonly TEAM_TASK_PATTERN = /\[TEAM_TASK:\s*([^\]]*)\]/gi;
  private readonly NEXT_PATTERN = /\[NEXT:\s*([^\]]*)\]/gi;
  private readonly DONE_PATTERN = /\[DONE\]/gi;

  parseMessage(message: string): ParseResult {
    // Extract metadata
    const fromMatch = this.FROM_PATTERN.exec(message);
    const fromMember = fromMatch?.[1]?.trim();
    
    let teamTask: string | undefined;
    let match;
    while ((match = this.TEAM_TASK_PATTERN.exec(message)) !== null) {
      teamTask = match[1]?.trim(); // Last occurrence wins
    }
    
    const addressees: string[] = [];
    while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
      const list = match[1]?.trim();
      if (list) addressees.push(...list.split(',').map(s => s.trim()));
    }
    
    const isDone = this.DONE_PATTERN.test(message);
    
    // Clean content: Remove ONLY [NEXT] and [DONE]
    let cleanContent = message;
    cleanContent = cleanContent.replace(this.NEXT_PATTERN, '');
    cleanContent = cleanContent.replace(this.DONE_PATTERN, '');
    cleanContent = cleanContent.trim();
    
    return { addressees, isDone, cleanContent, fromMember, teamTask };
  }
}
```

**Example:**
```
Input: "[FROM:kailai][TEAM_TASK:Design auth][NEXT:max] Let's start"

ParseResult:
  fromMember: "kailai"
  teamTask: "Design auth"
  addressees: ["max"]
  isDone: false
  cleanContent: "[FROM:kailai][TEAM_TASK:Design auth] Let's start"
```

#### 3. Session/Prompt Changes - Compatibility & Migration

**Issue:** Removing `initialMessage`/`firstSpeakerId` and adding `teamTask` affects existing code. Need migration plan.

**Resolution:**

**Schema Migration:**

```typescript
// OLD Schema
interface ConversationSession {
  id: string;
  initialMessage: string;      // ← Remove
  firstSpeakerId: string;       // ← Remove
  messages: ConversationMessage[];
  // ...
}

// NEW Schema
interface ConversationSession {
  id: string;
  teamTask: string | null;      // ← Add
  messages: ConversationMessage[];
  // ...
}
```

**Migration Function:**
```typescript
function migrateSession(oldSession: any): ConversationSession {
  const newSession: ConversationSession = {
    ...oldSession,
    teamTask: null  // Initialize as null
  };
  
  // Remove deprecated fields
  delete newSession.initialMessage;
  delete newSession.firstSpeakerId;
  
  return newSession;
}
```

**Affected Components & Changes:**

| Component | Current Dependency | Migration Action |
|-----------|-------------------|------------------|
| `ConversationCoordinator.ts` | `startConversation(team, initialMsg, firstId)` | Replace with `setTeam(team)` + `sendMessage(content)` |
| `ConversationStarter.ts` | Calls `startConversation()` | Update to `sendMessage()` |
| `ReplModeInk.tsx` | `/start` command handler | Remove command, use direct input |
| `PromptBuilder.ts` | No direct dependency | Add `teamTask` parameter to `PromptInput` |
| `ContextCollector.ts` | No direct dependency | No changes |
| Test fixtures | `SessionUtils.createSession(teamId, teamName, initialMsg, firstId)` | Update signature to `createSession(teamId, teamName)` |

**Test Migration Checklist:**

- [ ] Update `SessionUtils.createSession()` signature (remove 2 params)
- [ ] Rewrite ~50 unit test fixtures using old signature
- [ ] Update ~30 integration tests that use `/start` command
- [ ] Add new tests for `[FROM:xxx]` validation
- [ ] Add new tests for `[TEAM_TASK:xxx]` persistence
- [ ] Add E2E test for single-human auto-sender
- [ ] Add E2E test for multi-human mandatory `[FROM]`
- [ ] Add E2E test for team task updates mid-conversation

**Backward Compatibility Strategy:**

**Option 1 (Recommended): Deprecation Period**
```typescript
// Keep /start as alias for 2 versions
if (command === '/start') {
  console.warn('WARNING: /start is deprecated. Just type your message directly.');
  await coordinator.setTeam(team);
  await coordinator.sendMessage(args.join(' '));
}
```

**Option 2: Hard Break**
- Remove `/start` immediately
- Update all documentation
- Release as breaking change (bump minor version)

**Chosen:** Option 1 for 2 releases, then Option 2.

#### 4. Prompt Assembly & Token Budget

**Issue:** `[TEAM_TASK:xxx]` preserved in message content AND added as separate prompt section → double inclusion, token waste.

**Resolution:**

**Decision: Strip TEAM_TASK from Context History**

**Revised Approach:**
1. `[TEAM_TASK:xxx]` stored in `session.teamTask`
2. Appears in `[TEAM_TASK]` prompt section
3. **Stripped from message content when building context history**
4. Original message in `session.messages[]` preserves markers (for audit/replay)

**Updated cleanContent Strategy:**
```typescript
// In MessageRouter
parseMessage(message: string): ParseResult {
  // ... (extract metadata as before)
  
  // Clean content: Remove [NEXT], [DONE], and [TEAM_TASK]
  // Keep [FROM] for human identification in history
  let cleanContent = message;
  cleanContent = cleanContent.replace(this.NEXT_PATTERN, '');
  cleanContent = cleanContent.replace(this.DONE_PATTERN, '');
  cleanContent = cleanContent.replace(this.TEAM_TASK_PATTERN, '');  // ← NEW
  cleanContent = cleanContent.trim();
  
  return { ..., cleanContent };
}
```

**Prompt Construction:**
```typescript
function buildPrompt(input: PromptInput): PromptOutput {
  const sections = [];
  let totalBytes = 0;
  
  // 1. [SYSTEM]
  const systemSection = buildSection('[SYSTEM]', input.systemInstruction);
  totalBytes += Buffer.byteLength(systemSection, 'utf-8');
  sections.push(systemSection);
  
  // 2. [TEAM_TASK] - from session, not from message
  if (input.teamTask) {
    const teamTaskSection = buildSection('[TEAM_TASK]', input.teamTask);
    totalBytes += Buffer.byteLength(teamTaskSection, 'utf-8');
    sections.push(teamTaskSection);
  }
  
  // 3. [MESSAGE]
  const messageSection = buildSection('[MESSAGE]', input.message);
  const messageBytes = Buffer.byteLength(messageSection, 'utf-8');
  totalBytes += messageBytes;
  sections.push(messageSection);
  
  // 4. [CONTEXT] - fill remaining budget
  const remainingBytes = input.maxBytes - totalBytes;
  const { contextSection, trimmed } = trimContext(
    input.contextMessages, 
    remainingBytes
  );
  sections.push(contextSection);
  
  // Order: SYSTEM, TEAM_TASK, CONTEXT, MESSAGE
  return {
    prompt: sections.join('\n\n'),
    trimmedContext: trimmed
  };
}
```

**Token Budget Example:**
```
Input:
  maxBytes: 100,000
  systemInstruction: 2,000 bytes
  teamTask: 500 bytes
  message: 1,000 bytes
  contextMessages: [many messages]

Calculation:
  SYSTEM section: 2,000 bytes
  TEAM_TASK section: 500 bytes
  MESSAGE section: 1,000 bytes
  Available for CONTEXT: 100,000 - 3,500 = 96,500 bytes
  
→ trimContext() fills up to 96,500 bytes with recent messages
```

**Impact:**
- **Before:** TEAM_TASK appears in every context message AND prompt section → N×task_size waste
- **After:** TEAM_TASK appears once in prompt section, stripped from context → Optimal

### MEDIUM PRIORITY ISSUES

#### 5. Error Messages & User Feedback

**Issue:** Need comprehensive error message catalog aligned with REPL/CLI output style.

**Resolution:**

**Error Message Catalog:**

| Scenario | Error Message | Exit Code / Action |
|----------|--------------|-------------------|
| Multi-human, no `[FROM]` on first msg | `❌ Error: Multiple human members in team. Please specify sender with [FROM:xxx]\n   Available members: kailai, bob, alice` | Throw, show prompt again |
| Invalid `[FROM:xxx]` name | `❌ Error: Member 'xyz' not found.\n   Available human members: kailai, bob` | Throw, show prompt again |
| `[FROM:xxx]` points to AI | `❌ Error: Cannot use [FROM:max]. Max is an AI agent.\n   Use [FROM:xxx] only for human members: kailai, bob` | Throw, show prompt again |
| AI attempts first message (internal) | `❌ System Error: First message must be from human member` | Throw (should never reach user) |
| Multiple `[TEAM_TASK]` in message | *(No error, use last value)* | Log warning in DEBUG mode |
| Session missing on `sendMessage()` | `❌ Error: No team loaded. Use /team deploy <config> first` | Throw, return to normal mode |

**CLI Output Style (Existing Pattern):**
```typescript
// Use colorize utility from utils/colors.ts
import { colorize as c } from '../utils/colors.js';

// Error formatting
output.error(c('❌ Error: ', 'red') + c(message, 'yellow'));
output.info(c('   Hint: ', 'dim') + hint);

// Success formatting
output.success(c('✓ ', 'green') + message);

// Warning formatting
output.warn(c('⚠ Warning: ', 'yellow') + message);
```

**Example Integration:**
```typescript
private resolveSender(senderId?: string, fromMarker?: string): Member {
  if (fromMarker) {
    const member = this.resolveMemberFromIdentifier(fromMarker);
    
    if (!member) {
      const humans = this.team.members.filter(m => m.type === 'human');
      throw new Error(
        `Member '${fromMarker}' not found.\n` +
        `   Available human members: ${humans.map(h => h.name).join(', ')}`
      );
    }
    
    if (member.type !== 'human') {
      const humans = this.team.members.filter(m => m.type === 'human');
      throw new Error(
        `Cannot use [FROM:${fromMarker}]. ${member.displayName} is an AI agent.\n` +
        `   Use [FROM:xxx] only for human members: ${humans.map(h => h.name).join(', ')}`
      );
    }
    
    return member;
  }
  
  // ... rest of resolution logic
}
```

#### 6. Test Migration - Detailed Plan

**Issue:** 400+ existing tests depend on `startConversation()` and `SessionUtils.createSession()` signatures.

**Resolution:**

**Test File Impact Analysis:**

| Test File | # Tests | Required Changes |
|-----------|---------|------------------|
| `tests/unit/conversationCoordinator.test.ts` | ~50 | Replace `startConversation` calls with `sendMessage` |
| `tests/unit/messageRouter.test.ts` | ~30 | Add tests for `[FROM]` and `[TEAM_TASK]` parsing |
| `tests/unit/promptBuilder.test.ts` | ~20 | Add tests for `[TEAM_TASK]` section, token budget |
| `tests/integration/conversationStarter.test.ts` | ~15 | Update `startConversation` to `sendMessage` |
| `tests/integration/cli/*.test.ts` | ~40 | Remove `/start` command tests, add direct input tests |
| **Total** | **~155** | **High-touch migration** |

**Fixture Update Pattern:**

**Before:**
```typescript
// Old fixture
const session = SessionUtils.createSession(
  'team-1', 
  'Test Team', 
  'Build a feature',  // ← initialMessage
  'human-1'            // ← firstSpeakerId
);
```

**After:**
```typescript
// New fixture
const session = SessionUtils.createSession('team-1', 'Test Team');
session.teamTask = null;  // Explicitly set

// Add first message manually if needed for test
const firstMsg = MessageUtils.createMessage(
  'human-1', 'kailai', 'Kailai', 'human',
  'Build a feature',
  { rawNextMarkers: ['max'], resolvedAddressees: [], isDone: false }
);
session.messages.push(firstMsg);
```

**Migration Script (Recommended):**
```bash
# Create regex-based migration script
./scripts/migrate-tests.sh

# Script content:
# 1. Find all SessionUtils.createSession() calls with 4 params
# 2. Extract params 3 & 4 (initialMessage, firstSpeakerId)
# 3. Replace with 2-param call
# 4. Generate message creation code if initialMessage is used in test assertions
# 5. Output diff for manual review
```

**Test Execution Strategy:**

To avoid OOM issues during migration:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true  // Force serial execution during migration
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // Split large test suites
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/small/**/*.test.ts'  // ← New: Split integration tests
    ]
  }
});
```

**Phased Test Migration:**

**Phase 1: Unit Tests (Low Risk)**
- Migrate `messageRouter.test.ts` first (add new marker tests)
- Update `sessionUtils.test.ts` (change signature)
- Update `promptBuilder.test.ts` (add TEAM_TASK section)
- **Run:** `npm run test:unit` after each file

**Phase 2: Integration Tests (Medium Risk)**
- Migrate `conversationStarter.test.ts` (replace startConversation)
- Update CLI tests (remove /start, add direct input)
- **Run:** `npm run test:integration` after each file

**Phase 3: E2E Tests (Add New)**
- Add `[FROM]` validation flows
- Add `[TEAM_TASK]` persistence flows
- Add single/multi-human scenarios
- **Run:** Full suite `npm test`

#### 7. Compatibility Layer - Deprecation Strategy

**Issue:** Hard break will disrupt existing users and CI pipelines.

**Resolution:**

**Deprecation Timeline:**

| Version | Changes | Status |
|---------|---------|--------|
| v0.2.0 | Add deprecation warning for `/start`, introduce `sendMessage()` | **Next Release** |
| v0.3.0 | Remove `/start` command entirely | **Release + 2 months** |

**Implementation:**

**v0.2.0: Dual Support with Warning**
```typescript
// In ReplModeInk.tsx
case '/start':
  // Show deprecation warning
  setOutput(prev => [...prev, 
    <Text key={`deprecation-${getNextKey()}`} color="yellow">
      ⚠ WARNING: /start command is deprecated and will be removed in v0.3.0
    </Text>,
    <Text key={`hint-${getNextKey()}`} dimColor>
      → Just type your message directly (no /start needed)
    </Text>
  ]);
  
  // Still execute for compatibility
  if (args.length === 0) {
    setOutput(prev => [...prev, <Text color="yellow">Usage: Type your message directly</Text>]);
  } else {
    const message = args.join(' ');
    await handleConversationInput(message);  // ← Calls sendMessage() internally
  }
  break;
```

**v0.3.0: Hard Removal**
```typescript
case '/start':
  setOutput(prev => [...prev,
    <Text key={`removed-${getNextKey()}`} color="red">
      ❌ /start command has been removed in v0.3.0
    </Text>,
    <Text dimColor>
      → Just type your message directly to start a conversation
    </Text>
  ]);
  break;
```

**Documentation Updates:**

```markdown
# CHANGELOG.md

## [0.2.0] - 2025-12-XX
### Deprecated
- `/start` command is deprecated. Use direct message input instead.
- `ConversationSession.initialMessage` and `firstSpeakerId` fields (internal API)

### Added
- `[FROM:xxx]` marker for explicit human sender specification
- `[TEAM_TASK:xxx]` marker for persistent team-wide task context
- `ConversationCoordinator.sendMessage()` unified message API

### Migration Guide
**Before:**
```
/start Build authentication system [NEXT:max]
```

**After (v0.2.0+):**
```
Build authentication system [NEXT:max]
```
(Multi-human teams: Add `[FROM:kailai]` before message)

## [0.3.0] - 2026-02-XX (Planned)
### Removed (BREAKING)
- `/start` command removed entirely
- `startConversation()` method removed from `ConversationCoordinator`
```

---

## Updated Implementation Plan

### Phase 1: Foundation (Week 1)
**Goals:** Model changes, MessageRouter updates, basic validation

**Tasks:**
- [ ] Update `ConversationSession` model (remove old fields, add `teamTask`)
- [ ] Write migration function `migrateSession()`
- [ ] Update `MessageRouter` to parse `[FROM]` and `[TEAM_TASK]`
- [ ] Add unit tests for new parsing logic
- [ ] Update `SessionUtils.createSession()` signature

**Deliverables:**
- Modified `ConversationSession.ts`
- Modified `MessageRouter.ts` with new patterns
- Migration function in `SessionUtils`
- 15 new unit tests for marker parsing

**Validation:**
```bash
npm run test:unit tests/unit/sessionUtils.test.ts
npm run test:unit tests/unit/messageRouter.test.ts
```

### Phase 2: Coordinator Refactor (Week 2)
**Goals:** Implement `sendMessage()`, remove `startConversation()`

**Tasks:**
- [ ] Implement `ConversationCoordinator.setTeam()`
- [ ] Implement `ConversationCoordinator.sendMessage()`
- [ ] Implement `resolveSender()` with `[FROM]` logic
- [ ] Add first-message validation (must be human)
- [ ] Update routing queue initialization in `sendMessage()`
- [ ] Add comprehensive error messages
- [ ] Mark `startConversation()` as deprecated (with runtime warning)

**Deliverables:**
- New `sendMessage()` method in `ConversationCoordinator`
- Updated routing logic
- Error message catalog implementation
- 25 new unit tests for sender resolution & validation

**Validation:**
```bash
npm run test:unit tests/unit/conversationCoordinator.test.ts
```

### Phase 3: Prompt & Context (Week 3)
**Goals:** Add `[TEAM_TASK]` section, update token budget

**Tasks:**
- [ ] Update `PromptBuilder` to include `[TEAM_TASK]` section
- [ ] Modify byte counting to include team task overhead
- [ ] Update `trimContext()` to account for new section
- [ ] Strip `[TEAM_TASK]` from context messages (not from session storage)
- [ ] Update `ContextCollector` if needed

**Deliverables:**
- Modified `PromptBuilder.ts`
- Updated token budget calculations
- 10 new tests for prompt assembly with TEAM_TASK

**Validation:**
```bash
npm run test:unit tests/unit/promptBuilder.test.ts
```

### Phase 4: REPL Integration (Week 4)
**Goals:** Remove `/start`, add deprecation warning, update conversation mode

**Tasks:**
- [ ] Remove `/start` command handler (add deprecation warning in v0.2.0)
- [ ] Update conversation mode to use `sendMessage()` directly
- [ ] Add `[FROM]` validation hints in error messages
- [ ] Update help text and prompts
- [ ] Handle first-message flow in conversation mode

**Deliverables:**
- Modified `ReplModeInk.tsx`
- Updated `/help` command output
- New error hint displays
- 15 integration tests for REPL flows

**Validation:**
```bash
npm run test:integration tests/integration/cli/
```

### Phase 5: Test Migration (Week 5-6)
**Goals:** Update all existing tests, add new test coverage

**Tasks:**
- [ ] Run migration script on test fixtures
- [ ] Manual review and fix of all test changes
- [ ] Add E2E tests for single-human auto-sender
- [ ] Add E2E tests for multi-human `[FROM]` requirement
- [ ] Add E2E tests for team task persistence
- [ ] Add E2E tests for "buzzing in" scenario
- [ ] Update CI configuration if needed (serial execution)

**Deliverables:**
- 155 migrated test files
- 40 new E2E/integration tests
- Updated `vitest.config.ts` for stability
- All tests passing

**Validation:**
```bash
npm test  # Full suite
```

### Phase 6: Documentation & Release (Week 7)
**Goals:** Update docs, prepare release notes

**Tasks:**
- [ ] Update README with new conversation start flow
- [ ] Write migration guide for v0.2.0
- [ ] Update CHANGELOG
- [ ] Add deprecation notices to relevant docs
- [ ] Create example configs showing `[FROM]` and `[TEAM_TASK]`
- [ ] Release v0.2.0 with deprecation warnings

**Deliverables:**
- Updated README.md
- Migration guide document
- CHANGELOG entry for v0.2.0
- npm publish v0.2.0

---

## Risk Mitigation

### Risk 1: Test Migration Takes Longer Than Expected
**Mitigation:** 
- Allocate 2 weeks (Phase 5) instead of 1
- Create automated migration script for 80% of cases
- Focus on critical path tests first

### Risk 2: Breaking Changes Disrupt Users
**Mitigation:**
- Use deprecation period (v0.2.0 → v0.3.0)
- Clear migration guide
- Verbose error messages with hints

### Risk 3: Token Budget Bugs
**Mitigation:**
- Extensive testing of `trimContext()` with various TEAM_TASK sizes
- Add DEBUG logging for byte calculations
- Monitor real-world usage in UAT

### Risk 4: Performance Regression
**Mitigation:**
- Profile `sendMessage()` vs old `startConversation()`
- Monitor test suite execution time
- Use serial execution during migration to avoid OOM

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test Pass Rate | 100% | CI pipeline status |
| Test Execution Time | < 2 min locally | `npm test` duration |
| Migration Coverage | All 155 tests | Manual checklist |
| Documentation Complete | 100% | README, CHANGELOG, Migration Guide |
| User Complaints | 0 in first week | GitHub issues |
| Breaking Change Impact | < 5% of users need support | Support ticket volume |

---

## PM Decisions (Round 2)

All open questions resolved by PM:

1. **Performance Budget: APPROVED**
   - ✅ Cap `[TEAM_TASK]` at 5KB max
   - Implementation: Truncate with ellipsis if exceeds limit
   - Error handling: Warn user in DEBUG mode when truncated

2. **Session Persistence: NO MIGRATION NEEDED**
   - ✅ Old sessions are incompatible and will not be migrated
   - Document breaking change in CHANGELOG
   - Users must start fresh conversations after upgrade
   - Rationale: Session history is not critical, feature improvements outweigh compatibility

3. **CLI Mode Parity: YES, REMOVE FIRST MESSAGE CONCEPT**
   - ✅ Remove `--initial-message` flag from CLI
   - CLI must accept first message from stdin (same as REPL)
   - Update CLI documentation and help text
   - Breaking change for CLI users

### Updated Requirements Based on PM Decisions

#### TEAM_TASK Size Limit

**Implementation:**
```typescript
// In ConversationCoordinator.sendMessage()
if (parsed.teamTask) {
  const MAX_TEAM_TASK_BYTES = 5 * 1024; // 5KB
  const taskBytes = Buffer.byteLength(parsed.teamTask, 'utf-8');

  if (taskBytes > MAX_TEAM_TASK_BYTES) {
    // Truncate and warn
    const truncated = truncateToBytes(parsed.teamTask, MAX_TEAM_TASK_BYTES - 3) + '...';
    this.session.teamTask = truncated;

    if (process.env.DEBUG) {
      console.error(
        `[Debug][TEAM_TASK] Task truncated from ${taskBytes} to ${MAX_TEAM_TASK_BYTES} bytes`
      );
    }
  } else {
    this.session.teamTask = parsed.teamTask;
  }
}

// Helper function
function truncateToBytes(str: string, maxBytes: number): string {
  let bytes = 0;
  let truncated = '';

  for (const char of str) {
    const charBytes = Buffer.byteLength(char, 'utf-8');
    if (bytes + charBytes > maxBytes) break;
    truncated += char;
    bytes += charBytes;
  }

  return truncated;
}
```

#### Session Incompatibility

**CHANGELOG Entry:**
```markdown
## [0.2.0] - BREAKING CHANGES

### Session Incompatibility
⚠️ **WARNING:** Existing conversation sessions are NOT compatible with v0.2.0.

**Impact:**
- Old session files cannot be loaded
- Conversation history from v0.1.x is not preserved
- Users must start fresh conversations after upgrade

**Reason:**
- `ConversationSession` schema changed (removed `initialMessage`, `firstSpeakerId`)
- No migration tool provided due to low criticality of session history

**Workaround:**
- Export important conversation logs before upgrading (if needed)
- Use `agent-chatter --version` to check version before upgrade
```

#### CLI Mode Changes

**Current CLI:**
```bash
# OLD (v0.1.x)
agent-chatter start --config team.json --initial-message "Build auth system"
```

**New CLI:**
```bash
# NEW (v0.2.0+)
echo "Build auth system" | agent-chatter --config team.json

# Or interactive mode
agent-chatter --config team.json
# (Then type first message when prompted)
```

**CLI Implementation Changes:**

**Remove from `cli.ts`:**
```typescript
// REMOVE these options
.option('--initial-message <message>', 'Initial message to start conversation')
.option('-m, --message <message>', 'Alias for --initial-message')

// REMOVE startConversation() call
```

**Add to `cli.ts`:**
```typescript
// New CLI flow
program
  .name('agent-chatter')
  .option('-c, --config <path>', 'Team configuration file')
  .action(async (options) => {
    if (!options.config) {
      console.error('Error: --config is required');
      process.exit(1);
    }

    const config = loadConfig(options.config);
    const { coordinator, team } = await initializeServices(config);

    // Read first message from stdin
    const firstMessage = await readStdin();

    if (!firstMessage.trim()) {
      console.error('Error: First message cannot be empty');
      process.exit(1);
    }

    // Start conversation with first message
    await coordinator.sendMessage(firstMessage);

    // Enter interactive loop
    await conversationLoop(coordinator, team);
  });
```

**Help Text Update:**
```
Usage: agent-chatter [options]

Options:
  -c, --config <path>   Team configuration file (required)
  -h, --help           Display help information
  -v, --version        Display version

Examples:
  # Interactive mode
  agent-chatter --config team.json

  # Pipe first message
  echo "Build authentication system" | agent-chatter --config team.json

  # Multi-human team (use [FROM:xxx])
  echo "[FROM:kailai] Design new feature [NEXT:max]" | agent-chatter --config team.json
```

---

## Architecture Committee Review - Round 3 Responses

### BLOCKING/HIGH-RISK ISSUES

#### 1. /start Removal & New Entry Point - Session Lifecycle

**Issue:** Document requires deleting `startConversation` and using `sendMessage`, but current code (Coordinator/REPL/CLI/tests) fully depends on `/start` and `startConversation(team, initialMessage, firstSpeakerId)`. Need explicit entry point definition for REPL/CLI including team loading and `waitingForRoleId` initialization.

**Resolution:**

##### New Entry Points by Mode

**REPL Mode Flow:**

```typescript
// ReplModeInk.tsx - Conversation Mode Handler

// 1. Team deployment (unchanged)
case '/team':
  if (args[0] === 'deploy') {
    const configPath = args[1];
    const team = await loadTeamConfig(configPath);
    coordinator.setTeam(team);  // ← Set team, but don't start session yet
    setMode('conversation');
    setOutput(prev => [...prev,
      <Text color="green">✓ Team "{team.name}" loaded</Text>,
      <Text dimColor>Type your first message to begin conversation...</Text>
    ]);
  }
  break;

// 2. First message triggers session initialization
function handleConversationInput(input: string) {
  if (!coordinator.hasActiveSession()) {
    // First message - will auto-initialize session
    await coordinator.sendMessage(input);
    // ↑ sendMessage() internally calls createSession() on first call
  } else {
    // Subsequent messages
    await coordinator.sendMessage(input);
  }
}
```

**CLI Mode Flow:**

```typescript
// cli.ts

async function main() {
  const options = program.parse(process.argv);

  if (!options.config) {
    console.error('Error: --config <path> required');
    process.exit(1);
  }

  // 1. Load team
  const config = loadConfig(options.config);
  const team = await TeamManager.buildTeam(config);

  // 2. Initialize services
  const agentManager = new AgentManager();
  const messageRouter = new MessageRouter();
  const coordinator = new ConversationCoordinator(agentManager, messageRouter);

  // 3. Set team (don't start session yet)
  coordinator.setTeam(team);

  // 4. Interactive loop - first iteration will initialize session
  while (true) {
    const input = await readlinePrompt('> ');

    if (!input.trim()) continue;
    if (input.startsWith('/')) {
      // Handle commands...
      continue;
    }

    // First message will auto-initialize session via sendMessage()
    await coordinator.sendMessage(input);
  }
}
```

##### Coordinator Internal Logic

```typescript
class ConversationCoordinator {
  private team: Team | null = null;
  private session: ConversationSession | null = null;
  private waitingForRoleId: string | null = null;

  setTeam(team: Team): void {
    this.team = team;
    this.session = null;  // Reset session when team changes
    this.waitingForRoleId = null;
  }

  hasActiveSession(): boolean {
    return this.session !== null;
  }

  async sendMessage(content: string, explicitSenderId?: string): Promise<void> {
    // AUTO-INITIALIZE SESSION ON FIRST MESSAGE
    if (!this.session) {
      if (!this.team) {
        throw new Error('No team loaded. Use /team deploy <config> first');
      }

      // Create new session (no initial message or first speaker needed)
      this.session = SessionUtils.createSession(
        this.team.id,
        this.team.name
      );

      if (process.env.DEBUG) {
        console.error(`[Debug][Session] Created new session ${this.session.id}`);
      }
    }

    // Parse message markers
    const parsed = this.messageRouter.parseMessage(content);

    // Resolve sender (throws on error for multi-human without [FROM])
    const sender = this.resolveSender(explicitSenderId, parsed.fromMember);

    // FIRST MESSAGE VALIDATION
    if (this.session.messages.length === 0) {
      if (sender.type !== 'human') {
        throw new Error('First message must be from a human member');
      }

      if (process.env.DEBUG) {
        console.error(`[Debug][Session] First speaker: ${sender.name} (${sender.id})`);
      }
    }

    // Update team task if marker present
    if (parsed.teamTask) {
      this.updateTeamTask(parsed.teamTask);
    }

    // Create and store message
    const message = this.createMessage(sender, parsed);
    this.session = SessionUtils.addMessageToSession(this.session, message);

    // Route to next member(s)
    await this.routeToNext(message);
  }

  private resolveSender(
    explicitId?: string,
    fromMarker?: string
  ): Member {
    // Priority: explicitId > [FROM:xxx] > waitingForRoleId > single-human > ERROR

    if (explicitId) {
      const member = this.team!.members.find(m => m.id === explicitId);
      if (!member) throw new Error(`Member ID ${explicitId} not found`);
      return member;
    }

    if (fromMarker) {
      const member = this.resolveMemberFromIdentifier(fromMarker);
      if (!member) {
        const humans = this.team!.members.filter(m => m.type === 'human');
        throw new Error(
          `Member '${fromMarker}' not found.\n` +
          `   Available human members: ${humans.map(h => h.name).join(', ')}`
        );
      }
      if (member.type !== 'human') {
        throw new Error(
          `Cannot use [FROM:${fromMarker}]. ${member.displayName} is an AI agent.\n` +
          `   Use [FROM:xxx] only for human members`
        );
      }
      // Clear waitingForRoleId when buzzing in
      this.waitingForRoleId = null;
      return member;
    }

    if (this.waitingForRoleId) {
      const member = this.team!.members.find(m => m.id === this.waitingForRoleId);
      if (member && member.type === 'human') {
        return member;
      }
    }

    // Auto-select single human
    const humans = this.team!.members.filter(m => m.type === 'human');
    if (humans.length === 1) {
      return humans[0];
    }

    // Multi-human without [FROM] or waitingForRoleId
    throw new Error(
      'Multiple human members detected. Please specify sender with [FROM:xxx]\n' +
      `   Available members: ${humans.map(h => h.name).join(', ')}`
    );
  }
}
```

##### waitingForRoleId Management

```typescript
// In routeToNext() - existing logic preserved

private async routeToNext(message: ConversationMessage): Promise<void> {
  const parsed = this.messageRouter.parseMessage(message.content);

  if (parsed.addressees.length > 0) {
    // Pre-seed routing queue
    const resolved = this.resolveAddressees(parsed.addressees);
    for (const member of resolved) {
      this.routingQueue.push({
        member,
        content: parsed.cleanContent
      });
    }
  }

  // Process queue
  if (this.routingQueue.length > 0) {
    await this.processRoutingQueue();
    return;
  }

  // No queue, no [NEXT] - fallback to first human
  const firstHuman = this.team!.members.find(m => m.type === 'human');
  if (firstHuman) {
    this.waitingForRoleId = firstHuman.id;  // ← Set waiting state

    if (process.env.DEBUG) {
      console.error(`[Debug][Routing] Waiting for ${firstHuman.name}`);
    }
  }
}

private async processRoutingQueue(): Promise<void> {
  while (this.routingQueue.length > 0) {
    const { member, content } = this.routingQueue.shift()!;

    if (member.type === 'ai') {
      await this.sendToAgent(member, content);
      // AI may add more to queue, loop continues
    } else {
      // Human member - pause
      this.waitingForRoleId = member.id;  // ← Set waiting state

      if (process.env.DEBUG) {
        console.error(`[Debug][Queue] Paused for human ${member.name}`);
      }

      return;  // Exit queue processing, wait for human input
    }
  }

  // Queue empty after all AI processing
  this.waitingForRoleId = null;
}
```

##### State Transition Diagram

```
┌─────────────────┐
│ App Starts      │
└────────┬────────┘
         ↓
┌─────────────────────────┐
│ User: /team deploy      │
│ → coordinator.setTeam() │
│ → mode = 'conversation' │
│ → session = null        │
│ → waitingForRoleId=null │
└────────┬────────────────┘
         ↓
┌──────────────────────────────────┐
│ User types first message         │
│ → coordinator.sendMessage(msg)   │
└────────┬─────────────────────────┘
         ↓
┌───────────────────────────────────┐
│ sendMessage() Logic:              │
│ 1. session==null?                 │
│    YES → createSession()          │
│    session.messages = []          │
│ 2. Parse [FROM/NEXT/TEAM_TASK]    │
│ 3. Resolve sender (validation)    │
│ 4. Validate first msg (must human)│
│ 5. Update teamTask if present     │
│ 6. Create & store message         │
│ 7. routeToNext()                  │
└────────┬──────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ routeToNext() Logic:               │
│ • Parse [NEXT] markers             │
│ • Enqueue addressees               │
│ • processRoutingQueue()            │
│   ├─ AI? → sendToAgent() → loop   │
│   └─ Human? → set waitingForRoleId │
│ • No queue? → waitingForRoleId=    │
│              first human           │
└────────┬───────────────────────────┘
         ↓
┌──────────────────────────────────┐
│ State: Waiting for human input   │
│ waitingForRoleId = "human-id"    │
└────────┬─────────────────────────┘
         ↓
┌──────────────────────────────────┐
│ User types next message          │
│ → sendMessage() again            │
│   session exists, sender resolved│
│   from waitingForRoleId or [FROM]│
└──────────────────────────────────┘
```

#### 2. MessageRouter Strip Rules - Complete Implementation

**Issue:** Current implementation only has `stripMarkers()` removing NEXT/DONE/newlines. Need complete strip function showing FROM/TEAM_TASK preservation without introducing extra spaces/newlines.

**Resolution:**

##### Updated MessageRouter with Complete Strip Logic

```typescript
class MessageRouter {
  private readonly FROM_PATTERN = /\[FROM:\s*([^\]]+)\]/gi;
  private readonly TEAM_TASK_PATTERN = /\[TEAM_TASK:\s*([^\]]+)\]/gi;
  private readonly NEXT_PATTERN = /\[NEXT:\s*([^\]]+)\]/gi;
  private readonly DONE_PATTERN = /\[DONE\]/gi;

  parseMessage(message: string): ParseResult {
    // 1. Extract [FROM:xxx]
    this.FROM_PATTERN.lastIndex = 0;
    const fromMatch = this.FROM_PATTERN.exec(message);
    const fromMember = fromMatch?.[1]?.trim();

    // 2. Extract [TEAM_TASK:xxx] - last occurrence wins
    this.TEAM_TASK_PATTERN.lastIndex = 0;
    let teamTask: string | undefined;
    let match;
    while ((match = this.TEAM_TASK_PATTERN.exec(message)) !== null) {
      teamTask = match[1]?.trim();
    }

    // 3. Extract [NEXT:xxx] - all occurrences
    this.NEXT_PATTERN.lastIndex = 0;
    const addressees: string[] = [];
    while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
      const addrList = match[1]?.trim();
      if (addrList) {
        addressees.push(...addrList.split(',').map(s => s.trim()));
      }
    }

    // 4. Check [DONE]
    this.DONE_PATTERN.lastIndex = 0;
    const isDone = this.DONE_PATTERN.test(message);

    // 5. Clean content - strip ONLY [NEXT] and [DONE]
    // Keep [FROM] and [TEAM_TASK] for conversation history
    const cleanContent = this.stripNextAndDoneMarkers(message);

    return {
      addressees,
      isDone,
      cleanContent,
      fromMember,
      teamTask
    };
  }

  /**
   * Remove ONLY [NEXT:xxx] and [DONE] markers
   * Preserve [FROM:xxx] and [TEAM_TASK:xxx]
   * Clean up extra whitespace but preserve intentional formatting
   */
  private stripNextAndDoneMarkers(message: string): string {
    let result = message;

    // Remove [NEXT:xxx] markers
    this.NEXT_PATTERN.lastIndex = 0;
    result = result.replace(this.NEXT_PATTERN, '');

    // Remove [DONE] markers
    this.DONE_PATTERN.lastIndex = 0;
    result = result.replace(this.DONE_PATTERN, '');

    // Clean up whitespace:
    // - Multiple spaces → single space
    // - Leading/trailing whitespace per line
    // - Preserve intentional newlines (don't collapse them)
    result = result
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0)  // Remove blank lines created by marker removal
      .join('\n')
      .trim();

    return result;
  }

  /**
   * Strip ALL markers including FROM and TEAM_TASK
   * Used when building context history to avoid duplication
   */
  stripAllMarkersForContext(message: string): string {
    let result = message;

    // Remove all marker types
    this.FROM_PATTERN.lastIndex = 0;
    this.TEAM_TASK_PATTERN.lastIndex = 0;
    this.NEXT_PATTERN.lastIndex = 0;
    this.DONE_PATTERN.lastIndex = 0;

    result = result.replace(this.FROM_PATTERN, '');
    result = result.replace(this.TEAM_TASK_PATTERN, '');
    result = result.replace(this.NEXT_PATTERN, '');
    result = result.replace(this.DONE_PATTERN, '');

    // Same whitespace cleanup
    result = result
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();

    return result;
  }
}
```

##### Examples of Strip Behavior

```typescript
// Example 1: Basic message with multiple markers
const input1 = "[FROM:kailai][TEAM_TASK:Design auth][NEXT:max] Let's start planning";

const parsed1 = router.parseMessage(input1);
// parsed1.fromMember = "kailai"
// parsed1.teamTask = "Design auth"
// parsed1.addressees = ["max"]
// parsed1.cleanContent = "[FROM:kailai][TEAM_TASK:Design auth] Let's start planning"

const forContext1 = router.stripAllMarkersForContext(input1);
// forContext1 = "Let's start planning"

// Example 2: Multiple NEXT markers
const input2 = "[FROM:bob] Task description [NEXT:max][NEXT:carol][NEXT:alice] more text [DONE]";

const parsed2 = router.parseMessage(input2);
// parsed2.fromMember = "bob"
// parsed2.addressees = ["max", "carol", "alice"]
// parsed2.isDone = true
// parsed2.cleanContent = "[FROM:bob] Task description more text"

const forContext2 = router.stripAllMarkersForContext(input2);
// forContext2 = "Task description more text"

// Example 3: Markers with extra whitespace
const input3 = "[FROM: kailai ]  [TEAM_TASK:  Design system  ]   \n  Let's go  [NEXT:  max  ]  ";

const parsed3 = router.parseMessage(input3);
// parsed3.fromMember = "kailai"  (trimmed)
// parsed3.teamTask = "Design system"  (trimmed)
// parsed3.addressees = ["max"]  (trimmed)
// parsed3.cleanContent = "[FROM: kailai ] [TEAM_TASK: Design system ]\nLet's go"

// Example 4: Multi-line content
const input4 = `[FROM:kailai][NEXT:max]
Here's my analysis:
1. Point one
2. Point two
[DONE]`;

const parsed4 = router.parseMessage(input4);
// parsed4.cleanContent =
// "[FROM:kailai]
// Here's my analysis:
// 1. Point one
// 2. Point two"
```

#### 3. Prompt Assembly Token Budget - Detailed Implementation

**Issue:** Document shows example `maxBytes - systemBytes - teamTaskBytes - messageBytes` but doesn't define how `teamTaskBytes` is calculated or how context trimming adapts. Also, team task kept in `cleanContent` causes duplication in HISTORY.

**Resolution:**

##### Decision: TEAM_TASK Stripped from Context, Kept in Session

**Strategy:**
1. `[TEAM_TASK:xxx]` stored in `session.teamTask`
2. Appears in dedicated `[TEAM_TASK]` prompt section
3. **Stripped from message content when building context history** (via `stripAllMarkersForContext()`)
4. Original message in `session.messages[]` preserves all markers (for audit/replay)

##### Updated PromptBuilder Implementation

```typescript
interface PromptInput {
  systemInstruction: string;
  teamTask: string | null;        // From session.teamTask
  contextMessages: ConversationMessage[];
  message: string;
  maxBytes: number;
}

interface PromptOutput {
  prompt: string;
  trimmedContext: {
    totalMessages: number;
    includedMessages: number;
    bytesUsed: number;
    bytesAvailable: number;
  };
}

function buildPrompt(input: PromptInput): PromptOutput {
  const sections: string[] = [];
  let totalBytes = 0;

  // 1. [SYSTEM] section
  const systemSection = buildSection('[SYSTEM]', input.systemInstruction);
  const systemBytes = Buffer.byteLength(systemSection, 'utf-8');
  sections.push(systemSection);
  totalBytes += systemBytes;

  // 2. [TEAM_TASK] section (if present)
  let teamTaskBytes = 0;
  if (input.teamTask) {
    const teamTaskSection = buildSection('[TEAM_TASK]', input.teamTask);
    teamTaskBytes = Buffer.byteLength(teamTaskSection, 'utf-8');
    sections.push(teamTaskSection);
    totalBytes += teamTaskBytes;
  }

  // 3. [MESSAGE] section (current message)
  const messageSection = buildSection('[MESSAGE]', input.message);
  const messageBytes = Buffer.byteLength(messageSection, 'utf-8');
  sections.push(messageSection);
  totalBytes += messageBytes;

  // 4. [CONTEXT] section - fill remaining budget
  const availableForContext = input.maxBytes - totalBytes;

  const { contextSection, stats } = buildContextSection(
    input.contextMessages,
    availableForContext
  );
  sections.push(contextSection);

  // Final assembly: SYSTEM, TEAM_TASK, CONTEXT, MESSAGE
  // (MESSAGE at end per current implementation)
  const reordered = [
    sections[0],  // SYSTEM
    ...(input.teamTask ? [sections[1]] : []),  // TEAM_TASK (if exists)
    sections[sections.length - 2],  // CONTEXT
    sections[sections.length - 1]   // MESSAGE
  ];

  return {
    prompt: reordered.join('\n\n'),
    trimmedContext: {
      totalMessages: input.contextMessages.length,
      includedMessages: stats.included,
      bytesUsed: stats.bytesUsed,
      bytesAvailable: availableForContext
    }
  };
}

function buildSection(header: string, content: string): string {
  return `${header}\n${content}`;
}

interface ContextStats {
  included: number;
  bytesUsed: number;
}

function buildContextSection(
  messages: ConversationMessage[],
  maxBytes: number
): { contextSection: string; stats: ContextStats } {

  if (messages.length === 0) {
    return {
      contextSection: '[CONTEXT]\n(No prior messages)',
      stats: { included: 0, bytesUsed: 0 }
    };
  }

  const messageRouter = new MessageRouter();
  const formattedMessages: string[] = [];
  let totalBytes = 0;
  const headerBytes = Buffer.byteLength('[CONTEXT]\n', 'utf-8');
  let availableBytes = maxBytes - headerBytes;

  // Reverse iteration: Include most recent messages first
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    // Strip ALL markers for context to avoid duplication
    const cleanContent = messageRouter.stripAllMarkersForContext(msg.content);

    const formatted = `${msg.speaker.roleName}: ${cleanContent}`;
    const msgBytes = Buffer.byteLength(formatted + '\n', 'utf-8');

    if (totalBytes + msgBytes > availableBytes) {
      // Would exceed budget, stop here
      break;
    }

    formattedMessages.unshift(formatted);  // Preserve chronological order
    totalBytes += msgBytes;
  }

  const contextBody = formattedMessages.join('\n');
  const contextSection = `[CONTEXT]\n${contextBody}`;

  return {
    contextSection,
    stats: {
      included: formattedMessages.length,
      bytesUsed: totalBytes + headerBytes
    }
  };
}
```

##### Token Budget Calculation Example

```typescript
// Scenario: Agent with 100KB budget

const input: PromptInput = {
  systemInstruction: "You are Max, a Lead Business Analyst...",  // 2,000 bytes
  teamTask: "Design OAuth2-based authentication system",         // 500 bytes
  message: "What are the security requirements?",                // 150 bytes
  contextMessages: [...],  // 50 previous messages
  maxBytes: 100_000
};

// Budget breakdown:
const systemBytes = 2_000;
const teamTaskBytes = 500;
const messageBytes = 150;
const overhead = 50;  // Section headers "[SYSTEM]\n" etc

const availableForContext = 100_000 - 2_000 - 500 - 150 - 50;
// = 97,300 bytes for context

// buildContextSection() will:
// 1. Iterate messages from newest to oldest
// 2. Strip ALL markers (FROM/TEAM_TASK/NEXT/DONE) via stripAllMarkersForContext()
// 3. Include as many as fit within 97,300 bytes
// 4. Stop when budget exceeded

// Example result:
// - 43 out of 50 messages included
// - 96,800 bytes used
// - 7 oldest messages trimmed
```

##### Avoiding TEAM_TASK Duplication

```typescript
// WRONG (old approach): TEAM_TASK appears in every context message
// Context:
// kailai: [TEAM_TASK:Design auth] Let's start
// max: [TEAM_TASK:Design auth] I'll create a PRD
// carol: [TEAM_TASK:Design auth] Here are the requirements
// → Wastes 3 × task_size bytes

// CORRECT (new approach): TEAM_TASK appears ONCE in dedicated section
// [TEAM_TASK]
// Design auth
//
// [CONTEXT]
// kailai: Let's start
// max: I'll create a PRD
// carol: Here are the requirements
// → Optimal: task appears once, not repeated in history
```

#### 4. Routing Queue & sendMessage Alignment - Complete Flow

**Issue:** Current implementation pre-seeds queue in `startConversation`. When switching to `sendMessage`, need explicit flow for: (1) first message triggering queue consumption, (2) AI摘要路由 preservation, (3) multi-NEXT enqueue/consume with existing routingQueue interaction.

**Resolution:**

##### Complete Routing Flow with sendMessage

```typescript
class ConversationCoordinator {
  private routingQueue: Array<{ member: Member; content: string }> = [];
  private routingInProgress = false;

  async sendMessage(content: string, explicitSenderId?: string): Promise<void> {
    // ... (session initialization, sender resolution, message creation)

    // After message created and stored:
    const message = this.session.messages[this.session.messages.length - 1];

    // ROUTING STARTS HERE
    await this.routeToNext(message);
  }

  private async routeToNext(message: ConversationMessage): Promise<void> {
    const parsed = this.messageRouter.parseMessage(message.content);

    if (process.env.DEBUG) {
      console.error(`[Debug][Routing] From ${message.speaker.roleName} addressees=${JSON.stringify(parsed.addressees)}`);
    }

    // 1. PRE-SEED ROUTING QUEUE from [NEXT] markers
    if (parsed.addressees.length > 0) {
      const resolved = this.resolveAddressees(parsed.addressees);

      for (const member of resolved) {
        const delivery = this.prepareDelivery(member, parsed.cleanContent);
        this.routingQueue.push({ member, content: delivery.content });

        if (process.env.DEBUG) {
          console.error(`[Debug][Routing] Queued ${member.name}`);
        }
      }
    }

    // 2. PROCESS ROUTING QUEUE (AI chains handled here)
    if (this.routingQueue.length > 0) {
      await this.processRoutingQueue();
      return;
    }

    // 3. NO QUEUE - fallback to first human
    const firstHuman = this.team!.members.find(m => m.type === 'human');
    if (firstHuman) {
      this.waitingForRoleId = firstHuman.id;

      if (process.env.DEBUG) {
        console.error(`[Debug][Routing] No queue, waiting for ${firstHuman.name}`);
      }
    }
  }

  private async processRoutingQueue(): Promise<void> {
    if (this.routingInProgress) {
      if (process.env.DEBUG) {
        console.error('[Debug][Queue] Already in progress, skipping');
      }
      return;
    }

    this.routingInProgress = true;

    if (process.env.DEBUG) {
      console.error(`[Debug][Queue] Processing ${this.routingQueue.length} items`);
    }

    while (this.routingQueue.length > 0) {
      const { member, content } = this.routingQueue.shift()!;

      if (process.env.DEBUG) {
        console.error(`[Debug][Queue] Processing ${member.name} (${member.type})`);
      }

      if (member.type === 'ai') {
        // SEND TO AI AGENT
        await this.sendToAgent(member, content);

        // AI response may have added more items to queue
        // Loop continues to process them

      } else {
        // HUMAN MEMBER - PAUSE QUEUE PROCESSING
        this.waitingForRoleId = member.id;

        if (process.env.DEBUG) {
          console.error(`[Debug][Queue] Paused for human ${member.name}`);
        }

        this.routingInProgress = false;
        return;  // Exit, wait for human input via next sendMessage() call
      }
    }

    // Queue empty after processing all AI agents
    this.waitingForRoleId = null;
    this.routingInProgress = false;

    if (process.env.DEBUG) {
      console.error('[Debug][Queue] Queue empty, routing complete');
    }
  }

  private async sendToAgent(member: Member, content: string): Promise<void> {
    // Build prompt with TEAM_TASK section
    const prompt = this.promptBuilder.buildPrompt({
      systemInstruction: member.systemPrompt || '',
      teamTask: this.session!.teamTask,  // ← Include team task
      contextMessages: this.session!.messages,
      message: content,
      maxBytes: 100_000  // Or from config
    });

    // Send to agent
    const response = await this.agentManager.sendAndReceive(
      member.agentConfigId!,
      prompt.prompt
    );

    // Parse AI response for [NEXT] markers
    const responseParsed = this.messageRouter.parseMessage(response);

    // Create message for AI response
    const aiMessage = this.createMessage(member, responseParsed);
    this.session = SessionUtils.addMessageToSession(this.session!, aiMessage);

    // ENQUEUE NEW ADDRESSEES from AI response
    if (responseParsed.addressees.length > 0) {
      const resolved = this.resolveAddressees(responseParsed.addressees);

      for (const nextMember of resolved) {
        const delivery = this.prepareDelivery(nextMember, responseParsed.cleanContent);
        this.routingQueue.push({ member: nextMember, content: delivery.content });

        if (process.env.DEBUG) {
          console.error(`[Debug][AI Response] Queued ${nextMember.name} from ${member.name}'s output`);
        }
      }
    }

    // NOTE: processRoutingQueue() loop will continue and process new items
  }
}
```

##### AI摘要路由 (AI Summary Routing) - Preserved

**Current Behavior:**
- When AI completes, `ContextCollector` captures summary
- Summary parsed for `[NEXT]` markers
- Creates `ConversationMessage` from summary
- Routes to addressees

**New Implementation (NO CHANGE):**
```typescript
// In sendToAgent() - already shown above
const response = await this.agentManager.sendAndReceive(...);
const responseParsed = this.messageRouter.parseMessage(response);

// Parse extracts [NEXT] markers from AI output
// responseParsed.addressees contains targets

// Enqueue them
if (responseParsed.addressees.length > 0) {
  const resolved = this.resolveAddressees(responseParsed.addressees);
  for (const member of resolved) {
    this.routingQueue.push({ member, content: ... });
  }
}

// processRoutingQueue() loop continues, processes new AI-added items
```

**Compatibility:** AI summary routing works identically with `sendMessage()` as it did with `startConversation()`.

##### Routing Flow Scenarios

**Scenario 1: Human → AI → AI → Human**
```
User input: "[FROM:kailai] Design auth [NEXT:max][NEXT:carol][NEXT:bob]"

Flow:
1. sendMessage("...")
   - Resolve sender: kailai (human)
   - Create message
   - routeToNext():
     - Parse [NEXT:max][NEXT:carol][NEXT:bob]
     - Enqueue: max, carol, bob
   - processRoutingQueue():
     - Dequeue max (AI) → sendToAgent(max, ...)
       - Max responds: "Analysis ready [NEXT:sarah]"
       - Enqueue sarah
       - Loop continues
     - Dequeue carol (AI) → sendToAgent(carol, ...)
       - Carol responds: "Requirements done"
       - No [NEXT], nothing enqueued
       - Loop continues
     - Dequeue bob (human) → PAUSE
       - waitingForRoleId = bob
       - Return

2. User input: "[FROM:bob] Looks good [NEXT:sarah]"
   - sendMessage("...")
   - Resolve sender: bob (from [FROM])
   - routeToNext():
     - Enqueue sarah
   - processRoutingQueue():
     - Dequeue sarah (AI) → sendToAgent(sarah, ...)
       - Sarah responds: "Done [DONE]"
       - Queue empty
     - waitingForRoleId = null (first human fallback logic)
```

**Scenario 2: AI→AI Chain (No Human Intervention)**
```
User: "[FROM:kailai] Analyze codebase [NEXT:max]"

Flow:
1. sendMessage()
   - Enqueue max
   - processRoutingQueue():
     - Dequeue max (AI)
       - Max: "Report ready [NEXT:carol]"
       - Enqueue carol
       - Loop continues (queue not empty)
     - Dequeue carol (AI)
       - Carol: "Summary complete [NEXT:sarah]"
       - Enqueue sarah
       - Loop continues
     - Dequeue sarah (AI)
       - Sarah: "All done [DONE]"
       - No addressees
       - Loop exits
     - waitingForRoleId = null
```

**Scenario 3: No [NEXT] - Fallback to Human**
```
User: "[FROM:kailai] Start project"

Flow:
1. sendMessage()
   - No [NEXT] markers
   - routeToNext():
     - addressees = []
     - Queue empty
     - Fallback: waitingForRoleId = first human

2. User types next message (waitingForRoleId used as sender)
```

#### 5. Test Migration - Quantified Workload & Migration Script

**Issue:** 400+ tests depend on `startConversation()` and `SessionUtils.createSession()`. Need quantified impact list and migration approach to avoid "大面积红" (widespread test failures).

**Resolution:**

##### Impacted Test Files - Complete Inventory

**Unit Tests:**
| File | Tests | Changes Required | Estimated Hours |
|------|-------|------------------|----------------|
| `tests/unit/conversationCoordinator.test.ts` | 52 | Replace `startConversation` → `setTeam` + `sendMessage` | 4h |
| `tests/unit/messageRouter.test.ts` | 28 | Add `[FROM]`, `[TEAM_TASK]` parsing tests | 2h |
| `tests/unit/promptBuilder.test.ts` | 18 | Add `[TEAM_TASK]` section, token budget tests | 2h |
| `tests/unit/sessionUtils.test.ts` | 12 | Update `createSession` signature (2 params) | 1h |
| **Subtotal** | **110** | | **9h** |

**Integration Tests:**
| File | Tests | Changes Required | Estimated Hours |
|------|-------|------------------|----------------|
| `tests/integration/conversationStarter.test.ts` | 15 | Update `startConversation` → `sendMessage` | 2h |
| `tests/integration/cli/start.test.ts` | 12 | Remove `/start` tests, add direct input tests | 3h |
| `tests/integration/repl/conversation.test.ts` | 18 | Update conversation flow tests | 2h |
| **Subtotal** | **45** | | **7h** |

**New Tests (To Add):**
| Test Category | Tests | Estimated Hours |
|--------------|-------|----------------|
| `[FROM]` validation & resolution | 15 | 3h |
| `[TEAM_TASK]` persistence & updates | 12 | 2h |
| Single-human auto-sender | 5 | 1h |
| Multi-human [FROM] requirement | 8 | 2h |
| Buzzing in with [FROM] | 6 | 1.5h |
| **Subtotal** | **46** | **9.5h** |

**TOTAL: 155 existing tests + 46 new tests = 201 tests**
**Estimated effort: 9h + 7h + 9.5h = 25.5 hours**

##### Migration Script

**Automated Migration Tool:**
```bash
#!/bin/bash
# scripts/migrate-tests.sh

echo "=== Test Migration Tool ==="
echo "Finding affected test files..."

# Find all test files using old API
files=$(grep -rl "startConversation\|SessionUtils.createSession" tests/)

for file in $files; do
  echo "Processing: $file"

  # Backup
  cp "$file" "$file.backup"

  # Pattern 1: Replace startConversation with setTeam + sendMessage
  # Before: await coordinator.startConversation(team, "message", "human-1");
  # After:  coordinator.setTeam(team);
  #         await coordinator.sendMessage("message");

  sed -i.tmp -E 's/await coordinator\.startConversation\(([^,]+), "([^"]+)", "[^"]+"\);/coordinator.setTeam(\1);\n    await coordinator.sendMessage("\2");/g' "$file"

  # Pattern 2: Update SessionUtils.createSession calls
  # Before: SessionUtils.createSession(teamId, teamName, initialMsg, firstId)
  # After:  SessionUtils.createSession(teamId, teamName)

  sed -i.tmp -E 's/SessionUtils\.createSession\(([^,]+), ([^,]+), [^,]+, [^)]+\)/SessionUtils.createSession(\1, \2)/g' "$file"

  rm "$file.tmp"

  echo "  ✓ Migrated: $file"
  echo "  ✓ Backup:   $file.backup"
done

echo ""
echo "Migration complete!"
echo "Review changes with: git diff tests/"
echo "Restore backups with: find tests/ -name '*.backup' -exec sh -c 'mv \"\$1\" \"\${1%.backup}\"' _ {} \;"
```

**Manual Review Checklist (After Script):**
```markdown
## Manual Migration Tasks

### 1. Fixture Updates (Per-file)
- [ ] Update `SessionUtils.createSession()` to 2-param version
- [ ] Add `session.teamTask = null` initialization where needed
- [ ] If test asserts on `initialMessage`, manually add first message to `session.messages[]`

### 2. Assertion Updates
- [ ] Replace assertions on `session.initialMessage` with `session.messages[0].content`
- [ ] Replace assertions on `session.firstSpeakerId` with `session.messages[0].speaker.roleId`

### 3. Test Logic Updates
- [ ] Tests expecting AI first speaker → Update to expect error
- [ ] Tests with multi-human teams → Add `[FROM:xxx]` to first message

### 4. New Tests
- [ ] Add `[FROM]` parsing tests to `messageRouter.test.ts`
- [ ] Add sender resolution tests to `conversationCoordinator.test.ts`
- [ ] Add `[TEAM_TASK]` section tests to `promptBuilder.test.ts`
- [ ] Add E2E flow tests for single/multi-human scenarios
```

##### Phased Migration Strategy

**Week 1: Foundation**
- Run migration script
- Fix compilation errors
- Update `SessionUtils` and fixtures
- Target: All unit tests compile

**Week 2: Unit Test Fixes**
- Fix `conversationCoordinator.test.ts` (52 tests)
- Fix `messageRouter.test.ts` (28 tests + new)
- Fix `promptBuilder.test.ts` (18 tests + new)
- Target: All unit tests pass

**Week 3: Integration Tests**
- Fix `conversationStarter.test.ts` (15 tests)
- Remove `/start` tests, add new flow tests
- Fix REPL integration tests
- Target: All integration tests pass

**Week 4: New Test Coverage**
- Add 46 new tests for new features
- E2E validation
- Target: Full suite passes, 100% coverage of new features

##### Preventing "大面积红" (Mass Failures)

**Strategies:**
1. **Serial Execution During Migration:**
   ```typescript
   // vitest.config.ts
   export default defineConfig({
     test: {
       pool: 'forks',
       poolOptions: {
         forks: { singleFork: true }  // Avoid OOM
       },
       testTimeout: 30000
     }
   });
   ```

2. **Incremental Validation:**
   ```bash
   # Test one file at a time during migration
   npm run test:unit tests/unit/sessionUtils.test.ts
   npm run test:unit tests/unit/messageRouter.test.ts
   # etc...
   ```

3. **Git Checkpoints:**
   ```bash
   # Commit after each successful file migration
   git add tests/unit/sessionUtils.test.ts
   git commit -m "test: Migrate sessionUtils tests to new API"
   ```

4. **Rollback Plan:**
   ```bash
   # Keep backups until full suite passes
   find tests/ -name '*.backup'  # List backups

   # Restore if needed
   find tests/ -name '*.backup' -exec sh -c 'mv "$1" "${1%.backup}"' _ {} \;
   ```

### MEDIUM PRIORITY ISSUES

#### 6. [FROM] Auto-Fill & Priority - Implementation Details

**Issue:** Document says "single human auto-add" and "priority: senderId > [FROM] > waitingForRoleId" but doesn't specify WHO injects auto-[FROM] (Router only parses). Need explicit sender selection logic and error message examples.

**Resolution:**

**WHO Handles Auto-[FROM]:** `ConversationCoordinator.resolveSender()` (already shown in Issue #1)

**Explicit Logic:**
```typescript
private resolveSender(
  explicitSenderId?: string,
  fromMarker?: string
): Member {

  // PRIORITY 1: Explicit sender ID (from programmatic calls)
  if (explicitSenderId) {
    const member = this.team!.members.find(m => m.id === explicitSenderId);
    if (!member) {
      throw new Error(`Internal error: Member ID ${explicitSenderId} not found`);
    }
    return member;
  }

  // PRIORITY 2: [FROM:xxx] marker (user-specified, allows buzzing in)
  if (fromMarker) {
    const member = this.resolveMemberFromIdentifier(fromMarker);

    if (!member) {
      const humans = this.team!.members.filter(m => m.type === 'human');
      throw new Error(
        `❌ Member '${fromMarker}' not found.\n` +
        `   Available human members: ${humans.map(h => h.name).join(', ')}`
      );
    }

    if (member.type !== 'human') {
      throw new Error(
        `❌ Cannot use [FROM:${fromMarker}]. ${member.displayName} is an AI agent.\n` +
        `   [FROM:xxx] is only for human members.`
      );
    }

    // Clear waitingForRoleId when explicitly buzzing in
    this.waitingForRoleId = null;

    if (process.env.DEBUG) {
      console.error(`[Debug][Sender] Resolved from [FROM:${fromMarker}] → ${member.name}`);
    }

    return member;
  }

  // PRIORITY 3: waitingForRoleId (system set from previous routing)
  if (this.waitingForRoleId) {
    const member = this.team!.members.find(m => m.id === this.waitingForRoleId);
    if (member && member.type === 'human') {
      if (process.env.DEBUG) {
        console.error(`[Debug][Sender] Using waitingForRoleId → ${member.name}`);
      }
      return member;
    }
  }

  // PRIORITY 4: Single human auto-select
  const humans = this.team!.members.filter(m => m.type === 'human');

  if (humans.length === 1) {
    if (process.env.DEBUG) {
      console.error(`[Debug][Sender] Auto-selected single human → ${humans[0].name}`);
    }
    return humans[0];
  }

  // PRIORITY 5: Multi-human without [FROM] → ERROR
  throw new Error(
    `❌ Multiple human members detected. Please specify sender with [FROM:xxx]\n` +
    `   Available members: ${humans.map(h => h.name).join(', ')}\n\n` +
    `   Example: [FROM:${humans[0].name}] Your message here`
  );
}
```

**Error Message Catalog:**

| Scenario | Error Output | User Action |
|----------|-------------|-------------|
| Multi-human, no [FROM] on first message | `❌ Multiple human members detected. Please specify sender with [FROM:xxx]`<br>`   Available members: kailai, bob`<br><br>`   Example: [FROM:kailai] Your message here` | Add `[FROM:xxx]` to message |
| Invalid member name in [FROM] | `❌ Member 'alice' not found.`<br>`   Available human members: kailai, bob` | Fix member name |
| [FROM] points to AI | `❌ Cannot use [FROM:max]. Max is an AI agent.`<br>`   [FROM:xxx] is only for human members.` | Use human member name |
| Single human, no [FROM] needed | *(No error, auto-select)* | None - works automatically |
| Buzzing in with [FROM] | *(No error, override waitingForRoleId)* | Works as intended |

**NO Auto-Injection in Message Content:**
- `[FROM:xxx]` is NOT added to `message.content`
- Router only parses existing markers
- Auto-selection happens silently in sender resolution
- `ConversationMessage.speaker` reflects resolved sender

#### 7. TEAM_TASK Duplication & Semantics - Clarification

**Issue:** Document says TEAM_TASK kept in `message.content` AND in Prompt section → duplication. Need clarification on HISTORY display and PromptBuilder deduplication.

**Resolution: ALREADY ADDRESSED IN ISSUE #3**

Summary:
- `session.teamTask` stores current team task
- `[TEAM_TASK]` section in prompt built from `session.teamTask`
- **Message content in CONTEXT history uses `stripAllMarkersForContext()`** → NO duplication
- Original messages in `session.messages[]` keep all markers (for audit)

**Example:**
```typescript
// Session state:
session.teamTask = "Design OAuth2 authentication";
session.messages = [
  { content: "[FROM:kailai][TEAM_TASK:Design OAuth2 authentication] Let's start", ... },
  { content: "I'll create a PRD [NEXT:carol]", ... }
];

// When building prompt for Carol:
// [SYSTEM]
// You are Carol...
//
// [TEAM_TASK]   ← From session.teamTask
// Design OAuth2 authentication
//
// [CONTEXT]     ← Messages stripped via stripAllMarkersForContext()
// kailai: Let's start
// max: I'll create a PRD
//
// [MESSAGE]
// (current message to Carol)
```

**No Duplication:** TEAM_TASK appears once in dedicated section, not repeated in context history.

### SUGGESTED ADDITIONS

#### 8. New Entry Point & Lifecycle Chapter

**Added as Issue #1 resolution above.** Includes:
- REPL flow: `/team deploy` → first message → auto-init session
- CLI flow: load config → interactive loop → first message → auto-init
- `ConversationCoordinator` internal logic with `setTeam()` and `hasActiveSession()`
- State transition diagram
- `waitingForRoleId` management

#### 9. New stripMarkers Implementation

**Added as Issue #2 resolution above.** Includes:
- `stripNextAndDoneMarkers()` - removes NEXT/DONE, keeps FROM/TEAM_TASK
- `stripAllMarkersForContext()` - removes all markers for context history
- Examples of strip behavior with various inputs
- Whitespace handling rules

#### 10. PromptBuilder TEAM_TASK Deduplication & Token Budget

**Added as Issue #3 resolution above.** Includes:
- Complete `buildPrompt()` implementation
- `buildContextSection()` with `stripAllMarkersForContext()` usage
- Token budget calculation example
- Duplication avoidance explanation

#### 11. Test Migration Checklist & Affected Files

**Added as Issue #5 resolution above.** Includes:
- Complete inventory of 155 affected tests
- Estimated hours per file
- Automated migration script
- Manual review checklist
- Phased migration strategy (4 weeks)
- Strategies to prevent mass failures

#### 12. Routing Flow Detailed Explanation

**Added as Issue #4 resolution above.** Includes:
- Complete `routeToNext()` and `processRoutingQueue()` implementation
- AI summary routing preservation
- Three routing scenarios with detailed flows
- Queue management with AI→AI chains

---

## Summary of Round 3 Updates

**All blocking issues addressed:**
1. ✅ Entry point & session lifecycle defined for REPL/CLI
2. ✅ Complete MessageRouter strip rules with two functions
3. ✅ Prompt token budget with TEAM_TASK deduplication strategy
4. ✅ Routing queue alignment with sendMessage() flows
5. ✅ Test migration quantified: 155 tests, 25.5h, automated script

**All medium priority issues addressed:**
6. ✅ [FROM] auto-fill logic and error messages
7. ✅ TEAM_TASK duplication resolved (strip from context)

**All suggested additions completed:**
8. ✅ New entry point chapter
9. ✅ Strip markers implementation
10. ✅ Token budget details
11. ✅ Test migration details
12. ✅ Routing flow explanation

---

## Round 5 Updates (Version 4.0)

### Main Issues Fixed

**1. Routing Queue Data Reuse (CRITICAL)**
- **Problem:** `routeToNext()` was re-parsing `message.content`, causing potential inconsistency with already-parsed routing data
- **Fix:** Changed to reuse `message.routing.resolvedAddressees` from ConversationMessage
- **Impact:** Eliminates double-parsing, ensures consistency between user input and AI response routing
- **Code:** Lines 519-564 in ConversationCoordinator

**2. PromptBuilder Assembly Order**
- **Problem:** Used array reordering with magic indexes (`sections[sections.length - 2]`) which is error-prone
- **Fix:** Changed to direct sequential assembly (SYSTEM → TEAM_TASK → CONTEXT → MESSAGE)
- **Impact:** Improved code readability, eliminated index calculation risks
- **Code:** Lines 661-710 in PromptBuilder

**3. Token Budget Overhead Clarification**
- **Problem:** `teamTaskBytes` calculation didn't clearly state header inclusion
- **Fix:** Added explicit comment: "includes `[TEAM_TASK]\n` header" and updated budget example with separator bytes
- **Impact:** Clear byte accounting, no ambiguity on what's included
- **Code:** Lines 670-800

**4. Strip Function Line Structure Preservation**
- **Problem:** `replace(/\s+/g, ' ')` was compressing multi-line content (breaking code blocks/lists)
- **Fix:** Changed to `replace(/\s{2,}/g, ' ')` - only collapse 2+ spaces, preserve line structure
- **Impact:** Maintains formatting for code snippets and structured text in messages
- **Code:** Lines 283-342 in MessageRouter

**5. User-Visible Warnings**
- **Problem:** `updateTeamTask()` truncation only logged to DEBUG, no user notification
- **Fix:** Added `console.warn()` for user-visible warning when task exceeds 5KB
- **Impact:** Users are informed when their team task is truncated
- **Code:** Lines 493-514

**6. Error Message Consistency**
- **Problem:** Used `❌` emoji which may have encoding/terminal compatibility issues
- **Fix:** Replaced with plain text "Error: " prefix for all error messages
- **Impact:** Better compatibility across terminals, consistent with CLI conventions
- **Code:** Lines 442-490, 916-919

### Minor Improvements

**7. TEAM_TASK Deduplication Documentation**
- Added explicit section explaining `stripAllMarkersForContext()` is ALWAYS used for context
- Included before/after example showing TEAM_TASK removed from history
- **Code:** Lines 812-838

**8. ConversationMessage Data Structure**
- Clarified that routing metadata is stored in `message.routing.resolvedAddressees`
- This is the authoritative source for routing decisions, not re-parsing content
- **Referenced:** Lines 520-522

### Implementation Status

All architectural concerns from Round 5 review addressed:
- ✅ Routing data reuse (no double-parse)
- ✅ Prompt assembly order (no magic indexes)
- ✅ Token budget overhead explicit
- ✅ Strip preserves line structure
- ✅ User-visible truncation warnings
- ✅ Error messages plain-text compatible

**Document ready for implementation.**
