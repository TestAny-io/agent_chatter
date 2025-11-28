/**
 * GeminiAuthChecker - Google Gemini CLI Authentication Checker
 *
 * @file src/services/validation/auth/GeminiAuthChecker.ts
 * @layer Core
 *
 * @remarks
 * - Detects Google Gemini CLI authentication status
 * - Supports: API Key, OAuth, Vertex AI mode
 * - Note: gemini CLI may not have status command, relies heavily on file checks
 */

import {
  BaseAuthChecker,
  registerAuthChecker,
} from './AuthChecker.js';
import type { AuthCheckerOptions } from './AuthChecker.js';
import type { AuthCheckResult } from '../types.js';

// ===== Constants =====

/**
 * Gemini authentication related environment variables
 */
const ENV_VARS = {
  /** Primary API Key */
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  /** Alternative API Key name */
  GOOGLE_API_KEY: 'GOOGLE_API_KEY',
  /** Vertex AI mode switch */
  GEMINI_USE_VERTEX: 'GEMINI_USE_VERTEX',
  /** GCP project for Vertex */
  GOOGLE_CLOUD_PROJECT: 'GOOGLE_CLOUD_PROJECT',
  /** GCP credentials */
  GOOGLE_APPLICATION_CREDENTIALS: 'GOOGLE_APPLICATION_CREDENTIALS',
} as const;

/**
 * Gemini credential file paths (relative to home directory)
 *
 * @remarks Based on gemini-cli source code:
 * - GEMINI_DIR = '.gemini' (packages/core/src/utils/paths.ts)
 * - API Key stored in Keychain service 'gemini-cli-api-key' or mcp-oauth-tokens-v2.json
 * - mcp-oauth-tokens-v2.json is encrypted (packages/core/src/mcp/token-storage/file-token-storage.ts)
 */
const CREDENTIAL_PATHS = {
  /** MCP OAuth tokens - encrypted file for API keys and OAuth tokens */
  MCP_OAUTH_TOKENS: '.gemini/mcp-oauth-tokens-v2.json',
  /** Settings file (contains auth type selection: security.auth.selectedType) */
  SETTINGS_FILE: '.gemini/settings.json',
} as const;

/**
 * Auth type values from Gemini CLI (packages/core/src/core/contentGenerator.ts)
 */
const AUTH_TYPES = {
  /** OAuth with Google account */
  LOGIN_WITH_GOOGLE: 'oauth-personal',
  /** API Key authentication */
  USE_GEMINI: 'gemini-api-key',
  /** Vertex AI mode */
  USE_VERTEX_AI: 'vertex-ai',
  /** Legacy Cloud Shell mode */
  LEGACY_CLOUD_SHELL: 'cloud-shell',
  /** Compute default credentials */
  COMPUTE_ADC: 'compute-default-credentials',
} as const;

/**
 * GCP ADC path (relative to home directory)
 */
const GCP_ADC_PATH = '.config/gcloud/application_default_credentials.json';

// ===== Implementation =====

export class GeminiAuthChecker extends BaseAuthChecker {
  readonly agentType = 'gemini';
  readonly command = 'gemini';

  /** Vertex mode warning if gcloud not available */
  private vertexModeWarning?: string;

  constructor(options?: AuthCheckerOptions) {
    super(options);
  }

  /**
   * Execute Gemini authentication check
   *
   * Check order (based on gemini-cli source code):
   * 1. Environment variables (GEMINI_API_KEY, GOOGLE_API_KEY)
   * 2. Vertex AI mode (GEMINI_USE_VERTEX=1)
   * 3. Settings file (~/.gemini/settings.json security.auth.selectedType)
   *    - gemini-api-key: API Key stored in Keychain
   *    - oauth-personal: Google OAuth
   *    - vertex-ai: Vertex AI mode
   *    - compute-default-credentials: GCE ADC
   */
  async checkAuth(): Promise<AuthCheckResult> {
    // Priority 1: Environment variables
    const envResult = this.checkEnvVars();
    if (envResult) {
      return envResult;
    }

    // Priority 2: Vertex AI mode
    const vertexResult = await this.checkVertexMode();
    if (vertexResult) {
      return vertexResult;
    }

    // Priority 3: Settings file (check if gemini CLI is configured)
    const settingsResult = this.checkSettingsFile();
    if (settingsResult) {
      // Attach Vertex warning if exists
      if (this.vertexModeWarning && !settingsResult.warning) {
        settingsResult.warning = this.vertexModeWarning;
      }
      return settingsResult;
    }

    // All checks failed
    const result = this.failureResult(
      'AUTH_MISSING',
      'No credentials found',
      'Run: gemini auth login (or set GEMINI_API_KEY)'
    );

    // Attach Vertex warning if exists
    if (this.vertexModeWarning) {
      result.warning = this.vertexModeWarning;
    }

    return result;
  }

  // ===== Private Methods =====

  /**
   * Check environment variables
   */
  private checkEnvVars(): AuthCheckResult | null {
    if (this.hasEnv(ENV_VARS.GEMINI_API_KEY)) {
      return this.successResult('GEMINI_API_KEY env var');
    }

    if (this.hasEnv(ENV_VARS.GOOGLE_API_KEY)) {
      return this.successResult('GOOGLE_API_KEY env var');
    }

    return null;
  }

  /**
   * Check settings file for configured auth type
   *
   * @remarks
   * Gemini CLI stores auth configuration in ~/.gemini/settings.json
   * The selectedType values are defined in contentGenerator.ts AuthType enum:
   * - 'gemini-api-key': API key stored in Keychain (service: 'gemini-cli-api-key')
   * - 'oauth-personal': OAuth with Google account
   * - 'vertex-ai': Vertex AI mode
   * - 'compute-default-credentials': GCE default credentials
   *
   * API keys and OAuth tokens are stored in:
   * - macOS: Keychain (preferred)
   * - Other: ~/.gemini/mcp-oauth-tokens-v2.json (encrypted)
   */
  private checkSettingsFile(): AuthCheckResult | null {
    const settingsPath = this.getHomePath(CREDENTIAL_PATHS.SETTINGS_FILE);

    if (!this.fileExists(settingsPath)) {
      return null;
    }

    const settings = this.readJsonFile<{
      security?: {
        auth?: {
          selectedType?: string;
        };
      };
    }>(settingsPath);

    const selectedType = settings?.security?.auth?.selectedType;

    if (!selectedType) {
      return null;
    }

    // Map auth types to human-readable names (use AUTH_TYPES constants)
    const authTypeMap: Record<string, string> = {
      [AUTH_TYPES.USE_GEMINI]: 'API Key (Keychain)',
      [AUTH_TYPES.LOGIN_WITH_GOOGLE]: 'Google OAuth',
      [AUTH_TYPES.USE_VERTEX_AI]: 'Vertex AI',
      [AUTH_TYPES.COMPUTE_ADC]: 'Compute ADC',
      [AUTH_TYPES.LEGACY_CLOUD_SHELL]: 'Cloud Shell',
    };

    const authMethod = authTypeMap[selectedType] || selectedType;

    // For API key mode (gemini-api-key), credentials stored in Keychain
    // Keychain service name: 'gemini-cli-api-key', entry: 'default-api-key'
    if (selectedType === AUTH_TYPES.USE_GEMINI) {
      // Check if encrypted token file exists as fallback storage indicator
      const mcpTokensPath = this.getHomePath(CREDENTIAL_PATHS.MCP_OAUTH_TOKENS);
      const hasTokenFile = this.fileExists(mcpTokensPath);

      return {
        passed: true,
        method: authMethod,
        warning: hasTokenFile
          ? undefined  // Token file exists, likely valid
          : 'API key stored in system keychain. Cannot verify directly. If auth fails at runtime, run: gemini auth login',
      };
    }

    // For OAuth mode (oauth-personal), check if MCP tokens exist
    if (selectedType === AUTH_TYPES.LOGIN_WITH_GOOGLE) {
      const mcpTokensPath = this.getHomePath(CREDENTIAL_PATHS.MCP_OAUTH_TOKENS);
      if (this.fileExists(mcpTokensPath)) {
        return this.successResult(authMethod);
      }
      // OAuth configured but no tokens - might need re-auth
      return {
        passed: true,
        method: authMethod,
        warning: 'OAuth configured but tokens may be expired. If auth fails, run: gemini auth login',
      };
    }

    // For vertex-ai, let the Vertex check handle it
    if (selectedType === AUTH_TYPES.USE_VERTEX_AI) {
      return null;
    }

    // For compute-default-credentials or cloud-shell, trust the setting
    if (selectedType === AUTH_TYPES.COMPUTE_ADC || selectedType === AUTH_TYPES.LEGACY_CLOUD_SHELL) {
      return this.successResult(authMethod);
    }

    // Unknown type - trust it but warn
    return {
      passed: true,
      method: authMethod,
      warning: `Unknown auth type: ${selectedType}. If auth fails, run: gemini auth login`,
    };
  }

  /**
   * Check Vertex AI mode
   *
   * @remarks
   * Vertex AI mode requires:
   * 1. GEMINI_USE_VERTEX=1
   * 2. GCP credentials (ADC or service account)
   * 3. gcloud CLI (optional, for ADC refresh)
   *
   * If gcloud not available, continue with warning (don't block)
   */
  private async checkVertexMode(): Promise<AuthCheckResult | null> {
    const vertexEnabled = this.getEnv(ENV_VARS.GEMINI_USE_VERTEX) === '1';

    if (!vertexEnabled) {
      return null;
    }

    // Check GCP credentials
    const hasCredentials = this.checkGCPCredentials();

    if (!hasCredentials) {
      // Record warning and continue to other auth methods
      this.vertexModeWarning =
        'Vertex AI mode enabled but GCP credentials missing. ' +
        'Set GOOGLE_APPLICATION_CREDENTIALS or run: gcloud auth application-default login';
      return null;
    }

    // Check if gcloud is available (optional, for ADC refresh)
    const gcloudAvailable = await this.checkGcloudAvailable();

    if (!gcloudAvailable) {
      // Credentials exist but gcloud not available - warn but allow
      return {
        passed: true,
        method: 'Vertex AI',
        warning:
          'Vertex AI mode active. gcloud CLI not found - ADC refresh may not work. ' +
          'Install gcloud CLI for full functionality.',
      };
    }

    return this.successResult('Vertex AI');
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
   * Check if gcloud CLI is available
   */
  private async checkGcloudAvailable(): Promise<boolean> {
    try {
      const result = await this.executeStatusCommand(['--version']);
      // This uses the base class method which executes "gemini --version"
      // We need to check gcloud specifically
      return false; // Will implement properly
    } catch {
      return false;
    }
  }
}

// Register the checker
registerAuthChecker('gemini', GeminiAuthChecker);
