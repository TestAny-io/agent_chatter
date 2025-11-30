/**
 * ClaudeAuthChecker - Claude Code CLI Authentication Checker
 *
 * @file src/services/validation/auth/ClaudeAuthChecker.ts
 * @layer Core
 *
 * @remarks
 * - Detects Claude Code CLI authentication status
 * - Supports multiple auth methods: API Key, OAuth, Bedrock, Vertex AI
 * - Handles macOS Keychain cases where credentials cannot be read directly
 */

import {
  BaseAuthChecker,
  registerAuthChecker,
} from './AuthChecker.js';
import type { AuthCheckerOptions } from './AuthChecker.js';
import type { AuthCheckResult } from '../types.js';

// ===== Constants =====

/**
 * Claude authentication related environment variables
 */
const ENV_VARS = {
  /** Primary API Key */
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  /** Secondary API Key (legacy compatibility) */
  CLAUDE_API_KEY: 'CLAUDE_API_KEY',
  /** Bedrock mode switch */
  CLAUDE_CODE_USE_BEDROCK: 'CLAUDE_CODE_USE_BEDROCK',
  /** Vertex AI mode switch */
  CLAUDE_CODE_USE_VERTEX: 'CLAUDE_CODE_USE_VERTEX',
  /** AWS credentials */
  AWS_ACCESS_KEY_ID: 'AWS_ACCESS_KEY_ID',
  AWS_SECRET_ACCESS_KEY: 'AWS_SECRET_ACCESS_KEY',
  /** GCP credentials */
  GOOGLE_APPLICATION_CREDENTIALS: 'GOOGLE_APPLICATION_CREDENTIALS',
} as const;

/**
 * Claude credential file paths (relative to home directory)
 */
const CREDENTIAL_PATHS = {
  /** Linux OAuth credentials (new path) */
  LINUX_CREDENTIALS: '.claude/.credentials.json',
  /** Linux config directory credentials (XDG spec path) */
  LINUX_CONFIG_CREDENTIALS: '.config/claude/credentials.json',
  /** Main config file */
  MAIN_CONFIG: '.claude.json',
  /** Settings file */
  SETTINGS: '.claude/settings.json',
  /** XDG config path */
  XDG_CONFIG: '.config/claude/config.json',
} as const;

/**
 * AWS credentials path (relative to home directory)
 */
const AWS_CREDENTIALS_PATH = '.aws/credentials';

/**
 * GCP ADC path (relative to home directory)
 */
const GCP_ADC_PATH = '.config/gcloud/application_default_credentials.json';

// ===== Implementation =====

export class ClaudeAuthChecker extends BaseAuthChecker {
  readonly agentType = 'claude';
  readonly command = 'claude';

  /** Status command unavailable reason */
  private statusCommandUnavailableReason?: string;

  /** Bedrock credential missing warning */
  private bedrockModeWarning?: string;

  /** Vertex credential missing warning */
  private vertexModeWarning?: string;

  constructor(options?: AuthCheckerOptions) {
    super(options);
  }

  /**
   * Execute Claude authentication check
   *
   * Check order:
   * 1. Environment variables (ANTHROPIC_API_KEY, CLAUDE_API_KEY)
   * 2. Bedrock mode
   * 3. Vertex AI mode
   * 4. CLI status command (claude auth status)
   * 5. Credential files
   */
  async checkAuth(): Promise<AuthCheckResult> {
    // Priority 1: Environment variables
    const envResult = this.checkEnvVars();
    if (envResult) {
      return envResult;
    }

    // Priority 2: Bedrock mode
    const bedrockResult = await this.checkBedrockMode();
    if (bedrockResult) {
      return bedrockResult;
    }

    // Priority 3: Vertex AI mode
    const vertexResult = await this.checkVertexMode();
    if (vertexResult) {
      return vertexResult;
    }

    // Priority 4: CLI status command
    const statusResult = await this.checkStatusCommand();
    if (statusResult) {
      return statusResult;
    }

    // Priority 5: Credential files
    const fileResult = this.checkCredentialFiles();
    if (fileResult) {
      return fileResult;
    }

    // All checks failed
    // Build failure result with possible Bedrock/Vertex warnings
    const result = this.failureResult(
      'AUTH_MISSING',
      'No credentials found',
      'Run: claude auth login (or set ANTHROPIC_API_KEY)'
    );

    // Attach config mode warnings (help user understand why configured mode didn't work)
    const warnings: string[] = [];
    if (this.bedrockModeWarning) {
      warnings.push(this.bedrockModeWarning);
    }
    if (this.vertexModeWarning) {
      warnings.push(this.vertexModeWarning);
    }
    if (warnings.length > 0) {
      result.warning = warnings.join(' | ');
    }

    return result;
  }

  // ===== Private Methods =====

  /**
   * Check environment variables
   */
  private checkEnvVars(): AuthCheckResult | null {
    if (this.hasEnv(ENV_VARS.ANTHROPIC_API_KEY)) {
      return this.successResult('ANTHROPIC_API_KEY env var');
    }

    if (this.hasEnv(ENV_VARS.CLAUDE_API_KEY)) {
      return this.successResult('CLAUDE_API_KEY env var (legacy)');
    }

    return null;
  }

  /**
   * Check AWS Bedrock mode
   *
   * @remarks
   * When Bedrock mode enabled but credentials missing, record warning and continue.
   * Reason:
   * 1. This is a config dependency issue (AWS credentials), not Claude auth issue
   * 2. CONFIG_DEPENDENCY is non-blocking WARN, AUTH_MISSING is blocking
   * 3. User may have other auth methods available, should not block continued checking
   */
  private async checkBedrockMode(): Promise<AuthCheckResult | null> {
    const bedrockEnabled =
      this.getEnv(ENV_VARS.CLAUDE_CODE_USE_BEDROCK) === '1';

    if (!bedrockEnabled) {
      return null;
    }

    // Bedrock mode enabled, check AWS credentials
    if (this.checkAWSCredentials()) {
      return this.successResult('AWS Bedrock');
    }

    // Bedrock mode enabled but credentials missing
    // Record warning but don't block, continue checking other auth methods
    this.bedrockModeWarning =
      'Bedrock mode enabled but AWS credentials missing. ' +
      'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure ~/.aws/credentials';
    return null;
  }

  /**
   * Check AWS credentials
   */
  private checkAWSCredentials(): boolean {
    // Check environment variables
    if (
      this.hasEnv(ENV_VARS.AWS_ACCESS_KEY_ID) &&
      this.hasEnv(ENV_VARS.AWS_SECRET_ACCESS_KEY)
    ) {
      return true;
    }

    // Check credentials file
    const awsCredsPath = this.getHomePath(AWS_CREDENTIALS_PATH);
    return this.fileExists(awsCredsPath);
  }

  /**
   * Check Google Vertex AI mode
   *
   * @remarks
   * Similar to Bedrock, when credentials missing don't block, continue checking other auth methods.
   */
  private async checkVertexMode(): Promise<AuthCheckResult | null> {
    const vertexEnabled = this.getEnv(ENV_VARS.CLAUDE_CODE_USE_VERTEX) === '1';

    if (!vertexEnabled) {
      return null;
    }

    // Vertex mode enabled, check GCP credentials
    if (this.checkGCPCredentials()) {
      return this.successResult('Vertex AI');
    }

    // Vertex mode enabled but credentials missing
    // Record warning but don't block, continue checking other auth methods
    this.vertexModeWarning =
      'Vertex AI mode enabled but GCP credentials missing. ' +
      'Set GOOGLE_APPLICATION_CREDENTIALS or run: gcloud auth application-default login';
    return null;
  }

  /**
   * Check GCP credentials
   */
  private checkGCPCredentials(): boolean {
    // Check service account environment variable
    const saPath = this.getEnv(ENV_VARS.GOOGLE_APPLICATION_CREDENTIALS);
    if (saPath && this.fileExists(saPath)) {
      return true;
    }

    // Check ADC
    const adcPath = this.getHomePath(GCP_ADC_PATH);
    return this.fileExists(adcPath);
  }

  /**
   * Check CLI status command
   *
   * @remarks
   * - Command: claude auth status
   * - Exit code 0 usually means authenticated
   * - Known issue: GitHub Issue #8002 reports status command may give false results
   *
   * @returns
   * - AuthCheckResult if status can be determined
   * - null if command unavailable or result uncertain
   */
  private async checkStatusCommand(): Promise<AuthCheckResult | null> {
    const result = await this.executeStatusCommand(['auth', 'status']);

    // Command unavailable, record reason for later decision
    if (!result.available) {
      // Save to instance for checkCredentialFiles to use
      this.statusCommandUnavailableReason = result.reason;
      return null;
    }

    // Network error, can't determine not authenticated
    if (result.networkError) {
      this.statusCommandUnavailableReason = 'NETWORK_ERROR';
      return null;
    }

    const output = result.output?.toLowerCase() || '';

    // Parse output
    if (this.isAuthenticatedOutput(output)) {
      return this.successResult('OAuth session');
    }

    // Only return failure on explicit "not authenticated" status
    if (this.isNotAuthenticatedOutput(output)) {
      return this.failureResult(
        'AUTH_MISSING',
        'Not logged in',
        'Run: claude auth login'
      );
    }

    // Output uncertain (may be false report), mark and fallback to file check
    this.statusCommandUnavailableReason = 'AMBIGUOUS_OUTPUT';
    return null;
  }

  /**
   * Check if output indicates authenticated
   */
  private isAuthenticatedOutput(output: string): boolean {
    return (
      output.includes('authenticated') ||
      output.includes('logged in') ||
      output.includes('session active')
    );
  }

  /**
   * Check if output indicates not authenticated
   */
  private isNotAuthenticatedOutput(output: string): boolean {
    return (
      output.includes('not authenticated') ||
      output.includes('not logged in') ||
      output.includes('please login') ||
      output.includes('no credentials')
    );
  }

  /**
   * Check credential files
   *
   * @remarks
   * - macOS: Credentials stored in Keychain, cannot read directly
   * - Linux: Credentials stored in ~/.claude/.credentials.json or ~/.config/claude/credentials.json
   * - Windows: Credentials stored in Windows Credential Manager
   *
   * WARN passthrough strategy:
   * - When status command unavailable/uncertain and credential files exist, return WARN passthrough
   * - When macOS Keychain cannot be read, return WARN passthrough
   * - Avoid false negatives: prefer letting runtime discover issues over blocking possibly authenticated users
   */
  private checkCredentialFiles(): AuthCheckResult | null {
    const platform = this.getPlatform();

    // Linux: Check credential files
    if (platform === 'linux') {
      const credsPaths = [
        this.getHomePath(CREDENTIAL_PATHS.LINUX_CREDENTIALS),
        this.getHomePath(CREDENTIAL_PATHS.LINUX_CONFIG_CREDENTIALS),
      ];

      for (const credsPath of credsPaths) {
        if (this.fileExists(credsPath)) {
          const creds = this.readJsonFile<{
            accessToken?: string;
            refreshToken?: string;
          }>(credsPath);

          if (creds?.accessToken || creds?.refreshToken) {
            // Status command unavailable but file exists → WARN passthrough
            if (this.statusCommandUnavailableReason) {
              return {
                passed: true,
                method: 'OAuth credentials file',
                warning:
                  `Status command unavailable (${this.statusCommandUnavailableReason}). ` +
                  'Proceeding with local credentials. If auth fails at runtime, run: claude auth login',
              };
            }
            return this.successResult('OAuth credentials file');
          }
        }
      }
    }

    // macOS: Cannot read Keychain directly
    if (platform === 'darwin') {
      // If status command explicitly returned "not authenticated", already handled in checkStatusCommand
      // Here only handle status command unavailable/uncertain cases
      // Return success with warning to avoid blocking possibly authenticated users (no false negative)
      return {
        passed: true,
        method: 'OAuth (Keychain)',
        warning:
          'Cannot verify Keychain credentials directly. ' +
          `Status check: ${this.statusCommandUnavailableReason || 'not performed'}. ` +
          'If auth fails at runtime, run: claude auth login',
      };
    }

    // Windows: Similar to macOS, credentials in Credential Manager
    if (platform === 'win32') {
      return {
        passed: true,
        method: 'OAuth (Credential Manager)',
        warning:
          'Cannot verify Windows Credential Manager directly. ' +
          `Status check: ${this.statusCommandUnavailableReason || 'not performed'}. ` +
          'If auth fails at runtime, run: claude auth login',
      };
    }

    // Check API key helper in main config
    const configPaths = [
      this.getHomePath(CREDENTIAL_PATHS.MAIN_CONFIG),
      this.getHomePath(CREDENTIAL_PATHS.SETTINGS),
      this.getHomePath(CREDENTIAL_PATHS.XDG_CONFIG),
    ];

    for (const configPath of configPaths) {
      if (this.fileExists(configPath)) {
        const config = this.readJsonFile<{ apiKeyHelper?: string }>(configPath);
        if (config?.apiKeyHelper) {
          return this.successResult('API key helper script');
        }
      }
    }

    return null;
  }
}

// Register the checker
registerAuthChecker('claude', ClaudeAuthChecker);
