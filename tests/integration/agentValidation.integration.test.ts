/**
 * Integration tests for Agent Validation
 *
 * @file tests/integration/agentValidation.integration.test.ts
 *
 * @remarks
 * These tests verify the complete validation flow from AgentValidator
 * through the various checkers. Uses minimal mocking to test real integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentValidator } from '../../src/services/validation/AgentValidator.js';
import {
  getAuthChecker,
  getRegisteredAgentTypes,
} from '../../src/services/validation/auth/AuthChecker.js';

// Mock child_process for executable check (avoid actually running which/where)
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

// Mock connectivity checker to avoid real network calls
vi.mock('../../src/services/validation/ConnectivityChecker.js', () => ({
  checkConnectivity: vi.fn().mockResolvedValue({ reachable: true, latencyMs: 100 }),
}));

describe('AgentValidation Integration', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: executable exists
    mockExecAsync.mockResolvedValue({ stdout: '/usr/local/bin/test', stderr: '' });

    // Save original env
    originalEnv = { ...process.env };

    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));
  });

  afterEach(() => {
    // Restore env
    process.env = originalEnv;

    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Full Validation Flow', () => {
    it('should validate claude agent with API key', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        env: { ANTHROPIC_API_KEY: 'sk-ant-api-key-here' },
        platform: 'linux',
      });

      const result = await validator.validateAgent('claude');

      expect(result.name).toBe('claude');
      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('ANTHROPIC_API_KEY env var');
      expect(result.checks).toHaveLength(2); // Executable + Auth
      expect(result.checks[0].name).toBe('Executable Check');
      expect(result.checks[1].name).toBe('Auth Check');
    });

    it('should validate codex agent with API key', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        env: { OPENAI_API_KEY: 'sk-openai-key-here' },
        platform: 'linux',
      });

      const result = await validator.validateAgent('codex');

      expect(result.name).toBe('codex');
      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('OPENAI_API_KEY env var');
    });

    it('should validate gemini agent with API key', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        env: { GEMINI_API_KEY: 'AIza-gemini-key' },
        platform: 'linux',
      });

      const result = await validator.validateAgent('gemini');

      expect(result.name).toBe('gemini');
      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('GEMINI_API_KEY env var');
    });
  });

  describe('Credential File Integration', () => {
    it('should detect claude credentials file on Linux', async () => {
      // Create credentials file
      const claudeDir = path.join(tempDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, '.credentials.json'),
        JSON.stringify({ accessToken: 'test-token', refreshToken: 'test-refresh' })
      );

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: {},
        homeDir: tempDir,
        platform: 'linux',
      });

      const result = await validator.validateAgent('claude');

      // Should find credentials but with warning due to skipped status command
      expect(result.status).toBe('verified_with_warnings');
      expect(result.authMethod).toBe('OAuth credentials file');
    });

    it('should detect codex auth file', async () => {
      // Create auth file
      const codexDir = path.join(tempDir, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'auth.json'),
        JSON.stringify({ accessToken: 'codex-token' })
      );

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: {},
        homeDir: tempDir,
        platform: 'linux',
      });

      const result = await validator.validateAgent('codex');

      expect(result.status).toBe('verified_with_warnings');
      expect(result.authMethod).toBe('Auth file');
    });

    it('should detect gemini OAuth credentials', async () => {
      // Create OAuth credentials file
      const geminiDir = path.join(tempDir, '.gemini');
      fs.mkdirSync(geminiDir, { recursive: true });
      fs.writeFileSync(
        path.join(geminiDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'gemini-oauth-token' })
      );

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: {},
        homeDir: tempDir,
        platform: 'linux',
      });

      const result = await validator.validateAgent('gemini');

      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('OAuth credentials');
    });
  });

  describe('Cloud Provider Mode Integration', () => {
    it('should detect AWS Bedrock mode with credentials', async () => {
      // Create AWS credentials file
      const awsDir = path.join(tempDir, '.aws');
      fs.mkdirSync(awsDir, { recursive: true });
      fs.writeFileSync(
        path.join(awsDir, 'credentials'),
        '[default]\naws_access_key_id=AKIA...\naws_secret_access_key=secret'
      );

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: { CLAUDE_CODE_USE_BEDROCK: '1' },
        homeDir: tempDir,
        platform: 'linux',
      });

      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('AWS Bedrock');
    });

    it('should detect GCP Vertex mode with ADC', async () => {
      // Create ADC file
      const gcloudDir = path.join(tempDir, '.config', 'gcloud');
      fs.mkdirSync(gcloudDir, { recursive: true });
      fs.writeFileSync(
        path.join(gcloudDir, 'application_default_credentials.json'),
        JSON.stringify({ client_id: 'test', client_secret: 'test', refresh_token: 'test' })
      );

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: { CLAUDE_CODE_USE_VERTEX: '1' },
        homeDir: tempDir,
        platform: 'linux',
      });

      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('Vertex AI');
    });
  });

  describe('Batch Validation', () => {
    it('should validate all registered agents', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        env: {
          ANTHROPIC_API_KEY: 'sk-ant-key',
          OPENAI_API_KEY: 'sk-openai-key',
          GEMINI_API_KEY: 'AIza-key',
        },
        platform: 'linux',
      });

      const results = await validator.validateAllKnownAgents();

      expect(results.size).toBe(3);
      expect(results.get('claude')?.status).toBe('verified');
      expect(results.get('codex')?.status).toBe('verified');
      expect(results.get('gemini')?.status).toBe('verified');
    });

    it('should handle mixed success/failure in batch validation', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: { ANTHROPIC_API_KEY: 'sk-ant-key' },
        homeDir: tempDir,
        platform: 'linux',
      });

      const results = await validator.validateAgents(['claude', 'codex', 'gemini']);

      expect(results.size).toBe(3);
      expect(results.get('claude')?.status).toBe('verified');
      expect(results.get('codex')?.status).toBe('failed');
      expect(results.get('gemini')?.status).toBe('failed');
    });
  });

  describe('Error Handling', () => {
    it('should fail when executable not found', async () => {
      const error = new Error('not found') as any;
      error.code = 1;
      mockExecAsync.mockRejectedValue(error);

      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        env: { ANTHROPIC_API_KEY: 'sk-ant-key' },
        platform: 'linux',
      });

      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('failed');
      expect(result.errorType).toBe('CONFIG_MISSING');
      expect(result.checks).toHaveLength(1); // Only executable check, stopped early
    });

    it('should handle unknown agent types gracefully', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        platform: 'linux',
      });

      const result = await validator.validateAgent('unknown-ai');

      // Executable check passes, auth check passes with warning
      expect(result.checks.find(c => c.name === 'Auth Check')?.passed).toBe(true);
      expect(result.checks.find(c => c.name === 'Auth Check')?.warning).toContain('not registered');
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should handle macOS Keychain WARN passthrough', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: {},
        homeDir: tempDir,
        platform: 'darwin',
      });

      const result = await validator.validateAgent('claude');

      // macOS returns WARN passthrough when Keychain cannot be verified
      expect(result.status).toBe('verified_with_warnings');
      expect(result.authMethod).toBe('OAuth (Keychain)');
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain('Cannot verify Keychain');
    });

    it('should handle Windows Credential Manager WARN passthrough', async () => {
      const validator = new AgentValidator({
        skipConnectivityCheck: true,
        authCheckerOptions: { skipStatusCommand: true },
        env: {},
        homeDir: tempDir,
        platform: 'win32',
      });

      const result = await validator.validateAgent('claude');

      // Windows returns WARN passthrough when Credential Manager cannot be verified
      expect(result.status).toBe('verified_with_warnings');
      expect(result.authMethod).toBe('OAuth (Credential Manager)');
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain('Cannot verify Windows Credential Manager');
    });
  });

  describe('Auth Checker Registry', () => {
    it('should have all expected agent types registered', () => {
      const registeredTypes = getRegisteredAgentTypes();

      expect(registeredTypes).toContain('claude');
      expect(registeredTypes).toContain('codex');
      expect(registeredTypes).toContain('gemini');
    });

    it('should return correct checker for each agent type', () => {
      const claudeChecker = getAuthChecker('claude');
      const codexChecker = getAuthChecker('codex');
      const geminiChecker = getAuthChecker('gemini');

      expect(claudeChecker.agentType).toBe('claude');
      expect(claudeChecker.command).toBe('claude');

      expect(codexChecker.agentType).toBe('codex');
      expect(codexChecker.command).toBe('codex');

      expect(geminiChecker.agentType).toBe('gemini');
      expect(geminiChecker.command).toBe('gemini');
    });
  });
});
