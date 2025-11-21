/**
 * OpenAICodexAdapter - Adapter for OpenAI Codex CLI
 *
 * Stateless adapter that executes Codex CLI once per message:
 * - Codex CLI requires TTY for interactive mode
 * - We execute it with the prompt as a command-line argument
 * - Each message spawns a new process (one-shot execution)
 * - No dependency on external wrapper scripts
 */

import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import { access } from 'fs/promises';
import { constants } from 'fs';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';

export class OpenAICodexAdapter implements IAgentAdapter {
  readonly agentType = 'openai-codex';
  readonly executionMode = 'stateless' as const;

  constructor(
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

    // Merge environment variables
    const env = {
      ...process.env,
      ...config.env
    };

    // NOTE: systemInstruction is NOT set in env here
    // It will be handled by prepareMessage() in AgentManager.sendAndReceive()

    // Spawn the process
    const childProcess = spawn(this.command, args, {
      cwd: config.workDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Create PassThrough stream to intercept stdout and append [DONE]
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

    // Return spawn result with cleanup function and custom stdout
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
   * Prepare message for sending to Codex
   * Prepends [SYSTEM] section if systemInstruction is provided
   */
  prepareMessage(message: string, systemInstruction?: string): string {
    if (!systemInstruction) {
      return message;
    }

    // Prepend [SYSTEM] section
    return `[SYSTEM]\n${systemInstruction}\n\n${message}`;
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

    // Merge environment variables
    const env = {
      ...process.env,
      ...config.env
    };

    return new Promise<string>((resolve, reject) => {
      const childProcess = spawn(this.command, args, {
        cwd: config.workDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      childProcess.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      childProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn Codex process: ${error.message}`));
      });

      childProcess.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Codex process exited with code ${code}. stderr: ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
