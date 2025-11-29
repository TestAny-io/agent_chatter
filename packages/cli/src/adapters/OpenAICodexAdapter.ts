/**
 * OpenAICodexAdapter - Adapter for OpenAI Codex CLI
 *
 * Stateless adapter that executes Codex CLI once per message:
 * - Codex CLI requires TTY for interactive mode
 * - We execute it with the prompt as a command-line argument
 * - Each message spawns a new process (one-shot execution)
 * - No dependency on external wrapper scripts
 */

import { PassThrough } from 'stream';
import { access } from 'fs/promises';
import { constants } from 'fs';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from '@testany/agent-chatter-core';
import type { IExecutionEnvironment } from '@testany/agent-chatter-core';

export class OpenAICodexAdapter implements IAgentAdapter {
  readonly agentType = 'openai-codex';
  readonly executionMode = 'stateless' as const;

  constructor(
    private executionEnv: IExecutionEnvironment,
    public readonly command: string
  ) {}

  /**
   * Get default arguments for Codex CLI
   */
  getDefaultArgs(): string[] {
    // Keep defaults empty; use registry/config args to avoid duplication (e.g., multiple --json flags)
    return [];
  }

  /**
   * Spawn a Codex process with stdout interception
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

    // Create PassThrough stream to intercept stdout and append [DONE]
    const transformedStdout = new PassThrough();

    // Pipe original stdout to transformed stream
    if (iProcess.stdout) {
      iProcess.stdout.pipe(transformedStdout, { end: false });

      let buffer = '';
      iProcess.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
      });

      // When original stdout ends, append [DONE] if not present
      iProcess.stdout.on('end', () => {
        if (!buffer.trim().endsWith('[DONE]')) {
          transformedStdout.write('\n[DONE]\n');
        }
        transformedStdout.end();
      });
    }

    // Return spawn result with cleanup function and custom stdout
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
      },
      customStreams: {
        stdout: transformedStdout
      }
    };
  }

  /**
   * Validate that the Codex CLI exists and is executable
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

  /**
   * Execute a one-shot command (stateless mode)
   * Spawns a new Codex process for each message, passes message as CLI argument
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
        reject(new Error(`Failed to spawn Codex process: ${error.message}`));
      });

      iProcess.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Codex process exited with code ${code}. stderr: ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
