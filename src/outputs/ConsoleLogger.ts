/**
 * ConsoleLogger - CLI implementation of ILogger
 *
 * Provides console-based logging for CLI/REPL usage.
 * Implements ILogger interface from Core.
 */

import type { ILogger } from '../interfaces/ILogger.js';
import { colorize } from '../utils/colors.js';

export interface ConsoleLoggerOptions {
  /** Enable colored output (default: true) */
  colors?: boolean;
  /** Show debug messages (default: false) */
  debug?: boolean;
  /** Prefix for all messages (default: none) */
  prefix?: string;
}

/**
 * Console-based logger implementation
 *
 * Maps ILogger methods to console.* calls with optional color formatting.
 */
export class ConsoleLogger implements ILogger {
  private options: Required<Omit<ConsoleLoggerOptions, 'prefix'>> & { prefix?: string };

  constructor(options: ConsoleLoggerOptions = {}) {
    this.options = {
      colors: options.colors ?? true,
      debug: options.debug ?? false,
      prefix: options.prefix,
    };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (!this.options.debug) {
      return;
    }
    const formatted = this.format(message, context);
    const text = this.options.colors ? colorize(formatted, 'dim') : formatted;
    console.log(text);
  }

  info(message: string, context?: Record<string, unknown>): void {
    const formatted = this.format(message, context);
    const text = this.options.colors ? colorize(formatted, 'cyan') : formatted;
    console.log(text);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const formatted = this.format(message, context);
    const text = this.options.colors ? colorize(formatted, 'yellow') : formatted;
    console.warn(text);
  }

  error(message: string, context?: Record<string, unknown>): void {
    const formatted = this.format(message, context);
    const text = this.options.colors ? colorize(formatted, 'red') : formatted;
    console.error(text);
  }

  private format(message: string, context?: Record<string, unknown>): string {
    let result = this.options.prefix ? `${this.options.prefix} ${message}` : message;
    if (context && Object.keys(context).length > 0) {
      result += ` ${JSON.stringify(context)}`;
    }
    return result;
  }
}
