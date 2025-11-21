# Adapter Self-Contained Refactor - Design Proposal

> 更新（2025-11-21）：运行时已改为 JSONL 完成事件并移除 `endMarker` 依赖，本文中的 endMarker 字段为历史描述，将逐步清理。

**Status:** Revision 4 (Addressing Third Round Review)
**Date:** 2025-11-21
**Author:** Product Team
**Reviewer:** Architecture Committee

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-21 | Initial proposal submitted to architecture committee |
| 2.0 | 2025-11-21 | **First Round Review Response:**<br>• Added "AdapterFactory Implementation" section clarifying `config.type` usage<br>• Added "ProcessManager SendOptions Integration" section with merge strategy<br>• Extended IAgentAdapter interface with `prepareMessage()` and `getDefaultEndMarker()`<br>• Updated Architecture Decision Record with new decisions<br>• Updated Open Questions to mark items 1-2 as RESOLVED |
| 3.0 | 2025-11-21 | **Second Round Review Response:**<br>• **CRITICAL FIX:** Corrected Strategy B timing - `prepareMessage()` called during `sendAndReceive()`, NOT during `spawn()`<br>• **ADDED:** Comprehensive "Code Migration Plan" section with:<br>  - Current implementation flow diagram<br>  - Required code changes for each file<br>  - Before/after code comparisons<br>  - Migration summary table<br>  - Test impact analysis<br>• Clarified that `spawn()` only sets up process, user messages sent later via stdin<br>• Documented exact integration points with existing code (ConversationCoordinator, AgentManager, ProcessManager) |
| 4.0 | 2025-11-21 | **Third Round Review Response - CRITICAL IMPLEMENTATION FIXES:**<br>• **CRITICAL FIX #1:** systemInstruction storage location<br>  - ❌ Removed incorrect approach: `(childProcess as any).__systemInstruction`<br>  - ✅ Correct approach: Store in `AgentInstance.systemInstruction`<br>  - Added explicit comments explaining AgentManager.sendAndReceive() accesses AgentInstance, NOT childProcess<br>• **CRITICAL FIX #2:** stdout interception mechanism<br>  - ❌ Removed incorrect approach: `childProcess.stdout = transformedStdout` (readonly property)<br>  - ✅ Correct approach: Use `childProcess.stdout.pipe(transformedStdout)` + return in `customStreams`<br>  - Extended `AgentSpawnResult` interface with `customStreams?: { stdout?, stderr? }`<br>  - Extended `ProcessManager.registerProcess()` to accept and monitor custom streams<br>• Updated Migration Summary to reflect correct architectural flow<br>• Renumbered steps to include ProcessManager.registerProcess() modification |

---

## Executive Summary

Current adapter architecture has a critical design flaw: **OpenAICodexAdapter and GenericShellAdapter depend on external wrapper scripts** that are not distributed with the npm package, creating an unacceptable user experience. This proposal refactors all adapters to be self-contained, eliminating the dependency on external wrapper scripts.

---

## Problem Analysis

### Current State

We support three agent types with three different adapter implementations:

| Agent Type | Adapter | System Instruction Handling | Issues |
|-----------|---------|----------------------------|--------|
| Claude Code | `ClaudeCodeAdapter` | ✅ Uses native `--append-system-prompt` parameter | None - works correctly |
| OpenAI Codex | `OpenAICodexAdapter` | ❌ Sets `env.AGENT_SYSTEM_INSTRUCTION`, relies on external wrapper | **Broken UX** |
| Google Gemini | `GenericShellAdapter` | ❌ Sets `env.AGENT_SYSTEM_INSTRUCTION`, relies on external wrapper | **Broken UX** |

### Critical UX Problems

**Problem 1: Wrapper Scripts Not Distributed**
- Wrapper scripts exist in `user-guide/wrappers/` directory
- This directory is excluded from `.gitignore` and may not be in npm package
- Even if included, users must manually:
  1. Find the wrapper script
  2. Copy it to `~/.local/bin/` or similar
  3. Make it executable
  4. Update agent registry to point to wrapper

**Problem 2: User Expectation Violated**
- Users expect: `npm install -g @testany/agent-chatter` → ready to use
- Reality: Additional manual steps required for codex/gemini
- **This is completely unacceptable**

**Problem 3: Architectural Inconsistency**
- ClaudeCodeAdapter: Self-contained ✅
- OpenAICodexAdapter: Depends on external wrapper ❌
- GenericShellAdapter: Depends on external wrapper ❌

**Problem 4: Wrapper Script Role Confusion**
- Design documents say: "Wrapper scripts are reference implementations"
- Actual code says: "Wrapper scripts are required for systemInstruction to work"
- User experience says: "One npm install should be enough"

### Root Cause

**Responsibility Split Incorrectly:**
- Adapter handles: spawning process, environment variables
- Wrapper script handles: system instruction formatting, end marker appending
- **Result:** Adapter cannot work without wrapper

**Correct Architecture:**
- Adapter should handle: **everything** - spawning, system instruction, end marker, protocol adaptation
- Wrapper scripts should be: **optional examples** for advanced users only

---

## Proposed Solution

### Design Principles

1. **Self-Contained Adapters**: Every adapter must work with only the agent's native CLI, no external scripts required
2. **CLI-Specific Handling**: Adapt to each CLI's capabilities and limitations
3. **User-Transparent**: `npm install -g @testany/agent-chatter` is the only required step
4. **Wrapper Optional**: Wrapper scripts remain as reference examples, not production dependencies

### Adapter Implementation Strategy

#### Strategy A: CLI Has Native System Prompt Parameter

**Applicable to:** Claude Code

**Implementation:**
```typescript
// ClaudeCodeAdapter.spawn()
if (config.systemInstruction) {
  args.push('--append-system-prompt', config.systemInstruction);
}
```

**No changes needed** - ClaudeCodeAdapter already implements this correctly.

---

#### Strategy B: CLI Accepts Prompt via Argument/Stdin Only

**Applicable to:** OpenAI Codex, Google Gemini

**Two-Stage Implementation:**

**Stage 1: spawn() - Process Setup and Stream Interception**
```typescript
async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
  // 1. Spawn process with basic configuration
  // NOTE: We do NOT construct the full prompt here because we don't have the user message yet!
  const childProcess = spawn(this.command, args, {
    cwd: config.workDir,
    env: config.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // 2. Create PassThrough stream to intercept stdout and append [DONE]
  const transformedStdout = new PassThrough();

  // Pipe original stdout to transformed stream
  childProcess.stdout!.pipe(transformedStdout, { end: false });

  let buffer = '';
  childProcess.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
  });

  // When original stdout ends, append [DONE] if not present
  childProcess.stdout!.on('end', () => {
    if (!buffer.trim().endsWith('[DONE]')) {
      transformedStdout.write('\n[DONE]\n');
    }
    transformedStdout.end();
  });

  // 3. Return custom stdout stream for ProcessManager to monitor
  // NOTE: We do NOT store systemInstruction on childProcess!
  // systemInstruction will be stored in AgentInstance by AgentManager.ensureAgentStarted()
  return {
    process: childProcess,
    cleanup: async () => { /* ... */ },
    customStreams: {
      stdout: transformedStdout  // ProcessManager will monitor this instead of childProcess.stdout
    }
  };
}
```

**Stage 2: prepareMessage() - Message Construction**
```typescript
prepareMessage(message: string, systemInstruction?: string): string {
  // Called by AgentManager.sendAndReceive() for each message
  if (!systemInstruction) {
    return message;
  }

  // Prepend [SYSTEM] section to the message
  return `[SYSTEM]\n${systemInstruction}\n\n${message}`;
}
```

**Key Point:** System instruction is NOT included during spawn(), but rather prepended to each message when sending via stdin. This matches the actual implementation where:
- `spawn()` only initializes the process (no user message available)
- User messages are sent via `AgentManager.sendAndReceive()` → `ProcessManager.sendAndReceive()` → stdin

---

## AdapterFactory Implementation

### Correct Field for Adapter Type Detection

**Current Implementation (CORRECT):**
```typescript
// src/adapters/AdapterFactory.ts
export class AdapterFactory {
  static createAdapter(config: AgentConfig): IAgentAdapter {
    // ✅ CORRECT: Use config.type (agent type like "claude-code", "openai-codex")
    // ❌ WRONG: Using config.name (user-defined ID like "claude-dev", "claude-prod")
    switch (config.type) {
      case 'claude-code':
        return new ClaudeCodeAdapter(config.command);

      case 'openai-codex':
        return new OpenAICodexAdapter(config.command);

      case 'google-gemini':
      case 'gemini':
        return new GenericShellAdapter({
          agentType: 'google-gemini',
          command: config.command,
          defaultArgs: []
        });

      default:
        return new GenericShellAdapter({
          agentType: config.type,
          command: config.command,
          defaultArgs: []
        });
    }
  }
}
```

**Rationale:**
- `config.name`: User-defined configuration ID (e.g., "claude-dev", "claude-prod", "my-custom-codex")
- `config.type`: Agent type identifier (e.g., "claude-code", "openai-codex", "google-gemini")
- Adapter selection MUST be based on agent type, not user-defined name

**Example:**
```json
{
  "name": "claude-dev",           // ❌ User-defined, varies per config
  "type": "claude-code",          // ✅ Agent type, consistent
  "command": "/usr/local/bin/claude"
}
```

Using `config.name` would fail to match "claude-dev" → would fall through to default adapter → incorrect behavior.

---

## ProcessManager SendOptions Integration

### Preserving Existing SendOptions Behavior

The refactor must preserve all existing ProcessManager SendOptions functionality:

```typescript
export interface SendOptions {
  timeout?: number;              // Total timeout (default: 30000ms)
  endMarker?: string;            // Response end marker (e.g., "[DONE]")
  idleTimeout?: number;          // Idle timeout (default: 3000ms)
  useEndOfMessageMarker?: boolean;  // Add [END_OF_MESSAGE] for test agents
}
```

### Integration Strategy

**Adapter Configuration + SendOptions Merge:**

1. **Adapter provides default behavior:**
   - ClaudeCodeAdapter: Native `--append-system-prompt`, relies on Claude's natural completion
   - OpenAICodexAdapter: Prepends `[SYSTEM]`, appends `[DONE]` marker to stdout
   - GenericShellAdapter: Configurable based on CLI capabilities

2. **ProcessManager respects SendOptions overrides:**
   - `endMarker` from SendOptions takes precedence over adapter's default
   - `useEndOfMessageMarker` for test agents is independent of adapter behavior
   - `timeout` and `idleTimeout` are ProcessManager-level controls

**Pseudo-code:**
```typescript
// AgentManager.sendMessage()
async sendMessage(memberId: string, message: string, options?: SendOptions): Promise<string> {
  const agent = this.agents.get(memberId);
  const adapter = agent.adapter;

  // 1. Adapter prepares message (handles system instruction)
  const preparedMessage = adapter.prepareMessage(message, agent.systemInstruction);

  // 2. Merge adapter config with SendOptions
  const effectiveEndMarker = options?.endMarker ?? adapter.getDefaultEndMarker();
  const effectiveTimeout = options?.timeout ?? 30000;

  const sendOptions: SendOptions = {
    endMarker: effectiveEndMarker,
    timeout: effectiveTimeout,
    idleTimeout: options?.idleTimeout,
    useEndOfMessageMarker: options?.useEndOfMessageMarker  // Test agents only
  };

  // 3. ProcessManager.sendAndReceive uses merged options
  return await this.processManager.sendAndReceive(
    agent.processId,
    preparedMessage,
    sendOptions
  );
}
```

### Adapter Interface Extension

```typescript
export interface IAgentAdapter {
  readonly agentType: string;

  getDefaultArgs(): string[];

  async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult>;

  async validate(): Promise<boolean>;

  /**
   * Prepare message for sending to agent process
   * Handles system instruction prepending if needed
   */
  prepareMessage(message: string, systemInstruction?: string): string;

  /**
   * Get default end marker for this adapter
   * Can be overridden by SendOptions.endMarker
   */
  getDefaultEndMarker(): string;
}
```

### Adapter Implementations

**ClaudeCodeAdapter:**
```typescript
prepareMessage(message: string, _systemInstruction?: string): string {
  // System instruction already passed via --append-system-prompt in spawn()
  return message;
}

getDefaultEndMarker(): string {
  return '[DONE]';  // Claude Code outputs this naturally
}
```

**OpenAICodexAdapter:**
```typescript
prepareMessage(message: string, systemInstruction?: string): string {
  if (!systemInstruction) {
    return message;
  }

  return `[SYSTEM]\n${systemInstruction}\n\n[MESSAGE]\n${message}`;
}

getDefaultEndMarker(): string {
  return '[DONE]';  // Adapter appends this to stdout
}
```

### Test Agent Compatibility

**Existing test agents using `[END_OF_MESSAGE]`:**

```typescript
// Test scenario
const response = await agentManager.sendMessage(
  'test-agent-id',
  'Hello',
  { useEndOfMessageMarker: true, endMarker: '[END_OF_MESSAGE]' }
);
```

**ProcessManager behavior (UNCHANGED):**
```typescript
// ProcessManager.sendAndReceive()
if (options?.useEndOfMessageMarker) {
  content += '\n[END_OF_MESSAGE]';  // Appended to stdin
}

// Wait for response with endMarker
const effectiveEndMarker = options?.endMarker ?? '[DONE]';
// ... wait for effectiveEndMarker in stdout ...
```

**Result:** Test agents continue to work with `[END_OF_MESSAGE]` marker, unaffected by adapter changes.

### Migration Impact

**No breaking changes:**
- ✅ Existing SendOptions parameters all preserved
- ✅ Test agents using `useEndOfMessageMarker` continue to work
- ✅ Custom `endMarker` overrides adapter defaults
- ✅ `timeout` and `idleTimeout` behavior unchanged

**New capability:**
- ✅ Adapters can provide sensible defaults (e.g., `[DONE]`)
- ✅ Adapters handle system instruction prepending
- ✅ No dependency on external wrapper scripts

---

## Code Migration Plan

### Current Implementation Flow

**Message Flow (from user input to agent process):**
```
ConversationCoordinator.sendToAgent(member, message)
  ├─> buildAgentMessage(member, message)
  │     └─> Constructs: [CONTEXT]\n{history}\n\n[MESSAGE]\n{message}
  │         NOTE: Does NOT include systemInstruction (comment says "handled by adapter layer")
  │
  ├─> agentManager.ensureAgentStarted(member.id, agentConfigId, memberConfig)
  │     ├─> memberConfig = { workDir, env, additionalArgs, systemInstruction }
  │     ├─> adapter = AdapterFactory.createAdapter(config)
  │     ├─> spawnConfig = { ...memberConfig, systemInstruction }
  │     └─> adapter.spawn(spawnConfig)
  │           └─> ClaudeCodeAdapter: Uses --append-system-prompt ✅
  │           └─> OpenAICodexAdapter: Sets env.AGENT_SYSTEM_INSTRUCTION ❌ (expects wrapper)
  │           └─> GenericShellAdapter: Sets env.AGENT_SYSTEM_INSTRUCTION ❌ (expects wrapper)
  │
  └─> agentManager.sendAndReceive(member.id, fullMessage)
        └─> processManager.sendAndReceive(processId, message, sendOptions)
              └─> Writes message to stdin (NO PREPROCESSING!)
                    ❌ For Codex/Gemini: systemInstruction is NEVER sent!
```

**Problem:** `systemInstruction` is passed to `adapter.spawn()` but never used during message sending for Codex/Gemini adapters.

### Required Code Changes

#### 1. Extend IAgentAdapter Interface and AgentSpawnResult

**File:** `src/adapters/IAgentAdapter.ts`

**Current AgentSpawnResult:**
```typescript
export interface AgentSpawnResult {
  process: ChildProcess;
  cleanup: () => Promise<void>;
}
```

**New AgentSpawnResult (add customStreams):**
```typescript
export interface AgentSpawnResult {
  process: ChildProcess;
  cleanup: () => Promise<void>;

  /**
   * Custom streams for ProcessManager to monitor
   * If provided, ProcessManager will listen to these instead of process.stdout/stderr
   * This allows adapters to intercept and transform output (e.g., append [DONE] marker)
   */
  customStreams?: {
    stdout?: Readable;
    stderr?: Readable;
  };
}
```

**Current IAgentAdapter Interface:**
```typescript
export interface IAgentAdapter {
  readonly agentType: string;
  readonly command: string;
  spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult>;
  validate(): Promise<boolean>;
  getDefaultArgs(): string[];
}
```

**New IAgentAdapter Interface (add two methods):**
```typescript
export interface IAgentAdapter {
  readonly agentType: string;
  readonly command: string;
  spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult>;
  validate(): Promise<boolean>;
  getDefaultArgs(): string[];

  /**
   * Prepare message for sending to agent process
   * Handles system instruction prepending if needed
   *
   * @param message - The message to send (may include [CONTEXT] and [MESSAGE] sections)
   * @param systemInstruction - Optional system instruction to prepend
   * @returns Prepared message ready for stdin
   */
  prepareMessage(message: string, systemInstruction?: string): string;

  /**
   * Get default end marker for this adapter
   * Can be overridden by SendOptions.endMarker
   *
   * @returns End marker string (e.g., "[DONE]")
   */
  getDefaultEndMarker(): string;
}
```

#### 2. Update ProcessManager to Support Custom Streams

**File:** `src/infrastructure/ProcessManager.ts`

**Current registerProcess() signature (line 115):**
```typescript
registerProcess(childProcess: ChildProcess, config: ProcessConfig): string
```

**New registerProcess() signature:**
```typescript
registerProcess(
  childProcess: ChildProcess,
  config: ProcessConfig,
  customStreams?: { stdout?: Readable; stderr?: Readable }
): string
```

**Update stdout/stderr monitoring (lines 137-157):**
```typescript
// Current implementation - monitors childProcess.stdout directly
childProcess.stdout?.on('data', (data: Buffer) => {
  const output = data.toString();
  const callback = this.outputCallbacks.get(processId);
  if (callback) {
    callback(output);
  } else {
    managed.outputBuffer += output;
  }
});

// 🆕 New implementation - use customStreams if provided
const stdoutStream = customStreams?.stdout || childProcess.stdout;
const stderrStream = customStreams?.stderr || childProcess.stderr;

stdoutStream?.on('data', (data: Buffer) => {
  const output = data.toString();
  const callback = this.outputCallbacks.get(processId);
  if (callback) {
    callback(output);
  } else {
    managed.outputBuffer += output;
  }
});

stderrStream?.on('data', (data: Buffer) => {
  const error = data.toString();
  const callback = this.outputCallbacks.get(processId);
  if (callback) {
    callback(error);
  } else {
    managed.outputBuffer += error;
  }
});
```

#### 3. Update AgentManager to Store systemInstruction and Pass customStreams

**File:** `src/services/AgentManager.ts`

**Current AgentInstance:**
```typescript
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  cleanup?: () => Promise<void>;
}
```

**New AgentInstance (add adapter and systemInstruction):**
```typescript
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  cleanup?: () => Promise<void>;
  adapter: IAgentAdapter;  // 🆕 Store adapter for prepareMessage()
  systemInstruction?: string;  // 🆕 Store for use in sendAndReceive()
}
```

**Update ensureAgentStarted():**
```typescript
// Line 95 (current)
const spawnResult = await adapter.spawn(spawnConfig);

const processId = this.processManager.registerProcess(spawnResult.process, {
  command: config.command,
  args: config.args || [],
  env: config.env,
  cwd: spawnConfig.workDir
});

// Line 106 (current)
this.agents.set(roleId, {
  roleId,
  configId,
  processId,
  cleanup: spawnResult.cleanup
});

// 🆕 New implementation
const spawnResult = await adapter.spawn(spawnConfig);

// Pass customStreams to ProcessManager if adapter provides them
const processId = this.processManager.registerProcess(
  spawnResult.process,
  {
    command: config.command,
    args: config.args || [],
    env: config.env,
    cwd: spawnConfig.workDir
  },
  spawnResult.customStreams  // 🆕 Pass custom streams for [DONE] marker injection
);

// 🆕 Store adapter and systemInstruction in AgentInstance
// CRITICAL: systemInstruction MUST be stored here, NOT on childProcess!
// AgentManager.sendAndReceive() will access it from agent.systemInstruction
this.agents.set(roleId, {
  roleId,
  configId,
  processId,
  cleanup: spawnResult.cleanup,
  adapter: adapter,  // Store adapter for prepareMessage()
  systemInstruction: memberConfig?.systemInstruction  // Store for use in sendAndReceive()
});
```

#### 4. Update AgentManager.sendAndReceive() to Use prepareMessage()

**File:** `src/services/AgentManager.ts`

**Current Implementation (lines 119-143):**
```typescript
async sendAndReceive(
  roleId: string,
  message: string,
  options?: Partial<SendOptions>
): Promise<string> {
  const agent = this.agents.get(roleId);
  if (!agent) {
    throw new Error(`Role ${roleId} has no running agent`);
  }

  const config = await this.agentConfigManager.getAgentConfig(agent.configId);

  const sendOptions: SendOptions = {
    timeout: options?.timeout,
    endMarker: options?.endMarker || config?.endMarker,
    useEndOfMessageMarker: config?.useEndOfMessageMarker || false
  };

  return this.processManager.sendAndReceive(
    agent.processId,
    message,  // ❌ Original message, no preprocessing
    sendOptions
  );
}
```

**New Implementation:**
```typescript
async sendAndReceive(
  roleId: string,
  message: string,
  options?: Partial<SendOptions>
): Promise<string> {
  const agent = this.agents.get(roleId);
  if (!agent) {
    throw new Error(`Role ${roleId} has no running agent`);
  }

  const config = await this.agentConfigManager.getAgentConfig(agent.configId);

  // 🆕 Prepare message using adapter
  const preparedMessage = agent.adapter.prepareMessage(message, agent.systemInstruction);

  // 🆕 Get default end marker from adapter
  const defaultEndMarker = agent.adapter.getDefaultEndMarker();

  const sendOptions: SendOptions = {
    timeout: options?.timeout,
    endMarker: options?.endMarker || config?.endMarker || defaultEndMarker,
    useEndOfMessageMarker: config?.useEndOfMessageMarker || false
  };

  return this.processManager.sendAndReceive(
    agent.processId,
    preparedMessage,  // ✅ Prepared message with [SYSTEM] if needed
    sendOptions
  );
}
```

#### 5. Implement prepareMessage() and getDefaultEndMarker() in All Adapters

**File:** `src/adapters/ClaudeCodeAdapter.ts`

```typescript
prepareMessage(message: string, _systemInstruction?: string): string {
  // System instruction already passed via --append-system-prompt in spawn()
  // No need to prepend it here
  return message;
}

getDefaultEndMarker(): string {
  return '[DONE]';
}
```

**File:** `src/adapters/OpenAICodexAdapter.ts`

```typescript
prepareMessage(message: string, systemInstruction?: string): string {
  if (!systemInstruction) {
    return message;
  }

  // Prepend [SYSTEM] section
  return `[SYSTEM]\n${systemInstruction}\n\n${message}`;
}

getDefaultEndMarker(): string {
  return '[DONE]';
}
```

**File:** `src/adapters/GenericShellAdapter.ts`

```typescript
prepareMessage(message: string, systemInstruction?: string): string {
  if (!systemInstruction) {
    return message;
  }

  // Prepend [SYSTEM] section
  return `[SYSTEM]\n${systemInstruction}\n\n${message}`;
}

getDefaultEndMarker(): string {
  return '[DONE]';
}
```

#### 6. Remove Wrapper Script Dependency from OpenAICodexAdapter

**File:** `src/adapters/OpenAICodexAdapter.ts`

**Current spawn():**
```typescript
async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
  const env = { ...process.env, ...config.env };

  // ❌ Sets environment variable, expects wrapper to read it
  if (config.systemInstruction) {
    env.AGENT_SYSTEM_INSTRUCTION = config.systemInstruction;
  }

  const childProcess = spawn(this.command, args, {
    cwd: config.workDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return { process: childProcess, cleanup: ... };
}
```

**New spawn():**
```typescript
async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
  const env = { ...process.env, ...config.env };

  // ❌ REMOVED: No longer set AGENT_SYSTEM_INSTRUCTION
  // systemInstruction will be stored in AgentInstance and used by prepareMessage()

  const childProcess = spawn(this.command, args, {
    cwd: config.workDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // 🆕 Intercept stdout to append [DONE] marker
  const transformedStdout = new PassThrough();

  // Pipe original stdout to transformed stream
  childProcess.stdout!.pipe(transformedStdout, { end: false });

  let buffer = '';
  childProcess.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
  });

  // When original stdout ends, append [DONE] if not present
  childProcess.stdout!.on('end', () => {
    if (!buffer.trim().endsWith('[DONE]')) {
      transformedStdout.write('\n[DONE]\n');
    }
    transformedStdout.end();
  });

  // Return custom stdout stream for ProcessManager to monitor
  return {
    process: childProcess,
    cleanup: async () => { /* ... */ },
    customStreams: {
      stdout: transformedStdout
    }
  };
}
```

### Migration Summary

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `AgentSpawnResult` | **Interface Extension** | Add optional `customStreams: { stdout?, stderr? }` field |
| `IAgentAdapter` | **Interface Extension** | Add `prepareMessage()` and `getDefaultEndMarker()` methods |
| `ProcessManager.registerProcess()` | **Signature Change** | Add optional `customStreams` parameter for stream interception |
| `ProcessManager` event monitoring | **Logic Change** | Monitor `customStreams.stdout/stderr` if provided, else `childProcess.stdout/stderr` |
| `AgentManager.AgentInstance` | **Data Structure** | Add `adapter` and `systemInstruction` fields |
| `AgentManager.ensureAgentStarted()` | **Storage & Integration** | Store adapter and systemInstruction in AgentInstance; pass customStreams to ProcessManager |
| `AgentManager.sendAndReceive()` | **Logic Change** | Call `adapter.prepareMessage()` before sending to ProcessManager |
| `ClaudeCodeAdapter` | **Method Addition** | Implement `prepareMessage()` (no-op) and `getDefaultEndMarker()` |
| `OpenAICodexAdapter.spawn()` | **Behavior Change** | Remove env.AGENT_SYSTEM_INSTRUCTION, create PassThrough stream, return customStreams |
| `OpenAICodexAdapter` | **Method Addition** | Implement `prepareMessage()` (prepend [SYSTEM]) and `getDefaultEndMarker()` |
| `GenericShellAdapter` | **Method Addition** | Implement `prepareMessage()` (prepend [SYSTEM]), `getDefaultEndMarker()`, and stdout interception |

**Key Architectural Changes:**
1. **systemInstruction Flow:** spawn() → AgentInstance storage → sendAndReceive() → prepareMessage()
2. **Stream Interception:** adapter.spawn() creates PassThrough → returns in customStreams → ProcessManager monitors custom stream

### Test Impact

**Existing tests affected:**
- `AgentManager` unit tests: Need to mock new adapter methods
- `ClaudeCodeAdapter` tests: Need to test `prepareMessage()` returns message unchanged
- `OpenAICodexAdapter` tests: Need to test `prepareMessage()` prepends [SYSTEM] section
- Integration tests: Should pass without changes (behavior is the same, just correctly implemented)

**New tests needed:**
- Test that `prepareMessage()` correctly handles systemInstruction for each adapter type
- Test that `getDefaultEndMarker()` returns correct values
- Test that AgentManager stores and uses systemInstruction correctly

---

## Detailed Implementation Plan

### Phase 1: Refactor OpenAICodexAdapter

**Current Implementation (WRONG):**
```typescript
// src/adapters/OpenAICodexAdapter.ts
async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
  const env = { ...process.env, ...config.env };

  // Sets environment variable, expects wrapper to read it
  if (config.systemInstruction) {
    env.AGENT_SYSTEM_INSTRUCTION = config.systemInstruction;
  }

  const childProcess = spawn(this.command, args, {
    cwd: config.workDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return { process: childProcess, cleanup: ... };
}
```

**New Implementation (CORRECT):**
```typescript
// src/adapters/OpenAICodexAdapter.ts
import { PassThrough } from 'stream';

export class OpenAICodexAdapter implements IAgentAdapter {
  readonly agentType = 'openai-codex';

  constructor(public readonly command: string) {}

  getDefaultArgs(): string[] {
    return ['exec', '--json', '--full-auto', '--skip-git-repo-check'];
  }

  async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
    const args = [...this.getDefaultArgs()];

    // Add additional arguments from member config
    if (config.additionalArgs && config.additionalArgs.length > 0) {
      args.push(...config.additionalArgs);
    }

    const env = { ...process.env, ...config.env };

    // Spawn process with stdin for prompt
    const childProcess = spawn(this.command, args, {
      cwd: config.workDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Store system instruction for later use when sending messages
    // ProcessManager will need to be updated to handle this
    (childProcess as any).__systemInstruction = config.systemInstruction;

    // Intercept stdout to append [DONE] marker
    const originalStdout = childProcess.stdout!;
    const transformedStdout = new PassThrough();

    let buffer = '';
    originalStdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      buffer += text;
      transformedStdout.write(chunk);
    });

    originalStdout.on('end', () => {
      // Append [DONE] marker if not already present
      if (!buffer.trim().endsWith('[DONE]')) {
        transformedStdout.write('\n[DONE]\n');
      }
      transformedStdout.end();
    });

    // Replace stdout with transformed stream
    childProcess.stdout = transformedStdout as any;

    return {
      process: childProcess,
      cleanup: async () => { /* same as before */ }
    };
  }

  async validate(): Promise<boolean> {
    try {
      await execAsync(`${this.command} --version`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
```

**ProcessManager Changes Required:**

The ProcessManager needs to prepend system instruction when sending messages to codex:

```typescript
// src/infrastructure/ProcessManager.ts
async sendAndReceive(processId: string, message: string): Promise<string> {
  const proc = this.processes.get(processId);
  if (!proc) throw new Error('Process not found');

  // Check if this process has a system instruction
  const systemInstruction = (proc.process as any).__systemInstruction;

  let fullMessage = message;
  if (systemInstruction) {
    fullMessage = `[SYSTEM]\n${systemInstruction}\n\n[MESSAGE]\n${message}`;
  }

  // Send to stdin
  proc.process.stdin?.write(fullMessage + '\n');
  proc.process.stdin?.end();

  // Wait for response...
}
```

---

### Phase 2: Refactor GenericShellAdapter (Gemini)

**Same approach as OpenAICodexAdapter:**
- Prepend system instruction to prompt
- Append `[DONE]` marker to output
- No dependency on wrapper scripts

**Implementation:** Identical pattern to OpenAICodexAdapter refactor.

---

### Phase 3: Update Documentation

**Changes to `CLAUDE.md`:**
- Remove statement that wrapper scripts are required
- Clarify: "Wrapper scripts in `user-guide/wrappers/` are reference implementations for advanced users only"
- Add: "All adapters are self-contained and do not require wrapper scripts"

**Changes to wrapper script README (create new):**
- `user-guide/wrappers/README.md`:
  ```markdown
  # Wrapper Scripts - Reference Implementations

  These wrapper scripts are **optional reference implementations** for advanced users.

  ## ⚠️ NOT REQUIRED

  The agent-chatter application **does not require these wrapper scripts** to function.
  All adapters are self-contained and work directly with native CLI tools.

  ## When to Use Wrappers

  - You want to customize prompt formatting
  - You need special preprocessing/postprocessing
  - You want to integrate with a custom AI CLI tool

  ## How to Use

  1. Copy the wrapper script to a location in your PATH (e.g., `~/.local/bin/`)
  2. Make it executable: `chmod +x ~/.local/bin/codex-wrapper`
  3. Register as an agent: `agent-chatter agents register my-custom-codex --command ~/.local/bin/codex-wrapper`
  ```

---

### Phase 4: Update Agent Registry Guide

**Document the correct way to register agents:**

```markdown
# Registering Agents

## Claude Code
\`\`\`bash
agent-chatter agents register claude --command $(which claude) --end-marker "[DONE]"
\`\`\`

## OpenAI Codex
\`\`\`bash
agent-chatter agents register codex --command $(which codex) --end-marker "[DONE]"
\`\`\`

## Google Gemini
\`\`\`bash
# If using official Gemini CLI (hypothetical)
agent-chatter agents register gemini --command $(which gemini) --end-marker "[DONE]"
\`\`\`

**Important:** Register the **native CLI command**, NOT a wrapper script.
Adapters handle all protocol details internally.
```

---

## Architecture Decision Record

### Decision: Adapter Responsibility

**Question:** Should adapters or wrapper scripts handle system instruction and protocol adaptation?

**Decision:** ✅ Adapters should be self-contained and handle everything.

**Rationale:**
1. **User Experience:** Users should only run `npm install -g @testany/agent-chatter`
2. **Maintainability:** One codebase (adapters) is easier to maintain than adapter + scattered wrapper scripts
3. **Consistency:** All adapters should follow the same responsibility model
4. **Testability:** Adapters can be unit-tested; wrapper scripts in user's PATH cannot

### Decision: Wrapper Script Role

**Question:** What is the role of wrapper scripts?

**Decision:** ✅ Optional reference implementations for advanced users only.

**Rationale:**
1. **Not a dependency:** Application works without them
2. **Educational:** Show advanced users how to customize
3. **Flexibility:** Users can create their own wrappers if needed

### Decision: System Instruction Formatting

**Question:** What format should we use for system instructions in CLIs without native support?

**Decision:** ✅ Use `[SYSTEM]\n{instruction}\n\n[MESSAGE]\n{prompt}` format.

**Rationale:**
1. **Clear separation:** Distinguishes system instruction from user message
2. **Parseable:** AI models can recognize the structure
3. **Backward compatible:** If wrapper scripts exist, they use the same format
4. **Debuggable:** Easy to see in logs

### Decision: AdapterFactory Type Detection

**Question:** Should AdapterFactory use `config.name` or `config.type` for adapter selection?

**Decision:** ✅ Use `config.type` (agent type identifier).

**Rationale:**
1. **`config.name` is user-defined:** Users can name configs arbitrarily ("claude-dev", "my-codex")
2. **`config.type` is standardized:** Identifies agent type ("claude-code", "openai-codex")
3. **Reliability:** Type-based routing ensures correct adapter is always selected
4. **Extensibility:** New user configs work immediately without code changes

### Decision: SendOptions and Adapter Integration

**Question:** How should adapter-provided defaults integrate with existing ProcessManager SendOptions?

**Decision:** ✅ Adapters provide defaults, SendOptions override when specified.

**Rationale:**
1. **Backward compatibility:** All existing SendOptions parameters preserved
2. **Sensible defaults:** Adapters can specify appropriate end markers
3. **Flexibility:** Tests and special cases can override via SendOptions
4. **Clear precedence:** SendOptions → Adapter defaults → Hard-coded fallbacks
5. **Test compatibility:** `useEndOfMessageMarker` and custom markers continue to work

### Decision: systemInstruction Storage Location

**Question:** Where should systemInstruction be stored for use during message sending?

**Decision:** ✅ Store in `AgentInstance.systemInstruction`, NOT on childProcess object.

**Rationale:**
1. **Access pattern:** `AgentManager.sendAndReceive()` accesses `AgentInstance`, not `childProcess`
2. **Type safety:** childProcess is a Node.js ChildProcess, not designed for custom properties
3. **Separation of concerns:** Process management (ChildProcess) vs. agent configuration (AgentInstance)
4. **Data flow:** `spawn(config)` → `ensureAgentStarted()` stores in `AgentInstance` → `sendAndReceive()` reads from `AgentInstance`

**Rejected Alternative:** `(childProcess as any).__systemInstruction` - AgentManager cannot access this

### Decision: stdout Stream Interception Mechanism

**Question:** How should adapters intercept stdout to append `[DONE]` marker?

**Decision:** ✅ Use `pipe()` to create PassThrough stream, return via `customStreams`, ProcessManager monitors custom stream.

**Rationale:**
1. **Readonly constraint:** `ChildProcess.stdout` is readonly, cannot be reassigned
2. **Event listeners:** ProcessManager has already attached listeners to original stdout before adapter can modify
3. **Clean separation:** Adapter creates transformed stream, ProcessManager chooses which stream to monitor
4. **Extensibility:** `customStreams` pattern can support stderr transformation and future stream needs

**Rejected Alternative:** `childProcess.stdout = transformedStdout` - Violates readonly property, ProcessManager still monitors original stream

---

## Migration Plan

### For Existing Users

**Impact:** Minimal to none - users who registered codex/gemini with wrapper scripts can continue using them.

**Recommended Action:**
1. Delete old wrapper-based agent registration:
   ```bash
   agent-chatter agents delete codex
   ```

2. Re-register with native CLI:
   ```bash
   agent-chatter agents register codex --command $(which codex) --end-marker "[DONE]"
   ```

**Timeline:** Users can migrate at their convenience. Both approaches will work.

---

## Testing Plan

### Unit Tests

1. **ClaudeCodeAdapter** (no changes needed):
   - ✅ Verify `--append-system-prompt` is added when systemInstruction provided

2. **OpenAICodexAdapter** (new tests):
   - ✅ Verify system instruction is stored in process object
   - ✅ Verify `[DONE]` marker is appended to stdout
   - ✅ Verify ProcessManager prepends `[SYSTEM]` section to messages

3. **GenericShellAdapter** (new tests):
   - Same as OpenAICodexAdapter

### Integration Tests

1. **End-to-end with real CLIs:**
   - ✅ Claude: Verify systemInstruction works via `--append-system-prompt`
   - ✅ Codex: Verify systemInstruction is prepended to prompt
   - ✅ Verify `[DONE]` marker is received by ProcessManager

2. **UAT Scenario:**
   - Fresh install: `npm install -g @testany/agent-chatter`
   - Register agents with native CLIs (no wrappers)
   - Create team config with systemInstruction for each member
   - Start conversation and verify system instructions are respected

---

## Success Metrics

- ✅ Users can install and use agent-chatter with **zero manual steps** beyond `npm install -g`
- ✅ All three agent types (claude, codex, gemini) work with native CLI commands
- ✅ System instructions work correctly for all agent types
- ✅ No dependency on external wrapper scripts
- ✅ All 322+ tests passing

---

## Open Questions for Architecture Committee

### ✅ ADDRESSED (First Round Review - Revision 2):

1. **~~AdapterFactory Field Selection~~** → **RESOLVED**
   - **Issue:** Ensure AdapterFactory uses `config.type` (agent type), not `config.name` (user-defined ID)
   - **Resolution:** Section "AdapterFactory Implementation" added, confirming correct use of `config.type`

2. **~~SendOptions Integration~~** → **RESOLVED**
   - **Issue:** How do adapter defaults merge with existing ProcessManager SendOptions?
   - **Resolution:** Section "ProcessManager SendOptions Integration" added with merge strategy

### ✅ ADDRESSED (Second Round Review - Revision 3):

3. **~~Message Preparation Timing~~** → **RESOLVED**
   - **Issue:** Design incorrectly showed message construction during `spawn()`, but `spawn()` has no access to user messages
   - **Resolution:** Corrected Strategy B: `prepareMessage()` called during `AgentManager.sendAndReceive()`, NOT during `spawn()`

4. **~~Code Migration from Current Implementation~~** → **RESOLVED**
   - **Issue:** Design proposed new interfaces but didn't explain how to integrate with existing code
   - **Resolution:** Added complete "Code Migration Plan" section with implementation flow and migration table

### ✅ ADDRESSED (Third Round Review - Revision 4):

5. **~~systemInstruction Storage Location~~** → **RESOLVED**
   - **Issue:** Design incorrectly stored systemInstruction on childProcess object, but AgentManager.sendAndReceive() cannot access it
   - **Resolution:**
     - Removed `(childProcess as any).__systemInstruction = config.systemInstruction`
     - Corrected to store in `AgentInstance.systemInstruction` (AgentManager.ensureAgentStarted)
     - AgentManager.sendAndReceive() accesses via `agent.systemInstruction`
     - Added explicit comments explaining the data flow

6. **~~stdout Interception Implementation~~** → **RESOLVED**
   - **Issue:** Design incorrectly suggested `childProcess.stdout = transformedStdout` (readonly property, ProcessManager won't see it)
   - **Resolution:**
     - Use `childProcess.stdout.pipe(transformedStdout)` to create managed stream
     - Extended `AgentSpawnResult` with `customStreams?: { stdout?, stderr? }`
     - Extended `ProcessManager.registerProcess()` to accept customStreams parameter
     - ProcessManager monitors custom streams if provided, else original streams
     - Adapter returns `{ process, cleanup, customStreams }` from spawn()

### ⏳ PENDING:

7. **Backward Compatibility:** Should we maintain any support for users who have wrapper scripts? Or clean break?

8. **Error Handling:** If native CLI doesn't support our prompt format (e.g., rejects `[SYSTEM]` marker), how should we handle it?

9. **Gemini CLI:** We don't currently have gemini CLI for testing. Should we implement GenericShellAdapter refactor based on assumptions, or wait for actual gemini CLI investigation?

---

## Alternative Approaches Considered

### Alternative 1: Distribute Wrapper Scripts in npm Package

**Approach:** Include wrapper scripts in npm package, install to `node_modules/.bin/`

**Pros:**
- Wrapper scripts available after npm install
- No code changes to adapters needed

**Cons:**
- ❌ Users still need to register with wrapper path, not native CLI
- ❌ Doesn't solve the architecture inconsistency problem
- ❌ Adds complexity to package distribution

**Decision:** ❌ Rejected - doesn't solve the fundamental design problem

### Alternative 2: Auto-Register Agents on First Run

**Approach:** Application auto-detects and registers claude/codex/gemini on first run

**Pros:**
- Better UX - users don't manually register

**Cons:**
- ❌ Doesn't solve wrapper dependency problem
- ❌ Adds magic behavior that may surprise users
- ❌ Out of scope for this refactor

**Decision:** ❌ Rejected - consider separately as UX improvement

---

## Recommendation

**Proceed with the proposed refactor:**
1. Refactor OpenAICodexAdapter and GenericShellAdapter to be self-contained
2. Update ProcessManager to handle system instruction prepending
3. Update documentation to clarify wrapper scripts are optional
4. Keep wrapper scripts as reference examples only
5. All changes in a single release (0.0.15) to avoid partial migration state

**Estimated Effort:** 1-2 days of development + testing

**Risk:** Low - changes are localized to adapters and ProcessManager, with clear rollback path
