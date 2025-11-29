/**
 * LocalExecutionEnvironment - Local process execution implementation
 *
 * @file src/infrastructure/LocalExecutionEnvironment.ts
 *
 * Uses Node.js child_process module to spawn Agent processes locally.
 * Implements IExecutionEnvironment interface for Core abstraction.
 *
 * NOTE: In future CLI/Core split, this will move to CLI package.
 */

import { spawn, type ChildProcess, type SpawnOptions as NodeSpawnOptions } from 'child_process';
import type {
  IExecutionEnvironment,
  IProcess,
  IPty,
  SpawnOptions,
  PtyOptions
} from '@testany/agent-chatter-core';

// NOTE: This file has moved from src/infrastructure/ to src/cli/ as part of LLD-04
// CLI layer provides concrete implementations; Core only depends on interfaces

/**
 * Local execution environment implementation
 *
 * Uses Node.js child_process module to spawn Agent processes locally
 */
export class LocalExecutionEnvironment implements IExecutionEnvironment {
  readonly type = 'local' as const;

  spawn(command: string, args: string[], options: SpawnOptions = {}): IProcess {
    const nodeOptions: NodeSpawnOptions = {
      cwd: options.cwd,
      shell: options.shell ?? false,
      env: this.buildEnv(options),
      stdio: ['pipe', 'pipe', 'pipe']
    };

    const childProcess = spawn(command, args, nodeOptions);
    return new LocalProcess(childProcess);
  }

  createPty(command: string, args: string[], options: PtyOptions = {}): IPty | undefined {
    // PTY support is optional, requires node-pty dependency
    try {
      // Dynamic import of node-pty (if installed)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodePty = require('node-pty');
      const pty = nodePty.spawn(command, args, {
        name: 'xterm-color',
        cols: options.cols ?? 80,
        rows: options.rows ?? 30,
        cwd: options.cwd,
        env: this.buildEnv(options) as Record<string, string>
      });
      return new LocalPty(pty);
    } catch {
      // node-pty not installed, return undefined
      return undefined;
    }
  }

  private buildEnv(options: SpawnOptions): NodeJS.ProcessEnv {
    const baseEnv = options.inheritEnv !== false ? { ...process.env } : {};
    return options.env ? { ...baseEnv, ...options.env } : baseEnv;
  }
}

/**
 * Local process wrapper
 *
 * Wraps Node.js ChildProcess to implement IProcess interface
 */
class LocalProcess implements IProcess {
  constructor(private childProcess: ChildProcess) {}

  get stdin() {
    return this.childProcess.stdin;
  }

  get stdout() {
    return this.childProcess.stdout;
  }

  get stderr() {
    return this.childProcess.stderr;
  }

  get pid() {
    return this.childProcess.pid;
  }

  on(event: 'exit', handler: (code: number | null, signal: string | null) => void): this;
  on(event: 'error', handler: (err: Error) => void): this;
  on(event: 'close', handler: (code: number | null, signal: string | null) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): this {
    this.childProcess.on(event, handler);
    return this;
  }

  once(event: 'exit', handler: (code: number | null, signal: string | null) => void): this;
  once(event: 'error', handler: (err: Error) => void): this;
  once(event: 'close', handler: (code: number | null, signal: string | null) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: string, handler: (...args: any[]) => void): this {
    this.childProcess.once(event, handler);
    return this;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    return this.childProcess.kill(signal);
  }
}

/**
 * Local PTY wrapper
 *
 * Wraps node-pty IPty to implement IPty interface
 * Note: node-pty is an optional dependency
 */
class LocalPty implements IPty {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private pty: any) {}

  get pid(): number {
    return this.pty.pid;
  }

  write(data: string): void {
    this.pty.write(data);
  }

  onData(handler: (data: string) => void): void {
    this.pty.onData(handler);
  }

  onExit(handler: (exitCode: number, signal?: number) => void): void {
    this.pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => handler(exitCode, signal));
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  kill(signal?: string): void {
    this.pty.kill(signal);
  }
}
