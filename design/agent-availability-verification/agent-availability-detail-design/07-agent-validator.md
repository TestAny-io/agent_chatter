# AgentValidator - 详细设计

## 文件信息

| 属性 | 值 |
|------|-----|
| 文件路径 | `src/services/validation/AgentValidator.ts` |
| 层级 | Core 层 |
| 依赖 | `./types.ts`, `./ConnectivityChecker.ts`, `./auth/AuthChecker.ts` |

## 1. 类概览

### 1.1 职责

- 作为 Agent 验证的统一入口
- 协调各个检查器（可执行文件、连通性、认证）
- 汇总检查结果生成最终验证状态
- 提供批量验证功能

### 1.2 类图

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              AgentValidator                                │
├───────────────────────────────────────────────────────────────────────────┤
│ - options: AgentValidatorOptions                                          │
├───────────────────────────────────────────────────────────────────────────┤
│ + validateAgent(agentType: string): Promise<VerificationResult>           │
│ + validateAgents(agents: string[]): Promise<Map<string, VerificationResult>>│
│ + validateAllKnownAgents(): Promise<Map<string, VerificationResult>>      │
│ - checkExecutable(agentType: string): Promise<CheckResult>                │
│ - runChecks(agentType: string): Promise<CheckResult[]>                    │
│ - buildVerificationResult(name: string, checks: CheckResult[]): Result    │
└───────────────────────────────────────────────────────────────────────────┘

              Uses
         ┌────────────────┐
         │                │
         ▼                ▼
┌─────────────────┐  ┌─────────────────┐
│ConnectivityCheck│  │   AuthChecker   │
│      er         │  │   (Factory)     │
└─────────────────┘  └─────────────────┘
```

## 2. 配置选项

### 2.1 AgentValidatorOptions

```typescript
/**
 * AgentValidator 配置选项
 */
export interface AgentValidatorOptions {
  /**
   * 是否跳过连通性检查
   * @default false
   */
  skipConnectivityCheck?: boolean;

  /**
   * 连通性检查超时（毫秒）
   * @default 5000
   */
  connectivityTimeout?: number;

  /**
   * 认证检查器配置
   */
  authCheckerOptions?: AuthCheckerOptions;

  /**
   * 可执行文件检查超时（毫秒）
   * @default 5000
   */
  executableCheckTimeout?: number;

  /**
   * 自定义环境变量（用于测试）
   */
  env?: Record<string, string | undefined>;

  /**
   * 自定义 home 目录（用于测试）
   */
  homeDir?: string;

  /**
   * 自定义平台标识（用于测试跨平台行为）
   * @example 'darwin', 'linux', 'win32'
   */
  platform?: NodeJS.Platform;

  /**
   * 并行验证的最大并发数
   * @default 3
   */
  maxConcurrency?: number;
}
```

## 3. 公共方法

### 3.1 validateAgent

#### 签名

```typescript
/**
 * 验证单个 Agent 的可用性
 *
 * @param agentType - Agent 类型 ('claude' | 'codex' | 'gemini')
 * @returns 验证结果
 *
 * @remarks
 * 验证顺序：
 * 1. 可执行文件检查（阻塞性）
 * 2. 连通性检查（非阻塞性）
 * 3. 认证检查（部分阻塞性）
 */
async validateAgent(agentType: string): Promise<VerificationResult>
```

#### 实现

```typescript
import { checkConnectivity } from './ConnectivityChecker';
import { getAuthChecker, getRegisteredAgentTypes } from './auth/AuthChecker';
import {
  VerificationResult,
  CheckResult,
  determineVerificationStatus,
  isBlockingError,
} from './types';

export class AgentValidator {
  private readonly options: Required<AgentValidatorOptions>;

  constructor(options?: AgentValidatorOptions) {
    this.options = {
      skipConnectivityCheck: options?.skipConnectivityCheck ?? false,
      connectivityTimeout: options?.connectivityTimeout ?? 5000,
      authCheckerOptions: options?.authCheckerOptions ?? {},
      executableCheckTimeout: options?.executableCheckTimeout ?? 5000,
      env: options?.env ?? process.env,
      homeDir: options?.homeDir ?? require('os').homedir(),
      platform: options?.platform ?? process.platform,
      maxConcurrency: options?.maxConcurrency ?? 3,
    };
  }

  async validateAgent(agentType: string): Promise<VerificationResult> {
    const checks = await this.runChecks(agentType);
    return this.buildVerificationResult(agentType, checks);
  }

  /**
   * 运行所有检查
   */
  private async runChecks(agentType: string): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    // 1. 可执行文件检查
    const execCheck = await this.checkExecutable(agentType);
    checks.push(execCheck);

    // 如果可执行文件不存在，不需要继续检查
    if (!execCheck.passed && execCheck.errorType === 'CONFIG_MISSING') {
      return checks;
    }

    // 2. 连通性检查（并行启动）
    const connectivityPromise = this.options.skipConnectivityCheck
      ? Promise.resolve(null)
      : this.checkConnectivity(agentType);

    // 3. 认证检查
    const authCheck = await this.checkAuth(agentType);
    checks.push(authCheck);

    // 等待连通性检查完成
    const connectivityCheck = await connectivityPromise;
    if (connectivityCheck) {
      // 连通性检查结果插入到认证检查之前
      checks.splice(1, 0, connectivityCheck);
    }

    return checks;
  }

  /**
   * 构建验证结果
   */
  private buildVerificationResult(
    name: string,
    checks: CheckResult[]
  ): VerificationResult {
    const status = determineVerificationStatus(checks);

    // 收集所有警告
    const warnings = checks
      .filter((c) => c.warning)
      .map((c) => c.warning!);

    // 找到第一个阻塞性错误
    const blockingError = checks.find(
      (c) => !c.passed && c.errorType && isBlockingError(c.errorType)
    );

    // 找到认证方法（从成功的认证检查中获取）
    const authCheck = checks.find(
      (c) => c.name === 'Auth Check' && c.passed
    );

    const result: VerificationResult = {
      name,
      status,
      checks,
    };

    if (status === 'failed' && blockingError) {
      result.error = blockingError.message;
      result.errorType = blockingError.errorType;
    }

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    if (authCheck) {
      // 从 authMethod 字段获取认证方法（由 checkAuth 设置）
      // 注意：authMethod 是专门的字段，不是从 message 解析
      result.authMethod = (authCheck as CheckResultWithAuthMethod).authMethod;
    }

    return result;
  }
}

/**
 * 扩展的 CheckResult，包含 authMethod 字段
 * 用于 Auth Check 传递认证方法信息
 */
interface CheckResultWithAuthMethod extends CheckResult {
  authMethod?: string;
}
```

#### 流程图

```
validateAgent(agentType)
          │
          ▼
    checkExecutable()
          │
    ┌─────┴─────┐
  通过        失败
    │           │
    │           ▼
    │     errorType =
    │     CONFIG_MISSING?
    │     ├── 是 → 直接返回
    │     └── 否 → 继续检查
    │
    ▼
checkConnectivity() ←─┐
    │                 │ (并行)
    ▼                 │
checkAuth() ──────────┘
    │
    ▼
buildVerificationResult()
    │
    ▼
  返回 VerificationResult
```

### 3.2 validateAgents

#### 签名

```typescript
/**
 * 批量验证多个 Agent
 *
 * @param agents - Agent 类型列表
 * @returns Agent 类型到验证结果的映射
 *
 * @remarks
 * - 并行执行验证，受 maxConcurrency 限制
 * - 单个 Agent 验证失败不影响其他 Agent
 */
async validateAgents(
  agents: string[]
): Promise<Map<string, VerificationResult>>
```

#### 实现

```typescript
async validateAgents(
  agents: string[]
): Promise<Map<string, VerificationResult>> {
  const results = new Map<string, VerificationResult>();

  // 使用并发限制
  const chunks = this.chunkArray(agents, this.options.maxConcurrency);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(async (agent) => ({
        agent,
        result: await this.validateAgent(agent),
      }))
    );

    for (const { agent, result } of chunkResults) {
      results.set(agent, result);
    }
  }

  return results;
}

/**
 * 将数组分割成指定大小的块
 */
private chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
```

### 3.3 validateAllKnownAgents

#### 签名

```typescript
/**
 * 验证所有已注册的 Agent
 *
 * @returns Agent 类型到验证结果的映射
 */
async validateAllKnownAgents(): Promise<Map<string, VerificationResult>>
```

#### 实现

```typescript
async validateAllKnownAgents(): Promise<Map<string, VerificationResult>> {
  const knownAgents = getRegisteredAgentTypes();
  return this.validateAgents(knownAgents);
}
```

## 4. 私有方法

### 4.1 checkExecutable

```typescript
/**
 * 检查 Agent CLI 可执行文件是否存在
 *
 * @param agentType - Agent 类型
 * @returns 检查结果
 *
 * @remarks
 * 跨平台支持：
 * - Unix (darwin/linux): 使用 `which` 命令
 * - Windows (win32): 使用 `where` 命令
 *
 * 错误处理策略：
 * - 退出码 1 或 ENOENT：命令不存在 → CONFIG_MISSING（阻塞）
 * - 退出码 127：命令不存在（bash 报告）→ CONFIG_MISSING（阻塞）
 * - EACCES/126：权限不足 → 警告但放行（命令存在但可能无法执行）
 * - 超时/其他：不确定 → 警告但放行
 */
private async checkExecutable(agentType: string): Promise<CheckResult> {
  const command = this.getCommandName(agentType);
  const platform = this.options.platform ?? process.platform;

  // 跨平台：选择正确的命令查找工具
  const whichCommand = platform === 'win32' ? 'where' : 'which';

  try {
    const { execAsync } = await import('../utils/exec');
    await execAsync(`${whichCommand} ${command}`, {
      timeout: this.options.executableCheckTimeout,
    });

    return {
      name: 'CLI Command Check',
      passed: true,
      message: `${command} found in PATH`,
    };
  } catch (error: unknown) {
    const err = error as {
      code?: number | string;
      message?: string;
      signal?: string;
      killed?: boolean;
    };

    // 命令不存在的情况 → 明确的 CONFIG_MISSING
    // which 返回 1，where 返回 1，bash 返回 127，系统级 ENOENT
    const isNotFound =
      err.code === 1 ||        // which/where 返回 1 表示未找到
      err.code === 127 ||      // bash "command not found"
      err.code === 'ENOENT';   // 系统级命令不存在

    if (isNotFound) {
      return {
        name: 'CLI Command Check',
        passed: false,
        message: `${command} not found`,
        errorType: 'CONFIG_MISSING',
        resolution: this.getInstallInstructions(agentType),
      };
    }

    // 权限错误 → 命令可能存在但无法执行
    if (err.code === 'EACCES' || err.code === 126) {
      return {
        name: 'CLI Command Check',
        passed: true,  // 放行，让后续检查继续
        message: `${command} may exist but permission denied`,
        warning: `Permission error checking ${command}. Check file permissions.`,
      };
    }

    // 超时
    if (err.killed || err.signal === 'SIGTERM') {
      return {
        name: 'CLI Command Check',
        passed: true,  // 假设存在，继续检查
        message: `Executable check timed out for ${command}`,
        warning: `Timeout checking ${command}. Proceeding with verification.`,
      };
    }

    // 其他未知错误 → 不确定，放行但警告
    return {
      name: 'CLI Command Check',
      passed: true,
      message: `Cannot verify ${command}`,
      warning: `Executable check error: ${err.code || err.message}. Proceeding with verification.`,
    };
  }
}

/**
 * 获取 Agent 的命令名称
 */
private getCommandName(agentType: string): string {
  const commands: Record<string, string> = {
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini',
  };
  return commands[agentType] || agentType;
}

/**
 * 获取安装说明
 */
private getInstallInstructions(agentType: string): string {
  const instructions: Record<string, string> = {
    claude: 'Install: npm install -g @anthropic-ai/claude-code',
    codex: 'Install: npm install -g @openai/codex',
    gemini: 'Install: npm install -g @google/gemini-cli',
  };
  return instructions[agentType] || `Install the ${agentType} CLI`;
}
```

### 4.2 checkConnectivity

```typescript
/**
 * 执行连通性检查
 *
 * @param agentType - Agent 类型
 * @returns 检查结果
 */
private async checkConnectivity(agentType: string): Promise<CheckResult> {
  // 传递配置的超时参数
  const result = await checkConnectivity(agentType, {
    connectivityTimeout: this.options.connectivityTimeout,
  });

  if (result.reachable) {
    return {
      name: 'Connectivity Check',
      passed: true,
      message: `API reachable (${result.latencyMs}ms)`,
    };
  }

  // 连通性检查失败不阻塞验证
  return {
    name: 'Connectivity Check',
    passed: true,  // 注意：仍然 passed
    message: 'Cannot verify online connectivity',
    warning: `${result.error}. Proceeding with local credentials.`,
  };
}
```

### 4.3 checkAuth

```typescript
/**
 * 执行认证检查
 *
 * @param agentType - Agent 类型
 * @returns 检查结果（包含 authMethod 字段）
 */
private async checkAuth(agentType: string): Promise<CheckResultWithAuthMethod> {
  try {
    const checker = getAuthChecker(agentType, {
      ...this.options.authCheckerOptions,
      env: this.options.env,
      homeDir: this.options.homeDir,
    });

    const result = await checker.checkAuth();

    if (result.passed) {
      return {
        name: 'Auth Check',
        passed: true,
        message: `Authenticated via ${result.method || 'unknown method'}`,
        warning: result.warning,
        // 专门的 authMethod 字段，用于 buildVerificationResult
        authMethod: result.method,
      };
    }

    return {
      name: 'Auth Check',
      passed: false,
      message: result.message || 'Not authenticated',
      errorType: result.errorType,
      resolution: result.resolution,
    };
  } catch (error: unknown) {
    const err = error as { message?: string };

    // 未知 Agent 类型 → WARN 放行
    if (err.message?.includes('Unknown agent type')) {
      return {
        name: 'Auth Check',
        passed: true,
        message: 'No auth checker available',
        warning: `Cannot verify auth for ${agentType}. Agent type not registered.`,
      };
    }

    // 其他意外错误 → 不假定是 AUTH_MISSING
    // 使用 VERIFICATION_INCOMPLETE 表示验证过程异常
    // 避免误导用户认为是凭证缺失
    return {
      name: 'Auth Check',
      passed: true,  // WARN 放行，不阻塞
      message: 'Auth verification encountered an error',
      warning: `Auth check error: ${err.message}. Proceeding without verification.`,
      // 不设置 errorType，让上层知道这是不确定状态
    };
  }
}
```

## 5. 导出

```typescript
// src/services/validation/AgentValidator.ts

export { AgentValidator };
export type { AgentValidatorOptions };
```

## 6. 使用示例

### 6.1 验证单个 Agent

```typescript
import { AgentValidator } from './AgentValidator';

const validator = new AgentValidator();
const result = await validator.validateAgent('claude');

console.log(`Status: ${result.status}`);
// 输出: Status: verified | verified_with_warnings | failed

if (result.status === 'verified') {
  console.log(`Auth method: ${result.authMethod}`);
}

if (result.status === 'failed') {
  console.log(`Error: ${result.error}`);
  // 显示解决建议
  const failedCheck = result.checks.find(c => !c.passed);
  if (failedCheck?.resolution) {
    console.log(`Resolution: ${failedCheck.resolution}`);
  }
}
```

### 6.2 批量验证

```typescript
import { AgentValidator } from './AgentValidator';

const validator = new AgentValidator({
  maxConcurrency: 2,  // 限制并发
});

// 验证指定的 Agents
const results = await validator.validateAgents(['claude', 'codex', 'gemini']);

for (const [agent, result] of results) {
  console.log(`${agent}: ${result.status}`);
}

// 或验证所有已知 Agents
const allResults = await validator.validateAllKnownAgents();
```

### 6.3 自定义配置

```typescript
import { AgentValidator } from './AgentValidator';

// 跳过连通性检查（离线环境）
const offlineValidator = new AgentValidator({
  skipConnectivityCheck: true,
});

// 测试环境
const testValidator = new AgentValidator({
  env: {
    ANTHROPIC_API_KEY: 'test-key',
    OPENAI_API_KEY: 'test-key',
    GEMINI_API_KEY: 'test-key',
  },
  homeDir: '/tmp/test-home',
  skipConnectivityCheck: true,
});
```

## 7. 与 UI 层集成

### 7.1 UI 层使用示例

```typescript
// src/repl/AgentValidationUI.tsx

import { AgentValidator, VerificationResult } from '../services/validation';

export async function showValidationResults(agents: string[]): Promise<void> {
  const validator = new AgentValidator();

  console.log('Validating agents...\n');

  const results = await validator.validateAgents(agents);

  for (const [agent, result] of results) {
    displayResult(agent, result);
  }
}

function displayResult(agent: string, result: VerificationResult): void {
  const statusIcon = getStatusIcon(result.status);
  console.log(`${statusIcon} ${agent}: ${result.status}`);

  if (result.warnings && result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  if (result.status === 'failed' && result.error) {
    console.log(`  ✗ ${result.error}`);
    const failedCheck = result.checks.find(c => !c.passed && c.resolution);
    if (failedCheck?.resolution) {
      console.log(`  → ${failedCheck.resolution}`);
    }
  }

  console.log();
}

function getStatusIcon(status: VerificationStatus): string {
  switch (status) {
    case 'verified': return '✓';
    case 'verified_with_warnings': return '⚠';
    case 'failed': return '✗';
  }
}
```

### 7.2 对话开始前验证

```typescript
// src/repl/ConversationStarter.ts

import { AgentValidator } from '../services/validation';

async function validateAgentsBeforeConversation(
  agents: string[]
): Promise<{ valid: string[]; failed: VerificationResult[] }> {
  const validator = new AgentValidator();
  const results = await validator.validateAgents(agents);

  const valid: string[] = [];
  const failed: VerificationResult[] = [];

  for (const [agent, result] of results) {
    if (result.status !== 'failed') {
      valid.push(agent);
    } else {
      failed.push(result);
    }
  }

  return { valid, failed };
}
```

## 8. 单元测试

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentValidator } from './AgentValidator';

// Mock dependencies
vi.mock('./ConnectivityChecker', () => ({
  checkConnectivity: vi.fn(),
}));

vi.mock('./auth/AuthChecker', () => ({
  getAuthChecker: vi.fn(),
  getRegisteredAgentTypes: vi.fn(() => ['claude', 'codex', 'gemini']),
}));

vi.mock('../utils/exec', () => ({
  execAsync: vi.fn(),
}));

describe('AgentValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateAgent', () => {
    it('returns verified when all checks pass', async () => {
      // Mock executable exists
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/usr/local/bin/claude' });

      // Mock connectivity success
      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({
        reachable: true,
        latencyMs: 50,
      });

      // Mock auth success
      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({
          passed: true,
          method: 'ANTHROPIC_API_KEY env var',
        }),
      });

      const validator = new AgentValidator();
      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('verified');
      expect(result.authMethod).toBe('ANTHROPIC_API_KEY env var');
      expect(result.checks).toHaveLength(3);
    });

    it('returns failed when executable not found', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockRejectedValue({ code: 1 });

      const validator = new AgentValidator();
      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('failed');
      expect(result.errorType).toBe('CONFIG_MISSING');
      expect(result.checks).toHaveLength(1);  // 只有 executable 检查
    });

    it('returns verified_with_warnings when connectivity fails', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/usr/local/bin/claude' });

      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({
        reachable: false,
        error: 'DNS resolution failed',
        errorType: 'NETWORK_DNS',
      });

      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({
          passed: true,
          method: 'API Key',
        }),
      });

      const validator = new AgentValidator();
      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('verified_with_warnings');
      expect(result.warnings).toContain(
        'DNS resolution failed. Proceeding with local credentials.'
      );
    });

    it('returns failed when auth fails with blocking error', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/usr/local/bin/claude' });

      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({ reachable: true });

      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({
          passed: false,
          errorType: 'AUTH_MISSING',
          message: 'Not authenticated',
          resolution: 'Run: claude auth login',
        }),
      });

      const validator = new AgentValidator();
      const result = await validator.validateAgent('claude');

      expect(result.status).toBe('failed');
      expect(result.errorType).toBe('AUTH_MISSING');
      expect(result.error).toBe('Not authenticated');
    });
  });

  describe('validateAgents', () => {
    it('validates multiple agents in parallel', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/path/to/cli' });

      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({ reachable: true });

      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({ passed: true, method: 'API Key' }),
      });

      const validator = new AgentValidator({ maxConcurrency: 2 });
      const results = await validator.validateAgents(['claude', 'codex', 'gemini']);

      expect(results.size).toBe(3);
      expect(results.get('claude')?.status).toBe('verified');
      expect(results.get('codex')?.status).toBe('verified');
      expect(results.get('gemini')?.status).toBe('verified');
    });

    it('handles partial failures', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any)
        .mockResolvedValueOnce({ stdout: '/path/to/claude' })
        .mockRejectedValueOnce({ code: 1 })  // codex not found
        .mockResolvedValueOnce({ stdout: '/path/to/gemini' });

      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({ reachable: true });

      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({ passed: true, method: 'API Key' }),
      });

      const validator = new AgentValidator();
      const results = await validator.validateAgents(['claude', 'codex', 'gemini']);

      expect(results.get('claude')?.status).toBe('verified');
      expect(results.get('codex')?.status).toBe('failed');
      expect(results.get('gemini')?.status).toBe('verified');
    });
  });

  describe('validateAllKnownAgents', () => {
    it('validates all registered agent types', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/path/to/cli' });

      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({ reachable: true });

      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({ passed: true, method: 'API Key' }),
      });

      const validator = new AgentValidator();
      const results = await validator.validateAllKnownAgents();

      expect(results.size).toBe(3);  // claude, codex, gemini
    });
  });

  describe('options', () => {
    it('skips connectivity check when configured', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/path/to/claude' });

      const { checkConnectivity } = await import('./ConnectivityChecker');

      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue({
        checkAuth: vi.fn().mockResolvedValue({ passed: true, method: 'API Key' }),
      });

      const validator = new AgentValidator({ skipConnectivityCheck: true });
      await validator.validateAgent('claude');

      expect(checkConnectivity).not.toHaveBeenCalled();
    });

    it('passes custom env to auth checker', async () => {
      const { execAsync } = await import('../utils/exec');
      (execAsync as any).mockResolvedValue({ stdout: '/path/to/claude' });

      const { checkConnectivity } = await import('./ConnectivityChecker');
      (checkConnectivity as any).mockResolvedValue({ reachable: true });

      const mockChecker = {
        checkAuth: vi.fn().mockResolvedValue({ passed: true, method: 'API Key' }),
      };
      const { getAuthChecker } = await import('./auth/AuthChecker');
      (getAuthChecker as any).mockReturnValue(mockChecker);

      const customEnv = { ANTHROPIC_API_KEY: 'test-key' };
      const validator = new AgentValidator({ env: customEnv });
      await validator.validateAgent('claude');

      expect(getAuthChecker).toHaveBeenCalledWith('claude', expect.objectContaining({
        env: customEnv,
      }));
    });
  });
});
```

## 9. 注意事项

### 9.1 检查顺序的重要性

1. **可执行文件检查必须首先**：如果 CLI 不存在，其他检查没有意义
2. **连通性检查是非阻塞的**：即使失败也继续认证检查
3. **认证检查决定最终状态**：只有认证失败才会导致验证失败

### 9.2 并发控制

- 默认 `maxConcurrency = 3` 避免过多并发请求
- 每个 Agent 的检查是独立的，可以安全并行
- 连通性检查和认证检查在单个 Agent 内部并行执行

### 9.3 错误处理

- 单个检查失败不应导致整个验证崩溃
- 未知 Agent 类型应该优雅处理（返回警告而非错误）
- 超时应该有合理的默认值

### 9.4 可测试性

- 所有外部依赖都通过选项注入
- `env` 和 `homeDir` 选项支持测试场景
- 使用工厂模式获取 AuthChecker，便于 mock
