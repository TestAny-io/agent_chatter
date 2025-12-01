/**
 * Unit tests for AuthChecker base class and factory
 *
 * @file tests/unit/validation/authChecker.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAuthChecker,
  registerAuthChecker,
  getRegisteredAgentTypes,
  isAgentTypeRegistered,
  BaseAuthChecker,
} from '../../../src/services/validation/auth/AuthChecker.js';
import type {
  AuthCheckerOptions,
} from '../../../src/services/validation/auth/AuthChecker.js';
import type { AuthCheckResult } from '../../../src/services/validation/types.js';

// Import to register checkers
import '../../../src/services/validation/auth/ClaudeAuthChecker.js';
import '../../../src/services/validation/auth/CodexAuthChecker.js';
import '../../../src/services/validation/auth/GeminiAuthChecker.js';

describe('AuthChecker', () => {
  describe('getAuthChecker', () => {
    it('should return ClaudeAuthChecker for "claude"', () => {
      const checker = getAuthChecker('claude');
      expect(checker.agentType).toBe('claude');
      expect(checker.command).toBe('claude');
    });

    it('should return CodexAuthChecker for "codex"', () => {
      const checker = getAuthChecker('codex');
      expect(checker.agentType).toBe('codex');
      expect(checker.command).toBe('codex');
    });

    it('should return GeminiAuthChecker for "gemini"', () => {
      const checker = getAuthChecker('gemini');
      expect(checker.agentType).toBe('gemini');
      expect(checker.command).toBe('gemini');
    });

    it('should throw for unknown agent type', () => {
      expect(() => getAuthChecker('unknown')).toThrow('Unknown agent type: unknown');
    });
  });

  describe('getRegisteredAgentTypes', () => {
    it('should return all registered agent types', () => {
      const types = getRegisteredAgentTypes();
      expect(types).toContain('claude');
      expect(types).toContain('codex');
      expect(types).toContain('gemini');
    });
  });

  describe('isAgentTypeRegistered', () => {
    it('should return true for registered types', () => {
      expect(isAgentTypeRegistered('claude')).toBe(true);
      expect(isAgentTypeRegistered('codex')).toBe(true);
      expect(isAgentTypeRegistered('gemini')).toBe(true);
    });

    it('should return false for unregistered types', () => {
      expect(isAgentTypeRegistered('unknown')).toBe(false);
      expect(isAgentTypeRegistered('')).toBe(false);
    });
  });

  describe('registerAuthChecker', () => {
    it('should register a new checker', () => {
      class TestChecker extends BaseAuthChecker {
        readonly agentType = 'test-agent';
        readonly command = 'test';

        async checkAuth(): Promise<AuthCheckResult> {
          return { passed: true, method: 'test' };
        }
      }

      registerAuthChecker('test-agent', TestChecker);
      expect(isAgentTypeRegistered('test-agent')).toBe(true);

      const checker = getAuthChecker('test-agent');
      expect(checker.agentType).toBe('test-agent');
    });
  });
});

describe('BaseAuthChecker', () => {
  // Create a test implementation
  class TestAuthChecker extends BaseAuthChecker {
    readonly agentType = 'test';
    readonly command = 'test-cmd';

    async checkAuth(): Promise<AuthCheckResult> {
      return { passed: true, method: 'test' };
    }

    // Expose protected methods for testing
    public testHasEnv(name: string): boolean {
      return this.hasEnv(name);
    }

    public testGetEnv(name: string): string | undefined {
      return this.getEnv(name);
    }

    public testGetHomePath(...segments: string[]): string {
      return this.getHomePath(...segments);
    }

    public testFileExists(filePath: string): boolean {
      return this.fileExists(filePath);
    }

    public testReadJsonFile<T>(filePath: string): T | null {
      return this.readJsonFile<T>(filePath);
    }

    public testSuccessResult(method: string, warning?: string): AuthCheckResult {
      return this.successResult(method, warning);
    }

    public testFailureResult(
      errorType: 'AUTH_MISSING' | 'AUTH_EXPIRED' | 'AUTH_REVOKED',
      message: string,
      resolution?: string
    ): AuthCheckResult {
      return this.failureResult(errorType, message, resolution);
    }

    public testGetPlatform(): NodeJS.Platform {
      return this.getPlatform();
    }

    public testIsMacOS(): boolean {
      return this.isMacOS();
    }

    public testIsLinux(): boolean {
      return this.isLinux();
    }

    public testIsWindows(): boolean {
      return this.isWindows();
    }
  }

  describe('environment variable helpers', () => {
    it('should check env vars using custom env', () => {
      const checker = new TestAuthChecker({
        env: {
          TEST_VAR: 'value',
          EMPTY_VAR: '',
        },
      });

      expect(checker.testHasEnv('TEST_VAR')).toBe(true);
      expect(checker.testHasEnv('EMPTY_VAR')).toBe(false);
      expect(checker.testHasEnv('MISSING_VAR')).toBe(false);
      expect(checker.testGetEnv('TEST_VAR')).toBe('value');
    });
  });

  describe('home path helper', () => {
    it('should use custom home directory', () => {
      const checker = new TestAuthChecker({
        homeDir: '/custom/home',
      });

      const path = checker.testGetHomePath('.config', 'test.json');
      expect(path).toBe('/custom/home/.config/test.json');
    });
  });

  describe('platform helpers', () => {
    it('should return correct platform for darwin', () => {
      const checker = new TestAuthChecker({ platform: 'darwin' });
      expect(checker.testGetPlatform()).toBe('darwin');
      expect(checker.testIsMacOS()).toBe(true);
      expect(checker.testIsLinux()).toBe(false);
      expect(checker.testIsWindows()).toBe(false);
    });

    it('should return correct platform for linux', () => {
      const checker = new TestAuthChecker({ platform: 'linux' });
      expect(checker.testGetPlatform()).toBe('linux');
      expect(checker.testIsMacOS()).toBe(false);
      expect(checker.testIsLinux()).toBe(true);
      expect(checker.testIsWindows()).toBe(false);
    });

    it('should return correct platform for win32', () => {
      const checker = new TestAuthChecker({ platform: 'win32' });
      expect(checker.testGetPlatform()).toBe('win32');
      expect(checker.testIsMacOS()).toBe(false);
      expect(checker.testIsLinux()).toBe(false);
      expect(checker.testIsWindows()).toBe(true);
    });
  });

  describe('result helpers', () => {
    it('should create success result', () => {
      const checker = new TestAuthChecker();
      const result = checker.testSuccessResult('API Key');
      expect(result.passed).toBe(true);
      expect(result.method).toBe('API Key');
    });

    it('should create success result with warning', () => {
      const checker = new TestAuthChecker();
      const result = checker.testSuccessResult('OAuth', 'Token may expire soon');
      expect(result.passed).toBe(true);
      expect(result.method).toBe('OAuth');
      expect(result.warning).toBe('Token may expire soon');
    });

    it('should create failure result', () => {
      const checker = new TestAuthChecker();
      const result = checker.testFailureResult(
        'AUTH_MISSING',
        'No credentials found',
        'Run: test-cmd login'
      );
      expect(result.passed).toBe(false);
      expect(result.errorType).toBe('AUTH_MISSING');
      expect(result.message).toBe('No credentials found');
      expect(result.resolution).toBe('Run: test-cmd login');
    });
  });
});
