# CodexAuthChecker - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/auth/CodexAuthChecker.ts` |
| 层级 | Core 层 |
| 依赖 | `./AuthChecker.ts`, `../types.ts`, `fs`, `path`, `os` |

## 1. 类概览

### 1.1 职责

- 检测 OpenAI Codex CLI 的认证状态
- 支持 API Key 和 ChatGPT OAuth 两种认证方式
- 使用 `codex login status` 命令进行可靠检测

### 1.2 类图

```
┌─────────────────────────────────────────────────────────────────┐
│                      CodexAuthChecker                            │
├─────────────────────────────────────────────────────────────────┤
│ + agentType: 'codex'                                            │
│ + command: 'codex'                                              │
├─────────────────────────────────────────────────────────────────┤
│ + checkAuth(): Promise<AuthCheckResult>                         │
│ - checkEnvVars(): AuthCheckResult | null                        │
│ - checkStatusCommand(): Promise<AuthCheckResult | null>         │
│ - checkAuthFile(): AuthCheckResult | null                       │
│ - parseStatusOutput(output: string): AuthStatus                 │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 常量定义

### 2.1 环境变量

```typescript
/**
 * Codex 认证相关环境变量
 */
const ENV_VARS = {
  /** 主要 API Key */
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  /** Codex 专用 API Key（用于单次运行） */
  CODEX_API_KEY: 'CODEX_API_KEY',
  /** 自定义配置目录 */
  CODEX_HOME: 'CODEX_HOME',
} as const;
```

### 2.2 凭证文件路径

```typescript
/**
 * Codex 凭证文件名
 */
const AUTH_FILE = 'auth.json';

/**
 * 默认 Codex 配置目录（相对于 home）
 */
const DEFAULT_CODEX_DIR = '.codex';
```

### 2.3 状态命令输出模式

```typescript
/**
 * 状态命令输出模式（基于源码分析）
 *
 * 来源: codex-rs/cli/src/login.rs:154-183
 */
const STATUS_PATTERNS = {
  /** API Key 认证 */
  API_KEY: /Logged in using an API key/i,
  /** ChatGPT OAuth 认证 */
  CHATGPT: /Logged in using ChatGPT/i,
  /** 未登录 */
  NOT_LOGGED_IN: /Not logged in/i,
  /** 错误 */
  ERROR: /Error checking login status/i,
} as const;
```

## 3. 类实现

### 3.1 构造函数

```typescript
import { BaseAuthChecker, AuthCheckerOptions } from './AuthChecker';
import { AuthCheckResult } from '../types';

export class CodexAuthChecker extends BaseAuthChecker {
  readonly agentType = 'codex';
  readonly command = 'codex';

  constructor(options?: AuthCheckerOptions) {
    super(options);
  }
}
```

### 3.2 主检查方法

```typescript
/**
 * 执行 Codex 认证检查
 *
 * 检查顺序：
 * 1. 环境变量 (OPENAI_API_KEY, CODEX_API_KEY)
 * 2. CLI 状态命令 (codex login status)
 * 3. 凭证文件 (~/.codex/auth.json)
 */
async checkAuth(): Promise<AuthCheckResult> {
  // 优先级 1: 环境变量
  const envResult = this.checkEnvVars();
  if (envResult) {
    return envResult;
  }

  // 优先级 2: CLI 状态命令（最可靠，处理 OAuth 刷新）
  const statusResult = await this.checkStatusCommand();
  if (statusResult) {
    return statusResult;
  }

  // 优先级 3: 凭证文件（回退）
  const fileResult = this.checkAuthFile();
  if (fileResult) {
    return fileResult;
  }

  // 全部检查失败
  return this.failureResult(
    'AUTH_MISSING',
    'Not authenticated',
    'Run: codex login'
  );
}
```

### 3.3 流程图

```
checkAuth()
    │
    ▼
checkEnvVars()
    │
    ├── OPENAI_API_KEY 存在 → return success(API Key)
    ├── CODEX_API_KEY 存在 → return success(CODEX_API_KEY)
    └── 无 → 继续
    │
    ▼
checkStatusCommand()
    │
    ├── 退出码 0 + "API key" → return success(API Key)
    ├── 退出码 0 + "ChatGPT" → return success(OAuth)
    ├── 退出码 1 + "Not logged in" → return failure(AUTH_MISSING)
    ├── 网络错误 → return failure(NETWORK_*)
    └── 命令不可用 → 继续
    │
    ▼
checkAuthFile()
    │
    ├── 文件存在 + 有效凭证 → return success (with warning)
    └── 文件不存在/无效 → 继续
    │
    ▼
return failure(AUTH_MISSING)
```

## 4. 私有方法

### 4.1 checkEnvVars

```typescript
/**
 * 检查环境变量
 */
private checkEnvVars(): AuthCheckResult | null {
  if (this.hasEnv(ENV_VARS.OPENAI_API_KEY)) {
    return this.successResult('OPENAI_API_KEY env var');
  }

  if (this.hasEnv(ENV_VARS.CODEX_API_KEY)) {
    return this.successResult('CODEX_API_KEY env var');
  }

  return null;
}
```

### 4.2 checkStatusCommand

```typescript
/**
 * 检查 CLI 状态命令
 *
 * @remarks
 * - 命令: codex login status
 * - 退出码 0 = 已认证
 * - 退出码 1 = 未认证或错误
 *
 * WARN 放行策略：
 * - 命令不可用（ENOENT/未知命令）时，记录原因并回退到文件检查
 * - 网络错误时，不判定为"未认证"，回退到文件检查
 * - 只有明确的"Not logged in"才判定失败
 *
 * 来源: codex-rs/cli/src/login.rs:154-183
 */
private async checkStatusCommand(): Promise<AuthCheckResult | null> {
  const result = await this.executeStatusCommand(['login', 'status']);

  // 命令不可用，记录原因以便文件检查时使用
  if (!result.available) {
    this.statusCommandUnavailableReason = result.reason;
    return null;
  }

  // 网络错误 - 不能断定未认证，回退到文件检查
  if (result.networkError) {
    this.statusCommandUnavailableReason = 'NETWORK_ERROR';
    return null;
  }

  const output = result.output || '';

  // 退出码 0 = 已认证
  if (result.exitCode === 0) {
    return this.parseSuccessOutput(output);
  }

  // 退出码 1
  if (result.exitCode === 1) {
    return this.parseFailureOutput(output);
  }

  // 其他退出码，标记并回退到文件检查
  this.statusCommandUnavailableReason = `UNKNOWN_EXIT_CODE_${result.exitCode}`;
  return null;
}

/** 状态命令不可用的原因 */
private statusCommandUnavailableReason?: string;

/**
 * 解析成功输出
 */
private parseSuccessOutput(output: string): AuthCheckResult {
  if (STATUS_PATTERNS.API_KEY.test(output)) {
    // 提取 masked key
    const keyMatch = output.match(/sk-[a-zA-Z0-9]*\*{3}[A-Z]{5}/);
    const maskedKey = keyMatch ? ` (${keyMatch[0]})` : '';
    return this.successResult(`API Key${maskedKey}`);
  }

  if (STATUS_PATTERNS.CHATGPT.test(output)) {
    return this.successResult('ChatGPT OAuth');
  }

  // 默认成功
  return this.successResult('Authenticated');
}

/**
 * 解析失败输出
 *
 * @remarks
 * WARN 放行策略：
 * - 明确的 "Not logged in" → 失败
 * - 网络错误 → 回退到文件检查（不直接失败）
 * - 不确定的错误 → 回退到文件检查
 */
private parseFailureOutput(output: string): AuthCheckResult | null {
  // 明确的"未登录"状态 → 直接失败
  if (STATUS_PATTERNS.NOT_LOGGED_IN.test(output)) {
    return this.failureResult(
      'AUTH_MISSING',
      'Not logged in',
      'Run: codex login'
    );
  }

  if (STATUS_PATTERNS.ERROR.test(output)) {
    // 网络错误 → 不直接失败，回退到文件检查
    if (this.isNetworkError(output)) {
      this.statusCommandUnavailableReason = 'NETWORK_ERROR';
      return null;  // 让文件检查决定
    }

    // 其他错误 → 可能是凭证问题，但不确定，回退到文件检查
    this.statusCommandUnavailableReason = 'STATUS_CHECK_ERROR';
    return null;
  }

  // 不确定的失败 → 回退到文件检查
  this.statusCommandUnavailableReason = 'AMBIGUOUS_OUTPUT';
  return null;
}

/**
 * 判断是否为网络错误
 */
private isNetworkError(output: string): boolean {
  const networkPatterns = [
    /ETIMEDOUT/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /network/i,
    /timeout/i,
    /connection refused/i,
  ];

  return networkPatterns.some((pattern) => pattern.test(output));
}
```

### 4.3 checkAuthFile

```typescript
/**
 * auth.json 文件结构
 *
 * 来源: codex-rs/core/src/auth/storage.rs:36-47
 */
interface AuthDotJson {
  OPENAI_API_KEY?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
  };
  last_refresh?: string;
}

/**
 * 检查凭证文件
 *
 * @remarks
 * 这是回退检查，当状态命令不可用/不确定时使用。
 *
 * WARN 放行策略：
 * - 状态命令不可用 + 文件有凭证 → WARN 放行
 * - 网络错误 + 文件有凭证 → WARN 放行
 * - 避免假阴性：宁可让运行时发现问题
 */
private checkAuthFile(): AuthCheckResult | null {
  const authPath = this.getAuthFilePath();

  if (!this.fileExists(authPath)) {
    return null;
  }

  const auth = this.readJsonFile<AuthDotJson>(authPath);

  if (!auth) {
    // 文件存在但无法解析
    return this.failureResult(
      'CONFIG_INVALID',
      'auth.json is corrupted',
      `Delete ${authPath} and run: codex login`
    );
  }

  // 检查是否有有效凭证
  const hasApiKey = auth.OPENAI_API_KEY && auth.OPENAI_API_KEY.trim() !== '';
  const hasTokens = auth.tokens?.access_token || auth.tokens?.refresh_token;

  if (hasApiKey || hasTokens) {
    const method = hasApiKey ? 'API Key (file)' : 'OAuth tokens (file)';

    // 状态命令不可用/不确定时 → WARN 放行
    if (this.statusCommandUnavailableReason) {
      return {
        passed: true,
        method,
        warning: `Status command unavailable (${this.statusCommandUnavailableReason}). ` +
                 'Proceeding with local credentials. If auth fails at runtime, run: codex login',
      };
    }

    // 状态命令正常但没返回结果（不应该到这里）→ 也 WARN 放行
    return {
      passed: true,
      method,
      warning: 'Could not verify credentials online. If auth fails at runtime, run: codex login',
    };
  }

  return null;
}

/**
 * 获取 auth.json 文件路径
 */
private getAuthFilePath(): string {
  // 检查 CODEX_HOME 环境变量
  const codexHome = this.getEnv(ENV_VARS.CODEX_HOME);

  if (codexHome && codexHome.trim() !== '') {
    return path.join(codexHome, AUTH_FILE);
  }

  // 默认路径
  return this.getHomePath(DEFAULT_CODEX_DIR, AUTH_FILE);
}
```

## 5. 导出

```typescript
// src/services/validation/auth/CodexAuthChecker.ts

export { CodexAuthChecker };
```

## 6. 单元测试

### 6.1 环境变量测试

```typescript
describe('CodexAuthChecker', () => {
  describe('environment variables', () => {
    it('detects OPENAI_API_KEY', async () => {
      const checker = new CodexAuthChecker({
        env: { OPENAI_API_KEY: 'sk-test' },
      });

      const result = await checker.checkAuth();

      expect(result.passed).toBe(true);
      expect(result.method).toBe('OPENAI_API_KEY env var');
    });

    it('detects CODEX_API_KEY', async () => {
      const checker = new CodexAuthChecker({
        env: { CODEX_API_KEY: 'sk-codex-test' },
      });

      const result = await checker.checkAuth();

      expect(result.passed).toBe(true);
      expect(result.method).toBe('CODEX_API_KEY env var');
    });

    it('prefers OPENAI_API_KEY over CODEX_API_KEY', async () => {
      const checker = new CodexAuthChecker({
        env: {
          OPENAI_API_KEY: 'sk-openai',
          CODEX_API_KEY: 'sk-codex',
        },
      });

      const result = await checker.checkAuth();

      expect(result.method).toBe('OPENAI_API_KEY env var');
    });
  });
});
```

### 6.2 状态命令测试

```typescript
describe('status command', () => {
  it('parses API key authentication', async () => {
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockResolvedValue({
        stdout: 'Logged in using an API key - sk-proj-***ABCDE',
        stderr: '',
      }),
    }));

    const checker = new CodexAuthChecker({ env: {} });
    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toContain('API Key');
  });

  it('parses ChatGPT OAuth authentication', async () => {
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockResolvedValue({
        stdout: 'Logged in using ChatGPT',
        stderr: '',
      }),
    }));

    const checker = new CodexAuthChecker({ env: {} });
    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toBe('ChatGPT OAuth');
  });

  it('handles not logged in', async () => {
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockRejectedValue({
        code: 1,
        stderr: 'Not logged in',
      }),
    }));

    const checker = new CodexAuthChecker({ env: {} });
    const result = await checker.checkAuth();

    expect(result.passed).toBe(false);
    expect(result.errorType).toBe('AUTH_MISSING');
  });

  it('detects network errors', async () => {
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockRejectedValue({
        code: 1,
        stderr: 'Error checking login status: ETIMEDOUT',
      }),
    }));

    const checker = new CodexAuthChecker({ env: {} });
    const result = await checker.checkAuth();

    expect(result.passed).toBe(false);
    expect(result.errorType).toBe('NETWORK_TIMEOUT');
  });
});
```

### 6.3 凭证文件测试

```typescript
describe('auth file', () => {
  it('detects credentials in auth.json', async () => {
    // 模拟文件存在
    vi.mock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(
        JSON.stringify({
          OPENAI_API_KEY: 'sk-test',
        })
      ),
    }));

    const checker = new CodexAuthChecker({
      env: {},
      skipStatusCommand: true,
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toContain('API Key');
    expect(result.warning).toBeDefined();
  });

  it('handles corrupted auth.json', async () => {
    vi.mock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('invalid json'),
    }));

    const checker = new CodexAuthChecker({
      env: {},
      skipStatusCommand: true,
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(false);
    expect(result.errorType).toBe('CONFIG_INVALID');
  });

  it('respects CODEX_HOME environment variable', async () => {
    const mockReadFile = vi.fn().mockReturnValue(
      JSON.stringify({ OPENAI_API_KEY: 'sk-test' })
    );

    vi.mock('fs', () => ({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: mockReadFile,
    }));

    const checker = new CodexAuthChecker({
      env: { CODEX_HOME: '/custom/codex' },
      skipStatusCommand: true,
    });

    await checker.checkAuth();

    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/custom/codex/auth.json'),
      'utf-8'
    );
  });
});
```

## 7. 注意事项

### 7.1 状态命令优先

`codex login status` 是最可靠的检查方式，因为：
1. 它会自动处理 OAuth token 刷新
2. 它能准确反映 CLI 的认证状态
3. 退出码明确（0=成功，1=失败）

### 7.2 凭证文件仅作回退

直接检查 `auth.json` 文件可能导致误判：
- OAuth token 可能已过期但文件仍存在
- 文件中的 token 可能已被 CLI 更新

因此文件检查结果总是带有警告。

### 7.3 CODEX_HOME 环境变量

用户可以通过 `CODEX_HOME` 自定义配置目录。检查时必须尊重此设置。
