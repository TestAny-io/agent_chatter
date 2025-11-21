/**
 * IAgentAdapter - Interface for agent process adapters
 *
 * Adapters provide a unified interface for spawning and managing
 * different types of AI agent CLI processes (Claude Code, Codex, Gemini, etc.)
 */

import { ChildProcess } from 'child_process';

/**
 * Configuration for spawning an agent process
 */
export interface AgentSpawnConfig {
  /**
   * Working directory for the agent process
   */
  workDir: string;

  /**
   * Environment variables to pass to the agent
   * Will be merged with process.env
   */
  env?: Record<string, string>;

  /**
   * Additional command-line arguments to pass to the agent
   * Examples: ['--verbose', '--debug', '--json']
   */
  additionalArgs?: string[];

  /**
   * System instruction/prompt to pass to the agent (if supported)
   */
  systemInstruction?: string;
}

/**
 * Result of spawning an agent process
 */
export interface AgentSpawnResult {
  /**
   * The spawned child process
   */
  process: ChildProcess;

  /**
   * Cleanup function to call when done with the process
   * Should handle graceful shutdown, stdin closure, etc.
   */
  cleanup: () => Promise<void>;

  /**
   * Custom streams for ProcessManager to monitor
   * If provided, ProcessManager will listen to these instead of process.stdout/stderr
   * This allows adapters to intercept and transform output (e.g., append [DONE] marker)
   */
  customStreams?: {
    stdout?: NodeJS.ReadableStream;
    stderr?: NodeJS.ReadableStream;
  };
}

/**
 * Agent Adapter Interface
 *
 * Each adapter implements this interface to provide a consistent
 * way to spawn and interact with different AI agent CLI tools.
 */
export interface IAgentAdapter {
  /**
   * Agent type identifier
   * Examples: 'claude-code', 'openai-codex', 'google-gemini'
   */
  readonly agentType: string;

  /**
   * Command to execute (e.g., 'claude', 'codex', '/path/to/wrapper.sh')
   */
  readonly command: string;

  /**
   * Spawn an agent process with the given configuration
   *
   * @param config - Spawn configuration
   * @returns Spawn result containing process and cleanup function
   * @throws Error if spawn fails
   */
  spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult>;

  /**
   * Validate that the agent command is available and executable
   *
   * @returns true if agent is available, false otherwise
   */
  validate(): Promise<boolean>;

  /**
   * Get the default arguments for this agent type
   * Subclasses can override to provide agent-specific defaults
   *
   * @returns Array of default CLI arguments
   */
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
