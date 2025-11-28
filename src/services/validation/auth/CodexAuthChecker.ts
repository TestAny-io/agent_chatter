/**
 * CodexAuthChecker - OpenAI Codex CLI Authentication Checker
 *
 * @file src/services/validation/auth/CodexAuthChecker.ts
 * @layer Core
 *
 * @remarks
 * - Detects OpenAI Codex CLI authentication status
 * - Supports: API Key, OAuth login
 * - Handles status command output parsing
 */

import {
  BaseAuthChecker,
  registerAuthChecker,
} from './AuthChecker.js';
import type { AuthCheckerOptions } from './AuthChecker.js';
import type { AuthCheckResult } from '../types.js';

// ===== Constants =====

/**
 * Codex authentication related environment variables
 */
const ENV_VARS = {
  /** Primary API Key */
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  /** Organization ID (optional) */
  OPENAI_ORG_ID: 'OPENAI_ORG_ID',
} as const;

/**
 * Codex credential file paths (relative to home directory)
 */
const CREDENTIAL_PATHS = {
  /** Auth file */
  AUTH_FILE: '.codex/auth.json',
  /** Config file */
  CONFIG_FILE: '.codex/config.json',
} as const;

// ===== Implementation =====

export class CodexAuthChecker extends BaseAuthChecker {
  readonly agentType = 'codex';
  readonly command = 'codex';

  /** Status command unavailable reason */
  private statusCommandUnavailableReason?: string;

  constructor(options?: AuthCheckerOptions) {
    super(options);
  }

  /**
   * Execute Codex authentication check
   *
   * Check order:
   * 1. Environment variables (OPENAI_API_KEY)
   * 2. CLI status command (codex login status)
   * 3. Credential files
   */
  async checkAuth(): Promise<AuthCheckResult> {
    // Priority 1: Environment variables
    const envResult = this.checkEnvVars();
    if (envResult) {
      return envResult;
    }

    // Priority 2: CLI status command
    const statusResult = await this.checkStatusCommand();
    if (statusResult) {
      return statusResult;
    }

    // Priority 3: Credential files
    const fileResult = this.checkAuthFile();
    if (fileResult) {
      return fileResult;
    }

    // All checks failed
    return this.failureResult(
      'AUTH_MISSING',
      'No credentials found',
      'Run: codex login (or set OPENAI_API_KEY)'
    );
  }

  // ===== Private Methods =====

  /**
   * Check environment variables
   */
  private checkEnvVars(): AuthCheckResult | null {
    if (this.hasEnv(ENV_VARS.OPENAI_API_KEY)) {
      return this.successResult('OPENAI_API_KEY env var');
    }

    return null;
  }

  /**
   * Check CLI status command
   *
   * @remarks
   * - Command: codex login status (or codex whoami)
   * - Exit code 0 usually means authenticated
   */
  private async checkStatusCommand(): Promise<AuthCheckResult | null> {
    // Try "login status" first, may not exist in all versions
    let result = await this.executeStatusCommand(['login', 'status']);

    // If not available, try alternative commands
    if (!result.available && result.reason === 'STATUS_COMMAND_UNAVAILABLE') {
      result = await this.executeStatusCommand(['whoami']);
    }

    // Command unavailable, record reason for later decision
    if (!result.available) {
      this.statusCommandUnavailableReason = result.reason;
      return null;
    }

    // Network error, can't determine not authenticated
    if (result.networkError) {
      this.statusCommandUnavailableReason = 'NETWORK_ERROR';
      return null;
    }

    // Parse output
    const parseResult = this.parseStatusOutput(result.output || '');
    if (parseResult) {
      return parseResult;
    }

    // Parse failure output - may return null for uncertain cases
    const failureResult = this.parseFailureOutput(
      result.output || '',
      result.exitCode
    );
    if (failureResult) {
      return failureResult;
    }

    // Uncertain result, fallback to file check
    this.statusCommandUnavailableReason = 'AMBIGUOUS_OUTPUT';
    return null;
  }

  /**
   * Parse status command success output
   */
  private parseStatusOutput(output: string): AuthCheckResult | null {
    const lowerOutput = output.toLowerCase();

    // Look for success indicators
    if (
      lowerOutput.includes('logged in') ||
      lowerOutput.includes('authenticated') ||
      lowerOutput.includes('session active')
    ) {
      // Try to extract user info
      const userMatch = output.match(/(?:user|email|account)[:\s]+(\S+)/i);
      const method = userMatch ? `OAuth (${userMatch[1]})` : 'OAuth session';
      return this.successResult(method);
    }

    return null;
  }

  /**
   * Parse status command failure output
   *
   * @returns
   * - AuthCheckResult for clear failure cases
   * - null for uncertain cases (fallback to file check)
   */
  private parseFailureOutput(
    output: string,
    exitCode?: number
  ): AuthCheckResult | null {
    const lowerOutput = output.toLowerCase();

    // Explicit "not authenticated" indicators
    if (
      lowerOutput.includes('not logged in') ||
      lowerOutput.includes('not authenticated') ||
      lowerOutput.includes('please login') ||
      lowerOutput.includes('no credentials') ||
      lowerOutput.includes('unauthorized')
    ) {
      return this.failureResult(
        'AUTH_MISSING',
        'Not logged in',
        'Run: codex login'
      );
    }

    // Invalid/expired token
    if (
      lowerOutput.includes('invalid') ||
      lowerOutput.includes('expired') ||
      lowerOutput.includes('revoked')
    ) {
      return this.failureResult(
        'AUTH_EXPIRED',
        'Token expired or invalid',
        'Run: codex login'
      );
    }

    // Exit code 1 without clear message - uncertain, return null
    // This allows fallback to file check
    return null;
  }

  /**
   * Check auth file
   *
   * @remarks
   * WARN passthrough strategy:
   * - When status command unavailable/uncertain and auth file exists, return WARN passthrough
   */
  private checkAuthFile(): AuthCheckResult | null {
    const authFilePath = this.getHomePath(CREDENTIAL_PATHS.AUTH_FILE);

    if (this.fileExists(authFilePath)) {
      const auth = this.readJsonFile<{
        accessToken?: string;
        refreshToken?: string;
        apiKey?: string;
      }>(authFilePath);

      if (auth?.accessToken || auth?.refreshToken || auth?.apiKey) {
        // Status command unavailable but file exists → WARN passthrough
        if (this.statusCommandUnavailableReason) {
          return {
            passed: true,
            method: 'Auth file',
            warning:
              `Status command unavailable (${this.statusCommandUnavailableReason}). ` +
              'Proceeding with local credentials. If auth fails at runtime, run: codex login',
          };
        }
        return this.successResult('Auth file');
      }
    }

    // Check config file for API key reference
    const configFilePath = this.getHomePath(CREDENTIAL_PATHS.CONFIG_FILE);
    if (this.fileExists(configFilePath)) {
      const config = this.readJsonFile<{ apiKeyFile?: string }>(configFilePath);
      if (config?.apiKeyFile && this.fileExists(config.apiKeyFile)) {
        return this.successResult('API key file');
      }
    }

    return null;
  }
}

// Register the checker
registerAuthChecker('codex', CodexAuthChecker);
