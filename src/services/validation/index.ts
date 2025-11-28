/**
 * Agent Availability Verification - Public API
 *
 * @file src/services/validation/index.ts
 *
 * @example
 * ```typescript
 * import { AgentValidator } from './services/validation';
 *
 * const validator = new AgentValidator();
 * const result = await validator.validateAgent('claude');
 *
 * if (result.status === 'verified') {
 *   console.log(`Authenticated via: ${result.authMethod}`);
 * } else if (result.status === 'failed') {
 *   console.log(`Error: ${result.error}`);
 * }
 * ```
 */

// Types
export type {
  ErrorType,
  VerificationStatus,
  CheckResult,
  CheckResultWithAuthMethod,
  VerificationResult,
  ConnectivityResult,
  AuthCheckResult,
} from './types.js';

export {
  isBlockingError,
  isNetworkError,
  isAuthError,
  isConfigError,
  determineVerificationStatus,
  ErrorResolutions,
} from './types.js';

// Connectivity Checker
export { checkConnectivity } from './ConnectivityChecker.js';
export type { ConnectivityCheckerOptions } from './ConnectivityChecker.js';

// Auth Checker
export type {
  AuthChecker,
  AuthCheckerOptions,
  StatusCommandResult,
} from './auth/AuthChecker.js';

export {
  BaseAuthChecker,
  getAuthChecker,
  registerAuthChecker,
  getRegisteredAgentTypes,
  isAgentTypeRegistered,
} from './auth/AuthChecker.js';

// Specific Auth Checkers
export { ClaudeAuthChecker } from './auth/ClaudeAuthChecker.js';
export { CodexAuthChecker } from './auth/CodexAuthChecker.js';
export { GeminiAuthChecker } from './auth/GeminiAuthChecker.js';

// Agent Validator (main entry point)
export { AgentValidator } from './AgentValidator.js';
export type { AgentValidatorOptions } from './AgentValidator.js';
