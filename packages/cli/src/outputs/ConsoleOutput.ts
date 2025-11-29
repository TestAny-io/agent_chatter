import { colorize, type ColorName } from '@testany/agent-chatter-core';
import type { IOutput } from './IOutput.js';

export interface ConsoleOutputOptions {
  colors?: boolean;
  verbose?: boolean;
}

/**
 * Console-backed implementation of IOutput.
 * Used by CLI/legacy REPL to centralize formatting, colors, and verbosity control.
 */
export class ConsoleOutput implements IOutput {
  constructor(private options: ConsoleOutputOptions = {}) {
    this.options.colors = this.options.colors ?? true;
    this.options.verbose = this.options.verbose ?? true;
  }

  info(message: string): void {
    this.log(message, 'cyan', console.log);
  }

  success(message: string): void {
    this.log(message, 'green', console.log);
  }

  warn(message: string): void {
    this.log(message, 'yellow', console.warn);
  }

  error(message: string): void {
    this.log(message, 'red', console.error);
  }

  progress(message: string, options?: { current?: number; total?: number }): void {
    if (!this.options.verbose) return;
    let text = message;
    if (options?.current !== undefined && options?.total !== undefined) {
      text += ` (${options.current}/${options.total})`;
    }
    this.log(text, 'dim', console.log);
  }

  separator(char: string = '─', length: number = 60): void {
    this.log(char.repeat(length), 'dim', console.log);
  }

  keyValue(key: string, value: string, options?: { indent?: number }): void {
    const indent = ' '.repeat(options?.indent ?? 2);
    this.log(`${indent}${key}: ${value}`, 'dim', console.log);
  }

  /**
   * Apply optional color and delegate to the provided console function.
   */
  private log(message: string, color: ColorName, fn: (...args: any[]) => void) {
    const text = this.options.colors ? colorize(message, color) : message;
    fn(text);
  }
}
