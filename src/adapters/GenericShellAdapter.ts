/**
 * GenericShellAdapter - Generic adapter for shell scripts and custom commands
 *
 * Self-contained adapter that:
 * - Prepends [SYSTEM] section to messages
 * - Intercepts stdout to append [DONE] marker
 * - Suitable for custom agents, Gemini CLI, or any other CLI tool
 */

import { spawn, exec } from 'child_process';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { promisify } from 'util';
import { PassThrough } from 'stream';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';

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
  private readonly defaultArgs: string[];

  constructor(config: GenericShellAdapterConfig) {
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
   * Prepare message for sending to the command
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
   * Get default end marker for generic shell commands
   */
  getDefaultEndMarker(): string {
    return '[DONE]';
  }
}
