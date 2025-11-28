# ConnectivityChecker - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/ConnectivityChecker.ts` |
| 层级 | Core 层 |
| 依赖 | `dns`, `net` (Node.js 内置模块), `./types.ts` |

## 1. 类概览

### 1.1 职责

- 检测到 Agent API 端点的网络连通性
- 区分 DNS 错误、连接超时、连接被拒绝等错误类型
- **不阻止验证流程**：即使检测失败也只返回警告

### 1.2 类图

```
┌─────────────────────────────────────────────────────────────┐
│                    ConnectivityChecker                       │
├─────────────────────────────────────────────────────────────┤
│ - API_ENDPOINTS: Record<string, Endpoint>                   │
│ - TIMEOUT_MS: number                                        │
├─────────────────────────────────────────────────────────────┤
│ + checkConnectivity(agentType: string): Promise<Result>     │
│ - resolveDns(host: string): Promise<string[]>               │
│ - checkTcpConnection(host: string, port: number): Promise   │
└─────────────────────────────────────────────────────────────┘
```

## 2. 常量定义

### 2.1 API 端点映射

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

### 2.2 超时配置

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
```

### 2.3 配置选项

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
import { ConnectivityResult } from './types';

export async function checkConnectivity(
  agentType: string,
  options?: ConnectivityCheckerOptions
): Promise<ConnectivityResult> {
  const endpoint = API_ENDPOINTS[agentType];

  // 合并配置
  const connectivityTimeout = options?.connectivityTimeout ?? DEFAULT_CONNECTIVITY_TIMEOUT_MS;
  const dnsTimeout = options?.dnsTimeout ?? DEFAULT_DNS_TIMEOUT_MS;

  // 未知 Agent 类型，跳过检查
  if (!endpoint) {
    return { reachable: true };
  }

  const startTime = Date.now();

  try {
    // 步骤 1: DNS 解析
    await resolveDns(endpoint.host, dnsTimeout);

    // 步骤 2: TCP 连接检查
    await checkTcpConnection(endpoint.host, endpoint.port, connectivityTimeout);

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
    resolveDns(host)
         │
    ┌────┴────┐
   成功      失败
    │         │
    ▼         ▼
checkTcpConnection  return {
    │               reachable: false,
    │               errorType: 'NETWORK_DNS'
    │             }
    │
┌───┴───┐
成功    失败
│        │
▼        ▼
return { reachable: false,
  reachable: true,   errorType: 'NETWORK_TIMEOUT'
  latencyMs: xxx     or 'NETWORK_REFUSED'
}                  }
```

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
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dns 和 net 模块
vi.mock('dns', () => ({
  resolve4: vi.fn(),
}));

vi.mock('net', () => ({
  createConnection: vi.fn(),
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
- 总计最大阻塞时间：8 秒

如果需要更快的响应，可以调整超时参数，但不建议低于 2 秒，否则可能导致误报。
