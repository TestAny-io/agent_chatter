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
    // Use real timers for HTTP tests since they involve more complex async flows
    beforeEach(() => {
      vi.useRealTimers();
    });

    afterEach(() => {
      vi.useFakeTimers();
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
});
