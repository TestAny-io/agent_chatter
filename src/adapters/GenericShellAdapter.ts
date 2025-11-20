/**
 * GenericShellAdapter - Generic adapter for shell scripts and custom commands
 *
 * Provides a flexible adapter for any command-line tool or wrapper script
 * Suitable for custom agents, Gemini wrapper, or any other CLI tool
 */

import { spawn } from 'child_process';
import { access } from 'fs/promises';
import { constants } from 'fs';
import type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';

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
   * Spawn a generic shell process
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

    // Add system instruction as environment variable for wrapper scripts
    if (config.systemInstruction) {
      env.AGENT_SYSTEM_INSTRUCTION = config.systemInstruction;
    }

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
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

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
}
