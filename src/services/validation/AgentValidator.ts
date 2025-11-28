/**
 * AgentValidator - Unified Agent Verification Entry Point
 *
 * @file src/services/validation/AgentValidator.ts
 * @layer Core
 *
 * @remarks
 * - Unified entry point for Agent verification
 * - Coordinates various checkers (executable, connectivity, authentication)
 * - Aggregates check results to generate final verification status
 * - Provides batch verification functionality
 */

import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { checkConnectivity } from './ConnectivityChecker.js';
import type { ConnectivityCheckerOptions } from './ConnectivityChecker.js';
import {
  getAuthChecker,
  getRegisteredAgentTypes,
  isAgentTypeRegistered,
} from './auth/AuthChecker.js';
import type { AuthCheckerOptions } from './auth/AuthChecker.js';
import {
  determineVerificationStatus,
  isBlockingError,
} from './types.js';
import type {
  VerificationResult,
  CheckResult,
  CheckResultWithAuthMethod,
} from './types.js';

// Import checkers to register them
import './auth/ClaudeAuthChecker.js';
import './auth/CodexAuthChecker.js';
import './auth/GeminiAuthChecker.js';

const execAsync = promisify(exec);

// ===== Configuration Options =====

/**
 * AgentValidator configuration options
 */
export interface AgentValidatorOptions {
  /**
   * Whether to skip connectivity check
   * @default false
   */
  skipConnectivityCheck?: boolean;

  /**
   * TCP connectivity check timeout (ms)
   * @default 5000
   */
  connectivityTimeout?: number;

  /**
   * DNS resolution timeout (ms)
   * @default 3000
   */
  dnsTimeout?: number;

  /**
   * Authentication checker configuration
   */
  authCheckerOptions?: AuthCheckerOptions;

  /**
   * Executable file check timeout (ms)
   * @default 5000
   */
  executableCheckTimeout?: number;

  /**
   * Custom environment variables (for testing)
   */
  env?: Record<string, string | undefined>;

  /**
   * Custom home directory (for testing)
   */
  homeDir?: string;

  /**
   * Custom platform identifier (for testing cross-platform behavior)
   * @example 'darwin', 'linux', 'win32'
   */
  platform?: NodeJS.Platform;

  /**
   * Maximum concurrency for parallel verification
   * @default 3
   */
  maxConcurrency?: number;
}

// ===== Implementation =====

export class AgentValidator {
  private readonly options: Required<AgentValidatorOptions>;

  constructor(options?: AgentValidatorOptions) {
    this.options = {
      skipConnectivityCheck: options?.skipConnectivityCheck ?? false,
      connectivityTimeout: options?.connectivityTimeout ?? 5000,
      dnsTimeout: options?.dnsTimeout ?? 3000,
      authCheckerOptions: options?.authCheckerOptions ?? {},
      executableCheckTimeout: options?.executableCheckTimeout ?? 5000,
      env: options?.env ?? (process.env as Record<string, string | undefined>),
      homeDir: options?.homeDir ?? os.homedir(),
      platform: options?.platform ?? process.platform,
      maxConcurrency: options?.maxConcurrency ?? 3,
    };
  }

  /**
   * Validate single Agent availability
   *
   * @param agentType - Agent type ('claude' | 'codex' | 'gemini')
   * @returns Verification result
   *
   * @remarks
   * Verification order:
   * 1. Executable file check (blocking)
   * 2. Connectivity check (non-blocking)
   * 3. Authentication check (partially blocking)
   */
  async validateAgent(agentType: string): Promise<VerificationResult> {
    const checks = await this.runChecks(agentType);
    return this.buildVerificationResult(agentType, checks);
  }

  /**
   * Batch validate multiple Agents
   *
   * @param agents - Agent type list
   * @returns Agent type to verification result mapping
   *
   * @remarks
   * - Executes in parallel, limited by maxConcurrency
   * - Single Agent validation failure doesn't affect others
   */
  async validateAgents(
    agents: string[]
  ): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>();

    // Use concurrency limit
    const chunks = this.chunkArray(agents, this.options.maxConcurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (agent) => ({
          agent,
          result: await this.validateAgent(agent),
        }))
      );

      for (const { agent, result } of chunkResults) {
        results.set(agent, result);
      }
    }

    return results;
  }

  /**
   * Validate all registered Agents
   *
   * @returns Agent type to verification result mapping
   */
  async validateAllKnownAgents(): Promise<Map<string, VerificationResult>> {
    const knownAgents = getRegisteredAgentTypes();
    return this.validateAgents(knownAgents);
  }

  // ===== Private Methods =====

  /**
   * Run all checks
   */
  private async runChecks(agentType: string): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    // 1. Executable file check
    const execCheck = await this.checkExecutable(agentType);
    checks.push(execCheck);

    // If executable doesn't exist, no need to continue checking
    if (!execCheck.passed && execCheck.errorType === 'CONFIG_MISSING') {
      return checks;
    }

    // 2. Connectivity check (start in parallel)
    const connectivityPromise = this.options.skipConnectivityCheck
      ? Promise.resolve(null)
      : this.checkConnectivity(agentType);

    // 3. Authentication check
    const authCheck = await this.checkAuth(agentType);
    checks.push(authCheck);

    // Wait for connectivity check to complete
    const connectivityCheck = await connectivityPromise;
    if (connectivityCheck) {
      // Insert connectivity check result before auth check
      checks.splice(1, 0, connectivityCheck);
    }

    return checks;
  }

  /**
   * Build verification result
   */
  private buildVerificationResult(
    name: string,
    checks: CheckResult[]
  ): VerificationResult {
    const status = determineVerificationStatus(checks);

    // Collect all warnings
    const warnings = checks.filter((c) => c.warning).map((c) => c.warning!);

    // Find first blocking error
    const blockingError = checks.find(
      (c) => !c.passed && c.errorType && isBlockingError(c.errorType)
    );

    // Find auth method (from successful auth check)
    const authCheck = checks.find(
      (c) => c.name === 'Auth Check' && c.passed
    ) as CheckResultWithAuthMethod | undefined;

    const result: VerificationResult = {
      name,
      status,
      checks,
    };

    if (status === 'failed' && blockingError) {
      result.error = blockingError.message;
      result.errorType = blockingError.errorType;
    }

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    if (authCheck?.authMethod) {
      result.authMethod = authCheck.authMethod;
    }

    return result;
  }

  /**
   * Check Agent CLI executable file exists
   *
   * @param agentType - Agent type
   * @returns Check result
   *
   * @remarks
   * Cross-platform support:
   * - Unix (darwin/linux): Uses `which` command
   * - Windows (win32): Uses `where` command
   *
   * Error handling strategy:
   * - Exit code 1 or ENOENT: Command doesn't exist → CONFIG_MISSING (blocking)
   * - Exit code 127: Command doesn't exist (bash report) → CONFIG_MISSING (blocking)
   * - EACCES/126: Permission denied → warning but pass (command exists but may not execute)
   * - Timeout/other: Uncertain → warning but pass
   */
  private async checkExecutable(agentType: string): Promise<CheckResult> {
    const command = this.getCommandName(agentType);
    const platform = this.options.platform;

    // Cross-platform: Choose correct command lookup tool
    const whichCommand = platform === 'win32' ? 'where' : 'which';

    try {
      await execAsync(`${whichCommand} ${command}`, {
        timeout: this.options.executableCheckTimeout,
      });

      return {
        name: 'Executable Check',
        passed: true,
        message: `${command} found in PATH`,
      };
    } catch (error: unknown) {
      const err = error as {
        code?: number | string;
        message?: string;
        signal?: string;
        killed?: boolean;
      };

      // Command doesn't exist → clear CONFIG_MISSING
      // which returns 1, where returns 1, bash returns 127, system ENOENT
      const isNotFound =
        err.code === 1 || // which/where returns 1 for not found
        err.code === 127 || // bash "command not found"
        err.code === 'ENOENT'; // System level command doesn't exist

      if (isNotFound) {
        return {
          name: 'Executable Check',
          passed: false,
          message: `${command} not found`,
          errorType: 'CONFIG_MISSING',
          resolution: this.getInstallInstructions(agentType),
        };
      }

      // Permission error → command may exist but can't execute
      if (err.code === 'EACCES' || err.code === 126) {
        return {
          name: 'Executable Check',
          passed: true, // Pass, let subsequent checks continue
          message: `${command} may exist but permission denied`,
          warning: `Permission error checking ${command}. Check file permissions.`,
        };
      }

      // Timeout
      if (err.killed || err.signal === 'SIGTERM') {
        return {
          name: 'Executable Check',
          passed: true, // Assume exists, continue checking
          message: `Executable check timed out for ${command}`,
          warning: `Timeout checking ${command}. Proceeding with verification.`,
        };
      }

      // Other unknown errors → uncertain, pass but warn
      return {
        name: 'Executable Check',
        passed: true,
        message: `Cannot verify ${command}`,
        warning: `Executable check error: ${err.code || err.message}. Proceeding with verification.`,
      };
    }
  }

  /**
   * Get Agent command name
   */
  private getCommandName(agentType: string): string {
    const commands: Record<string, string> = {
      claude: 'claude',
      codex: 'codex',
      gemini: 'gemini',
    };
    return commands[agentType] || agentType;
  }

  /**
   * Get installation instructions
   */
  private getInstallInstructions(agentType: string): string {
    const instructions: Record<string, string> = {
      claude: 'Install: npm install -g @anthropic-ai/claude-code',
      codex: 'Install: npm install -g @openai/codex',
      gemini: 'Install: npm install -g @google/gemini-cli',
    };
    return instructions[agentType] || `Install the ${agentType} CLI`;
  }

  /**
   * Execute connectivity check
   *
   * @param agentType - Agent type
   * @returns Check result
   */
  private async checkConnectivity(agentType: string): Promise<CheckResult> {
    // Pass configured timeout parameters
    const result = await checkConnectivity(agentType, {
      connectivityTimeout: this.options.connectivityTimeout,
      dnsTimeout: this.options.dnsTimeout,
    });

    if (result.reachable) {
      return {
        name: 'Connectivity Check',
        passed: true,
        message: `API reachable (${result.latencyMs}ms)`,
      };
    }

    // Connectivity check failure doesn't block verification
    return {
      name: 'Connectivity Check',
      passed: true, // Note: still passed
      message: 'Cannot verify online connectivity',
      warning: `${result.error}. Proceeding with local credentials.`,
    };
  }

  /**
   * Execute authentication check
   *
   * @param agentType - Agent type
   * @returns Check result (includes authMethod field)
   */
  private async checkAuth(
    agentType: string
  ): Promise<CheckResultWithAuthMethod> {
    try {
      // Check if agent type is registered
      if (!isAgentTypeRegistered(agentType)) {
        return {
          name: 'Auth Check',
          passed: true,
          message: 'No auth checker available',
          warning: `Cannot verify auth for ${agentType}. Agent type not registered.`,
        };
      }

      const checker = getAuthChecker(agentType, {
        ...this.options.authCheckerOptions,
        env: this.options.env,
        homeDir: this.options.homeDir,
        platform: this.options.platform,
      });

      const result = await checker.checkAuth();

      if (result.passed) {
        return {
          name: 'Auth Check',
          passed: true,
          message: `Authenticated via ${result.method || 'unknown method'}`,
          warning: result.warning,
          // Dedicated authMethod field for buildVerificationResult
          authMethod: result.method,
        };
      }

      return {
        name: 'Auth Check',
        passed: false,
        message: result.message || 'Not authenticated',
        errorType: result.errorType,
        resolution: result.resolution,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };

      // Unknown Agent type → WARN passthrough
      if (err.message?.includes('Unknown agent type')) {
        return {
          name: 'Auth Check',
          passed: true,
          message: 'No auth checker available',
          warning: `Cannot verify auth for ${agentType}. Agent type not registered.`,
        };
      }

      // Other unexpected errors → don't assume AUTH_MISSING
      // Use VERIFICATION_INCOMPLETE to indicate verification process error
      // Avoid misleading user to think credentials are missing
      return {
        name: 'Auth Check',
        passed: true, // WARN passthrough, don't block
        message: 'Auth verification encountered an error',
        warning: `Auth check error: ${err.message}. Proceeding without verification.`,
        // Don't set errorType, let upper layer know this is uncertain state
      };
    }
  }

  /**
   * Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
