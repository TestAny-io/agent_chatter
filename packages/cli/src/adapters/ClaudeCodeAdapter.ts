/**
 * ClaudeCodeAdapter - Adapter for Anthropic's Claude Code CLI
 *
 * Handles spawning and configuration for the 'claude' command
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from '@testany/agent-chatter-core';
import type { IExecutionEnvironment } from '@testany/agent-chatter-core';

const execAsync = promisify(exec);

export class ClaudeCodeAdapter implements IAgentAdapter {
  readonly agentType = 'claude-code';
  // Use stateless mode so we can pass prompt via -p and avoid the interactive TUI
  readonly executionMode = 'stateless' as const;

  constructor(
    private executionEnv: IExecutionEnvironment,
    public readonly command: string = 'claude'
  ) {}

  /**
   * Get default arguments for Claude Code
   * Uses stream-json format for better output parsing
   */
  getDefaultArgs(): string[] {
    return ['--output-format=stream-json', '--verbose'];
  }

  /**
   * Spawn a Claude Code process
   */
  async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
    const args = [...this.getDefaultArgs()];

    // Add system instruction if provided
    if (config.systemInstruction) {
      args.push('--append-system-prompt', config.systemInstruction);
    }

    // Add additional arguments from member config
    if (config.additionalArgs && config.additionalArgs.length > 0) {
      args.push(...config.additionalArgs);
    }

    // Spawn the process using IExecutionEnvironment
    const iProcess = this.executionEnv.spawn(this.command, args, {
      cwd: config.workDir,
      env: config.env,
      inheritEnv: true
    });

    // Return spawn result with cleanup function
    return {
      process: iProcess,
      cleanup: async () => {
        return new Promise<void>((resolve) => {
          // Check if process is still alive by trying to send signal 0
          try {
            if (iProcess.pid !== undefined) {
              process.kill(iProcess.pid, 0);
              // Process is alive, set up exit handler and kill it
              iProcess.on('exit', () => resolve());
              iProcess.kill();

              // Force kill after 5 seconds if still running
              setTimeout(() => {
                try {
                  if (iProcess.pid !== undefined) {
                    process.kill(iProcess.pid, 0);
                    iProcess.kill('SIGKILL');
                  }
                } catch {
                  // Process already dead
                }
              }, 5000);
            } else {
              resolve();
            }
          } catch {
            // Process already dead
            resolve();
          }
        });
      }
    };
  }

  /**
   * Validate that Claude Code is available
   */
  async validate(): Promise<boolean> {
    try {
      await execAsync(`${this.command} --version`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
