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

    describe('OAuth Credentials File', () => {
      it('should pass when OAuth credentials file exists with access_token', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.gemini/oauth_creds.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ access_token: 'token123' })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth credentials');
      });

      it('should pass when OAuth credentials file exists with refresh_token', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.gemini/oauth_creds.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ refresh_token: 'refresh123' })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth credentials');
      });
    });

    describe('Config File with API Key', () => {
      it('should pass when config file has apiKey', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.gemini/config.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ apiKey: 'AIza...' })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Config file API key');
      });

      it('should pass when config file has api_key (snake_case)', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.gemini/config.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ api_key: 'AIza...' })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Config file API key');
      });

      it('should check alternative config path', async () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          return path === '/home/test/.config/gemini/config.json';
        });
        vi.mocked(fs.readFileSync).mockReturnValue(
          JSON.stringify({ apiKey: 'AIza...' })
        );

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/home/test',
          skipStatusCommand: true,
        });

        const result = await checker.checkAuth();
        expect(result.passed).toBe(true);
        expect(result.method).toBe('Config file API key');
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
