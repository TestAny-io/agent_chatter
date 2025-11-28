# AuthChecker 接口 - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/auth/AuthChecker.ts` |
| 层级 | Core 层 |
| 依赖 | `../types.ts` |

## 1. 接口概览

### 1.1 职责

- 定义认证检查器的统一接口
- 支持多种 Agent 的认证检查实现
- 提供工厂函数获取对应的检查器

### 1.2 类图

```
                    ┌─────────────────────────┐
                    │    AuthChecker (接口)    │
                    ├─────────────────────────┤
                    │ + agentType: string     │
                    │ + checkAuth(): Promise  │
                    └────────────┬────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           │                     │                     │
           ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ClaudeAuthChecker │  │ CodexAuthChecker │  │GeminiAuthChecker │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

## 2. 接口定义

### 2.1 AuthChecker 接口

```typescript
import { AuthCheckResult } from '../types';

/**
 * 认证检查器接口
 * 每个 Agent 类型实现此接口
 */
export interface AuthChecker {
  /**
   * Agent 类型标识
   * 如 'claude', 'codex', 'gemini'
   */
  readonly agentType: string;

  /**
   * CLI 命令名称
   * 如 'claude', 'codex', 'gemini'
   */
  readonly command: string;

  /**
   * 执行认证检查
   *
   * @returns 认证检查结果
   *
   * @remarks
   * 检查顺序（由快到慢，由便宜到昂贵）：
   * 1. 环境变量（即时，免费）
   * 2. 特殊模式（Bedrock/Vertex）
   * 3. CLI 状态命令（快速，无 API 调用）
   * 4. 凭证文件（本地检查）
   */
  checkAuth(): Promise<AuthCheckResult>;
}
```

### 2.2 AuthCheckerOptions 接口

```typescript
/**
 * 认证检查器配置选项
 */
export interface AuthCheckerOptions {
  /**
   * 状态命令执行超时（毫秒）
   * @default 5000
   */
  statusCommandTimeout?: number;

  /**
   * 是否跳过状态命令检查
   * 用于测试或状态命令不可用的情况
   * @default false
   */
  skipStatusCommand?: boolean;

  /**
   * 自定义环境变量（用于测试）
   * 如果未提供，使用 process.env
   */
  env?: Record<string, string | undefined>;

  /**
   * 自定义 home 目录（用于测试）
   * 如果未提供，使用 os.homedir()
   */
  homeDir?: string;

  /**
   * 自定义平台标识（用于测试跨平台行为）
   * 如果未提供，使用 process.platform
   * @example 'darwin', 'linux', 'win32'
   */
  platform?: NodeJS.Platform;
}
```

## 3. 工厂函数

### 3.1 getAuthChecker

```typescript
import { ClaudeAuthChecker } from './ClaudeAuthChecker';
import { CodexAuthChecker } from './CodexAuthChecker';
import { GeminiAuthChecker } from './GeminiAuthChecker';

/**
 * 已注册的认证检查器
 */
const checkerRegistry: Map<string, new (options?: AuthCheckerOptions) => AuthChecker> = new Map([
  ['claude', ClaudeAuthChecker],
  ['codex', CodexAuthChecker],
  ['gemini', GeminiAuthChecker],
]);

/**
 * 获取指定 Agent 类型的认证检查器
 *
 * @param agentType - Agent 类型
 * @param options - 可选配置
 * @returns 认证检查器实例
 * @throws 当 Agent 类型未注册时抛出错误
 */
export function getAuthChecker(
  agentType: string,
  options?: AuthCheckerOptions
): AuthChecker {
  const CheckerClass = checkerRegistry.get(agentType);

  if (!CheckerClass) {
    throw new Error(`Unknown agent type: ${agentType}. Available: ${Array.from(checkerRegistry.keys()).join(', ')}`);
  }

  return new CheckerClass(options);
}

/**
 * 注册新的认证检查器
 * 用于扩展支持新的 Agent 类型
 *
 * @param agentType - Agent 类型
 * @param checkerClass - 检查器类
 */
export function registerAuthChecker(
  agentType: string,
  checkerClass: new (options?: AuthCheckerOptions) => AuthChecker
): void {
  checkerRegistry.set(agentType, checkerClass);
}

/**
 * 获取所有已注册的 Agent 类型
 */
export function getRegisteredAgentTypes(): string[] {
  return Array.from(checkerRegistry.keys());
}
```

## 4. 基类实现

### 4.1 BaseAuthChecker

```typescript
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import { AuthCheckResult, ErrorType } from '../types';

/**
 * 认证检查器基类
 * 提供通用的辅助方法
 */
export abstract class BaseAuthChecker implements AuthChecker {
  abstract readonly agentType: string;
  abstract readonly command: string;

  protected readonly options: Required<AuthCheckerOptions>;

  constructor(options?: AuthCheckerOptions) {
    this.options = {
      statusCommandTimeout: options?.statusCommandTimeout ?? 5000,
      skipStatusCommand: options?.skipStatusCommand ?? false,
      env: options?.env ?? process.env,
      homeDir: options?.homeDir ?? os.homedir(),
      platform: options?.platform ?? process.platform,
    };
  }

  /**
   * 获取当前平台
   */
  protected getPlatform(): NodeJS.Platform {
    return this.options.platform;
  }

  /**
   * 检查是否为 macOS
   */
  protected isMacOS(): boolean {
    return this.options.platform === 'darwin';
  }

  /**
   * 检查是否为 Linux
   */
  protected isLinux(): boolean {
    return this.options.platform === 'linux';
  }

  /**
   * 检查是否为 Windows
   */
  protected isWindows(): boolean {
    return this.options.platform === 'win32';
  }

  /**
   * 子类必须实现的认证检查逻辑
   */
  abstract checkAuth(): Promise<AuthCheckResult>;

  // ===== 辅助方法 =====

  /**
   * 获取环境变量
   */
  protected getEnv(name: string): string | undefined {
    return this.options.env[name];
  }

  /**
   * 检查环境变量是否存在且非空
   */
  protected hasEnv(name: string): boolean {
    const value = this.getEnv(name);
    return value !== undefined && value.trim() !== '';
  }

  /**
   * 获取 home 目录路径
   */
  protected getHomePath(...segments: string[]): string {
    return path.join(this.options.homeDir, ...segments);
  }

  /**
   * 检查文件是否存在
   */
  protected fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * 读取 JSON 文件
   */
  protected readJsonFile<T>(filePath: string): T | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * 执行状态命令
   */
  protected async executeStatusCommand(args: string[]): Promise<StatusCommandResult> {
    if (this.options.skipStatusCommand) {
      return { available: false, reason: 'Skipped by configuration' };
    }

    try {
      const { stdout, stderr } = await execAsync(
        `"${this.command}" ${args.join(' ')}`,
        { timeout: this.options.statusCommandTimeout }
      );

      return {
        available: true,
        exitCode: 0,
        output: stdout + stderr,
      };
    } catch (error: unknown) {
      return this.classifyStatusCommandError(error);
    }
  }

  /**
   * 分类状态命令执行错误
   *
   * @remarks
   * 错误分类原则：
   * 1. 命令不存在 (ENOENT/127) → available: false, fallbackNeeded: true
   * 2. 参数无效 (unknown command) → available: false, fallbackNeeded: true
   * 3. 超时 → available: false, reason: 'TIMEOUT'
   * 4. 网络错误 → available: true, exitCode: -1, networkError: true
   * 5. 其他错误 → available: true, exitCode: N, output: stderr
   */
  private classifyStatusCommandError(error: unknown): StatusCommandResult {
    const err = error as {
      code?: number | string;
      message?: string;
      stderr?: string;
      stdout?: string;
      signal?: string;
      killed?: boolean;
    };

    // 超时
    if (err.killed || err.signal === 'SIGTERM' || err.message?.includes('timeout')) {
      return {
        available: false,
        reason: 'TIMEOUT',
        fallbackNeeded: true,
      };
    }

    // 命令不存在
    if (err.code === 127 || err.code === 'ENOENT') {
      return {
        available: false,
        reason: 'COMMAND_NOT_FOUND',
        fallbackNeeded: true,
      };
    }

    // 参数/子命令无效（CLI 存在但不支持此命令）
    const isInvalidCommand =
      err.message?.includes('unknown command') ||
      err.message?.includes('unrecognized option') ||
      err.message?.includes('invalid argument') ||
      err.message?.includes('not a command') ||
      err.stderr?.includes('Usage:') ||
      err.stderr?.includes('unknown command');

    if (isInvalidCommand) {
      return {
        available: false,
        reason: 'STATUS_COMMAND_UNAVAILABLE',
        fallbackNeeded: true,
      };
    }

    // 网络错误（命令存在，但无法连接服务器）
    const isNetworkError =
      err.message?.includes('ENOTFOUND') ||
      err.message?.includes('ETIMEDOUT') ||
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('network') ||
      err.stderr?.includes('network') ||
      err.stderr?.includes('connect');

    if (isNetworkError) {
      return {
        available: true,
        exitCode: typeof err.code === 'number' ? err.code : -1,
        output: err.stderr || err.stdout || err.message || '',
        networkError: true,
      };
    }

    // 命令存在但执行出错（可能是认证问题）
    return {
      available: true,
      exitCode: typeof err.code === 'number' ? err.code : -1,
      output: err.stderr || err.stdout || err.message || '',
    };
  }

  /**
   * 创建成功结果
   */
  protected successResult(method: string, warning?: string): AuthCheckResult {
    return {
      passed: true,
      method,
      warning,
    };
  }

  /**
   * 创建失败结果
   */
  protected failureResult(
    errorType: ErrorType,
    message: string,
    resolution?: string
  ): AuthCheckResult {
    return {
      passed: false,
      errorType,
      message,
      resolution,
    };
  }
}

/**
 * 状态命令执行结果
 */
export interface StatusCommandResult {
  /** 命令是否可用 */
  available: boolean;
  /** 退出码（仅当 available=true 时有值） */
  exitCode?: number;
  /** 命令输出（仅当 available=true 时有值） */
  output?: string;
  /**
   * 不可用原因（仅当 available=false 时有值）
   * - 'COMMAND_NOT_FOUND': CLI 不存在
   * - 'STATUS_COMMAND_UNAVAILABLE': CLI 存在但不支持状态命令
   * - 'TIMEOUT': 命令执行超时
   * - 'Skipped by configuration': 配置跳过
   */
  reason?: 'COMMAND_NOT_FOUND' | 'STATUS_COMMAND_UNAVAILABLE' | 'TIMEOUT' | string;
  /** 是否需要回退到文件检查 */
  fallbackNeeded?: boolean;
  /** 是否为网络错误（命令存在但网络不通） */
  networkError?: boolean;
}
```

## 5. 检查优先级

所有认证检查器应遵循以下检查顺序（由快到慢）：

```
1. 环境变量检查（即时）
   └── ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY 等

2. 特殊模式检查（如适用）
   └── Bedrock / Vertex AI 模式

3. CLI 状态命令（快速，无 API 调用）
   └── claude auth status / codex login status

4. 凭证文件检查（本地）
   └── ~/.claude/.credentials.json / ~/.codex/auth.json / ~/.gemini/oauth_creds.json
```

## 6. 导出

```typescript
// src/services/validation/auth/AuthChecker.ts

export type { AuthChecker, AuthCheckerOptions, StatusCommandResult };
export { BaseAuthChecker };
export { getAuthChecker, registerAuthChecker, getRegisteredAgentTypes };
```

## 7. 使用示例

### 7.1 获取检查器

```typescript
import { getAuthChecker } from './auth/AuthChecker';

// 获取 Claude 认证检查器
const claudeChecker = getAuthChecker('claude');
const result = await claudeChecker.checkAuth();

// 带配置选项
const codexChecker = getAuthChecker('codex', {
  statusCommandTimeout: 3000,
  skipStatusCommand: process.env.CI === 'true',
});
```

### 7.2 测试场景

```typescript
import { getAuthChecker } from './auth/AuthChecker';

// 模拟特定环境变量
const checker = getAuthChecker('claude', {
  env: {
    ANTHROPIC_API_KEY: 'sk-test-key',
  },
  homeDir: '/tmp/test-home',
});

const result = await checker.checkAuth();
expect(result.passed).toBe(true);
expect(result.method).toBe('ANTHROPIC_API_KEY env var');
```

## 8. 单元测试

```typescript
describe('AuthChecker', () => {
  describe('getAuthChecker', () => {
    it('returns ClaudeAuthChecker for claude', () => {
      const checker = getAuthChecker('claude');
      expect(checker.agentType).toBe('claude');
    });

    it('returns CodexAuthChecker for codex', () => {
      const checker = getAuthChecker('codex');
      expect(checker.agentType).toBe('codex');
    });

    it('returns GeminiAuthChecker for gemini', () => {
      const checker = getAuthChecker('gemini');
      expect(checker.agentType).toBe('gemini');
    });

    it('throws for unknown agent type', () => {
      expect(() => getAuthChecker('unknown')).toThrow('Unknown agent type');
    });
  });

  describe('registerAuthChecker', () => {
    it('allows registering custom checker', () => {
      class CustomChecker extends BaseAuthChecker {
        readonly agentType = 'custom';
        readonly command = 'custom-cli';
        async checkAuth() {
          return { passed: true, method: 'custom' };
        }
      }

      registerAuthChecker('custom', CustomChecker);

      const checker = getAuthChecker('custom');
      expect(checker.agentType).toBe('custom');
    });
  });

  describe('getRegisteredAgentTypes', () => {
    it('returns all registered types', () => {
      const types = getRegisteredAgentTypes();
      expect(types).toContain('claude');
      expect(types).toContain('codex');
      expect(types).toContain('gemini');
    });
  });
});
```
