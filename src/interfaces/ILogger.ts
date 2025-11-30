/**
 * ILogger - Core logging interface
 *
 * Provides a minimal logging abstraction for Core services.
 * CLI/UI layers provide concrete implementations (e.g., ConsoleLogger).
 *
 * Design rationale:
 * - Core should not depend on console.* or any UI libraries
 * - Logging is injected via dependency injection
 * - SilentLogger is the default for headless/test scenarios
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Core logging interface
 *
 * Implementations should handle formatting and output destination.
 * Core only calls these methods without knowing the underlying output mechanism.
 */
export interface ILogger {
  /**
   * Log a debug message (verbose, usually hidden in production)
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an informational message
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Silent logger implementation
 *
 * Default implementation that discards all log messages.
 * Used in headless mode, tests, or when no logger is provided.
 */
export class SilentLogger implements ILogger {
  debug(_message: string, _context?: Record<string, unknown>): void {
    // Intentionally empty
  }

  info(_message: string, _context?: Record<string, unknown>): void {
    // Intentionally empty
  }

  warn(_message: string, _context?: Record<string, unknown>): void {
    // Intentionally empty
  }

  error(_message: string, _context?: Record<string, unknown>): void {
    // Intentionally empty
  }
}
