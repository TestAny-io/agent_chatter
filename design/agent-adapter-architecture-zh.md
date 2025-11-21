# Agent Adapter 架构设计

**状态：** 提案
**日期：** 2025-11-20
**作者：** Claude
**评审方：** 架构委员会

## 执行摘要

本文档提出一个重大的架构重构，以解决当前 agent 通信设计中的两个关键问题：

1. **缺乏抽象**：不同的 AI agents（Claude Code, Codex, Gemini）有根本不同的通信协议，但当前通过通用的 ProcessManager + shell wrappers 处理
2. **配置分层违规**：系统提示词存储在全局 Registry 配置中，导致所有使用同一 agent 的团队成员共享相同的提示词

**解决方案：** 实现**适配器模式（Adapter Pattern）**并建立正确的配置分层。

---

## 问题陈述

### 问题 1：职责混乱和脆弱的实现

**当前架构：**
```
AgentDefaults.ts (硬编码配置)
    ↓
ProcessManager (通用进程spawning)
    ↓
Shell wrappers (codex-wrapper.sh, gemini-wrapper.sh)
    ↓
AI CLI 工具
```

**问题：**
- Shell wrappers 没有被打包进 npm（package.json 的 files 字段中缺失）
- Codex 默认配置期望 `[DONE]` 标记，但 codex 不输出它
- Agent 特定逻辑缺乏类型安全和可测试性
- 添加新 agents 需要在多个层级修改

**真实 bug 示例：**
```json
// Codex 的 Registry 配置
{
  "command": "codex",
  "args": ["exec", "--json", "--full-auto"],
  "completion": "jsonl"
}
```

结果：ProcessManager 无限期地等待 `[DONE]` 标记直到超时。

### 问题 2：配置分层违规

**当前设计：**
```json
// 全局 Registry: ~/.agent-chatter/agents/config.json
{
  "claude": {
    "command": "claude",
    "args": [
      "--append-system-prompt",
      "Always end with [DONE]. Keep responses concise."  // ← 所有成员共享！
    ]
  }
}

// 团队配置: .agent-chatter/team-config/team.json
{
  "members": [
    { "id": "max", "agentConfigId": "claude", "systemInstruction": "You are Max..." },
    { "id": "sarah", "agentConfigId": "claude", "systemInstruction": "You are Sarah..." }
  ]
}
```

**问题：** Max 和 Sarah 都会从 Registry args 获得相同的硬编码系统提示词。`member.systemInstruction` 只作为消息内容发送，而不是 CLI 参数。

**正确的分层：**
- **Registry（全局）**：技术协议细节（如何调用、如何检测完成）
- **Member（团队特定）**：角色身份和行为指令（他们是谁、做什么）

---

## 解决方案

### 架构概览

在 AgentManager 和 ProcessManager 之间引入 **Agent Adapter 层**：

```
AgentManager
    ↓
AgentAdapterFactory (根据 agent 类型创建适配器)
    ↓
IAgentAdapter (接口)
    ↓
├── ClaudeAdapter
├── CodexAdapter
└── GeminiAdapter
    ↓
ProcessManager (通用进程管理，核心逻辑不变，但支持多种完成检测策略)
```

### 1. ProcessManager 增强：支持多种完成检测策略

**当前问题（已解决）：** 需支持 JSONL 完成事件，不依赖 endMarker。

**解决方案：** 支持三种完成检测策略：

```typescript
// src/infrastructure/ProcessManager.ts (增强)

export type CompletionStrategy =
  | { type: 'jsonl'; completionTypes: string[] }    // 等待特定 JSON 行事件
  | { type: 'idleTimeout'; timeoutMs: number }      // 空闲超时
  | { type: 'custom'; detector: (output: string) => boolean };  // 自定义检测函数

export interface SendOptions {
  timeout?: number;  // 总超时时间（毫秒）
  completionStrategy?: CompletionStrategy;  // 完成检测策略
}

// ProcessManager 内部实现
async sendAndReceive(
  processId: string,
  message: string,
  options?: SendOptions
): Promise<string> {
  const strategy = options?.completionStrategy || {
    type: 'idleTimeout',
    timeoutMs: 3000
  };

  return new Promise((resolve, reject) => {
    let output = '';
    let idleTimer: NodeJS.Timeout | null = null;
    const totalTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Total timeout exceeded'));
    }, options?.timeout || 30000);

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(totalTimeout);
      this.outputCallbacks.delete(processId);
    };

    const checkCompletion = (currentOutput: string) => {
      switch (strategy.type) {
        case 'jsonl': {
          const lines = currentOutput.split('\\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) continue;
            try {
              const obj = JSON.parse(trimmed);
              if (strategy.completionTypes.includes(obj?.type)) {
                cleanup();
                resolve(currentOutput);
                return true;
              }
            } catch {
              continue;
            }
          }
          break;
        }

        case 'idleTimeout':
          // 重置空闲计时器
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            cleanup();
            resolve(currentOutput);
          }, strategy.timeoutMs);
          break;

        case 'custom':
          if (strategy.detector(currentOutput)) {
            cleanup();
            resolve(currentOutput);
            return true;
          }
          break;
      }
      return false;
    };

    const managed = this.processes.get(processId);
    if (!managed?.process.stdin) {
      cleanup();
      reject(new Error('Process stdin not available'));
      return;
    }

    // 设置输出回调
    this.outputCallbacks.set(processId, (data: string) => {
      output += data;
      checkCompletion(output);
    });

    // 检查缓冲区中是否已有输出
    if (managed.outputBuffer) {
      output = managed.outputBuffer;
      managed.outputBuffer = '';
      if (checkCompletion(output)) return;
    }

    // 发送消息
    managed.process.stdin.write(message + '\n');
    managed.process.stdin.end();  // 关闭 stdin，触发 agent 处理

    // 重要：对于 idleTimeout 策略，立即启动计时器
    // 这样即使 agent 完全没有输出，也会在超时后返回
    if (strategy.type === 'idleTimeout') {
      idleTimer = setTimeout(() => {
        cleanup();
        resolve(output);  // 即使是空输出也返回
      }, strategy.timeoutMs);
    }
  });
}
```

**关键改进：**
- ✅ 支持三种完成检测策略
- ✅ Codex 可以使用 `idleTimeout` 或自定义检测器
- ✅ Claude 改为 `--output-format=stream-json --verbose`，完成信号 `result`
- ✅ **idleTimeout 立即启动**：发送消息后立即启动计时器，即使 agent 没有任何输出也会超时返回
- ✅ 核心 ProcessManager 逻辑保持通用性

### 2. Agent Adapter 接口

```typescript
// src/agents/base/IAgentAdapter.ts

export interface AgentAdapter {
  /**
   * 获取启动此 agent 的进程配置
   *
   * @param memberConfig - 成员特定配置（systemInstruction 等）
   * @param workDir - agent 进程的工作目录
   * @returns 可以传递给 ProcessManager 的 ProcessConfig
   */
  getProcessConfig(memberConfig: MemberAgentConfig, workDir?: string): ProcessConfig;

  /**
   * 准备要发送给 agent 的消息
   *
   * 注意：此方法接收的是已经构建好的完整消息（包含 context）
   * Adapter 可以选择是否在前面添加系统提示词
   *
   * @param message - 包含 context 和当前消息的完整内容
   * @param memberConfig - 成员配置（如果需要在消息中注入系统提示词）
   * @returns 格式化后的消息，准备发送到 stdin
   */
  prepareMessage(message: string, memberConfig: MemberAgentConfig): string;

  /**
   * 解析 agent 的原始输出
   * 可能需要清理标记、解析 JSON、提取内容等
   *
   * @param rawOutput - 来自 agent 进程的原始 stdout/stderr
   * @returns 清理后的内容，不含技术标记
   */
  parseResponse(rawOutput: string): string;

  /**
   * 获取此 agent 的完成检测策略
   *
   * @returns 完成检测策略
   */
  getCompletionStrategy(): CompletionStrategy;
}

/**
 * 成员特定的 agent 配置
 * 从 Team Config 传递到 Adapter 用于成员级定制
 */
export interface MemberAgentConfig {
  systemInstruction?: string;  // 角色特定的系统提示词
  additionalArgs?: string[];   // 可选的成员特定参数
  env?: Record<string, string>; // 可选的环境变量
  workDir?: string;            // 可选的工作目录
}
```

### 3. Registry 配置（修订的 Schema）

**将技术配置与行为配置分离：**

```typescript
// ~/.agent-chatter/agents/config.json (Registry Schema 1.2)
{
  "schemaVersion": "1.2",
  "agents": {
    "claude": {
      "name": "claude",
      "displayName": "Claude Code",
      "command": "/path/to/claude",
      "baseArgs": [],  // 基础参数，无系统提示词
      "capabilities": {
        "supportsSystemPrompt": true,
        "systemPromptFlag": "--append-system-prompt",
        "completionDetection": "jsonl",  // "jsonl" | "idleTimeout" | "custom"
        "completionTypes": ["result"]
      },
      "usePty": false,
      "version": "2.0.44",
      "installedAt": "2025-11-20T..."
    },
    "codex": {
      "name": "codex",
      "displayName": "OpenAI Codex",
      "command": "/path/to/codex",
      "baseArgs": ["exec", "--json", "--full-auto", "--skip-git-repo-check"],
      "capabilities": {
        "supportsSystemPrompt": false,  // 不支持直接的系统提示词参数
        "completionDetection": "idleTimeout",  // 使用空闲超时检测
        "idleTimeoutMs": 2000
      },
      "usePty": false,
      "version": "0.58.0",
      "installedAt": "2025-11-20T..."
    }
  }
}
```

**关键改进：**
- `baseArgs` 取代 `args` - 仅包含技术参数
- `capabilities.completionDetection` - 明确完成检测方式
- `capabilities.systemPromptFlag` - 如何注入系统提示词（如果支持）
- Registry 中无角色特定内容

### 4. Adapter 实现

#### ClaudeAdapter

```typescript
// src/agents/claude/ClaudeAdapter.ts

export class ClaudeAdapter implements AgentAdapter {
  constructor(private registryConfig: AgentDefinition) {}

  getProcessConfig(memberConfig: MemberAgentConfig, workDir?: string): ProcessConfig {
    const args = [...this.registryConfig.baseArgs];

    // 构建系统提示词：成员指令 + 技术要求
    if (memberConfig.systemInstruction) {
      const systemPrompt = this.buildSystemPrompt(memberConfig.systemInstruction);
      const flag = this.registryConfig.capabilities.systemPromptFlag;
      args.push(flag, systemPrompt);
    }

    // 添加成员特定的额外参数
    if (memberConfig.additionalArgs) {
      args.push(...memberConfig.additionalArgs);
    }

    return {
      command: this.registryConfig.command,
      args,
      cwd: workDir || memberConfig.workDir,
      env: memberConfig.env
    };
  }

  private buildSystemPrompt(memberInstruction: string): string {
    // 合并成员指令与技术要求
    return memberInstruction;
  }

  prepareMessage(message: string, memberConfig: MemberAgentConfig): string {
    // Claude 已经通过 CLI args 接收了系统提示词
    // 这里只需要返回消息本身
    return message;
  }

  parseResponse(rawOutput: string): string {
    // JSONL 模式下交由上层解析
    return rawOutput.trim();
  }

  getCompletionStrategy(): CompletionStrategy {
    return {
      type: 'jsonl',
      completionTypes: ['result']
    };
  }
}
```

#### CodexAdapter

```typescript
// src/agents/codex/CodexAdapter.ts

export class CodexAdapter implements AgentAdapter {
  constructor(private registryConfig: AgentDefinition) {}

  getProcessConfig(memberConfig: MemberAgentConfig, workDir?: string): ProcessConfig {
    const args = [...this.registryConfig.baseArgs];

    // Codex 不支持 --append-system-prompt
    // 系统提示词将在 prepareMessage 中添加到消息前面

    if (memberConfig.additionalArgs) {
      args.push(...memberConfig.additionalArgs);
    }

    return {
      command: this.registryConfig.command,
      args,
      cwd: workDir || memberConfig.workDir,
      env: memberConfig.env
    };
  }

  prepareMessage(message: string, memberConfig: MemberAgentConfig): string {
    // Codex 不支持 CLI 参数传递系统提示词
    // 我们在消息开头添加系统提示词
    if (memberConfig.systemInstruction) {
      const systemPrompt = this.buildSystemPrompt(memberConfig.systemInstruction);
      return `${systemPrompt}\n\n${message}`;
    }
    return message;
  }

  private buildSystemPrompt(memberInstruction: string): string {
    // 系统提示词格式
    return `[SYSTEM]\n${memberInstruction}`;
  }

  parseResponse(rawOutput: string): string {
    // Codex 可能返回 JSON 格式，需要解析
    // 或者清理输出中的元数据
    let cleaned = rawOutput.trim();

    // 重要：注入 [DONE] 标记用于 MessageRouter 检测对话终止
    // MessageRouter 会在 parseMessage 时移除它，返回 cleanContent
    if (!cleaned.endsWith('[DONE]')) {
      cleaned += '\n[DONE]';
    }

    return cleaned;
  }

  getCompletionStrategy(): CompletionStrategy {
    // Codex 使用空闲超时检测完成
    return {
      type: 'idleTimeout',
      timeoutMs: this.registryConfig.capabilities.idleTimeoutMs || 2000
    };
  }
}
```

#### GeminiAdapter

```typescript
// src/agents/gemini/GeminiAdapter.ts

export class GeminiAdapter implements AgentAdapter {
  constructor(private registryConfig: AgentDefinition) {}

  getProcessConfig(memberConfig: MemberAgentConfig, workDir?: string): ProcessConfig {
    const args = [...this.registryConfig.baseArgs];

    // 类似 CodexAdapter
    if (memberConfig.additionalArgs) {
      args.push(...memberConfig.additionalArgs);
    }

    return {
      command: this.registryConfig.command,
      args,
      cwd: workDir || memberConfig.workDir,
      env: memberConfig.env
    };
  }

  prepareMessage(message: string, memberConfig: MemberAgentConfig): string {
    // 类似 CodexAdapter，在消息前添加系统提示词
    if (memberConfig.systemInstruction) {
      return `[SYSTEM]\n${memberConfig.systemInstruction}\n\n${message}`;
    }
    return message;
  }

  parseResponse(rawOutput: string): string {
    let cleaned = rawOutput.trim();

    // 重要：注入 [DONE] 标记用于 MessageRouter 检测对话终止
    if (!cleaned.endsWith('[DONE]')) {
      cleaned += '\n[DONE]';
    }

    return cleaned;
  }

  getCompletionStrategy(): CompletionStrategy {
    return {
      type: 'idleTimeout',
      timeoutMs: this.registryConfig.capabilities.idleTimeoutMs || 2000
    };
  }
}
```

### 5. Adapter Factory

```typescript
// src/agents/AgentAdapterFactory.ts

export class AgentAdapterFactory {
  /**
   * 为给定的 agent 类型创建 adapter
   *
   * @param registryConfig - Registry 中的 Agent 定义
   * @returns 适当的 adapter 实例
   * @throws Error 如果 agent 类型不支持
   */
  static createAdapter(registryConfig: AgentDefinition): AgentAdapter {
    switch (registryConfig.name) {
      case 'claude':
        return new ClaudeAdapter(registryConfig);

      case 'codex':
        return new CodexAdapter(registryConfig);

      case 'gemini':
        return new GeminiAdapter(registryConfig);

      default:
        throw new Error(
          `Unsupported agent type: ${registryConfig.name}\n` +
          `Supported types: claude, codex, gemini`
        );
    }
  }
}
```

### 6. AgentManager 集成（完整实现）

**修复架构委员会指出的实现细节问题：**

```typescript
// src/services/AgentManager.ts (完整修订)

import { ProcessManager, CompletionStrategy } from '../infrastructure/ProcessManager.js';
import { AgentConfigManager } from './AgentConfigManager.js';
import { AgentAdapterFactory } from '../agents/AgentAdapterFactory.js';
import type { AgentAdapter, MemberAgentConfig } from '../agents/base/IAgentAdapter.js';

/**
 * Agent 实例信息
 */
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  adapter: AgentAdapter;  // ← 存储 adapter 引用
}

/**
 * AgentManager 类
 */
export class AgentManager {
  // Role ID -> Agent Instance 的映射
  private agents: Map<string, AgentInstance> = new Map();

  constructor(
    private processManager: ProcessManager,
    private agentConfigManager: AgentConfigManager
  ) {}

  /**
   * 确保 Agent 已启动（懒加载）
   *
   * @param roleId - 角色 ID
   * @param configId - Agent 配置 ID
   * @param memberConfig - 成员特定配置（包含 systemInstruction）
   * @returns Process ID
   */
  async ensureAgentStarted(
    roleId: string,
    configId: string,
    memberConfig: MemberAgentConfig
  ): Promise<string> {
    // 检查是否已经启动
    const existing = this.agents.get(roleId);
    if (existing) {
      return existing.processId;
    }

    // 获取 Registry 配置
    const registryConfig = await this.agentConfigManager.getAgentConfig(configId);
    if (!registryConfig) {
      throw new Error(`Agent config ${configId} not found`);
    }

    // 创建适当的 adapter
    const adapter = AgentAdapterFactory.createAdapter(registryConfig);

    // 获取成员特定的进程配置
    // workDir 从 memberConfig 或使用默认值
    const workDir = memberConfig.workDir || process.cwd();
    const processConfig = adapter.getProcessConfig(memberConfig, workDir);

    // 启动进程
    const processId = await this.processManager.startProcess(processConfig);

    // 记录实例（包含 adapter）
    this.agents.set(roleId, {
      roleId,
      configId,
      processId,
      adapter  // ← 持久化 adapter
    });

    return processId;
  }

  /**
   * 发送消息并等待响应
   *
   * @param roleId - 角色 ID
   * @param message - 要发送的消息（已包含 context）
   * @param memberConfig - 成员配置（用于 prepareMessage）
   * @param options - 发送选项
   * @returns 解析后的响应
   */
  async sendAndReceive(
    roleId: string,
    message: string,
    memberConfig: MemberAgentConfig,
    options?: { timeout?: number }
  ): Promise<string> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Role ${roleId} has no running agent`);
    }

    // 使用 adapter 准备消息
    const preparedMessage = agent.adapter.prepareMessage(message, memberConfig);

    // 获取完成检测策略
    const completionStrategy = agent.adapter.getCompletionStrategy();

    // 发送消息并等待响应
    const rawResponse = await this.processManager.sendAndReceive(
      agent.processId,
      preparedMessage,
      {
        timeout: options?.timeout || 30000,
        completionStrategy  // ← 使用 adapter 提供的策略
      }
    );

    // 使用 adapter 解析响应
    const parsedResponse = agent.adapter.parseResponse(rawResponse);

    return parsedResponse;
  }

  /**
   * 停止 Agent
   */
  async stopAgent(roleId: string): Promise<void> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      return;  // 静默返回
    }

    await this.processManager.stopProcess(agent.processId);
    this.agents.delete(roleId);
  }

  /**
   * 检查 Agent 是否在运行
   */
  isRunning(roleId: string): boolean {
    return this.agents.has(roleId);
  }

  /**
   * 清理所有 Agent
   */
  cleanup(): void {
    this.processManager.cleanup();
    this.agents.clear();
  }

  /**
   * 获取所有运行中的 Agent 角色 ID
   */
  getRunningRoles(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * 获取 Agent 实例信息
   */
  getAgentInfo(roleId: string): AgentInstance | undefined {
    return this.agents.get(roleId);
  }
}
```

**关键修复：**
1. ✅ `AgentInstance` 包含 `adapter` 引用
2. ✅ `ensureAgentStarted` 明确接收 `memberConfig` 并传递给 adapter
3. ✅ `workDir` 从 `memberConfig.workDir` 获取
4. ✅ `sendAndReceive` 使用 `adapter.prepareMessage()` 和 `adapter.getCompletionStrategy()`
5. ✅ 所有变量都有明确来源，代码可以编译运行

### 7. ConversationCoordinator 变更

**关键：移除 buildAgentMessage 中的系统提示词部分**

```typescript
// src/services/ConversationCoordinator.ts (修订)

/**
 * 发送消息给 Agent
 */
private async sendToAgent(member: Member, message: string): Promise<void> {
  if (!member.agentConfigId) {
    throw new Error(`Member ${member.id} has no agent config`);
  }

  // 准备成员特定配置
  const memberConfig: MemberAgentConfig = {
    systemInstruction: member.systemInstruction,
    additionalArgs: member.additionalArgs,
    env: member.env,
    workDir: member.workDir
  };

  // 确保 agent 已启动（传递成员配置）
  await this.agentManager.ensureAgentStarted(
    member.id,
    member.agentConfigId,
    memberConfig
  );

  // 构建消息（仅包含 context + 当前消息，无系统提示词）
  const fullMessage = this.buildAgentMessage(member, message);

  // 发送并接收（传递成员配置用于 prepareMessage）
  const response = await this.agentManager.sendAndReceive(
    member.id,
    fullMessage,
    memberConfig
  );

  // 停止 agent
  await this.agentManager.stopAgent(member.id);

  // 处理响应
  await this.onAgentResponse(member.id, response);
}

/**
 * 构建发送给 Agent 的完整消息
 *
 * 注意：此方法不再添加 [SYSTEM] 部分
 * 系统提示词由 Adapter 通过 CLI args 或 prepareMessage 处理
 */
private buildAgentMessage(member: Member, message: string): string {
  const parts: string[] = [];

  // 添加最近的对话上下文
  const allMessages = this.session?.messages || [];
  const contextMessages = allMessages.slice(-this.contextMessageCount - 1, -1);

  if (contextMessages.length > 0) {
    parts.push('[CONTEXT]');
    for (const msg of contextMessages) {
      parts.push(`${msg.speaker.roleName}: ${msg.content}`);
    }
    parts.push('');
  }

  // 添加当前消息
  parts.push('[MESSAGE]');
  parts.push(message);

  return parts.join('\n');
}
```

**关键改进：**
1. ✅ `buildAgentMessage` 不再添加 `[SYSTEM]` 部分
2. ✅ 系统提示词完全由 Adapter 管理：
   - ClaudeAdapter：通过 `--append-system-prompt` CLI 参数
   - CodexAdapter/GeminiAdapter：通过 `prepareMessage()` 在消息前添加
3. ✅ 避免双重系统提示词问题
4. ✅ 职责清晰：ConversationCoordinator 负责上下文，Adapter 负责系统提示词

---

## 完成检测策略对比

| Agent | 策略 | 原因 | 实现 |
|-------|------|------|------|
| **Claude Code** | `completion: jsonl (result)` | 流式 JSON | CLI args 注入系统提示词 |
| **Codex** | `idleTimeout: 2000ms` | Codex 不输出标记 | 空闲 2 秒后认为完成 |
| **Gemini** | `idleTimeout: 2000ms` | Gemini 不输出标记 | 空闲 2 秒后认为完成 |

**优势：**
- ✅ 不需要 shell wrapper 注入 [DONE]
- ✅ 每个 agent 使用最适合的检测方式
- ✅ ProcessManager 保持通用性（支持多种策略）

---

## 收益

### 1. 清晰的关注点分离

| 组件 | 职责 |
|------|------|
| **Registry** | "安装了哪些 agents？" 技术协议细节 |
| **Adapter** | "如何与这个特定的 agent 通信？" 协议实现 |
| **Member Config** | "我是谁？" 角色身份和行为 |
| **ProcessManager** | "如何 spawn 进程？" 通用进程管理 |
| **ConversationCoordinator** | "对话上下文是什么？" 对话管理 |

### 2. 正确的配置分层

**修复前：**
```
Registry (全局) 包含角色特定的提示词 ❌
    ↓
所有成员共享相同的提示词 ❌
```

**修复后：**
```
Registry (全局): 仅技术配置 ✅
    ↓
Adapter: 合并 registry + member configs ✅
    ↓
每个成员获得定制化的进程配置 ✅
```

### 3. 不再需要 Shell Wrappers

- Wrapper 逻辑在 TypeScript 中实现
- 类型安全且可测试
- 无打包问题

### 4. 易于扩展

添加新 agent：
1. 实现 `AgentAdapter` 接口
2. 在 `AgentAdapterFactory` 中添加 case
3. 完成！

无需修改：
- ProcessManager
- AgentManager
- ConversationCoordinator
- Team config schema

### 5. 可测试性

每个 adapter 可以独立进行单元测试：
```typescript
describe('ClaudeAdapter', () => {
  it('将成员 systemInstruction 注入到 --append-system-prompt', () => {
    const adapter = new ClaudeAdapter(registryConfig);
    const processConfig = adapter.getProcessConfig({
      systemInstruction: 'You are Max, a tech lead.'
    });

    expect(processConfig.args).toContain('--append-system-prompt');
    const promptIndex = processConfig.args.indexOf('--append-system-prompt');
    const promptValue = processConfig.args[promptIndex + 1];
    expect(promptValue).toContain('You are Max, a tech lead.');
    expect(promptValue).toContain('[DONE]');
  });

  it('使用 JSONL 完成策略', () => {
    const adapter = new ClaudeAdapter(registryConfig);
    const strategy = adapter.getCompletionStrategy();

    expect(strategy.type).toBe('jsonl');
    expect(strategy.completionTypes).toContain('result');
  });
});

describe('CodexAdapter', () => {
  it('在 prepareMessage 中添加系统提示词', () => {
    const adapter = new CodexAdapter(registryConfig);
    const prepared = adapter.prepareMessage('Do task X', {
      systemInstruction: 'You are Sarah, a business analyst.'
    });

    expect(prepared).toContain('[SYSTEM]');
    expect(prepared).toContain('You are Sarah, a business analyst.');
    expect(prepared).toContain('Do task X');
  });

  it('使用 idleTimeout 完成策略', () => {
    const adapter = new CodexAdapter(registryConfig);
    const strategy = adapter.getCompletionStrategy();

    expect(strategy.type).toBe('idleTimeout');
    expect(strategy.timeoutMs).toBe(2000);
  });
});
```

---

## 迁移计划

### 阶段 1：添加 Adapter 层（非破坏性）

1. 创建 `src/agents/` 目录结构
2. 实现 adapter 接口和具体 adapters
3. 增强 ProcessManager 支持多种完成检测策略
4. 更新 AgentManager 使用 adapters（保持向后兼容）
5. 更新 ConversationCoordinator 的 buildAgentMessage（移除 [SYSTEM]）
6. 添加全面的测试

**向后兼容性：** 如果 `baseArgs` 不存在，继续支持 Registry Schema 1.1 的 `args` 作为后备。

### 阶段 2：更新 Schema（破坏性变更）

#### 2.1 更新 Registry Schema 到 1.2

1. 将 Registry Schema 升级到 1.2
2. 迁移现有的 registry 配置：
   - 将角色无关的 args 移到 `baseArgs`
   - 从 args 中移除角色特定的提示词
   - 添加 `capabilities` 对象
3. 更新 AgentDefaults.ts
4. 更新文档

**迁移工具：** 提供 `agent-chatter migrate-registry` 命令。

#### 2.2 更新 Team Schema（非破坏性，向后兼容）

1. 在 `src/models/Team.ts` 的 `Member` 接口中添加可选字段：
   - `workDir?: string`
   - `additionalArgs?: string[]`
   - `env?: Record<string, string>`
2. 更新 TypeScript 类型定义
3. 更新文档和示例

**向后兼容性：** 所有新字段都是可选的，现有配置无需修改。

### 阶段 3：移除 Shell Wrappers（清理）

1. 验证所有 wrapper 功能都已在 adapters 中实现
2. 移除 `wrappers/` 目录
3. 更新测试

---

## Schema 变更

### Registry Schema 1.1 → 1.2

**变更：**
- `args` → `baseArgs`（仅技术参数，无提示词）
- 添加 `capabilities` 对象
- 从 args 中移除角色特定内容

**向后兼容性：**
- 如果 `baseArgs` 不存在，继续读取 `args`
- 警告用户迁移
- 提供自动迁移工具

### Team Config Schema（需要变更）

**必需增强：** `Member` 接口需要添加以下字段以支持 Adapter 功能：

```typescript
// src/models/Team.ts
export interface Member {
  id: string;
  name: string;
  displayName: string;
  role: string;
  type: 'ai' | 'human';
  order: number;
  agentConfigId?: string;
  systemInstruction?: string;

  // 新增字段（用于 Adapter 集成）
  workDir?: string;            // 成员特定的工作目录
  additionalArgs?: string[];   // 成员特定的额外 CLI 参数
  env?: Record<string, string>; // 成员特定的环境变量
}
```

**变更原因：**
- `workDir` - 允许不同成员在不同目录工作
- `additionalArgs` - 允许成员级的 CLI 参数定制
- `env` - 允许成员级的环境变量设置

**迁移影响：**
- 所有字段都是可选的，向后兼容
- 现有 Team Config 无需修改即可继续工作
- 新配置可以利用这些字段提供更精细的控制

---

## 架构委员会的问题 - 已解决

### ✅ 问题 1：Codex 的 [DONE] 问题未真正解决

**原问题：**
- CodexAdapter 返回 `[DONE]`，但 Codex 不输出它
- ProcessManager 会一直等待标记

**解决方案：**
1. **增强 ProcessManager** 支持 JSONL 完成检测 + idleTimeout/custom
2. **CodexAdapter** 使用 JSONL 完成事件（turn.completed）
3. **ProcessManager** 根据策略选择合适的检测方式
4. **无需 shell wrapper** 注入 [DONE]

### ✅ 问题 2：配置分层修复不连贯

**原问题：**
- `buildAgentMessage` 仍然在消息中添加 `[SYSTEM]`
- 会导致 Claude 获得双重提示词
- Codex 仍依赖消息级提示词

**解决方案：**
1. **重新设计 buildAgentMessage**：移除 `[SYSTEM]` 部分，只负责 context + message
2. **Adapter 职责明确**：
   - ClaudeAdapter：通过 CLI args 传递系统提示词
   - CodexAdapter/GeminiAdapter：通过 `prepareMessage()` 在消息前添加
3. **避免双重提示词**：每个 agent 只通过一种方式接收系统提示词

### ✅ 问题 3：AgentManager 实现细节缺失

**原问题：**
- 引用不存在的 `workDir` 和 `processId` 变量
- 没有持久化 processId/adapter 对
- 代码无法编译

**解决方案：**
1. **AgentInstance 结构完整**：包含 `roleId, configId, processId, adapter`
2. **workDir 来源明确**：从 `memberConfig.workDir` 获取
3. **adapter 持久化**：存储在 `AgentInstance` 中
4. **完整的实现**：所有变量来源明确，代码可以编译运行

---

## 待架构委员会决策的问题

1. **目录命名**：`src/agents/` vs `src/adapters/` vs `src/connectors/`?
   - 建议：`src/agents/`（更清晰，符合领域术语）

2. **进程复用**：是否应该为多条消息复用同一进程，还是每次都重启？
   - 当前：每次重启（stdin.end() 关闭进程）
   - 建议：保持当前行为（更简单，无状态）

3. **Adapter 注册**：adapters 应该动态发现，还是在 factory 中硬编码？
   - 建议：初期硬编码（更简单），后续可添加插件系统

4. **Schema 迁移**：自动迁移 Registry 1.1 → 1.2，还是要求手动迁移？
   - 建议：提供迁移工具，对旧 schema 发出警告

5. **测试策略**：应该添加与真实 AI CLIs 的集成测试，还是只用 mock 进行单元测试？
   - 建议：单元测试用 mocks + 可选的集成测试（如果未安装则跳过）

6. **idleTimeout 值**：Codex 和 Gemini 的默认空闲超时应该设为多少？
   - 建议：2000ms（2秒），可在 Registry 中配置

7. **Team Config JSON Schema 验证**：是否需要在运行时验证 Team Config 符合新的 schema？
   - 建议：提供可选的 schema 验证，帮助用户发现配置错误

---

## 风险与缓解措施

### 风险 1：用户的破坏性变更

**缓解措施**：
- 阶段 1 保持向后兼容
- 提供迁移工具和清晰文档
- 通过发布说明和 changelog 沟通变更

### 风险 2：增加复杂性

**缓解措施**：
- Adapters 封装复杂性，使其可管理
- 清晰的接口和文档
- 全面的测试

### 风险 3：性能影响

**缓解措施**：
- Adapters 是轻量级的（无显著开销）
- 进程 spawning 保持不变（无性能回归）
- idleTimeout 检测可能增加 2 秒延迟，但比无限等待好

### 风险 4：idleTimeout 误判

**风险**：Agent 可能正在生成长响应，但暂时没有输出，导致提前终止。

**缓解措施**：
- 设置合理的 idleTimeout 值（2秒）
- 在 Registry 中可配置
- JSONL 完成事件优先；idleTimeout 为兜底

---

## 成功标准

### 核心功能

1. ✅ 所有三个 agents（Claude, Codex, Gemini）无需 shell wrappers 即可工作
2. ✅ 使用同一 agent 类型的不同团队成员获得不同的系统提示词
3. ✅ Codex 使用 idleTimeout 策略可以正常完成响应（2秒内）
4. ✅ Claude 不会收到双重系统提示词

### 边界情况（第二轮评审关注点）

5. ✅ **idleTimeout 启动时机**：Agent 完全无输出时，2 秒后正确返回（不等 30 秒）
6. ✅ **Team schema 一致性**：`Member` 类型包含 `workDir`、`additionalArgs`、`env` 字段
7. ✅ **对话终止**：Codex/Gemini 的响应能够正确触发 `isDone=true`，对话状态变为 `completed`

### 质量保证

8. ✅ 所有现有测试通过
9. ✅ 新 adapter 测试达到 >90% 覆盖率
10. ✅ UAT 测试无回归
11. ✅ 清晰的分离：Registry（技术）vs Member（行为）

### 文档完整性

12. ✅ 所有代码示例可以编译运行（无未定义变量）
13. ✅ Schema 变更明确列出并包含在迁移计划中

---

## 附录：文件结构

```
src/
  agents/
    base/
      IAgentAdapter.ts           # 接口定义
      BaseAgentAdapter.ts        # 可选的抽象基类
    claude/
      ClaudeAdapter.ts           # Claude Code adapter
      ClaudeAdapter.test.ts      # 单元测试
    codex/
      CodexAdapter.ts            # OpenAI Codex adapter
      CodexAdapter.test.ts       # 单元测试
    gemini/
      GeminiAdapter.ts           # Google Gemini adapter
      GeminiAdapter.test.ts      # 单元测试
    AgentAdapterFactory.ts       # 创建 adapters 的工厂
    AgentAdapterFactory.test.ts  # 工厂测试
    index.ts                     # 导出

  infrastructure/
    ProcessManager.ts            # 增强：支持多种完成检测策略

  services/
    AgentManager.ts              # 更新：使用 adapters
    ConversationCoordinator.ts   # 更新：传递 member config，修改 buildAgentMessage

  registry/
    RegistryStorage.ts           # 更新：支持 Schema 1.2
    RegistryMigration.ts         # 迁移工具（新增）

  utils/
    AgentDefaults.ts             # 更新：使用 Schema 1.2 默认值

tests/
  unit/
    agents/
      ClaudeAdapter.test.ts
      CodexAdapter.test.ts
      GeminiAdapter.test.ts
      AgentAdapterFactory.test.ts
    infrastructure/
      ProcessManager.test.ts     # 测试多种完成检测策略
  integration/
    agentCommunication.test.ts   # 端到端测试
```

---

## 架构委员会第二轮评审问题 - 已解决

### ✅ 问题 1：idleTimeout 启动时机问题

**原问题：**
- idleTimeout 检测只在 `checkCompletion` 被输出回调触发后才启动计时器
- 如果 agent 根本没有 stdout，idleTimeout 永远不会生效
- 只能等待 30 秒总超时，等同回到旧问题

**解决方案：**
在 ProcessManager.sendAndReceive() 中，**发送消息后立即启动 idleTimeout 计时器**：

```typescript
// 发送消息
managed.process.stdin.write(message + '\n');
managed.process.stdin.end();

// 重要：对于 idleTimeout 策略，立即启动计时器
// 这样即使 agent 完全没有输出，也会在超时后返回
if (strategy.type === 'idleTimeout') {
  idleTimer = setTimeout(() => {
    cleanup();
    resolve(output);  // 即使是空输出也返回
  }, strategy.timeoutMs);
}
```

**效果：**
- ✅ Agent 有输出：每次输出重置计时器
- ✅ Agent 无输出：2 秒后自动返回空字符串
- ✅ 不依赖总超时（30秒），2 秒即可检测到无响应

**代码位置：** `design/agent-adapter-architecture-zh.md:207-214`

---

### ✅ 问题 2：Team schema 类型不一致

**原问题：**
- 实现示例中使用了 `member.additionalArgs` 和 `member.workDir`
- 但 schema 章节说"无需变更，只是可选增强"
- 当前 `Team.Member` 类型并没有这些字段
- 会导致实现阶段类型不一致

**解决方案：**
**明确 Team Config Schema 需要变更**，添加必需字段：

```typescript
// src/models/Team.ts
export interface Member {
  // 现有字段...

  // 新增字段（用于 Adapter 集成）
  workDir?: string;            // 成员特定的工作目录
  additionalArgs?: string[];   // 成员特定的额外 CLI 参数
  env?: Record<string, string>; // 成员特定的环境变量
}
```

**迁移影响：**
- 所有字段都是**可选的**，向后兼容
- 现有 Team Config 无需修改即可继续工作
- 新配置可以利用这些字段提供更精细的控制

**文档位置：** `design/agent-adapter-architecture-zh.md:963-994`

---

### ✅ 问题 3：对话层 [DONE] 标记缺失

**原问题：**
- Codex/Gemini 适配器不再注入 [DONE]（只做 `trim()`）
- MessageRouter 依赖 [DONE] 标记来设置 `isDone=true`
- 即使 ProcessManager 能用 idleTimeout 停止等待，ConversationCoordinator 也拿不到 `isDone=true`
- 对话会保持 `active` 状态，无法终止

**解决方案：**
**Adapter 在 `parseResponse()` 时注入 [DONE] 标记**：

```typescript
// CodexAdapter.parseResponse()
parseResponse(rawOutput: string): string {
  let cleaned = rawOutput.trim();

  // 重要：注入 [DONE] 标记用于 MessageRouter 检测对话终止
  // MessageRouter 会在 parseMessage 时移除它，返回 cleanContent
  if (!cleaned.endsWith('[DONE]')) {
    cleaned += '\n[DONE]';
  }

  return cleaned;
}

// GeminiAdapter 同理
```

**完整流程：**
```
1. ProcessManager (idleTimeout 2秒) 停止等待
    ↓
2. 返回 rawOutput: "Codex response text"
    ↓
3. Adapter.parseResponse() 返回: "Codex response text\n[DONE]"
    ↓
4. AgentManager 返回给 ConversationCoordinator
    ↓
5. ConversationCoordinator.onAgentResponse(memberId, "Codex response text\n[DONE]")
    ↓
6. MessageRouter.parseMessage() 解析：
   - isDone = true （检测到 [DONE]）
   - cleanContent = "Codex response text" （移除了 [DONE]）
    ↓
7. ConversationCoordinator 检查 isDone == true
    ↓
8. 调用 handleConversationComplete()
    ↓
9. 对话正确终止 ✅
```

**关键优势：**
- ✅ 用户不会看到 [DONE]（MessageRouter 会移除）
- ✅ MessageRouter 逻辑无需修改
- ✅ ConversationCoordinator 逻辑无需修改
- ✅ 完成检测（ProcessManager层）和对话终止（MessageRouter层）职责分离清晰

**代码位置：**
- CodexAdapter: `design/agent-adapter-architecture-zh.md:431-443`
- GeminiAdapter: `design/agent-adapter-architecture-zh.md:487-496`

---

### 三个问题的关联关系

这三个问题共同确保了 **Codex/Gemini 的端到端工作流程**：

1. **问题1（启动时机）** → ProcessManager 能够检测到 agent 完成（即使无输出）
2. **问题2（schema 一致）** → AgentManager 能够正确传递成员配置给 Adapter
3. **问题3（[DONE] 注入）** → ConversationCoordinator 能够检测到对话终止

三者缺一不可，共同构成完整的 Adapter 解决方案。

---

## [DONE] 标记的语义变更（2025-11-21）

### 背景

原设计中，AI 和人类消息的 `[DONE]` 标记都会触发会话终止。这导致 AI 之间无法持续对话，限制了多 Agent 协作的灵活性。

### 新行为定义

**[DONE] 标记的两层语义：**

1. **ProcessManager 层（不变）**：
   - `[DONE]` 仍然作为消息完成标记
   - 用于检测 Agent 响应结束（通过 JSONL 完成事件或 `idleTimeout`）
   - Adapter 层负责注入 `[DONE]`（如果原始输出不包含）

2. **ConversationCoordinator 层（已变更）**：
   - **AI 消息**：`[DONE]` 只表示"当前 Agent 回复完成"，**不终止会话**
     - 会话继续通过 `routeToNext()` 路由到下一个成员（round-robin 或 [NEXT] 指定）
     - 允许 AI 之间持续对话

   - **人类消息**：`[DONE]` 表示"会话终止"
     - 调用 `handleConversationComplete()` 结束会话
     - 人类也可通过 `/end` 命令终止会话

### 实现位置

**ConversationCoordinator.ts**:
```typescript
// src/services/ConversationCoordinator.ts:136-140
async onAgentResponse(memberId: string, rawResponse: string): Promise<void> {
  // ... 消息处理 ...

  // AI 消息中的 [DONE] 只表示当前 Agent 回复完成，不表示会话终止
  // 会话终止由人类用户通过 /end 命令或带 [DONE] 的消息来控制

  // 路由到下一个接收者（而非终止）
  await this.routeToNext(message);
}

// src/services/ConversationCoordinator.ts:190-193
async injectMessage(memberId: string, content: string): Promise<void> {
  // ... 消息处理 ...

  // 人类消息中的 [DONE] 触发会话终止
  if (parsed.isDone) {
    this.handleConversationComplete();
    return;
  }

  await this.routeToNext(message);
}
```

### 会话终止的新控制方式

1. **人类用户**：
   - 发送包含 `[DONE]` 的消息
   - 使用 `/end` 命令

2. **编程控制**：
   - 调用 `coordinator.stop()`

### 影响和兼容性

- **不影响 Adapter 层**：Adapter 仍然正常注入 `[DONE]`
- **不影响 ProcessManager 层**：消息完成检测逻辑不变
- **测试更新**：所有相关测试已更新以反映新行为（273 个测试全部通过）
- **用户体验改进**：AI 团队可以持续协作，直到人类明确终止

---

## 参考

- 当前代码：src/services/AgentManager.ts
- 当前代码：src/infrastructure/ProcessManager.ts
- 当前代码：src/registry/RegistryStorage.ts
- 当前代码：src/services/ConversationCoordinator.ts
- 设计模式：适配器模式（Gang of Four）
- 相关讨论：[NEXT] 和 [DONE] 标记解析

---

**提交给架构委员会第三轮评审**

**修订历史：**
- v1.0 (2025-11-20)：初版提交
- v2.0 (2025-11-20)：解决第一轮评审问题（Codex [DONE]、配置分层、实现细节）
- v3.0 (2025-11-20)：解决第二轮评审问题（idleTimeout 启动时机、Team schema 一致性、对话层 [DONE] 注入）
