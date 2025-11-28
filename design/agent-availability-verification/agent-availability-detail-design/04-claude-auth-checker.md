# ClaudeAuthChecker - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/auth/ClaudeAuthChecker.ts` |
| 层级 | Core 层 |
| 依赖 | `./AuthChecker.ts`, `../types.ts`, `fs`, `path`, `os` |

## 1. 类概览

### 1.1 职责

- 检测 Claude Code CLI 的认证状态
- 支持多种认证方式：API Key、OAuth、Bedrock、Vertex AI
- 处理 macOS Keychain 无法直接读取的情况

### 1.2 类图

```
┌─────────────────────────────────────────────────────────────────┐
│                      ClaudeAuthChecker                           │
├─────────────────────────────────────────────────────────────────┤
│ + agentType: 'claude'                                           │
│ + command: 'claude'                                             │
├─────────────────────────────────────────────────────────────────┤
│ + checkAuth(): Promise<AuthCheckResult>                         │
│ - checkEnvVars(): AuthCheckResult | null                        │
│ - checkBedrockMode(): Promise<AuthCheckResult | null>           │
│ - checkVertexMode(): Promise<AuthCheckResult | null>            │
│ - checkStatusCommand(): Promise<AuthCheckResult | null>         │
│ - checkCredentialFiles(): AuthCheckResult | null                │
│ - checkAWSCredentials(): boolean                                │
│ - checkGCPCredentials(): boolean                                │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 常量定义

### 2.1 环境变量

```typescript
/**
 * Claude 认证相关环境变量
 */
const ENV_VARS = {
  /** 主要 API Key */
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  /** 次要 API Key（兼容旧版） */
  CLAUDE_API_KEY: 'CLAUDE_API_KEY',
  /** Bedrock 模式开关 */
  CLAUDE_CODE_USE_BEDROCK: 'CLAUDE_CODE_USE_BEDROCK',
  /** Vertex AI 模式开关 */
  CLAUDE_CODE_USE_VERTEX: 'CLAUDE_CODE_USE_VERTEX',
  /** AWS 凭证 */
  AWS_ACCESS_KEY_ID: 'AWS_ACCESS_KEY_ID',
  AWS_SECRET_ACCESS_KEY: 'AWS_SECRET_ACCESS_KEY',
  /** GCP 凭证 */
  GOOGLE_APPLICATION_CREDENTIALS: 'GOOGLE_APPLICATION_CREDENTIALS',
} as const;
```

### 2.2 凭证文件路径

```typescript
/**
 * Claude 凭证文件路径（相对于 home 目录）
 */
const CREDENTIAL_PATHS = {
  /** Linux OAuth 凭证（新路径） */
  LINUX_CREDENTIALS: '.claude/.credentials.json',
  /** Linux 配置目录凭证（XDG 规范路径） */
  LINUX_CONFIG_CREDENTIALS: '.config/claude/credentials.json',
  /** 主配置文件 */
  MAIN_CONFIG: '.claude.json',
  /** 设置文件 */
  SETTINGS: '.claude/settings.json',
  /** XDG 配置路径 */
  XDG_CONFIG: '.config/claude/config.json',
} as const;

/**
 * AWS 凭证路径（相对于 home 目录）
 */
const AWS_CREDENTIALS_PATH = '.aws/credentials';

/**
 * GCP ADC 路径（相对于 home 目录）
 */
const GCP_ADC_PATH = '.config/gcloud/application_default_credentials.json';
```

## 3. 类实现

### 3.1 构造函数

```typescript
import { BaseAuthChecker, AuthCheckerOptions } from './AuthChecker';
import { AuthCheckResult } from '../types';

export class ClaudeAuthChecker extends BaseAuthChecker {
  readonly agentType = 'claude';
  readonly command = 'claude';

  constructor(options?: AuthCheckerOptions) {
    super(options);
  }
}
```

### 3.2 主检查方法

```typescript
/**
 * 执行 Claude 认证检查
 *
 * 检查顺序：
 * 1. 环境变量 (ANTHROPIC_API_KEY, CLAUDE_API_KEY)
 * 2. Bedrock 模式
 * 3. Vertex AI 模式
 * 4. CLI 状态命令 (claude auth status)
 * 5. 凭证文件
 */
async checkAuth(): Promise<AuthCheckResult> {
  // 优先级 1: 环境变量
  const envResult = this.checkEnvVars();
  if (envResult) {
    return envResult;
  }

  // 优先级 2: Bedrock 模式
  const bedrockResult = await this.checkBedrockMode();
  if (bedrockResult) {
    return bedrockResult;
  }

  // 优先级 3: Vertex AI 模式
  const vertexResult = await this.checkVertexMode();
  if (vertexResult) {
    return vertexResult;
  }

  // 优先级 4: CLI 状态命令
  const statusResult = await this.checkStatusCommand();
  if (statusResult) {
    return statusResult;
  }

  // 优先级 5: 凭证文件
  const fileResult = this.checkCredentialFiles();
  if (fileResult) {
    return fileResult;
  }

  // 全部检查失败
  // 构建失败结果，附带可能的 Bedrock/Vertex 警告
  const result = this.failureResult(
    'AUTH_MISSING',
    'No credentials found',
    'Run: claude auth login (or set ANTHROPIC_API_KEY)'
  );

  // 附加配置模式警告（帮助用户理解为何配置的模式未生效）
  const warnings: string[] = [];
  if (this.bedrockModeWarning) {
    warnings.push(this.bedrockModeWarning);
  }
  if (this.vertexModeWarning) {
    warnings.push(this.vertexModeWarning);
  }
  if (warnings.length > 0) {
    result.warning = warnings.join(' | ');
  }

  return result;
}
```

### 3.3 流程图

```
checkAuth()
    │
    ▼
checkEnvVars() ─────有值────→ return success(API_KEY)
    │
   无值
    │
    ▼
checkBedrockMode()
    │
    ├── 模式启用 + 凭证完整 → return success(Bedrock)
    ├── 模式启用 + 凭证缺失 → 记录警告，继续检查
    └── 模式未启用 → 继续
    │
    ▼
checkVertexMode()
    │
    ├── 模式启用 + 凭证完整 → return success(Vertex)
    ├── 模式启用 + 凭证缺失 → 记录警告，继续检查
    └── 模式未启用 → 继续
    │
    ▼
checkStatusCommand()
    │
    ├── 返回"已认证" → return success(OAuth)
    ├── 返回"未认证" → return failure(AUTH_MISSING)
    └── 命令不可用/失败 → 继续
    │
    ▼
checkCredentialFiles()
    │
    ├── 找到有效凭证 → return success(OAuth file)
    │                    (可能带 warning)
    └── 未找到 → 继续
    │
    ▼
return failure(AUTH_MISSING)
   (附带 Bedrock/Vertex 警告)
```

## 4. 私有方法

### 4.1 checkEnvVars

```typescript
/**
 * 检查环境变量
 */
private checkEnvVars(): AuthCheckResult | null {
  if (this.hasEnv(ENV_VARS.ANTHROPIC_API_KEY)) {
    return this.successResult('ANTHROPIC_API_KEY env var');
  }

  if (this.hasEnv(ENV_VARS.CLAUDE_API_KEY)) {
    return this.successResult('CLAUDE_API_KEY env var (legacy)');
  }

  return null;
}
```

### 4.2 checkBedrockMode

```typescript
/**
 * 检查 AWS Bedrock 模式
 *
 * @remarks
 * 当 Bedrock 模式启用但凭证缺失时，返回 CONFIG_DEPENDENCY 而非 AUTH_MISSING。
 * 原因：
 * 1. 这是配置依赖问题（AWS 凭证），不是 Claude 认证问题
 * 2. CONFIG_DEPENDENCY 是非阻塞的 WARN，AUTH_MISSING 是阻塞的
 * 3. 用户可能有其他认证方式可用，不应阻止继续检查
 */
private async checkBedrockMode(): Promise<AuthCheckResult | null> {
  const bedrockEnabled = this.getEnv(ENV_VARS.CLAUDE_CODE_USE_BEDROCK) === '1';

  if (!bedrockEnabled) {
    return null;
  }

  // Bedrock 模式启用，检查 AWS 凭证
  if (this.checkAWSCredentials()) {
    return this.successResult('AWS Bedrock');
  }

  // Bedrock 模式启用但凭证缺失
  // 记录警告但不阻塞，继续检查其他认证方式
  this.bedrockModeWarning = 'Bedrock mode enabled but AWS credentials missing. ' +
    'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure ~/.aws/credentials';
  return null;
}

/**
 * Bedrock 凭证缺失时的警告信息
 * 如果最终没有找到其他认证方式，此警告会被附加到失败结果
 */
private bedrockModeWarning?: string;

/**
 * 检查 AWS 凭证
 */
private checkAWSCredentials(): boolean {
  // 检查环境变量
  if (
    this.hasEnv(ENV_VARS.AWS_ACCESS_KEY_ID) &&
    this.hasEnv(ENV_VARS.AWS_SECRET_ACCESS_KEY)
  ) {
    return true;
  }

  // 检查凭证文件
  const awsCredsPath = this.getHomePath(AWS_CREDENTIALS_PATH);
  return this.fileExists(awsCredsPath);
}
```

### 4.3 checkVertexMode

```typescript
/**
 * 检查 Google Vertex AI 模式
 *
 * @remarks
 * 与 Bedrock 类似，凭证缺失时不阻塞，继续检查其他认证方式。
 */
private async checkVertexMode(): Promise<AuthCheckResult | null> {
  const vertexEnabled = this.getEnv(ENV_VARS.CLAUDE_CODE_USE_VERTEX) === '1';

  if (!vertexEnabled) {
    return null;
  }

  // Vertex 模式启用，检查 GCP 凭证
  if (this.checkGCPCredentials()) {
    return this.successResult('Vertex AI');
  }

  // Vertex 模式启用但凭证缺失
  // 记录警告但不阻塞，继续检查其他认证方式
  this.vertexModeWarning = 'Vertex AI mode enabled but GCP credentials missing. ' +
    'Set GOOGLE_APPLICATION_CREDENTIALS or run: gcloud auth application-default login';
  return null;
}

/**
 * Vertex 凭证缺失时的警告信息
 */
private vertexModeWarning?: string;

/**
 * 检查 GCP 凭证
 */
private checkGCPCredentials(): boolean {
  // 检查服务账号环境变量
  const saPath = this.getEnv(ENV_VARS.GOOGLE_APPLICATION_CREDENTIALS);
  if (saPath && this.fileExists(saPath)) {
    return true;
  }

  // 检查 ADC
  const adcPath = this.getHomePath(GCP_ADC_PATH);
  return this.fileExists(adcPath);
}
```

### 4.4 checkStatusCommand

```typescript
/**
 * 检查 CLI 状态命令
 *
 * @remarks
 * - 命令: claude auth status
 * - 退出码 0 通常表示已认证
 * - 已知问题: GitHub Issue #8002 报告状态命令可能误报
 *
 * @returns
 * - AuthCheckResult 如果能明确判断状态
 * - null 如果命令不可用或结果不确定
 */
private async checkStatusCommand(): Promise<AuthCheckResult | null> {
  const result = await this.executeStatusCommand(['auth', 'status']);

  // 命令不可用时，记录原因以便后续决策
  if (!result.available) {
    // 保存到实例以便 checkCredentialFiles 使用
    this.statusCommandUnavailableReason = result.reason;
    return null;
  }

  // 网络错误时，不能断定未认证
  if (result.networkError) {
    this.statusCommandUnavailableReason = 'NETWORK_ERROR';
    return null;
  }

  const output = result.output?.toLowerCase() || '';

  // 解析输出
  if (this.isAuthenticatedOutput(output)) {
    return this.successResult('OAuth session');
  }

  // 明确的"未认证"状态才返回失败
  if (this.isNotAuthenticatedOutput(output)) {
    return this.failureResult(
      'AUTH_MISSING',
      'Not logged in',
      'Run: claude auth login'
    );
  }

  // 输出不确定（可能是误报），标记并回退到文件检查
  this.statusCommandUnavailableReason = 'AMBIGUOUS_OUTPUT';
  return null;
}

/** 状态命令不可用的原因 */
private statusCommandUnavailableReason?: string;

/**
 * 判断输出是否表示已认证
 */
private isAuthenticatedOutput(output: string): boolean {
  return (
    output.includes('authenticated') ||
    output.includes('logged in') ||
    output.includes('session active')
  );
}

/**
 * 判断输出是否表示未认证
 */
private isNotAuthenticatedOutput(output: string): boolean {
  return (
    output.includes('not authenticated') ||
    output.includes('not logged in') ||
    output.includes('please login') ||
    output.includes('no credentials')
  );
}
```

### 4.5 checkCredentialFiles

```typescript
/**
 * 检查凭证文件
 *
 * @remarks
 * - macOS: 凭证存储在 Keychain，无法直接读取
 * - Linux: 凭证存储在 ~/.claude/.credentials.json 或 ~/.config/claude/credentials.json
 * - Windows: 凭证存储在 Windows Credential Manager
 *
 * WARN 放行策略：
 * - 当状态命令不可用/不确定，且存在凭证文件时，返回 WARN 放行
 * - 当 macOS Keychain 无法读取时，返回 WARN 放行
 * - 避免假阴性：宁可让运行时发现问题，也不要阻止可能已认证的用户
 */
private checkCredentialFiles(): AuthCheckResult | null {
  const platform = this.getPlatform();
  const hasLocalCredentials = this.hasAnyLocalCredentials();

  // Linux: 检查凭证文件
  if (platform === 'linux') {
    const credsPaths = [
      this.getHomePath(CREDENTIAL_PATHS.LINUX_CREDENTIALS),
      this.getHomePath(CREDENTIAL_PATHS.LINUX_CONFIG_CREDENTIALS),
    ];

    for (const credsPath of credsPaths) {
      if (this.fileExists(credsPath)) {
        const creds = this.readJsonFile<{
          accessToken?: string;
          refreshToken?: string;
        }>(credsPath);

        if (creds?.accessToken || creds?.refreshToken) {
          // 状态命令不可用但文件存在 → WARN 放行
          if (this.statusCommandUnavailableReason) {
            return {
              passed: true,
              method: 'OAuth credentials file',
              warning: `Status command unavailable (${this.statusCommandUnavailableReason}). ` +
                       'Proceeding with local credentials. If auth fails at runtime, run: claude auth login',
            };
          }
          return this.successResult('OAuth credentials file');
        }
      }
    }
  }

  // macOS: 无法直接读取 Keychain
  if (platform === 'darwin') {
    // 如果前面的状态命令明确返回"未认证"，则已在 checkStatusCommand 中处理
    // 这里只处理状态命令不可用/不确定的情况
    // 返回带警告的成功，避免阻止可能已认证的用户（不假阴性原则）
    return {
      passed: true,
      method: 'OAuth (Keychain)',
      warning: 'Cannot verify Keychain credentials directly. ' +
               `Status check: ${this.statusCommandUnavailableReason || 'not performed'}. ` +
               'If auth fails at runtime, run: claude auth login',
    };
  }

  // Windows: 类似 macOS，凭证在 Credential Manager
  if (platform === 'win32') {
    return {
      passed: true,
      method: 'OAuth (Credential Manager)',
      warning: 'Cannot verify Windows Credential Manager directly. ' +
               `Status check: ${this.statusCommandUnavailableReason || 'not performed'}. ` +
               'If auth fails at runtime, run: claude auth login',
    };
  }

  // 检查主配置中的 API key helper
  const configPaths = [
    this.getHomePath(CREDENTIAL_PATHS.MAIN_CONFIG),
    this.getHomePath(CREDENTIAL_PATHS.SETTINGS),
    this.getHomePath(CREDENTIAL_PATHS.XDG_CONFIG),
  ];

  for (const configPath of configPaths) {
    if (this.fileExists(configPath)) {
      const config = this.readJsonFile<{ apiKeyHelper?: string }>(configPath);
      if (config?.apiKeyHelper) {
        return this.successResult('API key helper script');
      }
    }
  }

  return null;
}

/**
 * 检查是否存在任何本地凭证文件（用于 WARN 放行判断）
 */
private hasAnyLocalCredentials(): boolean {
  const allCredPaths = [
    this.getHomePath(CREDENTIAL_PATHS.LINUX_CREDENTIALS),
    this.getHomePath(CREDENTIAL_PATHS.LINUX_CONFIG_CREDENTIALS),
    this.getHomePath(CREDENTIAL_PATHS.MAIN_CONFIG),
    this.getHomePath(CREDENTIAL_PATHS.SETTINGS),
    this.getHomePath(CREDENTIAL_PATHS.XDG_CONFIG),
  ];

  return allCredPaths.some(p => this.fileExists(p));
}
```

## 5. 导出

```typescript
// src/services/validation/auth/ClaudeAuthChecker.ts

export { ClaudeAuthChecker };
```

## 6. 单元测试

### 6.1 Mock 策略

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ClaudeAuthChecker } from './ClaudeAuthChecker';

describe('ClaudeAuthChecker', () => {
  let checker: ClaudeAuthChecker;

  beforeEach(() => {
    vi.resetAllMocks();
  });
```

### 6.2 环境变量测试

```typescript
describe('environment variables', () => {
  it('detects ANTHROPIC_API_KEY', async () => {
    checker = new ClaudeAuthChecker({
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toBe('ANTHROPIC_API_KEY env var');
  });

  it('detects CLAUDE_API_KEY (legacy)', async () => {
    checker = new ClaudeAuthChecker({
      env: { CLAUDE_API_KEY: 'sk-test' },
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toBe('CLAUDE_API_KEY env var (legacy)');
  });

  it('prefers ANTHROPIC_API_KEY over CLAUDE_API_KEY', async () => {
    checker = new ClaudeAuthChecker({
      env: {
        ANTHROPIC_API_KEY: 'sk-ant-test',
        CLAUDE_API_KEY: 'sk-test',
      },
    });

    const result = await checker.checkAuth();

    expect(result.method).toBe('ANTHROPIC_API_KEY env var');
  });
});
```

### 6.3 Bedrock 模式测试

```typescript
describe('Bedrock mode', () => {
  it('succeeds when Bedrock enabled with AWS env vars', async () => {
    checker = new ClaudeAuthChecker({
      env: {
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_ACCESS_KEY_ID: 'AKIA...',
        AWS_SECRET_ACCESS_KEY: 'secret',
      },
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toBe('AWS Bedrock');
  });

  it('fails when Bedrock enabled but no AWS credentials', async () => {
    checker = new ClaudeAuthChecker({
      env: { CLAUDE_CODE_USE_BEDROCK: '1' },
      homeDir: '/nonexistent',
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(false);
    expect(result.errorType).toBe('AUTH_MISSING');
    expect(result.message).toContain('Bedrock');
  });
});
```

### 6.4 状态命令测试

```typescript
describe('status command', () => {
  it('succeeds when status command returns authenticated', async () => {
    // Mock execAsync
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockResolvedValue({
        stdout: 'Authenticated as user@example.com',
        stderr: '',
      }),
    }));

    checker = new ClaudeAuthChecker({ env: {} });
    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.method).toBe('OAuth session');
  });

  it('fails when status command returns not authenticated', async () => {
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockResolvedValue({
        stdout: 'Not logged in',
        stderr: '',
      }),
    }));

    checker = new ClaudeAuthChecker({ env: {} });
    const result = await checker.checkAuth();

    expect(result.passed).toBe(false);
    expect(result.errorType).toBe('AUTH_MISSING');
  });
});
```

### 6.5 macOS Keychain 测试

```typescript
describe('macOS Keychain handling', () => {
  it('returns success with warning on macOS when status command unavailable', async () => {
    // 使用 platform option 模拟 macOS 环境（无需修改 process.platform）
    checker = new ClaudeAuthChecker({
      env: {},
      skipStatusCommand: true,
      platform: 'darwin',
      homeDir: '/tmp/test-home',
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.warning).toContain('Keychain');
  });

  it('returns success with warning on Windows when status command unavailable', async () => {
    checker = new ClaudeAuthChecker({
      env: {},
      skipStatusCommand: true,
      platform: 'win32',
      homeDir: '/tmp/test-home',
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.warning).toContain('Credential Manager');
  });
});
```

### 6.6 WARN 放行策略测试

```typescript
describe('WARN passthrough strategy', () => {
  it('passes with warning when status command unavailable but credentials file exists on Linux', async () => {
    // Mock fs operations
    vi.spyOn(fs, 'existsSync').mockImplementation((path: string) => {
      return path.includes('.credentials.json');
    });
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      accessToken: 'test-token',
    }));

    checker = new ClaudeAuthChecker({
      env: {},
      skipStatusCommand: true,
      platform: 'linux',
      homeDir: '/tmp/test-home',
    });

    const result = await checker.checkAuth();

    expect(result.passed).toBe(true);
    expect(result.warning).toContain('Status command unavailable');
  });

  it('fails when status command explicitly says not authenticated', async () => {
    vi.mock('../../utils/exec', () => ({
      execAsync: vi.fn().mockResolvedValue({
        stdout: 'Not logged in',
        stderr: '',
      }),
    }));

    checker = new ClaudeAuthChecker({
      env: {},
      platform: 'linux',
    });

    const result = await checker.checkAuth();

    // 即使有本地文件，明确的"未认证"也应该 fail
    expect(result.passed).toBe(false);
    expect(result.errorType).toBe('AUTH_MISSING');
  });
});
```

## 7. 已知问题

### 7.1 GitHub Issue #8002

`claude auth status` 可能在有效 OAuth 凭证存在时误报 "Invalid API key"。

**处理策略**：当状态命令输出不确定时，回退到文件检查或返回带警告的成功。

### 7.2 SSH 环境认证问题

GitHub Issue #7358, #5225 报告在 SSH 连接下认证不持久。

**处理策略**：这是 Claude Code 本身的问题，我们只能如实报告认证状态。

### 7.3 macOS Keychain

macOS 上的 OAuth 凭证存储在系统 Keychain 中，无法通过文件系统读取。

**处理策略**：
1. 优先使用 `claude auth status` 命令
2. 如果命令不可用，返回带警告的成功，让运行时决定
