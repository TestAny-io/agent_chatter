/**
 * Unit tests for AgentValidator
 *
 * @file tests/unit/validation/agentValidator.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { AgentValidator } from '../../../src/services/validation/AgentValidator.js';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Use hoisted to create mockExecAsync before vi.mock uses it
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

// Mock connectivity checker
vi.mock('../../../src/services/validation/ConnectivityChecker.js', () => ({
  checkConnectivity: vi.fn().mockResolvedValue({ reachable: true, latencyMs: 50 }),
}));

describe('AgentValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: executable exists
    mockExecAsync.mockResolvedValue({ stdout: '/usr/local/bin/claude', stderr: '' });
    // Default: auth file exists
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  describe('validateAgent', () => {
    describe('CLI Command Check', () => {
      it('should fail when CLI not found', async () => {
        const error = new Error('not found') as any;
        error.code = 1;
        mockExecAsync.mockRejectedValue(error);

        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          platform: 'linux',
        });

        const result = await validator.validateAgent('claude');
        expect(result.status).toBe('failed');
        expect(result.checks[0].name).toBe('CLI Command Check');
        expect(result.checks[0].passed).toBe(false);
        expect(result.checks[0].errorType).toBe('CONFIG_MISSING');
      });

      it('should pass when CLI found', async () => {
        mockExecAsync.mockResolvedValue({ stdout: '/usr/local/bin/claude', stderr: '' });

        // Also need credentials
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.claude/.credentials.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ accessToken: 'token' })
        );

        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          homeDir: '/home/test',
          platform: 'linux',
        });

        const result = await validator.validateAgent('claude');
        expect(result.checks[0].name).toBe('CLI Command Check');
        expect(result.checks[0].passed).toBe(true);
      });

      it('should use "which" on Unix platforms', async () => {
        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          platform: 'linux',
        });

        await validator.validateAgent('claude');
        expect(mockExecAsync).toHaveBeenCalledWith(
          expect.stringContaining('which claude'),
          expect.any(Object)
        );
      });

      it('should use "where" on Windows', async () => {
        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          platform: 'win32',
        });

        await validator.validateAgent('claude');
        expect(mockExecAsync).toHaveBeenCalledWith(
          expect.stringContaining('where claude'),
          expect.any(Object)
        );
      });
    });

    describe('Auth Check', () => {
      it('should include auth method in result', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.claude/.credentials.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ accessToken: 'token' })
        );

        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          homeDir: '/home/test',
          platform: 'linux',
        });

        const result = await validator.validateAgent('claude');
        expect(result.authMethod).toBe('OAuth credentials file');
      });

      it('should return verified_with_warnings when only auth fails (1 failure tolerance)', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          homeDir: '/home/test',
          platform: 'linux',
        });

        const result = await validator.validateAgent('claude');
        // With new logic: 1 failure out of 3 non-executable checks = verified_with_warnings
        expect(result.status).toBe('verified_with_warnings');
        // The failure should be reported in warnings
        expect(result.warnings).toBeDefined();
        expect(result.warnings!.some(w => w.includes('Auth Check failed'))).toBe(true);
      });
    });

    describe('Verification Status', () => {
      it('should return "verified" when all checks pass', async () => {
        // When skipStatusCommand is true and credentials file exists,
        // the auth checker adds a warning about status command being skipped.
        // Use env var authentication which doesn't add a warning
        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          env: { ANTHROPIC_API_KEY: 'sk-ant-xxx' },
          platform: 'linux',
        });

        const result = await validator.validateAgent('claude');
        expect(result.status).toBe('verified');
        expect(result.authMethod).toBe('ANTHROPIC_API_KEY env var');
      });

      it('should return "verified_with_warnings" when checks pass with warnings', async () => {
        // macOS returns WARN passthrough
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
          homeDir: '/Users/test',
          platform: 'darwin',
        });

        const result = await validator.validateAgent('claude');
        expect(result.status).toBe('verified_with_warnings');
        expect(result.warnings).toBeDefined();
        expect(result.warnings!.length).toBeGreaterThan(0);
      });
    });

    describe('Unknown Agent Type', () => {
      it('should warn passthrough for unregistered agent', async () => {
        const validator = new AgentValidator({
          skipConnectivityCheck: true,
          skipDryRun: true,
          authCheckerOptions: { skipStatusCommand: true },
        });

        const result = await validator.validateAgent('unknown-agent');
        // Should pass executable check
        expect(result.checks[0].name).toBe('CLI Command Check');
        // Auth check should WARN passthrough
        const authCheck = result.checks.find(c => c.name === 'Auth Check');
        expect(authCheck?.passed).toBe(true);
        expect(authCheck?.warning).toContain('Agent type not registered');
      });
    });
  });

  describe('validateAgents', () => {
    it('should validate multiple agents', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
          skipDryRun: true,
        authCheckerOptions: { skipStatusCommand: true },
        platform: 'darwin',
      });

      const results = await validator.validateAgents(['claude', 'codex']);
      expect(results.size).toBe(2);
      expect(results.has('claude')).toBe(true);
      expect(results.has('codex')).toBe(true);
    });

    it('should respect maxConcurrency', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
          skipDryRun: true,
        authCheckerOptions: { skipStatusCommand: true },
        platform: 'darwin',
        maxConcurrency: 1,
      });

      const results = await validator.validateAgents(['claude', 'codex', 'gemini']);
      expect(results.size).toBe(3);
    });
  });

  describe('validateAllKnownAgents', () => {
    it('should validate all registered agents', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
          skipDryRun: true,
        authCheckerOptions: { skipStatusCommand: true },
        platform: 'darwin',
      });

      const results = await validator.validateAllKnownAgents();
      expect(results.has('claude')).toBe(true);
      expect(results.has('codex')).toBe(true);
      expect(results.has('gemini')).toBe(true);
    });
  });
});
