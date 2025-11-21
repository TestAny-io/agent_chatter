/**
 * OpenAICodexAdapter - Adapter for OpenAI Codex CLI
 *
 * Self-contained adapter that:
 * - Prepends [SYSTEM] section to messages
 * - Intercepts stdout to append [DONE] marker
 * - No dependency on external wrapper scripts
 */

import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { PassThrough } from 'stream';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';

export class OpenAICodexAdapter implements IAgentAdapter {
  readonly agentType = 'openai-codex';

  constructor(
    public readonly command: string
  ) {}

  /**
   * Get default arguments for Codex CLI
   */
  getDefaultArgs(): string[] {
    return ['exec', '--json', '--full-auto', '--skip-git-repo-check'];
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
   * Get default end marker for Codex
   */
  getDefaultEndMarker(): string {
    return '[DONE]';
  }
}
