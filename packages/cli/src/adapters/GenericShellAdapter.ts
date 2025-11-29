/**
 * GenericShellAdapter - Generic adapter for shell scripts and custom commands
 *
 * Stateless adapter that executes commands once per message:
 * - Executes command with prompt as CLI argument
 * - Each message spawns a new process (one-shot execution)
 * - Prepends [SYSTEM] section to messages
 * - Suitable for custom agents, Gemini CLI, or any other CLI tool
 */

import { exec } from 'child_process';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { promisify } from 'util';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from '@testany/agent-chatter-core';
import type { IExecutionEnvironment } from '@testany/agent-chatter-core';

const execAsync = promisify(exec);

export interface GenericShellAdapterConfig {
  /**
   * Agent type identifier (e.g., 'google-gemini', 'custom-agent')
   */
  agentType: string;

  /**
   * Command to execute
   */
  command: string;

  /**
   * Default arguments to pass to the command
   */
  defaultArgs?: string[];
}

export class GenericShellAdapter implements IAgentAdapter {
  readonly agentType: string;
  readonly command: string;
  readonly executionMode = 'stateless' as const;
  private readonly defaultArgs: string[];

  constructor(
    private executionEnv: IExecutionEnvironment,
    config: GenericShellAdapterConfig
  ) {
    this.agentType = config.agentType;
    this.command = config.command;
    this.defaultArgs = config.defaultArgs || [];
  }

  /**
   * Get default arguments for this adapter
   */
  getDefaultArgs(): string[] {
    return [...this.defaultArgs];
  }

  /**
   * Spawn a generic shell process with stdout interception
   */
  async spawn(config: AgentSpawnConfig): Promise<AgentSpawnResult> {
    const args = [...this.getDefaultArgs()];

    // Add additional arguments from member config
    if (config.additionalArgs && config.additionalArgs.length > 0) {
      args.push(...config.additionalArgs);
    }

    // NOTE: systemInstruction is not injected here; prompt is pre-built upstream

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
          try {
            if (iProcess.pid !== undefined) {
              process.kill(iProcess.pid, 0);
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
            resolve();
          }
        });
      }
    };
  }

  /**
   * Validate that the command exists and is executable
   */
  async validate(): Promise<boolean> {
    try {
      // For absolute paths, check if file exists and is executable
      if (this.command.startsWith('/') || this.command.startsWith('./')) {
        await access(this.command, constants.X_OK);
        return true;
      }

      // For commands in PATH, try to execute with --version or --help
      // This is a basic check and may not work for all commands
      try {
        await execAsync(`${this.command} --version`, { timeout: 3000 });
        return true;
      } catch {
        // If --version fails, try --help
        try {
          await execAsync(`${this.command} --help`, { timeout: 3000 });
          return true;
        } catch {
          // If both fail, assume command doesn't exist
          return false;
        }
      }
    } catch {
      return false;
    }
  }

  /**
   * Execute a one-shot command (stateless mode)
   * Spawns a new process for each message, passes message as CLI argument
   */
  async executeOneShot(message: string, config: AgentSpawnConfig): Promise<string> {
    const args = [...this.getDefaultArgs()];

    // Add additional arguments from member config
    if (config.additionalArgs && config.additionalArgs.length > 0) {
      args.push(...config.additionalArgs);
    }

    // Add the message as the final argument
    args.push(message);

    return new Promise<string>((resolve, reject) => {
      const iProcess = this.executionEnv.spawn(this.command, args, {
        cwd: config.workDir,
        env: config.env,
        inheritEnv: true
      });

      let stdout = '';
      let stderr = '';

      if (iProcess.stdout) {
        iProcess.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
      }

      if (iProcess.stderr) {
        iProcess.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      iProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn process: ${error.message}`));
      });

      iProcess.on('exit', (code) => {
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
  }
}
