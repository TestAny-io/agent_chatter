/**
 * AuthChecker Interface and Base Class
 *
 * @file src/services/validation/auth/AuthChecker.ts
 * @layer Core
 *
 * @remarks
 * Defines unified authentication checker interface
 * Supports multiple Agent authentication check implementations
 * Provides factory function to get corresponding checker
 *
 * @architecture LLD-04 Exception
 * Uses child_process (exec) for authentication verification commands.
 * See AgentValidator.ts for rationale on why this is an acceptable exception.
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { AuthCheckResult, ErrorType } from '../types.js';

const execAsync = promisify(exec);

// ===== Interface Definitions =====

/**
 * Authentication checker interface
 * Each Agent type implements this interface
 */
export interface AuthChecker {
  /**
   * Agent type identifier
   * e.g., 'claude', 'codex', 'gemini'
   */
  readonly agentType: string;

  /**
   * CLI command name
   * e.g., 'claude', 'codex', 'gemini'
   */
  readonly command: string;

  /**
   * Execute authentication check
   *
   * @returns Authentication check result
   *
   * @remarks
   * Check order (fast to slow, cheap to expensive):
   * 1. Environment variables (instant, free)
   * 2. Special modes (Bedrock/Vertex)
   * 3. CLI status command (fast, no API call)
   * 4. Credential files (local check)
   */
  checkAuth(): Promise<AuthCheckResult>;
}

/**
 * Authentication checker configuration options
 */
export interface AuthCheckerOptions {
  /**
   * Status command execution timeout (ms)
   * @default 5000
   */
  statusCommandTimeout?: number;

  /**
   * Whether to skip status command check
   * For testing or when status command is unavailable
   * @default false
   */
  skipStatusCommand?: boolean;

  /**
   * Custom environment variables (for testing)
   * If not provided, uses process.env
   */
  env?: Record<string, string | undefined>;

  /**
   * Custom home directory (for testing)
   * If not provided, uses os.homedir()
   */
  homeDir?: string;

  /**
   * Custom platform identifier (for testing cross-platform behavior)
   * If not provided, uses process.platform
   * @example 'darwin', 'linux', 'win32'
   */
  platform?: NodeJS.Platform;
}

/**
 * Status command execution result
 */
export interface StatusCommandResult {
  /** Whether command is available */
  available: boolean;
  /** Exit code (only when available=true) */
  exitCode?: number;
  /** Command output (only when available=true) */
  output?: string;
  /**
   * Unavailable reason (only when available=false)
   * - 'COMMAND_NOT_FOUND': CLI doesn't exist
   * - 'STATUS_COMMAND_UNAVAILABLE': CLI exists but doesn't support status command
   * - 'TIMEOUT': Command execution timeout
   * - 'Skipped by configuration': Configuration skipped
   */
  reason?:
    | 'COMMAND_NOT_FOUND'
    | 'STATUS_COMMAND_UNAVAILABLE'
    | 'TIMEOUT'
    | string;
  /** Whether fallback to file check is needed */
  fallbackNeeded?: boolean;
  /** Whether it's a network error (command exists but network down) */
  networkError?: boolean;
}

// ===== Base Class =====

/**
 * Authentication checker base class
 * Provides common helper methods
 */
export abstract class BaseAuthChecker implements AuthChecker {
  abstract readonly agentType: string;
  abstract readonly command: string;

  protected readonly options: Required<AuthCheckerOptions>;

  constructor(options?: AuthCheckerOptions) {
    this.options = {
      statusCommandTimeout: options?.statusCommandTimeout ?? 5000,
      skipStatusCommand: options?.skipStatusCommand ?? false,
      env: options?.env ?? (process.env as Record<string, string | undefined>),
      homeDir: options?.homeDir ?? os.homedir(),
      platform: options?.platform ?? process.platform,
    };
  }

  /**
   * Get current platform
   */
  protected getPlatform(): NodeJS.Platform {
    return this.options.platform;
  }

  /**
   * Check if macOS
   */
  protected isMacOS(): boolean {
    return this.options.platform === 'darwin';
  }

  /**
   * Check if Linux
   */
  protected isLinux(): boolean {
    return this.options.platform === 'linux';
  }

  /**
   * Check if Windows
   */
  protected isWindows(): boolean {
    return this.options.platform === 'win32';
  }

  /**
   * Subclass must implement authentication check logic
   */
  abstract checkAuth(): Promise<AuthCheckResult>;

  // ===== Helper Methods =====

  /**
   * Get environment variable
   */
  protected getEnv(name: string): string | undefined {
    return this.options.env[name];
  }

  /**
   * Check if environment variable exists and is non-empty
   */
  protected hasEnv(name: string): boolean {
    const value = this.getEnv(name);
    return value !== undefined && value.trim() !== '';
  }

  /**
   * Get home directory path
   */
  protected getHomePath(...segments: string[]): string {
    return path.join(this.options.homeDir, ...segments);
  }

  /**
   * Check if file exists
   */
  protected fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Read JSON file
   */
  protected readJsonFile<T>(filePath: string): T | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * Execute status command
   */
  protected async executeStatusCommand(
    args: string[]
  ): Promise<StatusCommandResult> {
    if (this.options.skipStatusCommand) {
      return { available: false, reason: 'Skipped by configuration' };
    }

    try {
      const { stdout, stderr } = await execAsync(
        `"${this.command}" ${args.join(' ')}`,
        { timeout: this.options.statusCommandTimeout }
      );

      return {
        available: true,
        exitCode: 0,
        output: stdout + stderr,
      };
    } catch (error: unknown) {
      return this.classifyStatusCommandError(error);
    }
  }

  /**
   * Classify status command execution error
   *
   * @remarks
   * Error classification principles:
   * 1. Command doesn't exist (ENOENT/127) → available: false, fallbackNeeded: true
   * 2. Invalid argument (unknown command) → available: false, fallbackNeeded: true
   * 3. Timeout → available: false, reason: 'TIMEOUT'
   * 4. Network error → available: true, exitCode: -1, networkError: true
   * 5. Other errors → available: true, exitCode: N, output: stderr
   */
  private classifyStatusCommandError(error: unknown): StatusCommandResult {
    const err = error as {
      code?: number | string;
      message?: string;
      stderr?: string;
      stdout?: string;
      signal?: string;
      killed?: boolean;
    };

    // Timeout
    if (
      err.killed ||
      err.signal === 'SIGTERM' ||
      err.message?.includes('timeout')
    ) {
      return {
        available: false,
        reason: 'TIMEOUT',
        fallbackNeeded: true,
      };
    }

    // Command doesn't exist
    if (err.code === 127 || err.code === 'ENOENT') {
      return {
        available: false,
        reason: 'COMMAND_NOT_FOUND',
        fallbackNeeded: true,
      };
    }

    // Invalid argument/subcommand (CLI exists but doesn't support this command)
    const isInvalidCommand =
      err.message?.includes('unknown command') ||
      err.message?.includes('unrecognized option') ||
      err.message?.includes('invalid argument') ||
      err.message?.includes('not a command') ||
      err.stderr?.includes('Usage:') ||
      err.stderr?.includes('unknown command');

    if (isInvalidCommand) {
      return {
        available: false,
        reason: 'STATUS_COMMAND_UNAVAILABLE',
        fallbackNeeded: true,
      };
    }

    // Network error (command exists but can't connect to server)
    const isNetworkError =
      err.message?.includes('ENOTFOUND') ||
      err.message?.includes('ETIMEDOUT') ||
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('network') ||
      err.stderr?.includes('network') ||
      err.stderr?.includes('connect');

    if (isNetworkError) {
      return {
        available: true,
        exitCode: typeof err.code === 'number' ? err.code : -1,
        output: err.stderr || err.stdout || err.message || '',
        networkError: true,
      };
    }

    // Command exists but execution error (may be auth issue)
    return {
      available: true,
      exitCode: typeof err.code === 'number' ? err.code : -1,
      output: err.stderr || err.stdout || err.message || '',
    };
  }

  /**
   * Create success result
   */
  protected successResult(method: string, warning?: string): AuthCheckResult {
    return {
      passed: true,
      method,
      warning,
    };
  }

  /**
   * Create failure result
   */
  protected failureResult(
    errorType: ErrorType,
    message: string,
    resolution?: string
  ): AuthCheckResult {
    return {
      passed: false,
      errorType,
      message,
      resolution,
    };
  }
}

// ===== Factory Functions =====

// Import will be done after checkers are created
// Placeholder for registry
type AuthCheckerClass = new (options?: AuthCheckerOptions) => AuthChecker;
const checkerRegistry: Map<string, AuthCheckerClass> = new Map();

/**
 * Get authentication checker for specified Agent type
 *
 * @param agentType - Agent type
 * @param options - Optional configuration
 * @returns Authentication checker instance
 * @throws When Agent type is not registered
 */
export function getAuthChecker(
  agentType: string,
  options?: AuthCheckerOptions
): AuthChecker {
  const CheckerClass = checkerRegistry.get(agentType);

  if (!CheckerClass) {
    throw new Error(
      `Unknown agent type: ${agentType}. Available: ${Array.from(checkerRegistry.keys()).join(', ')}`
    );
  }

  return new CheckerClass(options);
}

/**
 * Register new authentication checker
 * Used to extend support for new Agent types
 *
 * @param agentType - Agent type
 * @param checkerClass - Checker class
 */
export function registerAuthChecker(
  agentType: string,
  checkerClass: AuthCheckerClass
): void {
  checkerRegistry.set(agentType, checkerClass);
}

/**
 * Get all registered Agent types
 */
export function getRegisteredAgentTypes(): string[] {
  return Array.from(checkerRegistry.keys());
}

/**
 * Check if an agent type is registered
 */
export function isAgentTypeRegistered(agentType: string): boolean {
  return checkerRegistry.has(agentType);
}
