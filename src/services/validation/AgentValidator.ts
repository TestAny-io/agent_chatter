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
 *
 * @architecture LLD-04 Exception
 * This module uses child_process directly for system probing (exec/spawn).
 * This is an intentional exception to the "Core no child_process" rule because:
 * 1. Validation runs at startup, not during conversation execution
 * 2. Purpose is to verify CLI tools exist before conversation begins
 * 3. LLD-04 goal is abstracting the agent execution path, not all shell commands
 * Future: Could be abstracted via ICommandExecutor interface if needed
 */

import * as os from 'os';
import { exec, spawn } from 'child_process';
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
import type { ILogger } from '../../interfaces/ILogger.js';
import { SilentLogger } from '../../interfaces/ILogger.js';

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
   * Whether to skip connectivity check entirely
   * @default false
   */
  skipConnectivityCheck?: boolean;

  /**
   * Whether to skip HTTP layer check (Layer 7)
   * When true, only performs DNS + TCP checks (Layer 3-4)
   * @default false
   */
  skipHttpCheck?: boolean;

  /**
   * Whether to skip dry-run check
   * @default false
   */
  skipDryRun?: boolean;

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
   * HTTP request timeout (ms)
   * @default 10000
   */
  httpTimeout?: number;

  /**
   * Dry-run check timeout (ms)
   * @default 60000
   */
  dryRunTimeout?: number;

  /**
   * Authentication checker configuration
   */
  authCheckerOptions?: AuthCheckerOptions;

  /**
   * Explicit proxy URL
   *
   * @remarks
   * - Passed to ConnectivityChecker
   * - Takes precedence over environment variables
   * - Supports http:// and https:// protocols
   * - Authentication format: http://user:pass@proxy:8080
   */
  proxyUrl?: string;

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

  /**
   * Logger for diagnostic messages
   */
  logger?: ILogger;
}

// ===== Implementation =====

export class AgentValidator {
  private readonly options: Required<Omit<AgentValidatorOptions, 'logger' | 'proxyUrl'>> & { proxyUrl?: string };
  private readonly logger: ILogger;

  constructor(options?: AgentValidatorOptions) {
    this.logger = options?.logger ?? new SilentLogger();
    this.options = {
      skipConnectivityCheck: options?.skipConnectivityCheck ?? false,
      skipHttpCheck: options?.skipHttpCheck ?? false,
      skipDryRun: options?.skipDryRun ?? false,
      connectivityTimeout: options?.connectivityTimeout ?? 5000,
      dnsTimeout: options?.dnsTimeout ?? 3000,
      httpTimeout: options?.httpTimeout ?? 10000,
      authCheckerOptions: options?.authCheckerOptions ?? {},
      proxyUrl: options?.proxyUrl,
      executableCheckTimeout: options?.executableCheckTimeout ?? 5000,
      env: options?.env ?? (process.env as Record<string, string | undefined>),
      homeDir: options?.homeDir ?? os.homedir(),
      platform: options?.platform ?? process.platform,
      maxConcurrency: options?.maxConcurrency ?? 3,
      dryRunTimeout: options?.dryRunTimeout ?? 60000,
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
    this.logger.debug(`=== Starting validation for agent: ${agentType} ===`);
    const checks = await this.runChecks(agentType);
    this.logger.debug(`Checks completed for ${agentType}: ${JSON.stringify(checks.map(c => ({ name: c.name, passed: c.passed, errorType: c.errorType, warning: c.warning })))}`);
    const result = this.buildVerificationResult(agentType, checks);
    this.logger.debug(`Final result for ${agentType}: status=${result.status}, error=${result.error}, warnings=${result.warnings}`);
    return result;
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
   *
   * Check order:
   * 1. Executable check (blocking if failed)
   * 2. Connectivity check
   * 3. Auth check
   * 4. Dry-run check (actual CLI invocation)
   */
  private async runChecks(agentType: string): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    // 1. Executable file check
    const execCheck = await this.checkExecutable(agentType);
    checks.push(execCheck);

    // If executable doesn't exist, no need to continue checking
    // Add placeholder checks to show user what was skipped
    if (!execCheck.passed && execCheck.errorType === 'CONFIG_MISSING') {
      checks.push({
        name: 'Connectivity Check',
        passed: false,
        message: 'Skipped (executable not found)',
        errorType: 'CONFIG_MISSING',
      });
      checks.push({
        name: 'Auth Check',
        passed: false,
        message: 'Skipped (executable not found)',
        errorType: 'CONFIG_MISSING',
      });
      checks.push({
        name: 'Dry-Run Check',
        passed: false,
        message: 'Skipped (executable not found)',
        errorType: 'CONFIG_MISSING',
      });
      return checks;
    }

    // 2. Connectivity check
    const connectivityCheck = this.options.skipConnectivityCheck
      ? { name: 'Connectivity Check', passed: true, message: 'Skipped' }
      : await this.checkConnectivity(agentType);
    checks.push(connectivityCheck);

    // 3. Authentication check
    const authCheck = await this.checkAuth(agentType);
    checks.push(authCheck);

    // 4. Dry-run check (actual CLI invocation)
    const dryRunCheck = this.options.skipDryRun
      ? { name: 'Dry-Run Check', passed: true, message: 'Skipped' }
      : await this.checkDryRun(agentType);
    checks.push(dryRunCheck);

    return checks;
  }

  /**
   * Build verification result
   *
   * Verification logic:
   * 1. If CLI Command Check failed → FAIL
   * 2. Count failures in remaining 3 checks (Connectivity, Auth, Dry-Run)
   *    - 0 failures → verified
   *    - 1 failure → verified_with_warnings
   *    - 2+ failures → failed
   */
  private buildVerificationResult(
    name: string,
    checks: CheckResult[]
  ): VerificationResult {
    // Collect all warnings
    const warnings = checks.filter((c) => c.warning).map((c) => c.warning!);

    // Find auth method (from successful auth check)
    const authCheck = checks.find(
      (c) => c.name === 'Auth Check' && c.passed
    ) as CheckResultWithAuthMethod | undefined;

    // Check 1: CLI Command Check - if failed, overall fails
    const execCheck = checks.find((c) => c.name === 'CLI Command Check');
    if (execCheck && !execCheck.passed) {
      return {
        name,
        status: 'failed',
        checks,
        error: execCheck.message,
        errorType: execCheck.errorType,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    // Check 2: Count failures in remaining checks (Connectivity, Auth, Dry-Run)
    const remainingChecks = checks.filter(
      (c) => c.name !== 'CLI Command Check'
    );
    const failedChecks = remainingChecks.filter((c) => !c.passed);
    const failureCount = failedChecks.length;

    this.logger.debug(`[buildVerificationResult] ${name}: ${failureCount} failures in remaining checks`);
    this.logger.debug(`[buildVerificationResult] Failed checks: ${JSON.stringify(failedChecks.map(c => c.name))}`);

    // 2+ failures → failed
    if (failureCount >= 2) {
      // Find the most significant error to report
      const primaryError = failedChecks[0];
      return {
        name,
        status: 'failed',
        checks,
        error: `Multiple checks failed: ${failedChecks.map(c => c.name).join(', ')}`,
        errorType: primaryError?.errorType,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    // 1 failure → verified_with_warnings
    if (failureCount === 1) {
      const failedCheck = failedChecks[0];
      // Add the failure as a warning
      const allWarnings = [
        ...warnings,
        `${failedCheck.name} failed: ${failedCheck.message}`,
      ];
      return {
        name,
        status: 'verified_with_warnings',
        checks,
        warnings: allWarnings,
        authMethod: authCheck?.authMethod,
      };
    }

    // 0 failures
    if (warnings.length > 0) {
      return {
        name,
        status: 'verified_with_warnings',
        checks,
        warnings,
        authMethod: authCheck?.authMethod,
      };
    }

    return {
      name,
      status: 'verified',
      checks,
      authMethod: authCheck?.authMethod,
    };
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
        name: 'CLI Command Check',
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
          name: 'CLI Command Check',
          passed: false,
          message: `${command} not found`,
          errorType: 'CONFIG_MISSING',
          resolution: this.getInstallInstructions(agentType),
        };
      }

      // Permission error → command may exist but can't execute
      if (err.code === 'EACCES' || err.code === 126) {
        return {
          name: 'CLI Command Check',
          passed: true, // Pass, let subsequent checks continue
          message: `${command} may exist but permission denied`,
          warning: `Permission error checking ${command}. Check file permissions.`,
        };
      }

      // Timeout
      if (err.killed || err.signal === 'SIGTERM') {
        return {
          name: 'CLI Command Check',
          passed: true, // Assume exists, continue checking
          message: `Executable check timed out for ${command}`,
          warning: `Timeout checking ${command}. Proceeding with verification.`,
        };
      }

      // Other unknown errors → uncertain, pass but warn
      return {
        name: 'CLI Command Check',
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
   *
   * @remarks
   * Performs three layers of checks:
   * - Layer 3: DNS resolution
   * - Layer 4: TCP connection
   * - Layer 7: HTTP request (detect region restrictions)
   */
  private async checkConnectivity(agentType: string): Promise<CheckResult> {
    this.logger.debug(`[checkConnectivity] Starting for ${agentType}`);
    this.logger.debug(`[checkConnectivity] Options: skipHttpCheck=${this.options.skipHttpCheck}, httpTimeout=${this.options.httpTimeout}`);

    // Pass configured timeout parameters
    const result = await checkConnectivity(agentType, {
      connectivityTimeout: this.options.connectivityTimeout,
      dnsTimeout: this.options.dnsTimeout,
      httpTimeout: this.options.httpTimeout,
      skipHttpCheck: this.options.skipHttpCheck,
      proxyUrl: this.options.proxyUrl,
      logger: this.logger,
    });

    this.logger.debug(`[checkConnectivity] Result for ${agentType}: ${JSON.stringify(result)}`);

    if (result.reachable) {
      this.logger.debug(`[checkConnectivity] ${agentType} is reachable`);
      return {
        name: 'Connectivity Check',
        passed: true,
        message: `API reachable (${result.latencyMs}ms)`,
        proxyUsed: result.proxyUsed,
      };
    }

    this.logger.debug(`[checkConnectivity] ${agentType} not reachable, errorType: ${result.errorType}`);

    // HTTP layer errors (Layer 7) - all HTTP failures should be passed: false
    if (result.errorType?.startsWith('NETWORK_HTTP_')) {
      const hint = result.httpResponseHint
        ? ` Response: "${result.httpResponseHint}"`
        : '';

      // HTTP 403 - possible region restriction
      if (result.errorType === 'NETWORK_HTTP_FORBIDDEN') {
        return {
          name: 'Connectivity Check',
          passed: false,
          message: `HTTP 403 from API.${hint}`,
          errorType: result.errorType,
          resolution:
            'Possible causes: (1) IP in restricted region; (2) Access restrictions. ' +
            'If in supported region, try re-authenticating or using a VPN.',
          proxyUsed: result.proxyUsed,
        };
      }

      // HTTP 429 - rate limited
      if (result.errorType === 'NETWORK_HTTP_ERROR' && result.httpStatusCode === 429) {
        return {
          name: 'Connectivity Check',
          passed: false,
          message: `HTTP 429 - Rate limited`,
          errorType: result.errorType,
          resolution: 'API is rate limiting requests. Wait and try again.',
          proxyUsed: result.proxyUsed,
        };
      }

      // HTTP 5xx - service unavailable
      if (result.errorType === 'NETWORK_HTTP_UNAVAILABLE') {
        return {
          name: 'Connectivity Check',
          passed: false,
          message: `HTTP ${result.httpStatusCode} - Service unavailable`,
          errorType: result.errorType,
          resolution: 'API service may be down. Check provider status page.',
          proxyUsed: result.proxyUsed,
        };
      }

      // Other HTTP errors
      return {
        name: 'Connectivity Check',
        passed: false,
        message: `HTTP ${result.httpStatusCode} from API${hint}`,
        errorType: result.errorType,
        resolution: 'Check network connection and try again.',
        proxyUsed: result.proxyUsed,
      };
    }

    // Layer 3-4 errors - DNS, TCP, TLS, etc. - also passed: false
    return {
      name: 'Connectivity Check',
      passed: false,
      message: result.error || 'Cannot reach API',
      errorType: result.errorType,
      resolution: 'Check network connection, firewall, or VPN settings.',
      proxyUsed: result.proxyUsed,
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
   * Execute dry-run check - actually invoke the CLI to verify it works
   *
   * @param agentType - Agent type
   * @returns Check result
   *
   * @remarks
   * This is the most reliable check - it actually invokes the CLI with a simple
   * prompt to verify end-to-end functionality. Detects issues that other checks miss:
   * - Network issues from CLI's perspective (proxy, firewall)
   * - API authentication issues at runtime
   * - Region restrictions that only manifest at runtime
   */
  private async checkDryRun(agentType: string): Promise<CheckResult> {
    this.logger.debug(`[checkDryRun] Starting for ${agentType}`);

    const command = this.getDryRunCommand(agentType);
    const cwd = process.cwd();
    if (!command) {
      return {
        name: 'Dry-Run Check',
        passed: true,
        message: 'No dry-run command configured',
        warning: `Cannot perform dry-run check for ${agentType}`,
      };
    }

    this.logger.debug(`[checkDryRun] Command: ${command}`);
    this.logger.debug(`[checkDryRun] CWD: ${cwd}`);
    const start = Date.now();

    // Avoid propagating DEBUG to agent CLI (some CLIs change behavior or hang under DEBUG)
    const execEnv: NodeJS.ProcessEnv = { ...this.options.env } as NodeJS.ProcessEnv;
    if ('DEBUG' in execEnv) {
      delete execEnv.DEBUG;
    }

    this.logger.debug(`[checkDryRun] Env keys: ${Object.keys(execEnv).slice(0, 5).join(', ')}...`);

    // Use spawn with stdin ignored to prevent TTY/raw mode issues (especially for Claude CLI)
    // Claude CLI uses Ink which requires raw mode on stdin - by ignoring stdin we avoid this
    this.logger.debug(`[checkDryRun] spawn options: cwd=${cwd}, timeout=${this.options.dryRunTimeout}`);

    try {
      const result = await this.spawnWithTimeout(command, {
        cwd,
        env: execEnv,
        timeout: this.options.dryRunTimeout,
      });

      this.logger.debug(`[checkDryRun] stdout: ${result.stdout.slice(0, 500)}`);
      this.logger.debug(`[checkDryRun] stderr: ${result.stderr.slice(0, 500)}`);
      this.logger.debug(`[checkDryRun] Completed in ${Date.now() - start}ms, exitCode=${result.exitCode}`);

      // Check for error patterns in output
      const errorInfo = this.parseDryRunOutput(agentType, result.stdout, result.stderr);

      if (errorInfo) {
        this.logger.debug(`[checkDryRun] Detected error: ${errorInfo.message}`);
        return {
          name: 'Dry-Run Check',
          passed: false,
          message: errorInfo.message,
          errorType: 'DRYRUN_FAILED',
          resolution: errorInfo.resolution,
        };
      }

      // Non-zero exit code without recognized error pattern
      if (result.exitCode !== 0) {
        return {
          name: 'Dry-Run Check',
          passed: false,
          message: `CLI exited with code ${result.exitCode}`,
          errorType: 'DRYRUN_FAILED',
          resolution: 'Run the CLI manually to diagnose the issue.',
        };
      }

      return {
        name: 'Dry-Run Check',
        passed: true,
        message: 'CLI responded successfully',
      };
    } catch (error: unknown) {
      const err = error as { message?: string; timedOut?: boolean };

      this.logger.debug(`[checkDryRun] Error:`, err);
      this.logger.debug(`[checkDryRun] Duration=${Date.now() - start}ms`);

      // Timeout
      if (err.timedOut) {
        return {
          name: 'Dry-Run Check',
          passed: false,
          message: 'CLI timed out',
          errorType: 'DRYRUN_TIMEOUT',
          resolution: `CLI did not respond within ${this.options.dryRunTimeout}ms. If agent doesn't respond in conversation, check network.`,
        };
      }

      return {
        name: 'Dry-Run Check',
        passed: false,
        message: `CLI error: ${(err.message || 'Unknown error').slice(0, 200)}`,
        errorType: 'DRYRUN_FAILED',
        resolution: 'Run the CLI manually to diagnose the issue.',
      };
    }
  }

  /**
   * Get the dry-run command for an agent type
   */
  private getDryRunCommand(agentType: string): string | null {
    // Simple test prompt - just needs to trigger API communication
    const testPrompt = 'Reply with just the word OK';

    const commands: Record<string, string> = {
      // Claude: use print mode to avoid interactive behavior
      claude: `claude --print --output-format stream-json --verbose "${testPrompt}"`,
      // Codex: simple exec
      codex: `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --json "${testPrompt}"`,
      // Gemini: yolo mode
      gemini: `gemini --yolo --output-format stream-json "${testPrompt}"`,
    };

    return commands[agentType] || null;
  }

  /**
   * Parse dry-run output to detect errors
   */
  private parseDryRunOutput(
    agentType: string,
    stdout: string,
    stderr: string
  ): { message: string; resolution: string } | null {
    const combined = stdout + stderr;

    // Check for common error patterns
    // API Error patterns
    if (combined.includes('API Error') || combined.includes('"status":"error"')) {
      // Try to extract the error message
      const apiErrorMatch = combined.match(/API Error[:\s]*([^\n\r]+)/i);
      const jsonErrorMatch = combined.match(/"message"\s*:\s*"([^"]+)"/);
      const errorMsg = apiErrorMatch?.[1] || jsonErrorMatch?.[1] || 'API communication failed';

      // Check for specific error types
      if (combined.includes('403') || combined.includes('forbidden') || combined.includes('Request not allowed')) {
        return {
          message: `API returned 403 Forbidden: ${errorMsg}`,
          resolution: 'Possible region restriction or access denied. Try using a VPN or check account status.',
        };
      }

      if (combined.includes('401') || combined.includes('unauthorized') || combined.includes('authentication')) {
        return {
          message: `Authentication failed: ${errorMsg}`,
          resolution: 'Run the login command to authenticate.',
        };
      }

      if (combined.includes('fetch failed') || combined.includes('network') || combined.includes('ECONNREFUSED')) {
        return {
          message: `Network error: ${errorMsg}`,
          resolution: 'Check network connection, firewall, or proxy settings.',
        };
      }

      return {
        message: errorMsg,
        resolution: 'Run the CLI manually to diagnose the issue.',
      };
    }

    // Check for authentication errors
    if (combined.includes('not authenticated') || combined.includes('login required') || combined.includes('no credentials')) {
      return {
        message: 'Not authenticated',
        resolution: `Run: ${agentType} auth login`,
      };
    }

    // No error detected
    return null;
  }

  /**
   * Spawn a command with timeout and stdin ignored
   * This is needed for CLIs like Claude that use Ink and require TTY raw mode
   * By ignoring stdin, we prevent the TTY raw mode error
   */
  private spawnWithTimeout(
    command: string,
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      timeout: number;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // Use shell: true to parse the command string
      const child = spawn(command, [], {
        shell: true,
        cwd: options.cwd,
        env: options.env,
        // Key fix: ignore stdin to prevent TTY raw mode issues
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Set up timeout
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        // Give it a moment to terminate gracefully, then force kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 1000);
      }, options.timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          reject({ message: 'Command timed out', timedOut: true });
        } else {
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject({ message: err.message, timedOut: false });
      });
    });
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
