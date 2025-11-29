/**
 * Agent Availability Verification - Type Definitions
 *
 * @file src/services/validation/types.ts
 * @layer Core
 */

// ===== ErrorType =====

/**
 * Error type enumeration
 * Used to classify various errors encountered during verification
 */
export type ErrorType =
  // ===== Network Errors (OSI Layer 3-4: Network/Transport) =====
  // These errors only produce warnings, do not block verification
  | 'NETWORK_DNS' // DNS resolution failed
  | 'NETWORK_TIMEOUT' // Connection timeout
  | 'NETWORK_REFUSED' // Connection refused
  | 'NETWORK_UNREACHABLE' // Network unreachable
  | 'NETWORK_PROXY' // Proxy configuration issue
  | 'NETWORK_TLS' // TLS/SSL certificate issue

  // ===== Network Errors (OSI Layer 7: Application/HTTP) =====
  // HTTP layer errors - may indicate region restrictions or API issues
  | 'NETWORK_HTTP_FORBIDDEN' // HTTP 403 - possible region restriction or access denied
  | 'NETWORK_HTTP_UNAVAILABLE' // HTTP 5xx - service unavailable
  | 'NETWORK_HTTP_ERROR' // Other HTTP errors

  // ===== Authentication Errors (OSI Layer 7) =====
  // These errors block verification
  | 'AUTH_MISSING' // No credentials found
  | 'AUTH_INVALID' // API rejected credentials (401/403)
  | 'AUTH_EXPIRED' // Token/key expired
  | 'AUTH_PERMISSION' // Credentials valid but insufficient permissions

  // ===== Configuration Errors =====
  | 'CONFIG_MISSING' // Agent CLI not installed (blocking)
  | 'CONFIG_INVALID' // Invalid configuration (blocking)
  | 'CONFIG_VERSION' // Version incompatible (warning)
  | 'CONFIG_DEPENDENCY' // Missing external dependency like gcloud/aws cli (warning)

  // ===== Dry-Run Errors =====
  | 'DRYRUN_FAILED' // Dry-run test failed (CLI cannot communicate with API)
  | 'DRYRUN_TIMEOUT' // Dry-run test timed out

  // ===== Uncertain States =====
  // Pass with warning
  | 'VERIFICATION_INCOMPLETE' // Cannot fully verify, but local credentials exist
  | 'STATUS_COMMAND_UNAVAILABLE'; // CLI does not support status command

/**
 * Check if error type should block verification
 */
export function isBlockingError(errorType: ErrorType): boolean {
  const blockingTypes: ErrorType[] = [
    'AUTH_MISSING',
    'AUTH_INVALID',
    'AUTH_EXPIRED',
    'AUTH_PERMISSION',
    'CONFIG_MISSING',
    'CONFIG_INVALID',
  ];
  return blockingTypes.includes(errorType);
}

/**
 * Check if error is a network error
 */
export function isNetworkError(errorType: ErrorType): boolean {
  return errorType.startsWith('NETWORK_');
}

/**
 * Check if error is an auth error
 */
export function isAuthError(errorType: ErrorType): boolean {
  return errorType.startsWith('AUTH_');
}

/**
 * Check if error is a config error
 */
export function isConfigError(errorType: ErrorType): boolean {
  return errorType.startsWith('CONFIG_');
}

// ===== CheckResult =====

/**
 * Result of a single check item
 * e.g., environment variable check, file existence check, status command check
 */
export interface CheckResult {
  /** Check item name, e.g., "Environment Variable Check" */
  name: string;

  /** Whether check passed */
  passed: boolean;

  /** Result description (plain text, no formatting) */
  message: string;

  /** Error type (only when passed=false) */
  errorType?: ErrorType;

  /** Resolution suggestion (plain text), e.g., "Run: claude auth login" */
  resolution?: string;

  /** Non-blocking warning (may exist even when passed=true) */
  warning?: string;
}

/**
 * Extended CheckResult with auth method field
 * Used by Auth Check to pass authentication method information
 */
export interface CheckResultWithAuthMethod extends CheckResult {
  authMethod?: string;
}

// ===== VerificationResult =====

/**
 * Verification status enumeration
 */
export type VerificationStatus =
  | 'verified' // Fully verified
  | 'verified_with_warnings' // Verified but with warnings
  | 'failed'; // Verification failed

/**
 * Complete verification result for an Agent
 */
export interface VerificationResult {
  /** Agent name, e.g., "claude", "codex", "gemini" */
  name: string;

  /** Verification status */
  status: VerificationStatus;

  /** Primary error description (only when status='failed') */
  error?: string;

  /** Primary error type (only when status='failed') */
  errorType?: ErrorType;

  /** List of all warnings (plain text) */
  warnings?: string[];

  /** Detailed results of all check items */
  checks: CheckResult[];

  /** Authentication method (only when verification succeeds) */
  authMethod?: string;
}

/**
 * Determine final verification status based on check results
 */
export function determineVerificationStatus(
  checks: CheckResult[]
): VerificationStatus {
  // Any blocking error → failed
  const hasBlockingError = checks.some(
    (c) => !c.passed && c.errorType && isBlockingError(c.errorType)
  );
  if (hasBlockingError) {
    return 'failed';
  }

  // Has warnings but no blocking errors → verified_with_warnings
  const hasWarnings = checks.some((c) => c.warning);
  const hasNonBlockingErrors = checks.some(
    (c) => !c.passed && c.errorType && !isBlockingError(c.errorType)
  );
  if (hasWarnings || hasNonBlockingErrors) {
    return 'verified_with_warnings';
  }

  // All passed without warnings → verified
  return 'verified';
}

// ===== ConnectivityResult =====

/**
 * Network connectivity check result
 */
export interface ConnectivityResult {
  /** Whether reachable */
  reachable: boolean;

  /** Latency (ms), only when reachable=true */
  latencyMs?: number;

  /** Error description (only when reachable=false) */
  error?: string;

  /**
   * Error type (only when reachable=false)
   * Includes all NETWORK_* types
   */
  errorType?:
    // Layer 3-4 errors
    | 'NETWORK_DNS'
    | 'NETWORK_TIMEOUT'
    | 'NETWORK_REFUSED'
    | 'NETWORK_UNREACHABLE'
    | 'NETWORK_PROXY'
    | 'NETWORK_TLS'
    // Layer 7 errors
    | 'NETWORK_HTTP_FORBIDDEN'
    | 'NETWORK_HTTP_UNAVAILABLE'
    | 'NETWORK_HTTP_ERROR';

  /** HTTP status code (only for HTTP layer errors) */
  httpStatusCode?: number;

  /** HTTP response body snippet (only for HTTP layer errors, for diagnosis) */
  httpResponseHint?: string;
}

// ===== AuthCheckResult =====

/**
 * Authentication check result
 */
export interface AuthCheckResult {
  /** Whether authentication passed */
  passed: boolean;

  /** Authentication method (only when passed=true) */
  method?: string;

  /** Error description (only when passed=false) */
  message?: string;

  /** Error type (only when passed=false) */
  errorType?: ErrorType;

  /** Resolution suggestion (only when passed=false) */
  resolution?: string;

  /** Non-blocking warning */
  warning?: string;
}

// ===== Error Resolution Mapping =====

/**
 * Error type to resolution suggestion mapping
 * UI layer can use this to provide unified resolution suggestions
 */
export const ErrorResolutions: Record<ErrorType, string> = {
  // Network errors (Layer 3-4)
  NETWORK_DNS: 'Check internet connection. Try: ping api.anthropic.com',
  NETWORK_TIMEOUT: 'Network slow or blocked. Check firewall/VPN settings.',
  NETWORK_REFUSED: 'Server unavailable. Check if API endpoint is accessible.',
  NETWORK_UNREACHABLE: 'Network unreachable. Check network configuration.',
  NETWORK_PROXY: 'Configure proxy: export https_proxy=http://proxy:port',
  NETWORK_TLS: 'SSL issue. Corporate network? Set NODE_EXTRA_CA_CERTS.',

  // Network errors (Layer 7 - HTTP)
  NETWORK_HTTP_FORBIDDEN:
    'HTTP 403 Forbidden. Possible causes: ' +
    '(1) IP may be in a restricted region - check supported countries; ' +
    '(2) Account-level access restrictions; ' +
    '(3) Other authorization issues. ' +
    'If in a supported region, try re-authenticating.',
  NETWORK_HTTP_UNAVAILABLE:
    'API service unavailable (5xx). The service may be experiencing issues. ' +
    'Try again later or check the provider status page.',
  NETWORK_HTTP_ERROR:
    'HTTP error connecting to API. Check network and try again.',

  // Authentication errors
  AUTH_MISSING: 'No credentials found. Run the login command.',
  AUTH_INVALID: 'Credentials rejected. Re-run the login command.',
  AUTH_EXPIRED: 'Session expired. Run the login command to refresh.',
  AUTH_PERMISSION: 'Access denied. Check account permissions.',

  // Configuration errors
  CONFIG_MISSING: 'Agent not installed. Run: npm install -g <agent>',
  CONFIG_INVALID: 'Configuration invalid. Check config files.',
  CONFIG_VERSION: 'Version mismatch. Update agent: npm update -g <agent>',
  CONFIG_DEPENDENCY: 'External dependency missing. Install required CLI tool.',

  // Dry-run errors
  DRYRUN_FAILED:
    'CLI dry-run test failed. The agent cannot communicate with the API. ' +
    'Check network, credentials, or try running the CLI manually.',
  DRYRUN_TIMEOUT:
    'CLI dry-run test timed out. Network may be slow or blocked.',

  // Uncertain states
  VERIFICATION_INCOMPLETE:
    'Could not fully verify credentials. Proceeding with local credentials.',
  STATUS_COMMAND_UNAVAILABLE:
    'Status command not available in this CLI version.',
};
