# 类型定义 - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/types.ts` |
| 层级 | Core 层 |
| 依赖 | 无外部依赖 |

## 1. ErrorType 枚举

### 1.1 定义

```typescript
/**
 * 错误类型枚举
 * 用于分类验证过程中遇到的各种错误
 */
export type ErrorType =
  // ===== 网络错误 (OSI 第1-4层) =====
  // 这些错误仅产生警告，不阻止验证
  | 'NETWORK_DNS'           // DNS 解析失败
  | 'NETWORK_TIMEOUT'       // 连接超时
  | 'NETWORK_REFUSED'       // 连接被拒绝
  | 'NETWORK_UNREACHABLE'   // 网络不可达
  | 'NETWORK_PROXY'         // 代理配置问题
  | 'NETWORK_TLS'           // TLS/SSL 证书问题

  // ===== 认证错误 (OSI 第7层) =====
  // 这些错误会阻止验证
  | 'AUTH_MISSING'          // 未找到凭证
  | 'AUTH_INVALID'          // API 拒绝凭证 (401/403)
  | 'AUTH_EXPIRED'          // 令牌/密钥过期
  | 'AUTH_PERMISSION'       // 凭证有效但权限不足

  // ===== 配置错误 =====
  | 'CONFIG_MISSING'        // Agent CLI 未安装 (阻止)
  | 'CONFIG_INVALID'        // 配置无效 (阻止)
  | 'CONFIG_VERSION'        // 版本不兼容 (警告)
  | 'CONFIG_DEPENDENCY'     // 缺少外部依赖如 gcloud/aws cli (警告)

  // ===== 不确定状态 =====
  // 通过并发出警告
  | 'VERIFICATION_INCOMPLETE'     // 无法完全验证，但存在本地凭证
  | 'STATUS_COMMAND_UNAVAILABLE'; // CLI 不支持状态命令
```

### 1.2 错误类型分类

| 类别 | 前缀 | 是否阻止验证 | 说明 |
|------|------|-------------|------|
| 网络错误 | `NETWORK_` | 否 (警告) | CLI 可能通过代理工作 |
| 认证错误 | `AUTH_` | 是 | 明确的认证问题 |
| 配置错误 | `CONFIG_` | 视情况 | `CONFIG_MISSING/INVALID` 阻止，其他警告 |
| 不确定 | 其他 | 否 (警告) | 存在本地凭证但无法在线验证 |

### 1.3 辅助函数

```typescript
/**
 * 判断错误类型是否应该阻止验证
 */
export function isBlockingError(errorType: ErrorType): boolean {
  const blockingTypes: ErrorType[] = [
    'AUTH_MISSING',
    'AUTH_INVALID',
    'AUTH_EXPIRED',
    'AUTH_PERMISSION',
    'CONFIG_MISSING',
    'CONFIG_INVALID',
  ];
  return blockingTypes.includes(errorType);
}

/**
 * 判断是否为网络错误
 */
export function isNetworkError(errorType: ErrorType): boolean {
  return errorType.startsWith('NETWORK_');
}

/**
 * 判断是否为认证错误
 */
export function isAuthError(errorType: ErrorType): boolean {
  return errorType.startsWith('AUTH_');
}

/**
 * 判断是否为配置错误
 */
export function isConfigError(errorType: ErrorType): boolean {
  return errorType.startsWith('CONFIG_');
}
```

## 2. CheckResult 接口

### 2.1 定义

```typescript
/**
 * 单个检查项的结果
 * 例如：环境变量检查、文件存在性检查、状态命令检查等
 */
export interface CheckResult {
  /** 检查项名称，如 "Environment Variable Check" */
  name: string;

  /** 检查是否通过 */
  passed: boolean;

  /** 结果描述（纯文本，无格式化） */
  message: string;

  /** 错误类型（仅当 passed=false 时有值） */
  errorType?: ErrorType;

  /** 解决建议（纯文本），如 "Run: claude auth login" */
  resolution?: string;

  /** 非阻塞性警告（即使 passed=true 也可能有警告） */
  warning?: string;
}
```

### 2.2 使用示例

```typescript
// 成功案例
const successResult: CheckResult = {
  name: 'Environment Variable Check',
  passed: true,
  message: 'ANTHROPIC_API_KEY found',
};

// 失败案例
const failureResult: CheckResult = {
  name: 'CLI Status Command',
  passed: false,
  message: 'Not authenticated',
  errorType: 'AUTH_MISSING',
  resolution: 'Run: claude auth login',
};

// 带警告的成功案例
const warnResult: CheckResult = {
  name: 'Connectivity Check',
  passed: true,
  message: 'Local credentials found',
  warning: 'Cannot reach api.anthropic.com. Proceeding with local credentials.',
};
```

## 3. VerificationResult 接口

### 3.1 定义

```typescript
/**
 * 验证状态枚举
 */
export type VerificationStatus =
  | 'verified'              // 完全验证通过
  | 'verified_with_warnings' // 验证通过但有警告
  | 'failed';               // 验证失败

/**
 * Agent 验证的完整结果
 */
export interface VerificationResult {
  /** Agent 名称，如 "claude", "codex", "gemini" */
  name: string;

  /** 验证状态 */
  status: VerificationStatus;

  /** 主要错误描述（仅当 status='failed' 时有值） */
  error?: string;

  /** 主要错误类型（仅当 status='failed' 时有值） */
  errorType?: ErrorType;

  /** 所有警告列表（纯文本） */
  warnings?: string[];

  /** 所有检查项的详细结果 */
  checks: CheckResult[];

  /** 认证方法（仅当验证成功时有值） */
  authMethod?: string;
}
```

### 3.2 状态转换规则

```typescript
/**
 * 根据检查结果列表确定最终验证状态
 */
export function determineVerificationStatus(
  checks: CheckResult[]
): VerificationStatus {
  // 任何阻塞性错误 → failed
  const hasBlockingError = checks.some(
    (c) => !c.passed && c.errorType && isBlockingError(c.errorType)
  );
  if (hasBlockingError) {
    return 'failed';
  }

  // 有警告但无阻塞性错误 → verified_with_warnings
  const hasWarnings = checks.some((c) => c.warning);
  const hasNonBlockingErrors = checks.some(
    (c) => !c.passed && c.errorType && !isBlockingError(c.errorType)
  );
  if (hasWarnings || hasNonBlockingErrors) {
    return 'verified_with_warnings';
  }

  // 全部通过且无警告 → verified
  return 'verified';
}
```

### 3.3 使用示例

```typescript
// 完全验证通过
const verifiedResult: VerificationResult = {
  name: 'claude',
  status: 'verified',
  checks: [
    { name: 'CLI Command Check', passed: true, message: 'claude found' },
    { name: 'Auth Check', passed: true, message: 'Authenticated via API key' },
  ],
  authMethod: 'ANTHROPIC_API_KEY',
};

// 验证通过但有警告
const warnResult: VerificationResult = {
  name: 'codex',
  status: 'verified_with_warnings',
  warnings: ['Cannot reach api.openai.com. Proceeding with local credentials.'],
  checks: [
    { name: 'CLI Command Check', passed: true, message: 'codex found' },
    {
      name: 'Connectivity Check',
      passed: true,
      message: 'Local credentials found',
      warning: 'Cannot reach api.openai.com',
    },
    { name: 'Auth Check', passed: true, message: 'OAuth credentials found' },
  ],
  authMethod: 'OAuth',
};

// 验证失败
const failedResult: VerificationResult = {
  name: 'gemini',
  status: 'failed',
  error: 'Not authenticated',
  errorType: 'AUTH_MISSING',
  checks: [
    { name: 'CLI Command Check', passed: true, message: 'gemini found' },
    {
      name: 'Auth Check',
      passed: false,
      message: 'No credentials found',
      errorType: 'AUTH_MISSING',
      resolution: 'Run: gemini (or set GEMINI_API_KEY)',
    },
  ],
};
```

## 4. ConnectivityResult 接口

### 4.1 定义

```typescript
/**
 * 网络连通性检查结果
 */
export interface ConnectivityResult {
  /** 是否可达 */
  reachable: boolean;

  /** 延迟（毫秒），仅当 reachable=true 时有值 */
  latencyMs?: number;

  /** 错误描述（仅当 reachable=false 时有值） */
  error?: string;

  /**
   * 错误类型（仅当 reachable=false 时有值）
   * 包含所有 NETWORK_* 类型
   */
  errorType?:
    | 'NETWORK_DNS'
    | 'NETWORK_TIMEOUT'
    | 'NETWORK_REFUSED'
    | 'NETWORK_UNREACHABLE'
    | 'NETWORK_PROXY'
    | 'NETWORK_TLS';
}
```

### 4.2 使用示例

```typescript
// 连通成功
const reachable: ConnectivityResult = {
  reachable: true,
  latencyMs: 45,
};

// DNS 失败
const dnsError: ConnectivityResult = {
  reachable: false,
  error: 'Cannot resolve api.anthropic.com',
  errorType: 'NETWORK_DNS',
};

// 连接超时
const timeoutError: ConnectivityResult = {
  reachable: false,
  error: 'Connection timeout after 5000ms',
  errorType: 'NETWORK_TIMEOUT',
};
```

## 5. AuthCheckResult 接口

### 5.1 定义

```typescript
/**
 * 认证检查结果
 */
export interface AuthCheckResult {
  /** 认证是否通过 */
  passed: boolean;

  /** 认证方法（仅当 passed=true 时有值） */
  method?: string;

  /** 错误描述（仅当 passed=false 时有值） */
  message?: string;

  /** 错误类型（仅当 passed=false 时有值） */
  errorType?: ErrorType;

  /** 解决建议（仅当 passed=false 时有值） */
  resolution?: string;

  /** 非阻塞性警告 */
  warning?: string;
}
```

### 5.2 使用示例

```typescript
// 环境变量认证成功
const envKeyAuth: AuthCheckResult = {
  passed: true,
  method: 'ANTHROPIC_API_KEY env var',
};

// OAuth 认证成功但有警告
const oauthAuth: AuthCheckResult = {
  passed: true,
  method: 'OAuth session',
  warning: 'Cannot verify Keychain credentials on macOS',
};

// 认证失败
const authFailed: AuthCheckResult = {
  passed: false,
  message: 'Not authenticated',
  errorType: 'AUTH_MISSING',
  resolution: 'Run: claude auth login',
};

// 凭证过期
const authExpired: AuthCheckResult = {
  passed: false,
  message: 'Token expired',
  errorType: 'AUTH_EXPIRED',
  resolution: 'Run: codex login',
};
```

## 6. 错误解决建议映射

### 6.1 定义

```typescript
/**
 * 错误类型到解决建议的映射
 * UI 层可使用此映射提供统一的解决建议
 */
export const ErrorResolutions: Record<ErrorType, string> = {
  // 网络错误
  NETWORK_DNS: 'Check internet connection. Try: ping api.anthropic.com',
  NETWORK_TIMEOUT: 'Network slow or blocked. Check firewall/VPN settings.',
  NETWORK_REFUSED: 'Server unavailable. Check if API endpoint is accessible.',
  NETWORK_UNREACHABLE: 'Network unreachable. Check network configuration.',
  NETWORK_PROXY: 'Configure proxy: export https_proxy=http://proxy:port',
  NETWORK_TLS: 'SSL issue. Corporate network? Set NODE_EXTRA_CA_CERTS.',

  // 认证错误
  AUTH_MISSING: 'No credentials found. Run the login command.',
  AUTH_INVALID: 'Credentials rejected. Re-run the login command.',
  AUTH_EXPIRED: 'Session expired. Run the login command to refresh.',
  AUTH_PERMISSION: 'Access denied. Check account permissions.',

  // 配置错误
  CONFIG_MISSING: 'Agent not installed. Run: npm install -g <agent>',
  CONFIG_INVALID: 'Configuration invalid. Check config files.',
  CONFIG_VERSION: 'Version mismatch. Update agent: npm update -g <agent>',
  CONFIG_DEPENDENCY: 'External dependency missing. Install required CLI tool.',

  // 不确定状态
  VERIFICATION_INCOMPLETE: 'Could not fully verify credentials. Proceeding with local credentials.',
  STATUS_COMMAND_UNAVAILABLE: 'Status command not available in this CLI version.',
};
```

## 7. 导出汇总

```typescript
// src/services/validation/types.ts

export type {
  ErrorType,
  VerificationStatus,
  CheckResult,
  VerificationResult,
  ConnectivityResult,
  AuthCheckResult,
};

export {
  isBlockingError,
  isNetworkError,
  isAuthError,
  isConfigError,
  determineVerificationStatus,
  ErrorResolutions,
};
```

## 8. 单元测试要点

```typescript
describe('types', () => {
  describe('isBlockingError', () => {
    it('returns true for AUTH_MISSING', () => {
      expect(isBlockingError('AUTH_MISSING')).toBe(true);
    });

    it('returns true for CONFIG_MISSING', () => {
      expect(isBlockingError('CONFIG_MISSING')).toBe(true);
    });

    it('returns false for NETWORK_DNS', () => {
      expect(isBlockingError('NETWORK_DNS')).toBe(false);
    });

    it('returns false for VERIFICATION_INCOMPLETE', () => {
      expect(isBlockingError('VERIFICATION_INCOMPLETE')).toBe(false);
    });
  });

  describe('determineVerificationStatus', () => {
    it('returns verified when all checks pass without warnings', () => {
      const checks: CheckResult[] = [
        { name: 'Check1', passed: true, message: 'OK' },
        { name: 'Check2', passed: true, message: 'OK' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified');
    });

    it('returns verified_with_warnings when checks pass with warnings', () => {
      const checks: CheckResult[] = [
        { name: 'Check1', passed: true, message: 'OK', warning: 'Some warning' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified_with_warnings');
    });

    it('returns failed when blocking error exists', () => {
      const checks: CheckResult[] = [
        { name: 'Check1', passed: false, message: 'Failed', errorType: 'AUTH_MISSING' },
      ];
      expect(determineVerificationStatus(checks)).toBe('failed');
    });

    it('returns verified_with_warnings for non-blocking errors', () => {
      const checks: CheckResult[] = [
        { name: 'Check1', passed: false, message: 'Failed', errorType: 'NETWORK_DNS' },
        { name: 'Check2', passed: true, message: 'OK' },
      ];
      expect(determineVerificationStatus(checks)).toBe('verified_with_warnings');
    });
  });
});
```
