/**
 * IExecutionEnvironment - Execution environment abstraction
 *
 * @file src/interfaces/IExecutionEnvironment.ts
 *
 * Allows running Agent processes in different environments (local/container/remote)
 * Core uses this interface to spawn and manage Agent processes
 * without directly depending on child_process
 */

import type { Readable, Writable } from 'stream';

/**
 * Execution environment abstraction interface
 *
 * Allows running Agent in different environments (local/container/cloud)
 * Core uses this interface to spawn and manage Agent processes
 */
export interface IExecutionEnvironment {
  /**
   * Spawn a process
   *
   * @param command - Executable path
   * @param args - Command line arguments
   * @param options - Spawn options
   * @returns Process abstraction
   */
  spawn(command: string, args: string[], options?: SpawnOptions): IProcess;

  /**
   * Create a PTY (optional, local environment supports)
   *
   * @param command - Executable path
   * @param args - Command line arguments
   * @param options - PTY options
   * @returns PTY abstraction, undefined if not supported
   */
  createPty?(command: string, args: string[], options?: PtyOptions): IPty | undefined;

  /**
   * Environment type identifier
   */
  readonly type: 'local' | 'container' | 'remote';
}

/**
 * Process spawn options
 */
export interface SpawnOptions {
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Use shell */
  shell?: boolean;
  /** Inherit parent process environment variables (default: true) */
  inheritEnv?: boolean;
}

/**
 * PTY spawn options
 */
export interface PtyOptions extends SpawnOptions {
  /** Terminal columns */
  cols?: number;
  /** Terminal rows */
  rows?: number;
}

/**
 * Process abstraction interface
 */
export interface IProcess {
  /** Standard input stream */
  readonly stdin: Writable | null;
  /** Standard output stream */
  readonly stdout: Readable | null;
  /** Standard error stream */
  readonly stderr: Readable | null;
  /** Process ID */
  readonly pid: number | undefined;

  /**
   * Listen to events
   */
  on(event: 'exit', handler: (code: number | null, signal: string | null) => void): this;
  on(event: 'error', handler: (err: Error) => void): this;
  on(event: 'close', handler: (code: number | null, signal: string | null) => void): this;

  /**
   * Listen to events once (EventEmitter compatibility)
   */
  once(event: 'exit', handler: (code: number | null, signal: string | null) => void): this;
  once(event: 'error', handler: (err: Error) => void): this;
  once(event: 'close', handler: (code: number | null, signal: string | null) => void): this;

  /**
   * Terminate process
   */
  kill(signal?: NodeJS.Signals | number): boolean;
}

/**
 * PTY abstraction interface
 */
export interface IPty {
  /** Write data */
  write(data: string): void;
  /** Listen to data output */
  onData(handler: (data: string) => void): void;
  /** Listen to exit */
  onExit(handler: (exitCode: number, signal?: number) => void): void;
  /** Resize terminal */
  resize(cols: number, rows: number): void;
  /** Terminate PTY */
  kill(signal?: string): void;
  /** Process ID */
  readonly pid: number;
}
