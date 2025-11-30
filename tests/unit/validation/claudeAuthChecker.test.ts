/**
 * Unit tests for ClaudeAuthChecker
 *
 * @file tests/unit/validation/claudeAuthChecker.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { ClaudeAuthChecker } from '../../../src/services/validation/auth/ClaudeAuthChecker.js';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn(() => vi.fn()),
}));

describe('ClaudeAuthChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkAuth', () => {
    describe('Environment Variables', () => {
      it('should pass when ANTHROPIC_API_KEY is set', async () => {
        const checker = new ClaudeAuthChecker({
          env: { ANTHROPIC_API_KEY: 'sk-ant-xxx' },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('ANTHROPIC_API_KEY env var');
      });

      it('should pass when CLAUDE_API_KEY is set (legacy)', async () => {
        const checker = new ClaudeAuthChecker({
          env: { CLAUDE_API_KEY: 'sk-xxx' },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('CLAUDE_API_KEY env var (legacy)');
      });

      it('should prefer ANTHROPIC_API_KEY over CLAUDE_API_KEY', async () => {
        const checker = new ClaudeAuthChecker({
          env: {
            ANTHROPIC_API_KEY: 'sk-ant-xxx',
            CLAUDE_API_KEY: 'sk-xxx',
          },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('ANTHROPIC_API_KEY env var');
      });
    });

    describe('Bedrock Mode', () => {
      it('should pass when Bedrock mode enabled with AWS credentials in env', async () => {
        const checker = new ClaudeAuthChecker({
          env: {
            CLAUDE_CODE_USE_BEDROCK: '1',
            AWS_ACCESS_KEY_ID: 'AKIA...',
            AWS_SECRET_ACCESS_KEY: 'secret',
          },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('AWS Bedrock');
      });

      it('should pass when Bedrock mode enabled with AWS credentials file', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const checker = new ClaudeAuthChecker({
          env: { CLAUDE_CODE_USE_BEDROCK: '1' },
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('AWS Bedrock');
        expect(fs.existsSync).toHaveBeenCalledWith('/home/test/.aws/credentials');
      });

      it('should warn but continue when Bedrock enabled but no AWS credentials on Linux', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new ClaudeAuthChecker({
          env: { CLAUDE_CODE_USE_BEDROCK: '1' },
          homeDir: '/home/test',
          skipStatusCommand: true,
          platform: 'linux',
        });

        const result = await checker.checkAuth();
        // On Linux with no credentials, it should fail with AUTH_MISSING
        // but include the Bedrock warning
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.warning).toContain('Bedrock mode enabled but AWS credentials missing');
      });
    });

    describe('Vertex AI Mode', () => {
      it('should pass when Vertex mode enabled with GCP credentials in env', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const checker = new ClaudeAuthChecker({
          env: {
            CLAUDE_CODE_USE_VERTEX: '1',
            GOOGLE_APPLICATION_CREDENTIALS: '/path/to/sa.json',
          },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Vertex AI');
      });

      it('should pass when Vertex mode enabled with ADC file', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.config/gcloud/application_default_credentials.json';
        });

        const checker = new ClaudeAuthChecker({
          env: { CLAUDE_CODE_USE_VERTEX: '1' },
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Vertex AI');
      });
    });

    describe('Credential Files - Linux', () => {
      it('should pass when Linux credentials file exists with tokens', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.claude/.credentials.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' })
        );

        const checker = new ClaudeAuthChecker({
          env: {},
          homeDir: '/home/test',
          platform: 'linux',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth credentials file');
      });
    });

    describe('macOS Keychain', () => {
      it('should return WARN passthrough on macOS (cannot verify Keychain)', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new ClaudeAuthChecker({
          env: {},
          homeDir: '/Users/test',
          platform: 'darwin',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth (Keychain)');
        expect(result.warning).toContain('Cannot verify Keychain credentials');
      });
    });

    describe('Windows Credential Manager', () => {
      it('should return WARN passthrough on Windows', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new ClaudeAuthChecker({
          env: {},
          homeDir: 'C:\\Users\\test',
          platform: 'win32',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth (Credential Manager)');
        expect(result.warning).toContain('Cannot verify Windows Credential Manager');
      });
    });

    describe('No Credentials Found', () => {
      it('should fail when no credentials found on Linux', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new ClaudeAuthChecker({
          env: {},
          homeDir: '/home/test',
          platform: 'linux',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.resolution).toContain('claude auth login');
      });
    });
  });
});
