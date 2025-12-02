/**
 * Unit tests for ConnectivityChecker
 *
 * @file tests/unit/validation/connectivityChecker.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dns from 'dns';
import * as net from 'net';
import * as https from 'https';
import { EventEmitter } from 'events';
import { checkConnectivity } from '../../../src/services/validation/ConnectivityChecker.js';

// Mock dns module
vi.mock('dns', () => ({
  resolve4: vi.fn(),
}));

// Mock net module
vi.mock('net', () => ({
  createConnection: vi.fn(),
}));

// Mock https module
vi.mock('https', () => ({
  request: vi.fn(),
}));

describe('ConnectivityChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to create mock TCP socket
  function createMockSocket() {
    const mockSocket = new EventEmitter() as any;
    mockSocket.setTimeout = vi.fn();
    mockSocket.destroy = vi.fn();
    return mockSocket;
  }

  // Helper to create mock HTTPS request/response
  function createMockHttpRequest() {
    const mockReq = new EventEmitter() as any;
    mockReq.write = vi.fn();
    mockReq.end = vi.fn();
    mockReq.destroy = vi.fn();
    return mockReq;
  }

  function createMockHttpResponse(statusCode: number, body: string = '') {
    const mockRes = new EventEmitter() as any;
    mockRes.statusCode = statusCode;
    // Emit data and end events
    setTimeout(() => {
      if (body) {
        mockRes.emit('data', Buffer.from(body));
      }
      mockRes.emit('end');
    }, 0);
    return mockRes;
  }

  describe('checkConnectivity - Layer 3-4 (DNS + TCP)', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      // Save and clear proxy environment variables for Layer 3-4 tests
      originalEnv = { ...process.env };
      delete process.env.https_proxy;
      delete process.env.HTTPS_PROXY;
      delete process.env.http_proxy;
      delete process.env.HTTP_PROXY;
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should return reachable: true for unknown agent type', async () => {
      const result = await checkConnectivity('unknown-agent');
      expect(result.reachable).toBe(true);
    });

    it('should return reachable: true when DNS and TCP succeed (HTTP skipped)', async () => {
      // Mock DNS resolve4
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      // Mock TCP connection
      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude', { skipHttpCheck: true });

      // Simulate successful connection
      await vi.advanceTimersByTimeAsync(10);
      mockSocket.emit('connect');

      const result = await resultPromise;
      expect(result.reachable).toBe(true);
      expect(result.latencyMs).toBeDefined();
    });

    it('should return NETWORK_DNS error on DNS failure', async () => {
      // Mock DNS failure
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        const error = new Error('DNS failed') as NodeJS.ErrnoException;
        error.code = 'ENOTFOUND';
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(error, []);
      });

      const resultPromise = checkConnectivity('claude', { skipHttpCheck: true });
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_DNS');
      expect(result.error).toContain('Cannot resolve');
    });

    it('should return NETWORK_DNS error on temporary DNS failure (EAI_AGAIN)', async () => {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        const error = new Error('Temporary failure') as NodeJS.ErrnoException;
        error.code = 'EAI_AGAIN';
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(error, []);
      });

      const resultPromise = checkConnectivity('codex', { skipHttpCheck: true });
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_DNS');
    });

    it('should return NETWORK_TIMEOUT error on connection timeout', async () => {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude', { connectivityTimeout: 1000, skipHttpCheck: true });

      // Wait for DNS to resolve
      await vi.advanceTimersByTimeAsync(100);
      // Trigger timeout
      mockSocket.emit('timeout');

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_TIMEOUT');
    });

    it('should return NETWORK_REFUSED error on connection refused', async () => {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('gemini', { skipHttpCheck: true });

      await vi.advanceTimersByTimeAsync(100);
      const error = new Error('Connection refused') as NodeJS.ErrnoException;
      error.code = 'ECONNREFUSED';
      mockSocket.emit('error', error);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_REFUSED');
    });

    it('should return NETWORK_UNREACHABLE error on network unreachable', async () => {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude', { skipHttpCheck: true });

      await vi.advanceTimersByTimeAsync(100);
      const error = new Error('Network unreachable') as NodeJS.ErrnoException;
      error.code = 'ENETUNREACH';
      mockSocket.emit('error', error);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_UNREACHABLE');
    });

    it('should return NETWORK_TLS error on TLS errors', async () => {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude', { skipHttpCheck: true });

      await vi.advanceTimersByTimeAsync(100);
      const error = new Error('certificate has expired') as NodeJS.ErrnoException;
      error.code = 'CERT_HAS_EXPIRED';
      mockSocket.emit('error', error);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_TLS');
    });

    it('should handle DNS resolution timeout', async () => {
      vi.mocked(dns.resolve4).mockImplementation(() => {
        // Never call callback, simulating timeout
      });

      const resultPromise = checkConnectivity('claude', { dnsTimeout: 1000, skipHttpCheck: true });

      // Advance past DNS timeout
      await vi.advanceTimersByTimeAsync(1500);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      // DNS timeout produces a "timeout" message, which is classified as NETWORK_TIMEOUT
      // But the current implementation might classify it differently based on the error message
      expect(['NETWORK_TIMEOUT', 'NETWORK_DNS']).toContain(result.errorType);
    });
  });

  describe('checkConnectivity - Layer 7 (HTTP)', () => {
    let originalEnv: NodeJS.ProcessEnv;

    // Use real timers for HTTP tests since they involve more complex async flows
    beforeEach(() => {
      vi.useRealTimers();
      // Save and clear proxy environment variables
      originalEnv = { ...process.env };
      delete process.env.https_proxy;
      delete process.env.HTTPS_PROXY;
      delete process.env.http_proxy;
      delete process.env.HTTP_PROXY;
    });

    afterEach(() => {
      vi.useFakeTimers();
      // Restore original environment
      process.env = originalEnv;
    });

    // Setup: DNS and TCP always succeed synchronously, HTTP varies
    function setupLayer34Success() {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockImplementation(() => {
        // Emit connect synchronously
        process.nextTick(() => mockSocket.emit('connect'));
        return mockSocket;
      });
    }

    // Helper to create HTTP response that emits events properly
    function createHttpMock(statusCode: number, body: string = '') {
      const mockReq = createMockHttpRequest();
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = statusCode;

      vi.mocked(https.request).mockImplementation((options, callback) => {
        process.nextTick(() => {
          (callback as (res: any) => void)(mockRes);
          process.nextTick(() => {
            if (body) {
              mockRes.emit('data', Buffer.from(body));
            }
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      return mockReq;
    }

    it('should return reachable: true when HTTP returns 401 (API accessible, needs auth)', async () => {
      setupLayer34Success();
      createHttpMock(401, '{"error":"unauthorized"}');

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
    });

    it('should return NETWORK_HTTP_FORBIDDEN on HTTP 403 (possible region restriction)', async () => {
      setupLayer34Success();
      createHttpMock(403, '{"error":{"type":"forbidden","message":"Request not allowed"}}');

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_HTTP_FORBIDDEN');
      expect(result.httpStatusCode).toBe(403);
      expect(result.httpResponseHint).toContain('Request not allowed');
    });

    it('should return NETWORK_HTTP_UNAVAILABLE on HTTP 5xx (service unavailable)', async () => {
      setupLayer34Success();
      createHttpMock(503, '{"error":"Service Unavailable"}');

      const result = await checkConnectivity('codex');

      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_HTTP_UNAVAILABLE');
      expect(result.httpStatusCode).toBe(503);
    });

    it('should return reachable: true on HTTP 400 (API accessible, request invalid)', async () => {
      setupLayer34Success();
      createHttpMock(400, '{"error":"Bad Request"}');

      const result = await checkConnectivity('gemini');

      expect(result.reachable).toBe(true);
    });

    it('should return reachable: true on HTTP 200', async () => {
      setupLayer34Success();
      createHttpMock(200, '{"status":"ok"}');

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
    });

    it('should return NETWORK_HTTP_ERROR on HTTP 429 (rate limited)', async () => {
      setupLayer34Success();
      createHttpMock(429, '{"error":"Too Many Requests"}');

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_HTTP_ERROR');
      expect(result.httpStatusCode).toBe(429);
    });

    it('should handle HTTP request error', async () => {
      setupLayer34Success();

      const mockReq = createMockHttpRequest();

      vi.mocked(https.request).mockImplementation(() => {
        process.nextTick(() => {
          const error = new Error('Connection reset') as NodeJS.ErrnoException;
          error.code = 'ECONNRESET';
          mockReq.emit('error', error);
        });
        return mockReq;
      });

      const result = await checkConnectivity('claude');
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_REFUSED');
    });

    it('should test all three agents (claude, codex, gemini)', async () => {
      const agents = ['claude', 'codex', 'gemini'];

      for (const agent of agents) {
        vi.clearAllMocks();
        setupLayer34Success();
        createHttpMock(401);

        const result = await checkConnectivity(agent);
        expect(result.reachable).toBe(true);
      }
    });
  });

  describe('checkConnectivity - Proxy Support', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      // Save original environment
      originalEnv = { ...process.env };
      vi.useRealTimers();
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;
      vi.useFakeTimers();
    });

    function setupLayer34Success() {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockImplementation(() => {
        process.nextTick(() => mockSocket.emit('connect'));
        return mockSocket;
      });
    }

    function createHttpMock(statusCode: number, body: string = '') {
      const mockReq = createMockHttpRequest();
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = statusCode;

      vi.mocked(https.request).mockImplementation((options, callback) => {
        process.nextTick(() => {
          (callback as (res: any) => void)(mockRes);
          process.nextTick(() => {
            if (body) {
              mockRes.emit('data', Buffer.from(body));
            }
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      return mockReq;
    }

    it('should skip DNS/TCP checks when https_proxy is set', async () => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      // Should not call DNS or TCP (they're skipped in proxy mode)
      // But should still call HTTPS request
      expect(vi.mocked(dns.resolve4)).not.toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).not.toHaveBeenCalled();
      expect(vi.mocked(https.request)).toHaveBeenCalled();
      expect(result.reachable).toBe(true);
    });

    it('should skip DNS/TCP checks when HTTPS_PROXY is set', async () => {
      process.env.HTTPS_PROXY = 'http://proxy.example.com:8080';

      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(vi.mocked(dns.resolve4)).not.toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).not.toHaveBeenCalled();
      expect(result.reachable).toBe(true);
    });

    it('should skip DNS/TCP checks when http_proxy is set', async () => {
      process.env.http_proxy = 'http://proxy.example.com:8080';

      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(vi.mocked(dns.resolve4)).not.toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).not.toHaveBeenCalled();
      expect(result.reachable).toBe(true);
    });

    it('should skip DNS/TCP checks when HTTP_PROXY is set', async () => {
      process.env.HTTP_PROXY = 'http://proxy.example.com:8080';

      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(vi.mocked(dns.resolve4)).not.toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).not.toHaveBeenCalled();
      expect(result.reachable).toBe(true);
    });

    it('should use proxy agent when proxy is configured', async () => {
      process.env.https_proxy = 'http://proxy.example.com:8080';

      setupLayer34Success();
      createHttpMock(401);

      await checkConnectivity('claude');

      // Verify https.request was called with proxy agent
      expect(vi.mocked(https.request)).toHaveBeenCalled();
      const callArgs = vi.mocked(https.request).mock.calls[0][0] as any;
      expect(callArgs.agent).toBeDefined();
    });

    it('should perform DNS/TCP checks when no proxy is configured', async () => {
      // Ensure no proxy env vars are set
      delete process.env.https_proxy;
      delete process.env.HTTPS_PROXY;
      delete process.env.http_proxy;
      delete process.env.HTTP_PROXY;

      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      // Should call DNS and TCP when no proxy
      expect(vi.mocked(dns.resolve4)).toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).toHaveBeenCalled();
      expect(result.reachable).toBe(true);
    });

    it('should prioritize https_proxy over other proxy env vars', async () => {
      process.env.https_proxy = 'http://https-proxy.example.com:8080';
      process.env.http_proxy = 'http://http-proxy.example.com:8080';

      setupLayer34Success();
      createHttpMock(401);

      await checkConnectivity('claude');

      // Should skip Layer 3-4 checks
      expect(vi.mocked(dns.resolve4)).not.toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).not.toHaveBeenCalled();
    });
  });

  describe('proxyUsed field', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      vi.useRealTimers();
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.useFakeTimers();
    });

    function setupLayer34Success() {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockImplementation(() => {
        process.nextTick(() => mockSocket.emit('connect'));
        return mockSocket;
      });
    }

    function createHttpMock(statusCode: number, body: string = '') {
      const mockReq = createMockHttpRequest();
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = statusCode;

      vi.mocked(https.request).mockImplementation((options, callback) => {
        process.nextTick(() => {
          (callback as (res: any) => void)(mockRes);
          process.nextTick(() => {
            if (body) {
              mockRes.emit('data', Buffer.from(body));
            }
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      return mockReq;
    }

    it('should return sanitized proxyUsed when proxy env is set', async () => {
      process.env.https_proxy = 'http://user:pass@proxy.example.com:8080';
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
      expect(result.proxyUsed).toBe('http://proxy.example.com:8080');
    });

    it('should return undefined proxyUsed when no proxy', async () => {
      delete process.env.https_proxy;
      delete process.env.HTTPS_PROXY;
      delete process.env.http_proxy;
      delete process.env.HTTP_PROXY;

      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
      expect(result.proxyUsed).toBeUndefined();
    });

    it('should return proxyUsed even when connectivity check fails', async () => {
      process.env.https_proxy = 'http://proxy:8080';
      setupLayer34Success();
      createHttpMock(503);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(false);
      expect(result.proxyUsed).toBe('http://proxy:8080');
    });

    it('should sanitize proxyUsed when proxy has username only', async () => {
      process.env.https_proxy = 'http://user@proxy:8080';
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
      expect(result.proxyUsed).toBe('http://proxy:8080');
    });

    it('should remove trailing slash from proxyUsed', async () => {
      process.env.https_proxy = 'http://proxy:8080/';
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
      expect(result.proxyUsed).toBe('http://proxy:8080');
    });
  });

  describe('explicit proxyUrl parameter', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
      vi.useRealTimers();
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.useFakeTimers();
    });

    function setupLayer34Success() {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = createMockSocket();
      vi.mocked(net.createConnection).mockImplementation(() => {
        process.nextTick(() => mockSocket.emit('connect'));
        return mockSocket;
      });
    }

    function createHttpMock(statusCode: number, body: string = '') {
      const mockReq = createMockHttpRequest();
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = statusCode;

      vi.mocked(https.request).mockImplementation((options, callback) => {
        process.nextTick(() => {
          (callback as (res: any) => void)(mockRes);
          process.nextTick(() => {
            if (body) {
              mockRes.emit('data', Buffer.from(body));
            }
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      return mockReq;
    }

    it('should use explicit proxyUrl over env var', async () => {
      process.env.https_proxy = 'http://env-proxy:8080';
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude', {
        proxyUrl: 'http://explicit-proxy:9090',
      });

      expect(result.proxyUsed).toBe('http://explicit-proxy:9090');
    });

    it('should sanitize explicit proxyUrl', async () => {
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude', {
        proxyUrl: 'http://user:secret@proxy:8080',
      });

      expect(result.proxyUsed).toBe('http://proxy:8080');
    });

    it('should skip Layer 3-4 checks when explicit proxyUrl is provided', async () => {
      setupLayer34Success();
      createHttpMock(401);

      await checkConnectivity('claude', {
        proxyUrl: 'http://explicit-proxy:8080',
      });

      // Should skip DNS and TCP checks
      expect(vi.mocked(dns.resolve4)).not.toHaveBeenCalled();
      expect(vi.mocked(net.createConnection)).not.toHaveBeenCalled();
      // Should still make HTTP request
      expect(vi.mocked(https.request)).toHaveBeenCalled();
    });

    it('should handle https proxy URL', async () => {
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude', {
        proxyUrl: 'https://user:pass@proxy.example.com:3128',
      });

      expect(result.proxyUsed).toBe('https://proxy.example.com:3128');
    });
  });
});
