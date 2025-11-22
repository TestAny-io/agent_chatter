/**
 * ClaudeCodeAdapter - Adapter for Anthropic's Claude Code CLI
 *
 * Handles spawning and configuration for the 'claude' command
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';

const execAsync = promisify(exec);

export class ClaudeCodeAdapter implements IAgentAdapter {
  readonly agentType = 'claude-code';
  // Use stateless mode so we can pass prompt via -p and avoid the interactive TUI
  readonly executionMode = 'stateless' as const;

  constructor(
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

    // Merge environment variables
    const env = {
      ...process.env,
      ...config.env
    };

    // Spawn the process
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
