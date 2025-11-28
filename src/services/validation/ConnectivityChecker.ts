/**
 * ConnectivityChecker - Network Connectivity Verification
 *
 * @file src/services/validation/ConnectivityChecker.ts
 * @layer Core
 *
 * @remarks
 * - Checks network connectivity to Agent API endpoints
 * - Distinguishes DNS errors, connection timeout, connection refused, etc.
 * - **Never blocks** verification flow: even on failure, only returns warning
 */

import * as dns from 'dns';
import * as net from 'net';
import type { ConnectivityResult } from './types.js';

// ===== Constants =====

/**
 * API endpoints for each Agent
 */
const API_ENDPOINTS: Record<string, { host: string; port: number }> = {
  claude: { host: 'api.anthropic.com', port: 443 },
  codex: { host: 'api.openai.com', port: 443 },
  gemini: { host: 'generativelanguage.googleapis.com', port: 443 },
};

/**
 * Default connectivity check timeout (ms)
 */
const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 5000;

/**
 * Default DNS resolution timeout (ms)
 */
const DEFAULT_DNS_TIMEOUT_MS = 3000;

// ===== Configuration Options =====

/**
 * Connectivity checker configuration options
 */
export interface ConnectivityCheckerOptions {
  /**
   * TCP connection timeout (ms)
   * @default 5000
   */
  connectivityTimeout?: number;

  /**
   * DNS resolution timeout (ms)
   * @default 3000
   */
  dnsTimeout?: number;
}

// ===== Public API =====

/**
 * Check network connectivity to specified Agent API endpoint
 *
 * @param agentType - Agent type ('claude' | 'codex' | 'gemini')
 * @param options - Optional configuration (timeouts, etc.)
 * @returns Connectivity check result
 *
 * @remarks
 * - This check **never blocks** verification flow
 * - On failure returns reachable: false, but verification should continue
 * - CLI may work through proxy, direct TCP check failure doesn't mean CLI won't work
 */
export async function checkConnectivity(
  agentType: string,
  options?: ConnectivityCheckerOptions
): Promise<ConnectivityResult> {
  const endpoint = API_ENDPOINTS[agentType];

  // Merge configuration
  const connectivityTimeout =
    options?.connectivityTimeout ?? DEFAULT_CONNECTIVITY_TIMEOUT_MS;
  const dnsTimeout = options?.dnsTimeout ?? DEFAULT_DNS_TIMEOUT_MS;

  // Unknown Agent type, skip check
  if (!endpoint) {
    return { reachable: true };
  }

  const startTime = Date.now();

  try {
    // Step 1: DNS resolution
    await resolveDns(endpoint.host, dnsTimeout);

    // Step 2: TCP connection check
    await checkTcpConnection(endpoint.host, endpoint.port, connectivityTimeout);

    return {
      reachable: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    return classifyError(error, endpoint.host);
  }
}

// ===== Private Methods =====

/**
 * DNS resolution with timeout control
 *
 * @param host - Hostname
 * @param timeoutMs - Timeout in milliseconds
 * @returns IPv4 address list
 * @throws Error on resolution failure or timeout
 */
async function resolveDns(host: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DNS resolution timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    dns.resolve4(host, (err, addresses) => {
      clearTimeout(timer);
      if (err) {
        reject(err);
      } else {
        resolve(addresses);
      }
    });
  });
}

/**
 * TCP connection check with timeout control
 *
 * @param host - Hostname
 * @param port - Port number
 * @param timeoutMs - Timeout in milliseconds
 * @throws Error on connection failure or timeout
 */
async function checkTcpConnection(
  host: string,
  port: number,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host);

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.destroy();
      resolve();
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timeout'));
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

/**
 * Classify error into specific network error type
 *
 * @param error - Caught error
 * @param host - Target hostname
 * @returns Classified connectivity result
 *
 * @remarks
 * Error classification follows these principles:
 * 1. Exact match known error codes
 * 2. Unknown errors preserve original info, don't force classify
 * 3. All errors do not block verification flow
 */
function classifyError(error: unknown, host: string): ConnectivityResult {
  const err = error as NodeJS.ErrnoException & { message?: string };

  // DNS resolution failure (including temporary DNS errors like EAI_AGAIN)
  if (
    err.code === 'ENOTFOUND' ||
    err.code === 'EAI_AGAIN' || // Temporary DNS failure
    err.code === 'EAI_NODATA' || // DNS no record
    err.code === 'EAI_NONAME' || // Hostname doesn't exist
    err.message?.includes('DNS') ||
    err.message?.includes('getaddrinfo')
  ) {
    return {
      reachable: false,
      error: `Cannot resolve ${host}`,
      errorType: 'NETWORK_DNS',
    };
  }

  // Connection timeout
  if (
    err.code === 'ETIMEDOUT' ||
    err.message?.includes('timeout') ||
    err.message?.includes('Timeout')
  ) {
    return {
      reachable: false,
      error: `Connection timeout to ${host}`,
      errorType: 'NETWORK_TIMEOUT',
    };
  }

  // Connection refused
  if (err.code === 'ECONNREFUSED') {
    return {
      reachable: false,
      error: `Connection refused by ${host}`,
      errorType: 'NETWORK_REFUSED',
    };
  }

  // Connection reset (may be proxy/firewall issue)
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
    return {
      reachable: false,
      error: `Connection reset by ${host}`,
      errorType: 'NETWORK_REFUSED',
    };
  }

  // Network unreachable
  if (
    err.code === 'ENETUNREACH' ||
    err.code === 'EHOSTUNREACH' ||
    err.code === 'ENETDOWN' ||
    err.code === 'ENONET'
  ) {
    return {
      reachable: false,
      error: `Network unreachable: ${host}`,
      errorType: 'NETWORK_UNREACHABLE',
    };
  }

  // TLS/SSL errors
  if (
    err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    err.code === 'CERT_HAS_EXPIRED' ||
    err.code === 'CERT_NOT_YET_VALID' ||
    err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    err.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    err.code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    err.message?.includes('certificate') ||
    err.message?.includes('SSL') ||
    err.message?.includes('TLS')
  ) {
    return {
      reachable: false,
      error: `TLS/SSL error connecting to ${host}`,
      errorType: 'NETWORK_TLS',
    };
  }

  // Proxy-related errors
  if (
    err.code === 'EPROTO' ||
    err.message?.includes('proxy') ||
    err.message?.includes('PROXY')
  ) {
    return {
      reachable: false,
      error: `Proxy error connecting to ${host}`,
      errorType: 'NETWORK_PROXY',
    };
  }

  // Unknown error - preserve original info, classify as NETWORK_UNREACHABLE
  // Don't force classify as TIMEOUT, allow upper layer to diagnose via error field
  return {
    reachable: false,
    error: `Network error: ${err.code || ''} ${err.message || 'Unknown'}`.trim(),
    errorType: 'NETWORK_UNREACHABLE',
  };
}
