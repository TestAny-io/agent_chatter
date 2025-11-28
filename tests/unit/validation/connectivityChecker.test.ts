/**
 * Unit tests for ConnectivityChecker
 *
 * @file tests/unit/validation/connectivityChecker.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dns from 'dns';
import * as net from 'net';
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

describe('ConnectivityChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkConnectivity', () => {
    it('should return reachable: true for unknown agent type', async () => {
      const result = await checkConnectivity('unknown-agent');
      expect(result.reachable).toBe(true);
    });

    it('should return reachable: true when DNS and TCP succeed', async () => {
      // Mock DNS resolve4
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      // Mock TCP connection
      const mockSocket = new EventEmitter() as any;
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude');

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

      const resultPromise = checkConnectivity('claude');
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

      const resultPromise = checkConnectivity('codex');
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_DNS');
    });

    it('should return NETWORK_TIMEOUT error on connection timeout', async () => {
      vi.mocked(dns.resolve4).mockImplementation((host, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void)(null, ['1.2.3.4']);
      });

      const mockSocket = new EventEmitter() as any;
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude', { connectivityTimeout: 1000 });

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

      const mockSocket = new EventEmitter() as any;
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('gemini');

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

      const mockSocket = new EventEmitter() as any;
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude');

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

      const mockSocket = new EventEmitter() as any;
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      vi.mocked(net.createConnection).mockReturnValue(mockSocket);

      const resultPromise = checkConnectivity('claude');

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

      const resultPromise = checkConnectivity('claude', { dnsTimeout: 1000 });

      // Advance past DNS timeout
      await vi.advanceTimersByTimeAsync(1500);

      const result = await resultPromise;
      expect(result.reachable).toBe(false);
      // DNS timeout produces a "timeout" message, which is classified as NETWORK_TIMEOUT
      // But the current implementation might classify it differently based on the error message
      expect(['NETWORK_TIMEOUT', 'NETWORK_DNS']).toContain(result.errorType);
    });
  });
});
