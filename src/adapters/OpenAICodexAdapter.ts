/**
 * OpenAICodexAdapter - Adapter for OpenAI Codex CLI via wrapper script
 *
 * Uses a wrapper script to provide a unified stdin/stdout interface for Codex
 */

import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { constants } from 'fs';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';

export class OpenAICodexAdapter implements IAgentAdapter {
  readonly agentType = 'openai-codex';

  constructor(
    public readonly command: string
  ) {}

  /**
   * Get default arguments for Codex wrapper
   * Wrapper scripts typically don't need default args as they handle configuration internally
   */
  getDefaultArgs(): string[] {
    return [];
  }

  /**
   * Spawn a Codex wrapper process
   */
  async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
    const args = [...this.getDefaultArgs()];

    // Add additional arguments from member config
    if (config.additionalArgs && config.additionalArgs.length > 0) {
      args.push(...config.additionalArgs);
    }

    // Merge environment variables
    const env = {
      ...process.env,
      ...config.env
    };

    // Add system instruction as environment variable if wrapper supports it
    if (config.systemInstruction) {
      env.AGENT_SYSTEM_INSTRUCTION = config.systemInstruction;
    }

    // Spawn the wrapper process
    const childProcess = spawn(this.command, args, {
      cwd: config.workDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Return spawn result with cleanup function
    return {
      process: childProcess,
      cleanup: async () => {
        return new Promise<void>((resolve) => {
          if (!childProcess.killed) {
            childProcess.once('exit', () => resolve());
            childProcess.kill();

            // Force kill after 5 seconds if still running
            setTimeout(() => {
              if (!childProcess.killed) {
                childProcess.kill('SIGKILL');
              }
            }, 5000);
          } else {
            resolve();
          }
        });
      }
    };
  }

  /**
   * Validate that the wrapper script exists and is executable
   */
  async validate(): Promise<boolean> {
    try {
      // Check if file exists and is executable
      await access(this.command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}
