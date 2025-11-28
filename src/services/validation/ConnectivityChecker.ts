/**
 * ConnectivityChecker - Network Connectivity Verification
 *
 * @file src/services/validation/ConnectivityChecker.ts
 * @layer Core
 *
 * @remarks
 * - Checks network connectivity to Agent API endpoints
 * - Layer 3-4: DNS resolution + TCP connection
 * - Layer 7: HTTP request to detect API-level restrictions (e.g., region blocks)
 * - **Never blocks** verification flow: even on failure, only returns warning
 */

import * as dns from 'dns';
import * as net from 'net';
import * as https from 'https';
import type { ConnectivityResult } from './types.js';

// ===== Debug Logger =====

const DEBUG_PREFIX = '[ConnectivityChecker]';

function debug(...args: unknown[]): void {
  if (process.env.DEBUG) {
    console.error(DEBUG_PREFIX, ...args);
  }
}

// ===== Constants =====

/**
 * API endpoints for each Agent (Layer 4: TCP)
 */
const API_ENDPOINTS: Record<string, { host: string; port: number }> = {
  claude: { host: 'api.anthropic.com', port: 443 },
  codex: { host: 'api.openai.com', port: 443 },
  gemini: { host: 'generativelanguage.googleapis.com', port: 443 },
};

/**
 * API HTTP paths for each Agent (Layer 7: HTTP)
 * These endpoints are used to detect HTTP-level issues like region restrictions.
 * We expect 401 (Unauthorized) when credentials are not provided - this means API is accessible.
 * 403 with "Request not allowed" may indicate region restriction.
 */
const API_HTTP_PATHS: Record<string, string> = {
  claude: '/v1/messages',
  codex: '/v1/chat/completions',
  gemini: '/v1/models',
};

/**
 * Default connectivity check timeout (ms)
 */
const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 5000;

/**
 * Default DNS resolution timeout (ms)
 */
const DEFAULT_DNS_TIMEOUT_MS = 3000;

/**
 * Default HTTP check timeout (ms)
 */
const DEFAULT_HTTP_TIMEOUT_MS = 10000;

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

  /**
   * HTTP request timeout (ms)
   * @default 10000
   */
  httpTimeout?: number;

  /**
   * Skip HTTP layer check (Layer 7)
   * When true, only performs DNS + TCP checks
   * @default false
   */
  skipHttpCheck?: boolean;
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
 *
 * Check order:
 * 1. Layer 3: DNS resolution
 * 2. Layer 4: TCP connection
 * 3. Layer 7: HTTP request (detect region restrictions, API availability)
 */
export async function checkConnectivity(
  agentType: string,
  options?: ConnectivityCheckerOptions
): Promise<ConnectivityResult> {
  debug(`Starting connectivity check for agent: ${agentType}`);
  debug(`Options:`, JSON.stringify(options || {}));

  const endpoint = API_ENDPOINTS[agentType];
  const httpPath = API_HTTP_PATHS[agentType];

  // Merge configuration
  const connectivityTimeout =
    options?.connectivityTimeout ?? DEFAULT_CONNECTIVITY_TIMEOUT_MS;
  const dnsTimeout = options?.dnsTimeout ?? DEFAULT_DNS_TIMEOUT_MS;
  const httpTimeout = options?.httpTimeout ?? DEFAULT_HTTP_TIMEOUT_MS;
  const skipHttpCheck = options?.skipHttpCheck ?? false;

  debug(`Endpoint: ${endpoint?.host}:${endpoint?.port}, httpPath: ${httpPath}`);
  debug(`Timeouts - DNS: ${dnsTimeout}ms, TCP: ${connectivityTimeout}ms, HTTP: ${httpTimeout}ms`);
  debug(`skipHttpCheck: ${skipHttpCheck}`);

  // Unknown Agent type, skip check
  if (!endpoint) {
    debug(`Unknown agent type "${agentType}", skipping check`);
    return { reachable: true };
  }

  const startTime = Date.now();

  try {
    // Step 1: DNS resolution (Layer 3)
    debug(`[Layer 3] Starting DNS resolution for ${endpoint.host}...`);
    const addresses = await resolveDns(endpoint.host, dnsTimeout);
    debug(`[Layer 3] DNS resolved: ${addresses.join(', ')} (${Date.now() - startTime}ms)`);

    // Step 2: TCP connection check (Layer 4)
    debug(`[Layer 4] Starting TCP connection to ${endpoint.host}:${endpoint.port}...`);
    await checkTcpConnection(endpoint.host, endpoint.port, connectivityTimeout);
    debug(`[Layer 4] TCP connection successful (${Date.now() - startTime}ms)`);

    // Step 3: HTTP check (Layer 7) - detect region restrictions
    if (!skipHttpCheck && httpPath) {
      debug(`[Layer 7] Starting HTTP check to https://${endpoint.host}${httpPath}...`);
      const httpResult = await checkHttpEndpoint(
        endpoint.host,
        httpPath,
        httpTimeout
      );
      debug(`[Layer 7] HTTP result:`, JSON.stringify(httpResult));

      // HTTP check failed - return the HTTP-level error
      if (!httpResult.reachable) {
        debug(`[Layer 7] HTTP check failed - returning error`);
        return {
          ...httpResult,
          latencyMs: Date.now() - startTime,
        };
      }
      debug(`[Layer 7] HTTP check passed (${Date.now() - startTime}ms)`);
    } else {
      debug(`[Layer 7] Skipped (skipHttpCheck=${skipHttpCheck}, httpPath=${httpPath})`);
    }

    debug(`Connectivity check completed successfully (${Date.now() - startTime}ms)`);
    return {
      reachable: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    debug(`Connectivity check failed with error:`, error);
    const result = classifyError(error, endpoint.host);
    debug(`Classified error result:`, JSON.stringify(result));
    return result;
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

/**
 * HTTP endpoint check (Layer 7)
 *
 * @param host - Hostname
 * @param path - HTTP path
 * @param timeoutMs - Timeout in milliseconds
 * @returns Connectivity result
 *
 * @remarks
 * Expected responses:
 * - 401 Unauthorized: API is accessible, credentials needed → reachable: true
 * - 403 Forbidden: May indicate region restriction → reachable: false
 * - 5xx: Service unavailable → reachable: false
 * - Other 4xx: API accessible but request invalid → reachable: true
 */
async function checkHttpEndpoint(
  host: string,
  path: string,
  timeoutMs: number
): Promise<ConnectivityResult> {
  debug(`[HTTP] Sending POST to https://${host}${path} (timeout: ${timeoutMs}ms)`);
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: path,
        method: 'POST', // Use POST to match actual API usage
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          // No auth header - we expect 401/403
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        debug(`[HTTP] Response status: ${statusCode}`);
        let body = '';

        res.on('data', (chunk) => {
          // Only collect first 1KB for diagnosis
          if (body.length < 1024) {
            body += chunk.toString();
          }
        });

        res.on('end', () => {
          debug(`[HTTP] Response body: ${body.slice(0, 500)}`);
          const result = classifyHttpResponse(host, statusCode, body);
          debug(`[HTTP] Classified result:`, JSON.stringify(result));
          resolve(result);
        });
      }
    );

    req.on('error', (err) => {
      debug(`[HTTP] Request error:`, err);
      resolve(classifyError(err, host));
    });

    req.on('timeout', () => {
      debug(`[HTTP] Request timeout after ${timeoutMs}ms`);
      req.destroy();
      resolve({
        reachable: false,
        error: `HTTP request timeout to ${host}`,
        errorType: 'NETWORK_TIMEOUT',
      });
    });

    // Send empty body for POST request
    req.write('{}');
    req.end();
  });
}

/**
 * Classify HTTP response into connectivity result
 *
 * @param host - Hostname
 * @param statusCode - HTTP status code
 * @param body - Response body (for diagnosis)
 * @returns Connectivity result
 *
 * @remarks
 * Classification logic:
 * - 401: API accessible, needs auth → reachable: true
 * - 403: Possible region restriction → NETWORK_HTTP_FORBIDDEN
 * - 429: Rate limited → NETWORK_HTTP_ERROR (warning, API is accessible)
 * - 5xx: Service unavailable → NETWORK_HTTP_UNAVAILABLE
 * - Other 4xx: API accessible, request invalid → reachable: true
 */
function classifyHttpResponse(
  host: string,
  statusCode: number,
  body: string
): ConnectivityResult {
  // Extract error message from response body (used for multiple cases)
  const extractErrorHint = (): string => {
    try {
      const parsed = JSON.parse(body);
      return parsed.error?.message || parsed.message || parsed.error || '';
    } catch {
      return body.slice(0, 200);
    }
  };

  // 401 Unauthorized - API is accessible, just needs auth
  // This is the expected response when no credentials provided
  if (statusCode === 401) {
    return { reachable: true };
  }

  // 403 Forbidden - possible region restriction or access denied
  if (statusCode === 403) {
    return {
      reachable: false,
      error: `HTTP 403 Forbidden from ${host}`,
      errorType: 'NETWORK_HTTP_FORBIDDEN',
      httpStatusCode: 403,
      httpResponseHint: extractErrorHint(),
    };
  }

  // 429 Too Many Requests - rate limited
  // API is accessible but currently rate limited
  if (statusCode === 429) {
    return {
      reachable: false,
      error: `HTTP 429 Too Many Requests from ${host}`,
      errorType: 'NETWORK_HTTP_ERROR',
      httpStatusCode: 429,
      httpResponseHint: extractErrorHint(),
    };
  }

  // 5xx Server errors - service unavailable
  if (statusCode >= 500) {
    return {
      reachable: false,
      error: `HTTP ${statusCode} from ${host}`,
      errorType: 'NETWORK_HTTP_UNAVAILABLE',
      httpStatusCode: statusCode,
      httpResponseHint: extractErrorHint(),
    };
  }

  // Other 4xx errors (400, 404, 405, etc.) - API is accessible but request is invalid
  // This is acceptable - it means we can reach the API
  if (statusCode >= 400 && statusCode < 500) {
    return { reachable: true };
  }

  // 2xx, 3xx - success or redirect, API is accessible
  return { reachable: true };
}
