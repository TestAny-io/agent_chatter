/**
 * Unit tests for GeminiAuthChecker
 *
 * @file tests/unit/validation/geminiAuthChecker.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { GeminiAuthChecker } from '../../../src/services/validation/auth/GeminiAuthChecker.js';

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

describe('GeminiAuthChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkAuth', () => {
    describe('Environment Variables', () => {
      it('should pass when GEMINI_API_KEY is set', async () => {
        const checker = new GeminiAuthChecker({
          env: { GEMINI_API_KEY: 'AIza...' },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('GEMINI_API_KEY env var');
      });

      it('should pass when GOOGLE_API_KEY is set', async () => {
        const checker = new GeminiAuthChecker({
          env: { GOOGLE_API_KEY: 'AIza...' },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('GOOGLE_API_KEY env var');
      });

      it('should prefer GEMINI_API_KEY over GOOGLE_API_KEY', async () => {
        const checker = new GeminiAuthChecker({
          env: {
            GEMINI_API_KEY: 'gemini-key',
            GOOGLE_API_KEY: 'google-key',
          },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('GEMINI_API_KEY env var');
      });
    });

    describe('Vertex AI Mode', () => {
      it('should pass when Vertex mode enabled with service account', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const checker = new GeminiAuthChecker({
          env: {
            GEMINI_USE_VERTEX: '1',
            GOOGLE_APPLICATION_CREDENTIALS: '/path/to/sa.json',
          },
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Vertex AI');
      });

      it('should pass when Vertex mode enabled with ADC', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.config/gcloud/application_default_credentials.json';
        });

        const checker = new GeminiAuthChecker({
          env: { GEMINI_USE_VERTEX: '1' },
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Vertex AI');
      });

      it('should warn and continue when Vertex enabled but no GCP credentials', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new GeminiAuthChecker({
          env: { GEMINI_USE_VERTEX: '1' },
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        // With no other auth method, should fail
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.warning).toContain('Vertex AI mode enabled but GCP credentials missing');
      });
    });

    describe('Settings File Auth', () => {
      it('should pass when settings file has gemini-api-key type with token file', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          if (path === '/home/test/.gemini/settings.json') return true;
          if (path === '/home/test/.gemini/mcp-oauth-tokens-v2.json') return true;
          return false;
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({
            security: {
              auth: {
                selectedType: 'gemini-api-key',
              },
            },
          })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('API Key (Keychain)');
      });

      it('should pass when settings file has oauth-personal type with tokens', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          if (path === '/home/test/.gemini/settings.json') return true;
          if (path === '/home/test/.gemini/mcp-oauth-tokens-v2.json') return true;
          return false;
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({
            security: {
              auth: {
                selectedType: 'oauth-personal',
              },
            },
          })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Google OAuth');
      });

      it('should pass when settings file has compute-default-credentials type', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.gemini/settings.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({
            security: {
              auth: {
                selectedType: 'compute-default-credentials',
              },
            },
          })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Compute ADC');
      });

      it('should warn when API key mode has no token file', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          // Only settings file exists, no token file
          return path === '/home/test/.gemini/settings.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({
            security: {
              auth: {
                selectedType: 'gemini-api-key',
              },
            },
          })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.warning).toContain('API key stored in system keychain');
      });
    });

    describe('No Credentials Found', () => {
      it('should fail when no credentials found', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.message).toBe('No credentials found');
        expect(result.resolution).toContain('gemini auth login');
      });
    });
  });
});
