/**
 * AgentValidator - Agent availability and authentication verification
 *
 * @file src/registry/AgentValidator.ts
 *
 * @remarks
 * This is an adapter that delegates to the new validation module
 * at src/services/validation/AgentValidator.ts for actual verification logic.
 *
 * @deprecated The direct usage of this class is deprecated.
 * Use src/services/validation/AgentValidator directly for new code.
 */

import type { AgentDefinition } from './RegistryStorage.js';
import type { VerificationResult, CheckResult } from './AgentRegistry.js';
import { AgentValidator as NewAgentValidator } from '../services/validation/AgentValidator.js';
import type { AgentValidatorOptions as NewAgentValidatorOptions } from '../services/validation/AgentValidator.js';
import type {
  VerificationResult as NewVerificationResult,
  CheckResult as NewCheckResult,
} from '../services/validation/types.js';

// Re-export for use in AgentRegistry
export type { AgentValidatorOptions } from '../services/validation/AgentValidator.js';

/**
 * AgentValidator class
 *
 * Adapter that wraps the new validation module while maintaining
 * backwards compatibility with the existing AgentRegistry interface.
 */
export class AgentValidator {
  private readonly newValidator: NewAgentValidator;

  constructor(options?: NewAgentValidatorOptions) {
    // Initialize new validator with provided options
    // Enable connectivity check by default with new implementation
    this.newValidator = new NewAgentValidator({
      skipConnectivityCheck: false,
      ...options
    });
  }

  /**
   * Verify agent availability
   * Delegates to the new validation module
   */
  async verify(agent: AgentDefinition): Promise<VerificationResult> {
    const newResult = await this.newValidator.validateAgent(agent.name);
    return this.convertResult(newResult, agent.name);
  }

  /**
   * Verify with timeout
   */
  async verifyWithTimeout(
    agent: AgentDefinition,
    timeoutMs: number = 30000
  ): Promise<VerificationResult> {
    return Promise.race([
      this.verify(agent),
      new Promise<VerificationResult>((_, reject) =>
        setTimeout(
          () => reject(new Error('Verification timeout')),
          timeoutMs
        )
      )
    ]).catch((error) => ({
      name: agent.name,
      status: 'failed' as const,
      error: error.message || 'Verification timeout',
      checks: []
    }));
  }

  /**
   * Convert new VerificationResult to legacy format
   */
  private convertResult(
    newResult: NewVerificationResult,
    name: string
  ): VerificationResult {
    // Pass through status directly - legacy interface now supports verified_with_warnings
    const result: VerificationResult = {
      name,
      status: newResult.status,
      checks: newResult.checks.map(this.convertCheckResult),
      warnings: newResult.warnings
    };

    // Add error if failed
    if (newResult.status === 'failed' && newResult.error) {
      result.error = newResult.error;
    }

    return result;
  }

  /**
   * Convert new CheckResult to legacy format
   */
  private convertCheckResult(check: NewCheckResult): CheckResult {
    const result: CheckResult = {
      name: check.name,
      passed: check.passed,
      message: check.message,
      warning: check.warning
    };

    // Append resolution to message if present and check failed
    if (!check.passed && check.resolution) {
      result.message = `${check.message}. ${check.resolution}`;
    }

    return result;
  }
}
