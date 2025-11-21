  Architecture Committee Review: UX-Driven Timeout with Configurable Safety Net

  ---

  ## Revision History

  | Version | Date | Status | Changes |
  |---------|------|--------|---------|
  | 1.0 | 2025-11-21 | Initial Proposal | Original design submitted to architecture committee |
  | 2.0 | 2025-11-21 | Second Round Response | • Fixed REPL entry point from App.tsx to ReplModeInk.tsx<br>• Added configuration schema and loading flow<br>• Aligned ConversationCoordinator with actual implementation<br>• Clarified AgentManager spawnConfig handling<br>• Clarified ProcessManager timeout relationship |
  | 3.0 | 2025-11-21 | Third Round Response | • Corrected loadConfig location - documented THREE entry points<br>• Corrected initializeServices return type<br>• Fixed buildAgentMessage description<br>• Corrected session data structure<br>• Added agent thinking signal mechanism |
  | 4.0 | 2025-11-21 | Fourth Round Response | • Aligned status machine design with existing implementation<br>• Extended InitializeServicesOptions interface |
  | 5.0 | 2025-11-21 | Fifth Round Response | • Made configuration drive UI behavior - checks showThinkingTimer and allowEscCancel<br>• Made timer display dynamic - calculate maxTimeoutMinutes from config |
  | 6.0 | 2025-11-21 | **In Review** | **Sixth Round Review Response:**<br>• **Fixed**: ThinkingIndicator now accepts `allowEscCancel` prop (line 515) and conditionally displays ESC hint (line 521-523) - shows "press ESC to cancel, auto-cancel at Xm" when enabled, shows only "auto-cancel at Xm" when disabled, preventing misleading UI hints when ESC is configured off |

  ---

  ## Summary

  Replace hardcoded 30-second timeout with:
  1. Real-time timer display + ESC cancellation (REPL mode)
  2. Configurable maximum timeout with 30-minute default (all modes)
  3. Proper cancellation flow handling

  Current Problem (v0.0.16)

  Error: Timeout waiting for response from process proc-xxx

  Root Cause: ProcessManager.sendAndReceive() has hardcoded 30-second timeout for stateful agents (Claude Code). Long-running tasks get killed prematurely.

  Proposed Solution

  Architecture: Three-Layer Timeout Strategy

  Layer 1 (REPL only): User-initiated cancellation (ESC key)
  Layer 2 (All modes): Configurable maximum timeout (default: 30 minutes)
  Layer 3 (Safety):    Process crash detection (exit handler)

  1. Configurable Maximum Timeout

  ## Configuration Schema Extension

  **Current State**: CLIConfig (src/utils/ConversationStarter.ts:73-78) only has:
  - `schemaVersion?: string`
  - `agents?: AgentDefinition[]`
  - `team: TeamConfig`
  - `maxRounds?: number`

  **Required Change**: Extend CLIConfig to add conversation-level configuration:

  ```typescript
  // src/utils/ConversationStarter.ts - EXTEND CLIConfig interface
  export interface ConversationConfig {
    maxAgentResponseTime?: number;  // 30 minutes (default: 1800000ms)
    showThinkingTimer?: boolean;    // Enable timer display (REPL only, default: true)
    allowEscCancel?: boolean;        // Enable ESC cancellation (REPL only, default: true)
  }

  export interface CLIConfig {
    schemaVersion?: string;
    agents?: AgentDefinition[];
    team: TeamConfig;
    maxRounds?: number;
    conversation?: ConversationConfig;  // NEW: Conversation-level configuration
  }
  ```

  ## Configuration File Location

  Team configuration files are stored at:
  - **Global**: `~/.agent-chatter/team-config/<team-name>.json`
  - **Local**: `.agent-chatter/team-config/<team-name>.json`

  Example configuration with timeout settings:
  ```json
  {
    "schemaVersion": "1.2",
    "team": {
      "name": "phoenix-dev",
      "displayName": "Phoenix Dev Team",
      "description": "Development team with long-running tasks",
      "members": [...]
    },
    "conversation": {
      "maxAgentResponseTime": 1800000,
      "showThinkingTimer": true,
      "allowEscCancel": true
    }
  }
  ```

  ## Configuration Loading Flow

  **IMPORTANT**: There is NO centralized `loadConfig()` in ConversationStarter. Configuration loading happens in THREE separate entry points:

  ### Entry Point 1: CLI Mode (src/cli.ts:103-126)

  ```typescript
  // src/cli.ts - loadConfig() function (MODIFY)
  function loadConfig(configPath: string): CLIConfig {
    const readConfig = (file: string): CLIConfig => {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const config: CLIConfig = JSON.parse(content);

        // NEW: Validate and apply defaults for conversation config
        if (!config.conversation) {
          config.conversation = {};
        }
        config.conversation.maxAgentResponseTime ??= 1800000;  // 30 min default
        config.conversation.showThinkingTimer ??= true;
        config.conversation.allowEscCancel ??= true;

        return config;
      } catch (error) {
        console.error(colorize(`Error: Failed to parse config file: ${error}`, 'red'));
        process.exit(1);
      }
    };

    const resolution = resolveTeamConfigPath(configPath);
    if (!resolution.exists) {
      console.error(colorize(formatMissingConfigError(configPath, resolution), 'red'));
      process.exit(1);
    }
    return readConfig(resolution.path);
  }
  ```

  ### Entry Point 2: REPL Mode (src/repl/ReplMode.ts:247-270)

  ```typescript
  // src/repl/ReplMode.ts - private loadConfig() method (MODIFY)
  private loadConfig(filePath: string): boolean {
    try {
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        console.log(c(`Error: Configuration file not found: ${filePath}`, 'red'));
        return false;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const config: CLIConfig = JSON.parse(content);

      // NEW: Validate and apply defaults for conversation config
      if (!config.conversation) {
        config.conversation = {};
      }
      config.conversation.maxAgentResponseTime ??= 1800000;
      config.conversation.showThinkingTimer ??= true;
      config.conversation.allowEscCancel ??= true;

      this.currentConfig = config;
      this.currentConfigPath = filePath;
      return true;
    } catch (error) {
      console.log(c(`Error: Failed to load configuration: ${error}`, 'red'));
      return false;
    }
  }
  ```

  ### Entry Point 3: REPL Ink Mode (src/repl/ReplModeInk.tsx:1444-1470)

  ```typescript
  // src/repl/ReplModeInk.tsx - loadConfig() closure (MODIFY)
  const loadConfig = (filePath: string) => {
    try {
      const resolution = resolveTeamConfigPath(filePath);
      if (!resolution.exists) {
        setOutput(prev => [...prev, <Text color="red">{formatMissingConfigError(filePath, resolution)}</Text>]);
        return;
      }

      const content = fs.readFileSync(resolution.path, 'utf-8');
      const config: CLIConfig = JSON.parse(content);

      // NEW: Validate and apply defaults for conversation config
      if (!config.conversation) {
        config.conversation = {};
      }
      config.conversation.maxAgentResponseTime ??= 1800000;
      config.conversation.showThinkingTimer ??= true;
      config.conversation.allowEscCancel ??= true;

      setCurrentConfig(config);
      setCurrentConfigPath(filePath);
      // ... UI output ...
    } catch (error) {
      setOutput(prev => [...prev, <Text color="red">Error: {String(error)}</Text>]);
    }
  };
  ```

  ### Step 2: Extend InitializeServicesOptions and pass callbacks to ConversationCoordinator

  **IMPORTANT**: initializeServices() returns `{ coordinator, team, processManager }`, NOT `{ coordinator, agentManager, team }`.

  ```typescript
  // src/utils/ConversationStarter.ts - EXTEND InitializeServicesOptions interface (line 95-101)
  export interface InitializeServicesOptions {
    contextMessageCount?: number;
    onMessage?: (message: ConversationMessage) => void;
    onStatusChange?: (status: ConversationStatus) => void;
    onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;
    registryPath?: string;
    // NEW: Agent thinking callbacks for REPL UI
    onAgentStarted?: (member: Member) => void;
    onAgentCompleted?: (member: Member) => void;
  }

  // src/utils/ConversationStarter.ts - initializeServices() method (MODIFY line 460-476)
  export async function initializeServices(
    config: CLIConfig,
    options: InitializeServicesOptions = {}
  ): Promise<{
    coordinator: ConversationCoordinator;
    team: Team;
    processManager: ProcessManager;  // CORRECT: processManager, not agentManager
  }> {
    // ... existing code creates processManager, agentManager, etc. ...

    const coordinator = new ConversationCoordinator(
      agentManager,
      messageRouter,
      {
        contextMessageCount: options.contextMessageCount,
        onMessage: options.onMessage,
        onStatusChange: options.onStatusChange,
        onUnresolvedAddressees: options.onUnresolvedAddressees,
        conversationConfig: config.conversation,  // NEW: Pass conversation config
        onAgentStarted: options.onAgentStarted,   // NEW: Pass agent started callback
        onAgentCompleted: options.onAgentCompleted // NEW: Pass agent completed callback
      }
    );

    return { coordinator, team, processManager };  // CORRECT return value
  }
  ```

  **Step 3**: ConversationCoordinator passes timeout to ProcessManager AND emits agent thinking signals

  **CRITICAL**: Add new callbacks `onAgentStarted` and `onAgentCompleted` to signal REPL UI when agent thinking begins/ends.

  ```typescript
  // src/services/ConversationCoordinator.ts - Constructor (MODIFY line 21-26 and 38-44)
  export interface ConversationCoordinatorOptions {
    contextMessageCount?: number;
    onMessage?: (message: ConversationMessage) => void;
    onStatusChange?: (status: ConversationStatus) => void;
    onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;
    conversationConfig?: ConversationConfig;  // NEW: Conversation-level config
    onAgentStarted?: (member: Member) => void;  // NEW: Signal when agent starts thinking
    onAgentCompleted?: (member: Member) => void;  // NEW: Signal when agent finishes (success or error)
  }

  export class ConversationCoordinator {
    private conversationConfig: ConversationConfig;

    constructor(
      private agentManager: AgentManager,
      private messageRouter: MessageRouter,
      private options: ConversationCoordinatorOptions = {}
    ) {
      this.contextMessageCount = options.contextMessageCount || 5;
      this.conversationConfig = options.conversationConfig || {
        maxAgentResponseTime: 1800000,
        showThinkingTimer: true,
        allowEscCancel: true
      };
    }
    // ... rest of class ...
  }
  ```

  ## ProcessManager Timeout Changes (Clarifying Relationship)

  **Current State** (src/infrastructure/ProcessManager.ts:19-24):
  ```typescript
  export interface SendOptions {
    timeout?: number;           // Total timeout (default: 30000ms = 30s)
    endMarker?: string;
    idleTimeout?: number;       // Streaming idle timeout (default: 3000ms = 3s)
    useEndOfMessageMarker?: boolean;
  }
  ```

  **Problem**: `timeout` defaults to 30 seconds, which is too short for long-running agent tasks.

  **Solution**: RENAME `timeout` to `maxTimeout` and increase default to 30 minutes.
  Keep `idleTimeout` unchanged for streaming detection.

  **Migration Strategy**:
  1. **Rename** `timeout` → `maxTimeout` (breaking change, but internal API)
  2. **Update default**: 30000ms (30s) → 1800000ms (30min)
  3. **Keep** `idleTimeout` for streaming (unchanged)
  4. **Remove** backward compatibility shim (we have no external users)

  **Updated Interface**:
  ```typescript
  // src/infrastructure/ProcessManager.ts - MODIFY SendOptions
  export interface SendOptions {
    maxTimeout?: number;        // RENAMED from timeout: Total response timeout (default: 1800000ms = 30min)
    endMarker?: string;
    idleTimeout?: number;       // Streaming idle timeout (default: 3000ms = 3s, unchanged)
    useEndOfMessageMarker?: boolean;
  }

  async sendAndReceive(
    processId: string,
    message: string,
    options?: SendOptions
  ): Promise<string> {
    const managed = this.processes.get(processId);
    if (!managed) {
      throw new Error(`Process not found: ${processId}`);
    }

    if (!managed.running) {
      throw new Error(`Process not running: ${processId}`);
    }

    // CHANGE: Use maxTimeout instead of timeout, default to 30 minutes
    const maxTimeout = options?.maxTimeout ?? 1800000;  // 30 min (was 30s)
    const idleTimeout = options?.idleTimeout ?? 3000;   // 3s (unchanged)
    const endMarker = options?.endMarker;
    const useEndOfMessageMarker = options?.useEndOfMessageMarker ?? false;

    return new Promise((resolve, reject) => {
      let output = managed.outputBuffer;
      managed.outputBuffer = '';

      let maxTimeoutTimer: NodeJS.Timeout | null = null;
      let idleTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (maxTimeoutTimer) clearTimeout(maxTimeoutTimer);
        if (idleTimer) clearTimeout(idleTimer);
        this.outputCallbacks.delete(processId);
      };

      // Set maximum timeout (safety net for hung processes)
      maxTimeoutTimer = setTimeout(() => {
        cleanup();
        this.stopProcess(processId);  // Kill the process
        reject(new Error(
          `Agent response timeout after ${maxTimeout}ms (${Math.floor(maxTimeout/60000)}min). ` +
          `This likely indicates the agent process has hung or crashed.`
        ));
      }, maxTimeout);

      // Set idle timeout (for streaming detection)
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cleanup();
          resolve(output);  // Resolve with partial output
        }, idleTimeout);
      };

      // ... rest of existing logic for endMarker detection and streaming ...
    });
  }
  ```

  **Timeout Semantics**:
  - `maxTimeout`: Total time allowed for agent response (default: 30 minutes)
    - Triggered when agent hangs or crashes
    - Kills the process with `stopProcess()`
    - Used for long-running tasks like code analysis, compilation
  - `idleTimeout`: Time to wait for next chunk in streaming output (default: 3 seconds)
    - Triggered when agent stops producing output but hasn't sent [DONE]
    - Resolves with partial output (doesn't kill process)
    - Used for streaming responses without endMarker

  **Why Both Timeouts?**:
  1. **maxTimeout**: Protects against infinite hangs (process crash, infinite loop)
  2. **idleTimeout**: Detects end of streaming output (agent finished but forgot [DONE])

  2. REPL Mode: Live Timer + ESC Cancellation

  Only applies when running in interactive REPL mode.

  UI Display and ESC Handling (Ink layer):

  **IMPORTANT**: The actual REPL entry point is `src/repl/ReplModeInk.tsx`, NOT `src/ui/App.tsx`.
  The existing `App` component (line 617) already has a `useInput` hook (line 701) that handles various keys.
  We need to extend this existing hook to add ESC cancellation and timer display.

  **CRITICAL**: Use `onAgentStarted` and `onAgentCompleted` callbacks to set `isAgentThinking` state.

  ```typescript
  // src/repl/ReplModeInk.tsx (existing App component - EXTEND)
  function App({ registryPath }: { registryPath?: string } = {}) {
    // ... existing state ...
    const [activeCoordinator, setActiveCoordinator] = useState<ConversationCoordinator | null>(null);

    // NEW: Add agent thinking state for timer display
    const [isAgentThinking, setIsAgentThinking] = useState(false);
    const [thinkingElapsed, setThinkingElapsed] = useState(0);
    const [thinkingMemberName, setThinkingMemberName] = useState<string>('');
    const [conversationConfig, setConversationConfig] = useState<ConversationConfig | null>(null);

    // NEW: Timer updates
    useEffect(() => {
      if (!isAgentThinking) return;

      const interval = setInterval(() => {
        setThinkingElapsed(prev => prev + 1);
      }, 1000);

      return () => clearInterval(interval);
    }, [isAgentThinking]);

    // EXTEND existing useInput hook (line 701-861)
    useInput((inputChar: string, key: any) => {
      // ... existing logic for agentsMenu, Ctrl+C, etc. ...

      // NEW: Add ESC key handling for agent cancellation (BEFORE other handlers)
      // CRITICAL: Check conversationConfig.allowEscCancel to honor user configuration
      const allowEscCancel = conversationConfig?.allowEscCancel ?? true;  // Default true if not set
      if (key.escape && mode === 'conversation' && isAgentThinking && activeCoordinator && allowEscCancel) {
        // Cancel current agent execution
        activeCoordinator.cancelCurrentAgent();
        setIsAgentThinking(false);
        setThinkingElapsed(0);
        setOutput(prev => [...prev,
          <Text key={`cancel-${getNextKey()}`} color="yellow">
            Agent execution cancelled by user (ESC).
          </Text>
        ]);
        return;
      }

      // ... rest of existing key handlers ...
    });

    // MODIFY startConversationInRepl (line 1472-1518) to pass NEW callbacks
    const startConversationInRepl = async (initialMessage: string) => {
      if (!currentConfig) return;

      try {
        setOutput(prev => [...prev, <Text dimColor>Initializing services...</Text>]);

        // Store conversation config for UI use
        setConversationConfig(currentConfig.conversation || {
          maxAgentResponseTime: 1800000,
          showThinkingTimer: true,
          allowEscCancel: true
        });

        const { coordinator, team } = await initializeServices(currentConfig, {
          onMessage: (message: ConversationMessage) => {
            // ... existing onMessage handler ...
          },
          onStatusChange: (status) => {
            // ... existing onStatusChange handler ...
          },
          // NEW: Agent thinking callbacks
          onAgentStarted: (member: Member) => {
            setIsAgentThinking(true);
            setThinkingElapsed(0);
            setThinkingMemberName(member.displayName);
          },
          onAgentCompleted: (member: Member) => {
            setIsAgentThinking(false);
            setThinkingElapsed(0);
          }
        });

        // ... rest of existing code ...
      } catch (error) {
        // ... error handling ...
      }
    };

    // ... rest of existing code ...

    // CRITICAL: Calculate maxTimeoutMinutes dynamically from config
    const maxTimeoutMinutes = conversationConfig?.maxAgentResponseTime
      ? Math.floor(conversationConfig.maxAgentResponseTime / 60000)
      : 30;  // Default 30 minutes

    // CRITICAL: Check conversationConfig.showThinkingTimer to honor user configuration
    const showThinkingTimer = conversationConfig?.showThinkingTimer ?? true;  // Default true if not set
    const allowEscCancel = conversationConfig?.allowEscCancel ?? true;  // Default true if not set

    return (
      <Box flexDirection="column">
        {/* NEW: Thinking indicator - ONLY show if showThinkingTimer is enabled */}
        {isAgentThinking && showThinkingTimer && (
          <ThinkingIndicator
            memberName={thinkingMemberName}
            elapsed={thinkingElapsed}
            maxTimeoutMinutes={maxTimeoutMinutes}  // Dynamic value from config
            allowEscCancel={allowEscCancel}  // Pass config to control ESC hint
          />
        )}

        {/* Existing UI components */}
        {output}
        {/* ... rest of existing UI ... */}
      </Box>
    );
  }
  ```

  // NEW COMPONENT: src/ui/ThinkingIndicator.tsx
  import React from 'react';
  import { Box, Text } from 'ink';

  export const ThinkingIndicator: React.FC<{
    memberName: string;
    elapsed: number;
    maxTimeoutMinutes: number;
    allowEscCancel: boolean;  // NEW: Control ESC hint display
  }> = ({ memberName, elapsed, maxTimeoutMinutes, allowEscCancel }) => {
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    // Build hint message based on allowEscCancel configuration
    const hintMessage = allowEscCancel
      ? `(press ESC to cancel, auto-cancel at ${maxTimeoutMinutes}m)`
      : `(auto-cancel at ${maxTimeoutMinutes}m)`;  // Don't mention ESC if disabled

    return (
      <Box>
        <Text dimColor>
          [{memberName}] Thinking for {minutes}m {seconds}s {hintMessage}
        </Text>
      </Box>
    );
  };

  ## ConversationCoordinator Integration (Compatible with Existing Implementation)

  **Current Implementation**: `sendToAgent` is a PRIVATE method (line 280-307) that returns `Promise<void>`.
  Flow: ensureAgentStarted → sendAndReceive → stopAgent → onAgentResponse

  **Required Changes**:

  ```typescript
  // src/services/ConversationCoordinator.ts - MODIFY existing class
  export class ConversationCoordinator {
    // ... existing fields ...
    private currentAgentRole: string | null = null;  // NEW: Track current agent
    private currentAgentStartTime: number = 0;        // NEW: Track start time

    constructor(
      private agentManager: AgentManager,
      private messageRouter: MessageRouter,
      private options: ConversationCoordinatorOptions = {}
    ) {
      this.contextMessageCount = options.contextMessageCount || 5;
      this.conversationConfig = options.conversationConfig || {
        maxAgentResponseTime: 1800000,
        showThinkingTimer: true,
        allowEscCancel: true
      };
    }

    // MODIFY existing private method (line 280-307)
    private async sendToAgent(member: Member, message: string): Promise<void> {
      if (!member.agentConfigId) {
        throw new Error(`Member ${member.id} has no agent config`);
      }

      // NEW: Track current agent for cancellation
      this.currentAgentRole = member.id;
      this.currentAgentStartTime = Date.now();

      // NEW: Signal REPL UI that agent started thinking
      if (this.options.onAgentStarted) {
        this.options.onAgentStarted(member);
      }

      try {
        // Prepare member-specific spawn configuration
        const memberConfig = {
          workDir: member.workDir,
          env: member.env,
          additionalArgs: member.additionalArgs,
          systemInstruction: member.systemInstruction
        };

        // Ensure Agent is started
        await this.agentManager.ensureAgentStarted(member.id, member.agentConfigId, memberConfig);

        // Build full message (context only, NO system instruction)
        // NOTE: System instruction is handled by adapter layer (--append-system-prompt for Claude,
        // prepending for stateless adapters). buildAgentMessage() only adds conversation context.
        const fullMessage = this.buildAgentMessage(member, message);

        // NEW: Pass maxTimeout from conversationConfig to AgentManager
        const response = await this.agentManager.sendAndReceive(
          member.id,
          fullMessage,
          {
            maxTimeout: this.conversationConfig.maxAgentResponseTime  // Pass configured timeout
          }
        );

        // Stop Agent (process will exit, need to restart next time)
        await this.agentManager.stopAgent(member.id);

        // Process response
        await this.onAgentResponse(member.id, response);

        // Clear tracking
        this.currentAgentRole = null;

        // NEW: Signal REPL UI that agent completed successfully
        if (this.options.onAgentCompleted) {
          this.options.onAgentCompleted(member);
        }

      } catch (error: any) {
        // Clear tracking
        const elapsed = Math.floor((Date.now() - this.currentAgentStartTime) / 1000);
        this.currentAgentRole = null;

        // NEW: Signal REPL UI that agent completed (even on error)
        if (this.options.onAgentCompleted) {
          this.options.onAgentCompleted(member);
        }

        if (error.message === '[CANCELLED_BY_USER]') {
          // User pressed ESC - route to last human speaker
          this.handleUserCancellation(member, elapsed);
          return;  // Don't throw, just continue conversation
        }

        throw error;  // Re-throw other errors
      }
    }

    /**
     * NEW: Cancel current agent send (called from REPL UI layer via ESC)
     */
    public cancelCurrentAgent(): void {
      if (this.currentAgentRole) {
        this.agentManager.cancelCurrentSend(this.currentAgentRole);
      }
    }

    /**
     * NEW: Handle user cancellation (route to last human speaker)
     */
    private handleUserCancellation(cancelledMember: Member, elapsedSeconds: number): void {
      console.log(`\n[Cancelled after ${elapsedSeconds}s]`);

      // Find all human members (CORRECT - does not mutate original array)
      const humanMembers = this.team!.members.filter(m => m.type === 'human');

      if (humanMembers.length === 0) {
        // No humans - pause conversation
        this.status = 'paused';  // Valid status: 'active' | 'paused' | 'completed'
        this.notifyStatusChange();  // Notify subscribers
        console.log('No human members available. Conversation paused.');
        return;
      }

      // Find last human who spoke (iterate backwards without mutating)
      // IMPORTANT: Use session.messages (NOT conversationHistory)
      let lastHumanSpeaker: Member | undefined;
      const messages = this.session!.messages;  // CORRECT: messages, not conversationHistory
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const speaker = this.team!.members.find(m => m.id === msg.speaker.id);
        if (speaker && speaker.type === 'human') {
          lastHumanSpeaker = speaker;
          break;
        }
      }

      // Use lastHumanSpeaker or fallback to first human
      const nextSpeaker = lastHumanSpeaker || humanMembers[0];

      console.log(`Routing to ${nextSpeaker.displayName} (${lastHumanSpeaker ? 'last speaker' : 'first human'})`);

      // IMPORTANT: Follow existing pattern (line 253-257)
      // When routing to human, pause conversation and notify subscribers
      this.waitingForRoleId = nextSpeaker.id;
      this.status = 'paused';  // Consistent with existing implementation
      this.notifyStatusChange();  // Notify onStatusChange subscribers
    }

    // ... rest of existing methods ...
  }
  ```

  3. Cancellation Flow Implementation

  ## AgentManager Cancellation Support (Compatible with Current Architecture)

  **Current State**:
  - AgentInstance stores: `roleId`, `configId`, `processId`, `cleanup`, `adapter`, `systemInstruction` (line 132-139)
  - `ensureAgentStarted` receives `memberConfig` with workDir/env/additionalArgs/systemInstruction (line 100-111)
  - Stateless agents: NOT registered in process table, return early (line 90-96)
  - Stateful agents: Build `spawnConfig` from memberConfig + agentConfig, then spawn (line 100-114)

  **Required Changes**:

  ```typescript
  // src/services/AgentManager.ts - MODIFY existing class
  export class AgentManager {
    // ... existing fields ...

    // NEW: Track active sends for cancellation
    private activeSends: Map<string, {
      processId: string;
      childProcess?: ChildProcess;  // For stateless mode only
      cancelFn: () => void;
    }> = new Map();

    // MODIFY existing method (line 147-194)
    async sendAndReceive(
      roleId: string,
      message: string,
      options?: Partial<SendOptions>
    ): Promise<string> {
      const agent = this.agents.get(roleId);
      if (!agent) {
        throw new Error(`Role ${roleId} has no running agent`);
      }

      // Get agent config to determine endMarker and useEndOfMessageMarker
      const config = await this.agentConfigManager.getAgentConfig(agent.configId);

      // Prepare message using adapter (prepends system instruction if needed)
      const preparedMessage = agent.adapter.prepareMessage(message, agent.systemInstruction);

      if (agent.adapter.executionMode === 'stateless') {
        // Stateless mode - execute one-shot with proper cancellation
        // CRITICAL: We need to rebuild spawnConfig for each execution
        // because stateless agents don't persist in process table

        // Retrieve memberConfig from agent instance (stored during ensureAgentStarted)
        // SOLUTION: Store memberConfig in AgentInstance during ensureAgentStarted
        const memberConfig = agent.memberConfig;  // NEW field added to AgentInstance

        // Build spawnConfig (same logic as ensureAgentStarted)
        const spawnConfig: AgentSpawnConfig = {
          workDir: memberConfig?.workDir || config.cwd || process.cwd(),
          env: {
            ...config.env,
            ...memberConfig?.env
          },
          additionalArgs: [
            ...(config.args || []),
            ...(memberConfig?.additionalArgs || [])
          ],
          systemInstruction: memberConfig?.systemInstruction
        };

        return new Promise(async (resolve, reject) => {
          // Create cancellable execution
          const execution = agent.adapter.executeOneShotCancellable!(
            preparedMessage,
            spawnConfig
          );

          // Store cancel function that kills the child process
          this.activeSends.set(roleId, {
            processId: agent.processId,
            childProcess: execution.childProcess,
            cancelFn: () => {
              // Kill the subprocess immediately
              execution.childProcess.kill('SIGTERM');

              // Give it 5 seconds to exit gracefully, then force kill
              setTimeout(() => {
                if (!execution.childProcess.killed) {
                  execution.childProcess.kill('SIGKILL');
                }
              }, 5000);

              reject(new Error('[CANCELLED_BY_USER]'));
            }
          });

          try {
            const response = await execution.promise;
            this.activeSends.delete(roleId);
            resolve(response);
          } catch (error) {
            this.activeSends.delete(roleId);
            reject(error);
          }
        });

      } else {
        // Stateful mode - use ProcessManager
        const sendOptions: SendOptions = {
          maxTimeout: options?.maxTimeout,  // NEW: Use maxTimeout instead of timeout
          endMarker: options?.endMarker || config?.endMarker || defaultEndMarker,
          idleTimeout: options?.idleTimeout,  // Keep idleTimeout for streaming
          useEndOfMessageMarker: config?.useEndOfMessageMarker || false
        };

        // Store cancel function that kills the process
        this.activeSends.set(roleId, {
          processId: agent.processId,
          cancelFn: () => {
            this.processManager.cancelSend(agent.processId);
          }
        });

        try {
          return await this.processManager.sendAndReceive(
            agent.processId,
            preparedMessage,
            sendOptions
          );
        } finally {
          this.activeSends.delete(roleId);
        }
      }
    }

    /**
     * NEW: Cancel current send (called from ConversationCoordinator)
     */
    cancelCurrentSend(roleId: string): void {
      const activeSend = this.activeSends.get(roleId);
      if (activeSend) {
        activeSend.cancelFn();
      }
    }

    // MODIFY ensureAgentStarted to store memberConfig
    async ensureAgentStarted(
      roleId: string,
      configId: string,
      memberConfig?: MemberSpawnConfig
    ): Promise<string> {
      // ... existing logic ...

      // When creating AgentInstance, store memberConfig for stateless reuse
      const agentInstance: AgentInstance = {
        roleId,
        configId,
        processId,
        cleanup: spawnResult.cleanup,
        adapter: adapter,
        systemInstruction: memberConfig?.systemInstruction,
        memberConfig: memberConfig  // NEW: Store for stateless mode cancellation
      };

      this.agents.set(roleId, agentInstance);
      return processId;
    }
  }

  // MODIFY AgentInstance interface to store memberConfig
  interface AgentInstance {
    roleId: string;
    configId: string;
    processId: string;
    cleanup?: () => void;
    adapter: IAgentAdapter;
    systemInstruction?: string;
    memberConfig?: MemberSpawnConfig;  // NEW: Store for stateless cancellation
  }
  ```

  Adapter Interface Extension (Stateless Cancellation):
  // src/adapters/IAgentAdapter.ts
  export interface IAgentAdapter {
    // ... existing methods ...

    /**
     * Execute one-shot command with cancellation support (stateless mode only)
     * Returns child process reference and promise for cancellation
     */
    executeOneShotCancellable?(
      message: string,
      config: AgentSpawnConfig
    ): {
      childProcess: ChildProcess;
      promise: Promise<string>;
    };
  }

  // Example implementation: OpenAICodexAdapter
  // src/adapters/OpenAICodexAdapter.ts
  executeOneShotCancellable(
    message: string,
    config: AgentSpawnConfig
  ): { childProcess: ChildProcess; promise: Promise<string> } {
    const args = [...this.getDefaultArgs()];
    if (config.additionalArgs && config.additionalArgs.length > 0) {
      args.push(...config.additionalArgs);
    }
    args.push(message);

    const childProcess = spawn(this.command, args, {
      cwd: config.workDir,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const promise = new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      childProcess.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      childProcess.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      childProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn: ${error.message}`));
      });

      childProcess.on('exit', (code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          reject(new Error('[CANCELLED_BY_USER]'));
          return;
        }

        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}. stderr: ${stderr}`));
          return;
        }

        // Append [DONE] marker if not present
        if (!stdout.trim().endsWith('[DONE]')) {
          stdout += '\n[DONE]\n';
        }

        resolve(stdout);
      });
    });

    return { childProcess, promise };
  }

  ProcessManager cancellation support:
  // src/infrastructure/ProcessManager.ts
  export class ProcessManager {
    private activeSends: Map<string, {
      reject: (error: Error) => void;
      timeoutHandle: NodeJS.Timeout;
    }> = new Map();

    async sendAndReceive(
      processId: string,
      message: string,
      options?: SendOptions
    ): Promise<string> {
      const maxTimeout = options?.maxTimeout ?? 1800000;

      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          this.activeSends.delete(processId);
          this.stopProcess(processId);  // FIX: Use stopProcess
          reject(new Error(`Agent response timeout after ${maxTimeout}ms`));
        }, maxTimeout);

        // Store for cancellation
        this.activeSends.set(processId, { reject, timeoutHandle });

        // ... send message and wait for [DONE] ...

        const cleanup = () => {
          clearTimeout(timeoutHandle);
          this.activeSends.delete(processId);
        };

        // On completion: cleanup() then resolve()
        // On error: cleanup() then reject()
      });
    }

    cancelSend(processId: string): void {
      const activeSend = this.activeSends.get(processId);
      if (activeSend) {
        clearTimeout(activeSend.timeoutHandle);
        this.activeSends.delete(processId);
        activeSend.reject(new Error('[CANCELLED_BY_USER]'));

        // Stop the process
        this.stopProcess(processId);
      }
    }
  }

  4. User Cancellation Handling

  **Note**: User cancellation handling is implemented in `ConversationCoordinator.handleUserCancellation()` method.
  See the ConversationCoordinator section above for complete implementation details.

  5. Mode Comparison

  | Mode                  | Timer Display         | ESC Cancel | Max Timeout               | Use Case               |
  |-----------------------|-----------------------|------------|---------------------------|------------------------|
  | REPL (Interactive)    | ✅ Live timer every 1s | ✅ ESC key  | ✅ 30 min (configurable)   | User actively watching |
  | CLI (Non-interactive) | ❌ No display          | ❌ No ESC   | ✅ 30 min (configurable)   | Automation, CI/CD      |
  | Testing               | ❌ No display          | ❌ No ESC   | ⚠️ Custom (short timeout) | Unit/integration tests |

  6. Benefits

  | Aspect                  | Old (30s timeout)  | New (UX-driven + safety net) |
  |-------------------------|--------------------|------------------------------|
  | User Control            | ❌ System decides   | ✅ User decides (REPL)        |
  | Transparency            | ❌ Silent timeout   | ✅ Live feedback (REPL)       |
  | Long Tasks              | ❌ Kills at 30s     | ✅ Waits up to 30min          |
  | Non-interactive Safety  | ⚠️ 30s (too short) | ✅ 30min (reasonable)         |
  | Dead Process Detection  | ✅ 30s              | ✅ 30min (configurable)       |
  | User Away from Keyboard | ❌ Hangs forever?   | ✅ 30min auto-cancel          |
  | Error Handling          | ❌ Throws Error     | ✅ Graceful routing (REPL)    |

  ## Implementation Scope

  ### 1. Configuration Schema and Options Changes

  - **src/utils/ConversationStarter.ts**:
    - Add `ConversationConfig` interface with maxAgentResponseTime/showThinkingTimer/allowEscCancel
    - Extend `CLIConfig` interface to include `conversation?: ConversationConfig`
    - **EXTEND** `InitializeServicesOptions` interface (line 95-101) to add `onAgentStarted` and `onAgentCompleted` callbacks
    - Update `initializeServices()` (line 460-476) to pass `conversationConfig` and new callbacks to ConversationCoordinator
  - **src/cli.ts**: Modify `loadConfig()` (line 103-126) to validate and apply defaults for conversation config
  - **src/repl/ReplMode.ts**: Modify `private loadConfig()` (line 247-270) to validate and apply defaults
  - **src/repl/ReplModeInk.tsx**: Modify `const loadConfig` closure (line 1444-1470) to validate and apply defaults

  ### 2. ProcessManager Changes (src/infrastructure/ProcessManager.ts)

  - **RENAME** `SendOptions.timeout` → `SendOptions.maxTimeout` (breaking change, internal API)
  - **UPDATE** default: 30000ms (30s) → 1800000ms (30min)
  - **KEEP** `idleTimeout` unchanged (3000ms for streaming)
  - **UPDATE** timeout handler to use `stopProcess()` instead of cleanup
  - **ADD** `cancelSend(processId)` method
  - **ADD** `activeSends` Map to track active sends for cancellation

  ### 3. AgentManager Changes (src/services/AgentManager.ts)

  - **ADD** `cancelCurrentSend(roleId)` public method
  - **ADD** `activeSends` Map with childProcess reference for stateless mode
  - **UPDATE** `sendAndReceive()` to handle maxTimeout in both stateful and stateless modes
  - **UPDATE** stateless mode to call `executeOneShotCancellable()` with proper cancellation
  - **UPDATE** `AgentInstance` interface to store `memberConfig` for stateless reuse
  - **UPDATE** `ensureAgentStarted()` to store memberConfig in AgentInstance

  ### 4. Adapter Interface Changes (src/adapters/IAgentAdapter.ts)

  - **ADD** `executeOneShotCancellable()` optional method to IAgentAdapter
  - Returns `{ childProcess, promise }` for cancellation support
  - **IMPLEMENT** in OpenAICodexAdapter and GenericShellAdapter
  - **HANDLE** SIGTERM/SIGKILL signals in exit handler to reject with `[CANCELLED_BY_USER]`

  ### 5. ConversationCoordinator Changes (src/services/ConversationCoordinator.ts)

  - **ADD** `onAgentStarted` and `onAgentCompleted` callbacks to `ConversationCoordinatorOptions` interface
  - **ADD** `conversationConfig` field to store conversation-level configuration
  - **ADD** `currentAgentRole` and `currentAgentStartTime` for tracking
  - **ADD** `cancelCurrentAgent()` public method (called from REPL UI)
  - **ADD** `handleUserCancellation()` private method to route to last human speaker:
    - **IMPORTANT**: Set `status = 'paused'` and call `notifyStatusChange()` (consistent with existing pattern line 253-257)
    - This ensures onStatusChange subscribers receive "waiting for user input" signal
  - **UPDATE** constructor to accept `conversationConfig` and new callbacks via options
  - **UPDATE** `sendToAgent()` to:
    - Call `onAgentStarted()` before starting agent execution
    - Track current agent and pass maxTimeout to AgentManager
    - Call `onAgentCompleted()` after successful completion or on error (even cancellation)
    - Catch `[CANCELLED_BY_USER]` and route gracefully to last human speaker

  ### 6. REPL UI Layer Changes (src/repl/ReplModeInk.tsx - REPL only)

  - **ADD** `isAgentThinking`, `thinkingElapsed`, `thinkingMemberName`, `conversationConfig` state variables
  - **ADD** timer with useEffect to update every 1 second when agent is thinking
  - **EXTEND** existing `useInput` hook (line 701-861) to capture ESC key for cancellation:
    - **CRITICAL**: Check `conversationConfig.allowEscCancel` before processing ESC key
    - Default to `true` if not configured
  - **MODIFY** `startConversationInRepl()` (line 1472-1518):
    - Store `currentConfig.conversation` in `conversationConfig` state (with defaults)
    - Pass new callbacks to `initializeServices()`:
      - `onAgentStarted`: Set `isAgentThinking=true`, reset timer, set member name
      - `onAgentCompleted`: Set `isAgentThinking=false`, reset timer
  - **CALCULATE** `maxTimeoutMinutes` dynamically from `conversationConfig.maxAgentResponseTime / 60000`
  - **CHECK** `conversationConfig.showThinkingTimer` before rendering ThinkingIndicator:
    - Default to `true` if not configured
    - Only render if both `isAgentThinking && showThinkingTimer` are true
  - **CALL** `coordinator.cancelCurrentAgent()` on ESC press (if allowed)
  - **CREATE** new component `src/ui/ThinkingIndicator.tsx` for live timer display:
    - **ACCEPT** `allowEscCancel` prop to control ESC hint display
    - Show "press ESC to cancel, auto-cancel at Xm" when `allowEscCancel=true`
    - Show only "auto-cancel at Xm" when `allowEscCancel=false` (no misleading ESC hint)
  - **NO** direct stdin manipulation (Ink manages it internally)

  ### 7. Configuration Files

  Team configuration files at `~/.agent-chatter/team-config/<team-name>.json`:
  ```json
  {
    "schemaVersion": "1.2",
    "team": { ... },
    "conversation": {
      "maxAgentResponseTime": 1800000,
      "showThinkingTimer": true,
      "allowEscCancel": true
    }
  }
  ```

  Edge Cases Handled

  1. Non-Interactive Mode (CLI automation)

  Scenario: User runs agent-chatter start --team phoenix-prd
  - ✅ No timer display (no TTY)
  - ✅ No ESC listener (no stdin)
  - ✅ 30-minute timeout still applies
  - ✅ If timeout, throw error and exit gracefully

  2. User Away from Keyboard (REPL)

  Scenario: User starts conversation, then leaves for coffee
  - ✅ Timer keeps running, displays elapsed time
  - ✅ 30-minute timeout triggers automatically
  - ✅ Conversation pauses or routes to human
  - ✅ No infinite resource consumption

  3. Multiple ESC Presses

  Scenario: User panics and presses ESC multiple times
  - ✅ First ESC triggers cancellation
  - ✅ Subsequent ESCs ignored (listener removed)
  - ✅ No duplicate cancellation logic

  4. Agent Completes Before Timeout

  Scenario: Agent responds with [DONE] after 2 minutes
  - ✅ Timer stops immediately
  - ✅ Timeout cleared
  - ✅ No phantom timeout fires later

  5. Process Crashes

  Scenario: Agent process crashes (exit code non-zero)
  - ✅ ProcessManager exit handler triggers
  - ✅ Timeout cleared
  - ✅ Error propagated to ConversationCoordinator
  - ✅ Conversation can continue or pause

  6. Stateless Mode Cancellation

  Scenario: User cancels Codex one-shot execution
  - ✅ childProcess.kill('SIGTERM') called immediately
  - ✅ 5-second grace period for graceful shutdown
  - ✅ Force kill with SIGKILL if still running
  - ✅ Promise rejected with [CANCELLED_BY_USER]
  - ✅ Resources freed (CPU, API quota)

  Risk Assessment

  Low Risk:
  - ProcessManager keeps timeout logic (safer than removing it)
  - Default 30 minutes is very conservative
  - Non-interactive mode unaffected (just longer timeout)
  - REPL enhancements are additive (no breaking changes)

  No risk of:
  - Infinite hangs (30-minute timeout)
  - Resource leaks (timeout clears resources)
  - Broken automation (non-interactive mode still works)

  Testing Strategy

  Unit Tests

  1. ProcessManager timeout behavior (30 min default)
  2. ProcessManager cancellation API
  3. AgentManager cancellation routing
  4. ConversationCoordinator.handleUserCancellation() (no array mutation)

  Integration Tests

  1. REPL mode: Timer display + ESC cancellation
  2. Non-interactive mode: 30-min timeout without UI
  3. Timeout triggers: Verify cleanup and error handling
  4. Cancellation flow: Verify Promise rejection and routing

  Manual UAT

  1. Start long-running task in REPL, press ESC at various times
  2. Start long-running task in REPL, walk away, verify 30-min timeout
  3. Run CLI automation, verify no UI overhead, timeout still works
  4. Test with stateful (Claude) and stateless (Codex) agents

  Configuration Examples

  Conservative (Default)

  {
    "conversation": {
      "maxAgentResponseTime": 1800000,  // 30 minutes
      "showThinkingTimer": true,
      "allowEscCancel": true
    }
  }

  Aggressive (Fast timeout)

  {
    "conversation": {
      "maxAgentResponseTime": 300000,   // 5 minutes
      "showThinkingTimer": true,
      "allowEscCancel": true
    }
  }

  Minimal UI (Background jobs)

  {
    "conversation": {
      "maxAgentResponseTime": 1800000,
      "showThinkingTimer": false,        // No timer display
      "allowEscCancel": false             // No ESC handling
    }
  }

  Testing (Short timeout)

  {
    "conversation": {
      "maxAgentResponseTime": 10000,    // 10 seconds for tests
      "showThinkingTimer": false,
      "allowEscCancel": false
    }
  }

  Recommendation

  Approve and implement this revised approach:

  1. ✅ Keep configurable timeout (default 30 min) for safety
  2. ✅ Add REPL enhancements (timer + ESC) for UX
  3. ✅ Support non-interactive mode (no UI overhead)
  4. ✅ Proper cancellation flow (Promise rejection handled)
  5. ✅ Fixed code issues (no array mutation)

  Key Differences from Original Proposal:
  - Keeps timeout as safety net (not removed)
  - Distinguishes REPL vs non-interactive modes
  - Properly handles cancellation Promise lifecycle
  - Fixes conversation history mutation bug

  ---
  ## Estimated Implementation: 8-10 hours

  | Component | Time | Changes |
  |-----------|------|---------|
  | **Configuration Schema** | 1 hour | Extend CLIConfig, add ConversationConfig interface, update loadConfig() |
  | **ProcessManager** | 2 hours | Rename timeout→maxTimeout, update default, add cancelSend() |
  | **AgentManager** | 2 hours | Add cancellation support, store memberConfig, handle stateless cancellation |
  | **ConversationCoordinator** | 2 hours | Add config field, tracking, cancelCurrentAgent(), handleUserCancellation() |
  | **Adapter Interface** | 1 hour | Add executeOneShotCancellable(), implement in adapters |
  | **REPL UI Components** | 1 hour | Extend useInput hook, add ThinkingIndicator component |
  | **Testing** | 2 hours | Unit tests + integration tests + manual UAT |
  | **Total** | **11 hours** | (with buffer for debugging and edge cases) |

  **Target Version: 0.0.17 (feature enhancement)**