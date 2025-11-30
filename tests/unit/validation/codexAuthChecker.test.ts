/**
 * Unit tests for CodexAuthChecker
 *
 * @file tests/unit/validation/codexAuthChecker.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { CodexAuthChecker } from '../../../src/services/validation/auth/CodexAuthChecker.js';

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

describe('CodexAuthChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkAuth', () => {
    describe('Environment Variables', () => {
      it('should pass when OPENAI_API_KEY is set', async () => {
        const checker = new CodexAuthChecker({
          env: { OPENAI_API_KEY: 'sk-xxx' },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OPENAI_API_KEY env var');
      });

      it('should not pass when only OPENAI_ORG_ID is set', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new CodexAuthChecker({
          env: { OPENAI_ORG_ID: 'org-xxx' },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
      });
    });

    describe('Auth File', () => {
      it('should pass when auth file exists with accessToken', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.codex/auth.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ accessToken: 'token123' })
        );

        const checker = new CodexAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Auth file');
      });

      it('should pass when auth file exists with refreshToken', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.codex/auth.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ refreshToken: 'refresh123' })
        );

        const checker = new CodexAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Auth file');
      });

      it('should pass when auth file exists with apiKey', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.codex/auth.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ apiKey: 'sk-xxx' })
        );

        const checker = new CodexAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Auth file');
      });

      it('should not pass when auth file exists but empty', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.codex/auth.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

        const checker = new CodexAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
      });
    });

    describe('Config File with API Key File', () => {
      it('should pass when config references existing API key file', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          if (path === '/home/test/.codex/config.json') return true;
          if (path === '/path/to/api-key.txt') return true;
          return false;
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ apiKeyFile: '/path/to/api-key.txt' })
        );

        const checker = new CodexAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('API key file');
      });
    });

    describe('No Credentials Found', () => {
      it('should fail when no credentials found', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new CodexAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.message).toBe('No credentials found');
        expect(result.resolution).toContain('codex login');
      });
    });
  });
});
