/**
 * Unit tests for validation types and helper functions
 *
 * @file tests/unit/validation/types.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isBlockingError,
  determineVerificationStatus,
  isNetworkError,
  isAuthError,
  isConfigError,
} from '../../../src/services/validation/types.js';
import type {
  ErrorType,
  CheckResult,
  VerificationStatus,
} from '../../../src/services/validation/types.js';

describe('validation/types', () => {
  describe('isBlockingError', () => {
    it('should return true for AUTH_MISSING', () => {
      expect(isBlockingError('AUTH_MISSING')).toBe(true);
    });

    it('should return true for AUTH_EXPIRED', () => {
      expect(isBlockingError('AUTH_EXPIRED')).toBe(true);
    });

    it('should return true for AUTH_INVALID', () => {
      expect(isBlockingError('AUTH_INVALID')).toBe(true);
    });

    it('should return true for AUTH_PERMISSION', () => {
      expect(isBlockingError('AUTH_PERMISSION')).toBe(true);
    });

    it('should return true for CONFIG_MISSING', () => {
      expect(isBlockingError('CONFIG_MISSING')).toBe(true);
    });

    it('should return true for CONFIG_INVALID', () => {
      expect(isBlockingError('CONFIG_INVALID')).toBe(true);
    });

    it('should return false for CONFIG_DEPENDENCY', () => {
      expect(isBlockingError('CONFIG_DEPENDENCY')).toBe(false);
    });

    it('should return false for CONFIG_VERSION', () => {
      expect(isBlockingError('CONFIG_VERSION')).toBe(false);
    });

    it('should return false for NETWORK errors', () => {
      expect(isBlockingError('NETWORK_DNS')).toBe(false);
      expect(isBlockingError('NETWORK_TIMEOUT')).toBe(false);
      expect(isBlockingError('NETWORK_REFUSED')).toBe(false);
      expect(isBlockingError('NETWORK_UNREACHABLE')).toBe(false);
      expect(isBlockingError('NETWORK_TLS')).toBe(false);
      expect(isBlockingError('NETWORK_PROXY')).toBe(false);
    });

    it('should return false for uncertain states', () => {
      expect(isBlockingError('VERIFICATION_INCOMPLETE')).toBe(false);
      expect(isBlockingError('STATUS_COMMAND_UNAVAILABLE')).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('should return true for NETWORK_* errors', () => {
      expect(isNetworkError('NETWORK_DNS')).toBe(true);
      expect(isNetworkError('NETWORK_TIMEOUT')).toBe(true);
      expect(isNetworkError('NETWORK_REFUSED')).toBe(true);
      expect(isNetworkError('NETWORK_UNREACHABLE')).toBe(true);
      expect(isNetworkError('NETWORK_TLS')).toBe(true);
      expect(isNetworkError('NETWORK_PROXY')).toBe(true);
    });

    it('should return false for non-NETWORK errors', () => {
      expect(isNetworkError('AUTH_MISSING')).toBe(false);
      expect(isNetworkError('CONFIG_MISSING')).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('should return true for AUTH_* errors', () => {
      expect(isAuthError('AUTH_MISSING')).toBe(true);
      expect(isAuthError('AUTH_INVALID')).toBe(true);
      expect(isAuthError('AUTH_EXPIRED')).toBe(true);
      expect(isAuthError('AUTH_PERMISSION')).toBe(true);
    });

    it('should return false for non-AUTH errors', () => {
      expect(isAuthError('NETWORK_DNS')).toBe(false);
      expect(isAuthError('CONFIG_MISSING')).toBe(false);
    });
  });

  describe('isConfigError', () => {
    it('should return true for CONFIG_* errors', () => {
      expect(isConfigError('CONFIG_MISSING')).toBe(true);
      expect(isConfigError('CONFIG_INVALID')).toBe(true);
      expect(isConfigError('CONFIG_VERSION')).toBe(true);
      expect(isConfigError('CONFIG_DEPENDENCY')).toBe(true);
    });

    it('should return false for non-CONFIG errors', () => {
      expect(isConfigError('AUTH_MISSING')).toBe(false);
      expect(isConfigError('NETWORK_DNS')).toBe(false);
    });
  });

  describe('determineVerificationStatus', () => {
    it('should return "verified" when all checks pass without warnings', () => {
      const checks: CheckResult[] = [
        { name: 'Test 1', passed: true, message: 'OK' },
        { name: 'Test 2', passed: true, message: 'OK' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified');
    });

    it('should return "verified_with_warnings" when all checks pass but have warnings', () => {
      const checks: CheckResult[] = [
        { name: 'Test 1', passed: true, message: 'OK', warning: 'Something might be wrong' },
        { name: 'Test 2', passed: true, message: 'OK' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified_with_warnings');
    });

    it('should return "failed" when any check fails with blocking error', () => {
      const checks: CheckResult[] = [
        { name: 'Test 1', passed: true, message: 'OK' },
        { name: 'Test 2', passed: false, message: 'Failed', errorType: 'AUTH_MISSING' },
      ];
      expect(determineVerificationStatus(checks)).toBe('failed');
    });

    it('should return "verified_with_warnings" when check fails with non-blocking error', () => {
      const checks: CheckResult[] = [
        { name: 'Test 1', passed: true, message: 'OK' },
        { name: 'Test 2', passed: false, message: 'Network issue', errorType: 'NETWORK_TIMEOUT' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified_with_warnings');
    });

    it('should return "failed" for CONFIG_MISSING error', () => {
      const checks: CheckResult[] = [
        { name: 'Executable', passed: false, message: 'Not found', errorType: 'CONFIG_MISSING' },
      ];
      expect(determineVerificationStatus(checks)).toBe('failed');
    });

    it('should return "verified_with_warnings" for CONFIG_DEPENDENCY error', () => {
      const checks: CheckResult[] = [
        { name: 'Test 1', passed: true, message: 'OK' },
        { name: 'Config', passed: false, message: 'Dependency missing', errorType: 'CONFIG_DEPENDENCY' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified_with_warnings');
    });

    it('should return "verified" for empty checks array', () => {
      expect(determineVerificationStatus([])).toBe('verified');
    });

    it('should prioritize blocking errors over non-blocking', () => {
      const checks: CheckResult[] = [
        { name: 'Network', passed: false, message: 'Timeout', errorType: 'NETWORK_TIMEOUT' },
        { name: 'Auth', passed: false, message: 'Missing', errorType: 'AUTH_MISSING' },
      ];
      expect(determineVerificationStatus(checks)).toBe('failed');
    });

    it('should return "failed" for AUTH_INVALID error', () => {
      const checks: CheckResult[] = [
        { name: 'Auth', passed: false, message: 'Invalid', errorType: 'AUTH_INVALID' },
      ];
      expect(determineVerificationStatus(checks)).toBe('failed');
    });

    it('should return "failed" for CONFIG_INVALID error', () => {
      const checks: CheckResult[] = [
        { name: 'Config', passed: false, message: 'Invalid config', errorType: 'CONFIG_INVALID' },
      ];
      expect(determineVerificationStatus(checks)).toBe('failed');
    });
  });
});
