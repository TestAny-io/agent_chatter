# ConnectivityChecker - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/ConnectivityChecker.ts` |
| 层级 | Core 层 |
| 依赖 | `dns`, `net`, `https` (Node.js 内置模块), `./types.ts` |

## 1. 类概览

### 1.1 职责

- 检测到 Agent API 端点的网络连通性（多层检查）
- **Layer 3-4**: DNS 解析 + TCP 连接
- **Layer 7**: HTTP 请求，检测区域限制、API 可用性等
- 区分各类网络错误类型
- **不阻止验证流程**：即使检测失败也只返回警告

### 1.2 类图

```
┌──────────────────────────────────────────────────────────────────┐
│                      ConnectivityChecker                          │
├──────────────────────────────────────────────────────────────────┤
│ Constants:                                                        │
│ - API_ENDPOINTS: Record<string, {host, port}>                    │
│ - API_HTTP_PATHS: Record<string, string>                         │
│ - DEFAULT_CONNECTIVITY_TIMEOUT_MS: 5000                          │
│ - DEFAULT_DNS_TIMEOUT_MS: 3000                                   │
│ - DEFAULT_HTTP_TIMEOUT_MS: 10000                                 │
├──────────────────────────────────────────────────────────────────┤
│ Public:                                                           │
│ + checkConnectivity(agentType, options?): Promise<Result>        │
├──────────────────────────────────────────────────────────────────┤
│ Private (Layer 3-4):                                              │
│ - resolveDns(host, timeoutMs): Promise<string[]>                 │
│ - checkTcpConnection(host, port, timeoutMs): Promise<void>       │
│ - classifyError(error, host): ConnectivityResult                 │
├──────────────────────────────────────────────────────────────────┤
│ Private (Layer 7):                                                │
│ - checkHttpEndpoint(host, path, timeoutMs): Promise<Result>      │
│ - classifyHttpResponse(host, statusCode, body): Result           │
└──────────────────────────────────────────────────────────────────┘
```

## 2. 常量定义

### 2.1 API 端点映射（Layer 4: TCP）

```typescript
/**
 * 各 Agent 的 API 端点
 */
const API_ENDPOINTS: Record<string, { host: string; port: number }> = {
  claude: { host: 'api.anthropic.com', port: 443 },
  codex: { host: 'api.openai.com', port: 443 },
  gemini: { host: 'generativelanguage.googleapis.com', port: 443 },
};
```

### 2.2 API HTTP 路径映射（Layer 7: HTTP）

```typescript
/**
 * 各 Agent 的 HTTP 路径
 * 用于检测 HTTP 层问题（如区域限制）
 * 期望响应：401（未授权）表示 API 可访问
 * 403 + "Request not allowed" 可能表示区域限制
 */
const API_HTTP_PATHS: Record<string, string> = {
  claude: '/v1/messages',
  codex: '/v1/chat/completions',
  gemini: '/v1/models',
};
```

### 2.3 超时配置

```typescript
/**
 * 默认连通性检查超时时间（毫秒）
 * 设置较短以避免阻塞验证流程
 */
const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 5000;

/**
 * 默认 DNS 解析超时时间（毫秒）
 */
const DEFAULT_DNS_TIMEOUT_MS = 3000;

/**
 * 默认 HTTP 检查超时时间（毫秒）
 */
const DEFAULT_HTTP_TIMEOUT_MS = 10000;
```

### 2.4 配置选项

```typescript
/**
 * 连通性检查器配置选项
 */
export interface ConnectivityCheckerOptions {
  /**
   * TCP 连接超时（毫秒）
   * @default 5000
   */
  connectivityTimeout?: number;

  /**
   * DNS 解析超时（毫秒）
   * @default 3000
   */
  dnsTimeout?: number;

  /**
   * HTTP 请求超时（毫秒）
   * @default 10000
   */
  httpTimeout?: number;

  /**
   * 跳过 HTTP 层检查（Layer 7）
   * 设为 true 时仅执行 DNS + TCP 检查
   * @default false
   */
  skipHttpCheck?: boolean;
}
```

## 3. 公共方法

### 3.1 checkConnectivity

#### 签名

```typescript
/**
 * 检查到指定 Agent API 端点的网络连通性
 *
 * @param agentType - Agent 类型 ('claude' | 'codex' | 'gemini')
 * @param options - 可选配置（超时等）
 * @returns 连通性检查结果
 *
 * @remarks
 * - 此检查**永不阻止**验证流程
 * - 失败时返回 reachable: false，但验证应继续进行
 * - CLI 可能通过代理工作，直接 TCP 检查失败不代表 CLI 无法工作
 */
async function checkConnectivity(
  agentType: string,
  options?: ConnectivityCheckerOptions
): Promise<ConnectivityResult>
```

#### 实现

```typescript
import * as dns from 'dns';
import * as net from 'net';
import * as https from 'https';
import { ConnectivityResult } from './types';

export async function checkConnectivity(
  agentType: string,
  options?: ConnectivityCheckerOptions
): Promise<ConnectivityResult> {
  const endpoint = API_ENDPOINTS[agentType];
  const httpPath = API_HTTP_PATHS[agentType];

  // 合并配置
  const connectivityTimeout = options?.connectivityTimeout ?? DEFAULT_CONNECTIVITY_TIMEOUT_MS;
  const dnsTimeout = options?.dnsTimeout ?? DEFAULT_DNS_TIMEOUT_MS;
  const httpTimeout = options?.httpTimeout ?? DEFAULT_HTTP_TIMEOUT_MS;
  const skipHttpCheck = options?.skipHttpCheck ?? false;

  // 未知 Agent 类型，跳过检查
  if (!endpoint) {
    return { reachable: true };
  }

  const startTime = Date.now();

  try {
    // 步骤 1: DNS 解析 (Layer 3)
    await resolveDns(endpoint.host, dnsTimeout);

    // 步骤 2: TCP 连接检查 (Layer 4)
    await checkTcpConnection(endpoint.host, endpoint.port, connectivityTimeout);

    // 步骤 3: HTTP 检查 (Layer 7) - 检测区域限制
    if (!skipHttpCheck && httpPath) {
      const httpResult = await checkHttpEndpoint(
        endpoint.host,
        httpPath,
        httpTimeout
      );

      // HTTP 检查失败 - 返回 HTTP 层错误
      if (!httpResult.reachable) {
        return {
          ...httpResult,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    return {
      reachable: true,
      latencyMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    return classifyError(error, endpoint.host);
  }
}
```

#### 流程图

```
checkConnectivity(agentType)
         │
         ▼
    端点已知？ ──否──→ return { reachable: true }
         │
        是
         │
         ▼
   ┌─────────────────────────────────┐
   │  Layer 3: DNS 解析              │
   │  resolveDns(host)               │
   └──────────────┬──────────────────┘
                  │
          ┌───────┴───────┐
         成功            失败
          │               │
          ▼               ▼
   ┌─────────────────┐   return {
   │  Layer 4: TCP   │     reachable: false,
   │  checkTcpConn() │     errorType: 'NETWORK_DNS'
   └────────┬────────┘   }
            │
    ┌───────┴───────┐
   成功            失败
    │               │
    ▼               ▼
 skipHttpCheck?     return {
    │                 reachable: false,
    ├──是──→ return { reachable: true }
    │
   否
    │
    ▼
   ┌─────────────────────────────────┐
   │  Layer 7: HTTP 检查             │
   │  checkHttpEndpoint(host, path)  │
   └──────────────┬──────────────────┘
                  │
          ┌───────┼───────┬───────────┐
         401     403     429/5xx    其他
          │       │        │          │
          ▼       ▼        ▼          ▼
       可达    可能区域  服务问题   可达
              限制
```

#### HTTP 响应分类

| 状态码 | 含义 | ErrorType | 处理 |
|--------|------|-----------|------|
| 401 | 未授权 | - | reachable: true（API 可访问，需要认证）|
| 403 | 禁止 | NETWORK_HTTP_FORBIDDEN | reachable: false（可能区域限制）|
| 429 | 限流 | NETWORK_HTTP_ERROR | reachable: false（暂时限流）|
| 5xx | 服务错误 | NETWORK_HTTP_UNAVAILABLE | reachable: false（服务不可用）|
| 其他 4xx | 请求无效 | - | reachable: true（API 可访问）|

## 4. 私有方法

### 4.1 resolveDns

```typescript
/**
 * DNS 解析，带超时控制
 *
 * @param host - 主机名
 * @param timeoutMs - 超时毫秒数
 * @returns IPv4 地址列表
 * @throws 解析失败或超时时抛出错误
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
```

### 4.2 checkTcpConnection

```typescript
/**
 * TCP 连接检查，带超时控制
 *
 * @param host - 主机名
 * @param port - 端口号
 * @param timeoutMs - 超时毫秒数
 * @throws 连接失败或超时时抛出错误
 */
async function checkTcpConnection(host: string, port: number, timeoutMs: number): Promise<void> {
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
```

### 4.3 classifyError

```typescript
/**
 * 将错误分类为具体的网络错误类型
 *
 * @param error - 捕获的错误
 * @param host - 目标主机名
 * @returns 分类后的连通性结果
 *
 * @remarks
 * 错误分类遵循以下原则：
 * 1. 精确匹配已知错误码
 * 2. 未知错误保留原始信息，不强制归类
 * 3. 所有错误都不阻塞验证流程
 */
function classifyError(error: unknown, host: string): ConnectivityResult {
  const err = error as NodeJS.ErrnoException & { message?: string };

  // DNS 解析失败（包括 EAI_AGAIN 等临时性 DNS 错误）
  if (
    err.code === 'ENOTFOUND' ||
    err.code === 'EAI_AGAIN' ||        // 临时性 DNS 失败
    err.code === 'EAI_NODATA' ||       // DNS 无记录
    err.code === 'EAI_NONAME' ||       // 主机名不存在
    err.message?.includes('DNS') ||
    err.message?.includes('getaddrinfo')
  ) {
    return {
      reachable: false,
      error: `Cannot resolve ${host}`,
      errorType: 'NETWORK_DNS',
    };
  }

  // 连接超时
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

  // 连接被拒绝
  if (err.code === 'ECONNREFUSED') {
    return {
      reachable: false,
      error: `Connection refused by ${host}`,
      errorType: 'NETWORK_REFUSED',
    };
  }

  // 连接被重置（可能是代理/防火墙问题）
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
    return {
      reachable: false,
      error: `Connection reset by ${host}`,
      errorType: 'NETWORK_REFUSED',
    };
  }

  // 网络不可达
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

  // TLS/SSL 错误
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

  // 代理相关错误
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

  // 未知错误 - 保留原始信息，归类为 NETWORK_UNREACHABLE
  // 不强制归类为 TIMEOUT，以便上层根据 error 字段进行诊断
  return {
    reachable: false,
    error: `Network error: ${err.code || ''} ${err.message || 'Unknown'}`.trim(),
    errorType: 'NETWORK_UNREACHABLE',
  };
}
```

### 4.4 checkHttpEndpoint

```typescript
/**
 * HTTP 端点检查 (Layer 7)
 *
 * @param host - 主机名
 * @param path - HTTP 路径
 * @param timeoutMs - 超时毫秒数
 * @returns 连通性检查结果
 *
 * @remarks
 * 期望响应：
 * - 401 Unauthorized: API 可访问，需要认证 → reachable: true
 * - 403 Forbidden: 可能是区域限制 → reachable: false
 * - 5xx: 服务不可用 → reachable: false
 * - 其他 4xx: API 可访问但请求无效 → reachable: true
 */
async function checkHttpEndpoint(
  host: string,
  path: string,
  timeoutMs: number
): Promise<ConnectivityResult> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: path,
        method: 'POST', // 使用 POST 匹配实际 API 使用
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          // 不带认证头 - 期望 401/403
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        let body = '';

        res.on('data', (chunk) => {
          // 仅收集前 1KB 用于诊断
          if (body.length < 1024) {
            body += chunk.toString();
          }
        });

        res.on('end', () => {
          resolve(classifyHttpResponse(host, statusCode, body));
        });
      }
    );

    req.on('error', (err) => {
      resolve(classifyError(err, host));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        reachable: false,
        error: `HTTP request timeout to ${host}`,
        errorType: 'NETWORK_TIMEOUT',
      });
    });

    // 发送空 body 的 POST 请求
    req.write('{}');
    req.end();
  });
}
```

### 4.5 classifyHttpResponse

```typescript
/**
 * 将 HTTP 响应分类为连通性结果
 *
 * @param host - 主机名
 * @param statusCode - HTTP 状态码
 * @param body - 响应体（用于诊断）
 * @returns 连通性检查结果
 *
 * @remarks
 * 分类逻辑：
 * - 401: API 可访问，需要认证 → reachable: true
 * - 403: 可能是区域限制 → NETWORK_HTTP_FORBIDDEN
 * - 429: 限流 → NETWORK_HTTP_ERROR（警告，API 可访问）
 * - 5xx: 服务不可用 → NETWORK_HTTP_UNAVAILABLE
 * - 其他 4xx: API 可访问，请求无效 → reachable: true
 */
function classifyHttpResponse(
  host: string,
  statusCode: number,
  body: string
): ConnectivityResult {
  // 从响应体提取错误信息（多处使用）
  const extractErrorHint = (): string => {
    try {
      const parsed = JSON.parse(body);
      return parsed.error?.message || parsed.message || parsed.error || '';
    } catch {
      return body.slice(0, 200);
    }
  };

  // 401 Unauthorized - API 可访问，只是需要认证
  // 这是不带凭据时的预期响应
  if (statusCode === 401) {
    return { reachable: true };
  }

  // 403 Forbidden - 可能是区域限制或访问被拒绝
  if (statusCode === 403) {
    return {
      reachable: false,
      error: `HTTP 403 Forbidden from ${host}`,
      errorType: 'NETWORK_HTTP_FORBIDDEN',
      httpStatusCode: 403,
      httpResponseHint: extractErrorHint(),
    };
  }

  // 429 Too Many Requests - 限流
  // API 可访问但当前被限流
  if (statusCode === 429) {
    return {
      reachable: false,
      error: `HTTP 429 Too Many Requests from ${host}`,
      errorType: 'NETWORK_HTTP_ERROR',
      httpStatusCode: 429,
      httpResponseHint: extractErrorHint(),
    };
  }

  // 5xx 服务器错误 - 服务不可用
  if (statusCode >= 500) {
    return {
      reachable: false,
      error: `HTTP ${statusCode} from ${host}`,
      errorType: 'NETWORK_HTTP_UNAVAILABLE',
      httpStatusCode: statusCode,
      httpResponseHint: extractErrorHint(),
    };
  }

  // 其他 4xx 错误 (400, 404, 405 等) - API 可访问但请求无效
  // 这是可接受的 - 说明我们能够访问 API
  if (statusCode >= 400 && statusCode < 500) {
    return { reachable: true };
  }

  // 2xx, 3xx - 成功或重定向，API 可访问
  return { reachable: true };
}
```

## 5. 导出

```typescript
// src/services/validation/ConnectivityChecker.ts

export { checkConnectivity };
export type { ConnectivityResult, ConnectivityCheckerOptions };
```

## 6. 使用示例

```typescript
import { checkConnectivity } from './ConnectivityChecker';

// 在 AgentValidator 中使用
async function validateAgent(agentType: string): Promise<VerificationResult> {
  const checks: CheckResult[] = [];

  // 连通性检查（不阻止）
  const connectivity = await checkConnectivity(agentType);

  if (!connectivity.reachable) {
    checks.push({
      name: 'Connectivity Check',
      passed: true,  // 注意：仍然标记为 passed
      message: 'Cannot verify online connectivity',
      warning: `${connectivity.error}. Proceeding with local credentials.`,
    });
  } else {
    checks.push({
      name: 'Connectivity Check',
      passed: true,
      message: `Connected to API (${connectivity.latencyMs}ms)`,
    });
  }

  // 继续其他检查...
}
```

## 7. 单元测试

### 7.1 Mock 策略

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock dns, net, https 模块
vi.mock('dns', () => ({
  resolve4: vi.fn(),
}));

vi.mock('net', () => ({
  createConnection: vi.fn(),
}));

vi.mock('https', () => ({
  request: vi.fn(),
}));
```

### 7.2 测试用例

```typescript
describe('ConnectivityChecker', () => {
  describe('checkConnectivity', () => {
    it('returns reachable: true when connection succeeds', async () => {
      // Mock 成功的 DNS 解析
      dns.resolve4.mockImplementation((host, callback) => {
        callback(null, ['1.2.3.4']);
      });

      // Mock 成功的 TCP 连接
      const mockSocket = new EventEmitter();
      net.createConnection.mockReturnValue(mockSocket);
      setTimeout(() => mockSocket.emit('connect'), 10);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(true);
      expect(result.latencyMs).toBeDefined();
    });

    it('returns NETWORK_DNS when DNS resolution fails', async () => {
      dns.resolve4.mockImplementation((host, callback) => {
        callback({ code: 'ENOTFOUND' });
      });

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_DNS');
    });

    it('returns NETWORK_TIMEOUT when connection times out', async () => {
      dns.resolve4.mockImplementation((host, callback) => {
        callback(null, ['1.2.3.4']);
      });

      const mockSocket = new EventEmitter();
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      net.createConnection.mockReturnValue(mockSocket);
      setTimeout(() => mockSocket.emit('timeout'), 10);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_TIMEOUT');
    });

    it('returns NETWORK_REFUSED when connection is refused', async () => {
      dns.resolve4.mockImplementation((host, callback) => {
        callback(null, ['1.2.3.4']);
      });

      const mockSocket = new EventEmitter();
      mockSocket.setTimeout = vi.fn();
      mockSocket.destroy = vi.fn();
      net.createConnection.mockReturnValue(mockSocket);
      setTimeout(() => mockSocket.emit('error', { code: 'ECONNREFUSED' }), 10);

      const result = await checkConnectivity('claude');

      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_REFUSED');
    });

    it('returns reachable: true for unknown agent type', async () => {
      const result = await checkConnectivity('unknown-agent');

      expect(result.reachable).toBe(true);
    });
  });

  // Layer 7 HTTP 测试（使用真实定时器）
  describe('checkConnectivity - Layer 7 (HTTP)', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    it('returns reachable: true when HTTP returns 401', async () => {
      setupLayer34Success();
      createHttpMock(401);

      const result = await checkConnectivity('claude');
      expect(result.reachable).toBe(true);
    });

    it('returns NETWORK_HTTP_FORBIDDEN on HTTP 403', async () => {
      setupLayer34Success();
      createHttpMock(403, '{"error":{"message":"Request not allowed"}}');

      const result = await checkConnectivity('claude');
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_HTTP_FORBIDDEN');
      expect(result.httpStatusCode).toBe(403);
    });

    it('returns NETWORK_HTTP_ERROR on HTTP 429', async () => {
      setupLayer34Success();
      createHttpMock(429, '{"error":"Too Many Requests"}');

      const result = await checkConnectivity('claude');
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_HTTP_ERROR');
      expect(result.httpStatusCode).toBe(429);
    });

    it('returns NETWORK_HTTP_UNAVAILABLE on HTTP 5xx', async () => {
      setupLayer34Success();
      createHttpMock(503, '{"error":"Service Unavailable"}');

      const result = await checkConnectivity('codex');
      expect(result.reachable).toBe(false);
      expect(result.errorType).toBe('NETWORK_HTTP_UNAVAILABLE');
    });
  });
});
```

## 8. 注意事项

### 8.1 代理环境

用户可能在企业代理后面工作，此时直接 TCP 检查会失败，但 CLI 工具通过 `https_proxy` 环境变量可以正常工作。因此：

- **连通性检查失败不应阻止验证**
- 检查结果仅作为诊断信息

### 8.2 IPv6 问题

某些环境下 IPv6 可能导致连接问题。当前实现使用 `dns.resolve4`（仅 IPv4），避免 IPv6 相关问题。

### 8.3 性能考虑

- DNS 超时：3 秒
- TCP 连接超时：5 秒
- HTTP 超时：10 秒
- 总计最大阻塞时间：18 秒

如果需要更快的响应，可以：
- 设置 `skipHttpCheck: true` 跳过 HTTP 层检查（减少 10 秒）
- 调整各项超时参数（不建议低于 2 秒）

## 9. Layer 7 HTTP 检查（v0.2.5 新增）

### 9.1 目的

Layer 7 HTTP 检查用于检测 TCP 层无法发现的问题：

1. **区域限制**：某些 API（如 Claude）限制特定地区的 IP 访问
2. **API 可用性**：检测 5xx 服务错误
3. **限流状态**：检测 429 Too Many Requests

### 9.2 实现原理

发送一个不带认证凭据的 POST 请求到 API 端点：

```typescript
const req = https.request({
  hostname: host,
  port: 443,
  path: path,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
});
req.write('{}');
req.end();
```

期望响应：
- **401 Unauthorized**：正常，API 可访问但需要认证
- **403 Forbidden**：可能是区域限制
- **其他**：根据状态码分类

### 9.3 403 错误的特殊处理

403 错误可能有多种原因，**不应武断判定为区域限制**：

```typescript
// 错误提示应列出可能的原因
warning:
  'HTTP 403 Forbidden. Possible causes: ' +
  '(1) IP may be in a restricted region; ' +
  '(2) Account-level access restrictions; ' +
  '(3) Other authorization issues. ' +
  'If in supported region, try re-authenticating.'
```

### 9.4 新增的 ErrorType

| 类型 | 描述 | 触发条件 |
|------|------|----------|
| NETWORK_HTTP_FORBIDDEN | HTTP 403 | 可能是区域限制或访问受限 |
| NETWORK_HTTP_UNAVAILABLE | HTTP 5xx | 服务不可用 |
| NETWORK_HTTP_ERROR | 其他 HTTP 错误 | 429 限流等 |

### 9.5 ConnectivityResult 扩展

```typescript
interface ConnectivityResult {
  reachable: boolean;
  latencyMs?: number;
  error?: string;
  errorType?: ErrorType;
  // v0.2.5 新增
  httpStatusCode?: number;      // HTTP 状态码
  httpResponseHint?: string;    // 响应体摘要（用于诊断）
}
```
