# GeminiAuthChecker - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/auth/GeminiAuthChecker.ts` |
| 层级 | Core 层 |
| 依赖 | `./AuthChecker.ts`, `../types.ts` |

## 1. 类概览

### 1.1 职责

- 检查 Gemini CLI 的认证状态
- 支持多种认证方式的检测
- 提供详细的错误信息和解决建议

### 1.2 类图

```
┌──────────────────────────────────────────────────────────────────┐
│                       GeminiAuthChecker                           │
├──────────────────────────────────────────────────────────────────┤
│ + agentType: 'gemini'                                            │
│ + command: 'gemini'                                              │
├──────────────────────────────────────────────────────────────────┤
│ + checkAuth(): Promise<AuthCheckResult>                          │
│ - checkEnvironmentVariables(): AuthCheckResult | null            │
│ - checkVertexAIMode(): AuthCheckResult | null                    │
│ - checkOAuthCredentials(): AuthCheckResult | null                │
│ - checkKnownIssues(): { warning?: string }                       │
└──────────────────────────────────────────────────────────────────┘
```

## 2. 认证方式

### 2.1 支持的认证方式

| 优先级 | 认证方式 | 环境变量/文件 | 说明 |
|--------|----------|--------------|------|
| 1 | API Key | `GEMINI_API_KEY` | Google AI Studio API Key |
| 2 | API Key | `GOOGLE_API_KEY` | 通用 Google API Key |
| 3 | Vertex AI | `GOOGLE_GENAI_USE_VERTEXAI=1` | 需要 gcloud CLI |
| 4 | OAuth | `~/.gemini/oauth_creds.json` | 交互式登录凭证 |

### 2.2 认证检查流程

```
checkAuth()
     │
     ▼
检查环境变量
├── GEMINI_API_KEY 存在？ ──是──→ return success('GEMINI_API_KEY')
│
├── GOOGLE_API_KEY 存在？ ──是──→ return success('GOOGLE_API_KEY')
│
     ▼
检查 Vertex AI 模式
├── GOOGLE_GENAI_USE_VERTEXAI=1？
│   └── 是 → gcloud CLI 可用？
│            ├── 是 → return success('Vertex AI')
│            └── 否 → return failure(CONFIG_DEPENDENCY)
│
     ▼
检查 OAuth 凭证文件
├── ~/.gemini/oauth_creds.json 存在？
│   └── 是 → 文件有效？
│            ├── 是 → return success('OAuth session')
│            └── 否 → return failure(AUTH_INVALID)
│
     ▼
return failure(AUTH_MISSING)
```

## 3. 实现细节

### 3.1 常量定义

```typescript
/**
 * Gemini 认证相关常量
 */
const GEMINI_CONSTANTS = {
  // 环境变量
  ENV_VARS: {
    API_KEY: 'GEMINI_API_KEY',
    GOOGLE_API_KEY: 'GOOGLE_API_KEY',
    VERTEX_AI_MODE: 'GOOGLE_GENAI_USE_VERTEXAI',
    GEMINI_HOME: 'GEMINI_HOME',
  },

  // 凭证文件路径（相对于 home 目录或 GEMINI_HOME）
  CREDENTIAL_PATHS: {
    OAUTH_CREDS: '.gemini/oauth_creds.json',
  },

  // 已知退出码
  EXIT_CODES: {
    AUTH_ERROR: 41,  // 认证错误退出码
  },

  // gcloud CLI 命令
  GCLOUD_COMMAND: 'gcloud',
} as const;
```

### 3.2 GeminiAuthChecker 类

```typescript
import * as path from 'path';
import { BaseAuthChecker, StatusCommandResult } from './AuthChecker';
import { AuthCheckResult } from '../types';

/**
 * Gemini CLI 认证检查器
 *
 * @remarks
 * Gemini CLI 特点：
 * 1. 没有专门的 status 命令
 * 2. 支持 API Key、Vertex AI 和 OAuth 三种认证方式
 * 3. 认证错误通过退出码 41 表示
 * 4. 存在已知的 IPv6 连接问题
 */
export class GeminiAuthChecker extends BaseAuthChecker {
  readonly agentType = 'gemini';
  readonly command = 'gemini';

  /**
   * 执行认证检查
   *
   * 检查顺序：
   * 1. 环境变量（GEMINI_API_KEY, GOOGLE_API_KEY）
   * 2. Vertex AI 模式
   * 3. OAuth 凭证文件
   */
  async checkAuth(): Promise<AuthCheckResult> {
    // 检查已知问题
    const knownIssues = this.checkKnownIssues();

    // 1. 检查环境变量
    const envResult = this.checkEnvironmentVariables();
    if (envResult) {
      return knownIssues.warning
        ? { ...envResult, warning: knownIssues.warning }
        : envResult;
    }

    // 2. 检查 Vertex AI 模式
    const vertexResult = await this.checkVertexAIMode();
    if (vertexResult) {
      return knownIssues.warning
        ? { ...vertexResult, warning: knownIssues.warning }
        : vertexResult;
    }

    // 3. 检查 OAuth 凭证文件
    const oauthResult = this.checkOAuthCredentials();
    if (oauthResult) {
      return knownIssues.warning
        ? { ...oauthResult, warning: knownIssues.warning }
        : oauthResult;
    }

    // 未找到任何凭证
    return this.failureResult(
      'AUTH_MISSING',
      'No Gemini credentials found',
      'Run: gemini (for OAuth) or set GEMINI_API_KEY'
    );
  }

  // ===== 私有方法 =====

  /**
   * 检查环境变量认证
   */
  private checkEnvironmentVariables(): AuthCheckResult | null {
    // 检查 GEMINI_API_KEY
    if (this.hasEnv(GEMINI_CONSTANTS.ENV_VARS.API_KEY)) {
      return this.successResult('GEMINI_API_KEY env var');
    }

    // 检查 GOOGLE_API_KEY（通用 Google API Key）
    if (this.hasEnv(GEMINI_CONSTANTS.ENV_VARS.GOOGLE_API_KEY)) {
      return this.successResult('GOOGLE_API_KEY env var');
    }

    return null;
  }

  /**
   * 检查 Vertex AI 模式
   *
   * @remarks
   * HLD 策略对齐：
   * - CONFIG_DEPENDENCY (gcloud 缺失) → WARN 放行，继续检查其他认证方式
   * - AUTH_MISSING (gcloud 未认证) → 失败，因为用户明确配置了 Vertex 模式
   */
  private async checkVertexAIMode(): Promise<AuthCheckResult | null> {
    const vertexEnabled = this.getEnv(GEMINI_CONSTANTS.ENV_VARS.VERTEX_AI_MODE);

    if (vertexEnabled !== '1' && vertexEnabled !== 'true') {
      return null;
    }

    // Vertex AI 模式需要 gcloud CLI
    const gcloudAvailable = await this.checkGcloudCLI();

    if (!gcloudAvailable) {
      // HLD 策略：CONFIG_DEPENDENCY 是警告不是阻塞
      // 但 Vertex 模式是用户明确配置的，gcloud 缺失应该提示
      // 返回 null 让后续检查其他认证方式（如 OAuth），但记录警告
      this.vertexModeWarning = 'Vertex AI mode enabled but gcloud CLI not found. ' +
                               'Install: https://cloud.google.com/sdk/docs/install';
      return null;  // 继续检查其他认证方式
    }

    // 检查 gcloud 是否已认证
    const gcloudAuth = await this.checkGcloudAuth();

    if (!gcloudAuth.authenticated) {
      // gcloud 存在但未认证 → 这是明确的认证问题
      return this.failureResult(
        'AUTH_MISSING',
        'gcloud not authenticated for Vertex AI',
        'Run: gcloud auth application-default login'
      );
    }

    return this.successResult(
      'Vertex AI mode',
      gcloudAuth.warning
    );
  }

  /** Vertex 模式警告（当 gcloud 缺失时） */
  private vertexModeWarning?: string;

  /**
   * 检查 gcloud CLI 是否可用
   */
  private async checkGcloudCLI(): Promise<boolean> {
    try {
      const { execAsync } = await import('../../utils/exec');
      await execAsync('gcloud --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查 gcloud 认证状态
   */
  private async checkGcloudAuth(): Promise<{ authenticated: boolean; warning?: string }> {
    try {
      const { execAsync } = await import('../../utils/exec');
      const { stdout } = await execAsync(
        'gcloud auth application-default print-access-token',
        { timeout: 10000 }
      );

      // 如果能获取到 token，说明已认证
      if (stdout && stdout.trim().length > 0) {
        return { authenticated: true };
      }

      return { authenticated: false };
    } catch (error: unknown) {
      const err = error as { message?: string; stderr?: string };

      // 检查是否是 token 过期
      if (
        err.message?.includes('expired') ||
        err.stderr?.includes('expired')
      ) {
        return {
          authenticated: false,
        };
      }

      // 其他错误，可能是未认证
      return { authenticated: false };
    }
  }

  /**
   * 检查 OAuth 凭证文件
   *
   * @remarks
   * WARN 放行策略：
   * - 文件存在 + 有 refresh_token → 成功（可能带 Vertex 警告）
   * - 文件存在但损坏 → AUTH_INVALID（阻塞）
   * - 文件存在但无 refresh_token → AUTH_MISSING（阻塞，OAuth 流程未完成）
   */
  private checkOAuthCredentials(): AuthCheckResult | null {
    const credPath = this.getOAuthCredentialsPath();

    if (!this.fileExists(credPath)) {
      return null;
    }

    // 尝试读取并验证凭证文件
    const creds = this.readJsonFile<GeminiOAuthCredentials>(credPath);

    if (!creds) {
      return this.failureResult(
        'AUTH_INVALID',
        'OAuth credentials file is invalid',
        'Remove ~/.gemini/oauth_creds.json and re-run: gemini'
      );
    }

    // 检查必要字段
    if (!creds.client_id || !creds.client_secret) {
      return this.failureResult(
        'AUTH_INVALID',
        'OAuth credentials incomplete',
        'Remove ~/.gemini/oauth_creds.json and re-run: gemini'
      );
    }

    // 检查是否有 refresh_token（表示已完成 OAuth 流程）
    if (!creds.refresh_token) {
      return this.failureResult(
        'AUTH_MISSING',
        'OAuth not completed',
        'Run: gemini (to complete OAuth flow)'
      );
    }

    // OAuth 凭证有效
    // 如果有 Vertex 模式警告，附加到结果中
    const warnings: string[] = [];
    if (this.vertexModeWarning) {
      warnings.push(this.vertexModeWarning);
    }

    return {
      passed: true,
      method: 'OAuth session',
      warning: warnings.length > 0 ? warnings.join('; ') : undefined,
    };
  }

  /**
   * 获取 OAuth 凭证文件路径
   */
  private getOAuthCredentialsPath(): string {
    // 优先使用 GEMINI_HOME 环境变量
    const geminiHome = this.getEnv(GEMINI_CONSTANTS.ENV_VARS.GEMINI_HOME);

    if (geminiHome) {
      return path.join(geminiHome, 'oauth_creds.json');
    }

    return this.getHomePath(GEMINI_CONSTANTS.CREDENTIAL_PATHS.OAUTH_CREDS);
  }

  /**
   * 检查已知问题
   *
   * @returns 如果检测到已知问题，返回警告信息
   */
  private checkKnownIssues(): { warning?: string } {
    const warnings: string[] = [];

    // 检查 IPv6 问题（通过检测系统是否优先使用 IPv6）
    // 这个检查比较复杂，暂时跳过自动检测，只在文档中提供解决方案

    return {
      warning: warnings.length > 0 ? warnings.join('; ') : undefined,
    };
  }
}

/**
 * Gemini OAuth 凭证文件结构
 */
interface GeminiOAuthCredentials {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  token_uri?: string;
  scopes?: string[];
}
```

## 4. 特殊情况处理

### 4.1 Vertex AI 模式

当 `GOOGLE_GENAI_USE_VERTEXAI=1` 时，Gemini CLI 使用 Google Cloud Vertex AI 而非 Google AI Studio。

检查流程：
1. 检测 `gcloud` CLI 是否可用
2. 检查 `gcloud auth application-default` 是否已认证
3. 如果 `gcloud` 不可用，返回 `CONFIG_DEPENDENCY` 错误

```typescript
// 检查 Vertex AI 模式
if (process.env.GOOGLE_GENAI_USE_VERTEXAI === '1') {
  // 需要 gcloud CLI
  const gcloudAvailable = await checkGcloudCLI();
  if (!gcloudAvailable) {
    return {
      passed: false,
      errorType: 'CONFIG_DEPENDENCY',
      message: 'Vertex AI mode requires gcloud CLI',
      resolution: 'Install: https://cloud.google.com/sdk/docs/install',
    };
  }
}
```

### 4.2 退出码 41 检测

Gemini CLI 没有专门的 status 命令，但认证错误会返回退出码 41。这个信息主要用于 UI 层在实际调用失败时提供诊断：

```typescript
/**
 * 判断 Gemini CLI 退出码是否表示认证错误
 */
export function isGeminiAuthError(exitCode: number): boolean {
  return exitCode === GEMINI_CONSTANTS.EXIT_CODES.AUTH_ERROR;
}
```

### 4.3 IPv6 连接问题

Gemini CLI 存在已知的 IPv6 连接问题。当用户报告连接问题时，可以建议：

```typescript
/**
 * IPv6 问题的解决建议
 */
const IPV6_RESOLUTION = `
If you experience connection issues, try disabling IPv6:
  macOS: networksetup -setv6off Wi-Fi
  Linux: sysctl -w net.ipv6.conf.all.disable_ipv6=1
Or set: export NODE_OPTIONS="--dns-result-order=ipv4first"
`.trim();
```

## 5. 凭证文件结构

### 5.1 OAuth 凭证文件

位置：`~/.gemini/oauth_creds.json`

```json
{
  "client_id": "xxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxx",
  "refresh_token": "1//xxx",
  "token_uri": "https://oauth2.googleapis.com/token",
  "scopes": ["https://www.googleapis.com/auth/cloud-platform"]
}
```

### 5.2 凭证文件验证

```typescript
interface GeminiOAuthCredentials {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  token_uri?: string;
  scopes?: string[];
}

function validateOAuthCredentials(creds: GeminiOAuthCredentials): boolean {
  // 必须有 client_id 和 client_secret
  if (!creds.client_id || !creds.client_secret) {
    return false;
  }

  // 必须有 refresh_token（表示 OAuth 流程已完成）
  if (!creds.refresh_token) {
    return false;
  }

  return true;
}
```

## 6. 导出

```typescript
// src/services/validation/auth/GeminiAuthChecker.ts

export { GeminiAuthChecker };
export { isGeminiAuthError };
```

## 7. 使用示例

### 7.1 基本使用

```typescript
import { getAuthChecker } from './auth/AuthChecker';

const checker = getAuthChecker('gemini');
const result = await checker.checkAuth();

if (result.passed) {
  console.log(`Gemini authenticated via: ${result.method}`);
} else {
  console.log(`Auth failed: ${result.message}`);
  console.log(`Resolution: ${result.resolution}`);
}
```

### 7.2 测试场景

```typescript
import { getAuthChecker } from './auth/AuthChecker';

// 模拟 API Key 认证
const apiKeyChecker = getAuthChecker('gemini', {
  env: {
    GEMINI_API_KEY: 'test-api-key',
  },
});
const result1 = await apiKeyChecker.checkAuth();
expect(result1.passed).toBe(true);
expect(result1.method).toBe('GEMINI_API_KEY env var');

// 模拟 Vertex AI 模式（无 gcloud）
const vertexChecker = getAuthChecker('gemini', {
  env: {
    GOOGLE_GENAI_USE_VERTEXAI: '1',
  },
  skipStatusCommand: true,  // 跳过 gcloud 检查
});
// 需要 mock gcloud 命令
```

## 8. 单元测试

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAuthChecker } from './GeminiAuthChecker';

describe('GeminiAuthChecker', () => {
  describe('checkAuth', () => {
    describe('environment variables', () => {
      it('passes when GEMINI_API_KEY is set', async () => {
        const checker = new GeminiAuthChecker({
          env: { GEMINI_API_KEY: 'test-key' },
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(true);
        expect(result.method).toBe('GEMINI_API_KEY env var');
      });

      it('passes when GOOGLE_API_KEY is set', async () => {
        const checker = new GeminiAuthChecker({
          env: { GOOGLE_API_KEY: 'test-key' },
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(true);
        expect(result.method).toBe('GOOGLE_API_KEY env var');
      });

      it('prefers GEMINI_API_KEY over GOOGLE_API_KEY', async () => {
        const checker = new GeminiAuthChecker({
          env: {
            GEMINI_API_KEY: 'gemini-key',
            GOOGLE_API_KEY: 'google-key',
          },
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(true);
        expect(result.method).toBe('GEMINI_API_KEY env var');
      });
    });

    describe('Vertex AI mode', () => {
      it('falls back to OAuth when Vertex AI enabled but gcloud not available', async () => {
        // Mock gcloud not available
        vi.mock('../../utils/exec', () => ({
          execAsync: vi.fn().mockRejectedValue(new Error('command not found')),
        }));

        // Mock OAuth credentials exist
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
          client_id: 'test-client-id',
          client_secret: 'test-secret',
          refresh_token: 'test-refresh-token',
        }));

        const checker = new GeminiAuthChecker({
          env: { GOOGLE_GENAI_USE_VERTEXAI: '1' },
          homeDir: '/tmp/test-home',
        });

        const result = await checker.checkAuth();

        // Should pass with warning (fall back to OAuth)
        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth session');
        expect(result.warning).toContain('gcloud CLI not found');
      });

      it('fails when Vertex AI enabled but gcloud not authenticated', async () => {
        // Mock gcloud available but not authenticated
        vi.mock('../../utils/exec', () => ({
          execAsync: vi.fn()
            .mockResolvedValueOnce({ stdout: 'Google Cloud SDK 400.0.0' }) // gcloud --version
            .mockRejectedValueOnce({ stderr: 'ERROR: (gcloud.auth.application-default.print-access-token) could not find credentials' }),
        }));

        const checker = new GeminiAuthChecker({
          env: { GOOGLE_GENAI_USE_VERTEXAI: '1' },
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.message).toContain('gcloud not authenticated');
      });

      it('succeeds when Vertex AI mode properly configured', async () => {
        // Mock gcloud available and authenticated
        vi.mock('../../utils/exec', () => ({
          execAsync: vi.fn()
            .mockResolvedValueOnce({ stdout: 'Google Cloud SDK 400.0.0' })
            .mockResolvedValueOnce({ stdout: 'ya29.access-token-here' }),
        }));

        const checker = new GeminiAuthChecker({
          env: { GOOGLE_GENAI_USE_VERTEXAI: '1' },
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(true);
        expect(result.method).toBe('Vertex AI mode');
      });
    });

    describe('OAuth credentials', () => {
      it('passes when valid OAuth credentials exist', async () => {
        // Mock fs operations
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
          client_id: 'test-client-id',
          client_secret: 'test-secret',
          refresh_token: 'test-refresh-token',
        }));

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/tmp/test-home',
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(true);
        expect(result.method).toBe('OAuth session');
      });

      it('fails when OAuth credentials missing refresh_token', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
          client_id: 'test-client-id',
          client_secret: 'test-secret',
          // No refresh_token
        }));

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/tmp/test-home',
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.message).toContain('OAuth not completed');
      });
    });

    describe('no credentials', () => {
      it('fails when no credentials found', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);

        const checker = new GeminiAuthChecker({
          env: {},
          homeDir: '/tmp/test-home',
        });

        const result = await checker.checkAuth();

        expect(result.passed).toBe(false);
        expect(result.errorType).toBe('AUTH_MISSING');
        expect(result.resolution).toContain('gemini');
      });
    });
  });
});

describe('isGeminiAuthError', () => {
  it('returns true for exit code 41', () => {
    expect(isGeminiAuthError(41)).toBe(true);
  });

  it('returns false for other exit codes', () => {
    expect(isGeminiAuthError(0)).toBe(false);
    expect(isGeminiAuthError(1)).toBe(false);
    expect(isGeminiAuthError(127)).toBe(false);
  });
});
```

## 9. 注意事项

### 9.1 无 Status 命令

与 Claude 和 Codex 不同，Gemini CLI 没有专门的认证状态检查命令。认证检查主要通过：
- 检测环境变量
- 检查本地凭证文件
- 检查 Vertex AI 模式配置

### 9.2 Vertex AI vs Google AI Studio

| 特性 | Google AI Studio | Vertex AI |
|------|-----------------|-----------|
| 认证方式 | API Key 或 OAuth | gcloud ADC |
| 环境变量 | `GEMINI_API_KEY` | `GOOGLE_GENAI_USE_VERTEXAI=1` |
| 依赖 | 无 | gcloud CLI |
| 适用场景 | 开发/测试 | 生产/企业 |

### 9.3 API Key 优先级

当同时设置多个认证方式时，优先级为：
1. `GEMINI_API_KEY`（最高）
2. `GOOGLE_API_KEY`
3. Vertex AI 模式
4. OAuth 凭证文件（最低）

### 9.4 IPv6 问题

部分网络环境下，IPv6 可能导致连接问题。如果用户报告连接超时，建议：
1. 设置 `NODE_OPTIONS="--dns-result-order=ipv4first"`
2. 或禁用系统 IPv6
