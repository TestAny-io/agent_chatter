/**
 * AgentManager - 管理 Agent 实例
 *
 * 负责启动、停止和管理 Agent 进程
 * 实现懒加载（按需启动 Agent）
 * 维护 Role ID 到 Process ID 的映射
 *
 * 简化版：适配简化的 ProcessManager
 */

import { ProcessManager } from '../infrastructure/ProcessManager.js';
import type { SendOptions } from '../infrastructure/ProcessManager.js';
import { AgentConfigManager } from './AgentConfigManager.js';
import { AdapterFactory } from '../adapters/AdapterFactory.js';
import type { AgentSpawnConfig, IAgentAdapter } from '../adapters/IAgentAdapter.js';

/**
 * Agent 实例信息
 */
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  cleanup?: () => Promise<void>;  // Adapter cleanup function
  adapter: IAgentAdapter;  // Store adapter for prepareMessage()
  systemInstruction?: string;  // Store for use in sendAndReceive()
}

/**
 * Member-specific configuration for spawning agents
 * Extracted from Member model to avoid circular dependencies
 */
export interface MemberSpawnConfig {
  workDir?: string;
  env?: Record<string, string>;
  additionalArgs?: string[];
  systemInstruction?: string;
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
   * 如果 Agent 已经在运行，返回现有的 process ID
   * 否则启动新的 Agent 进程
   *
   * @param roleId - Role/Member ID
   * @param configId - Agent config ID
   * @param memberConfig - Optional member-specific configuration (workDir, env, additionalArgs, systemInstruction)
   */
  async ensureAgentStarted(
    roleId: string,
    configId: string,
    memberConfig?: MemberSpawnConfig
  ): Promise<string> {
    // 检查是否已经启动
    const existing = this.agents.get(roleId);
    if (existing) {
      return existing.processId;
    }

    // 获取配置
    const config = await this.agentConfigManager.getAgentConfig(configId);
    if (!config) {
      throw new Error(`Agent config ${configId} not found`);
    }

    // 创建适配器
    const adapter = AdapterFactory.createAdapter(config);

    // 准备 spawn 配置
    const spawnConfig: AgentSpawnConfig = {
      workDir: memberConfig?.workDir || config.cwd || process.cwd(),
      env: {
        ...config.env,
        ...memberConfig?.env
      },
      additionalArgs: [
        ...(config.args || []),
        ...(memberConfig?.additionalArgs || [])
      ],
      systemInstruction: memberConfig?.systemInstruction
    };

    // 使用适配器启动进程
    const spawnResult = await adapter.spawn(spawnConfig);

    // 将进程注册到 ProcessManager
    // Pass customStreams to ProcessManager if adapter provides them
    const processId = this.processManager.registerProcess(
      spawnResult.process,
      {
        command: config.command,
        args: config.args || [],
        env: config.env,
        cwd: spawnConfig.workDir
      },
      spawnResult.customStreams  // Pass custom streams for [DONE] marker injection
    );

    // 记录实例
    // CRITICAL: systemInstruction MUST be stored here, NOT on childProcess!
    // AgentManager.sendAndReceive() will access it from agent.systemInstruction
    this.agents.set(roleId, {
      roleId,
      configId,
      processId,
      cleanup: spawnResult.cleanup,
      adapter: adapter,  // Store adapter for prepareMessage()
      systemInstruction: memberConfig?.systemInstruction  // Store for use in sendAndReceive()
    });

    return processId;
  }

  /**
   * 发送消息并等待响应
   */
  async sendAndReceive(
    roleId: string,
    message: string,
    options?: Partial<SendOptions>
  ): Promise<string> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Role ${roleId} has no running agent`);
    }

    // 获取配置以确定 endMarker 和 useEndOfMessageMarker
    const config = await this.agentConfigManager.getAgentConfig(agent.configId);

    // Prepare message using adapter (handles system instruction prepending)
    const preparedMessage = agent.adapter.prepareMessage(message, agent.systemInstruction);

    // Get default end marker from adapter
    const defaultEndMarker = agent.adapter.getDefaultEndMarker();

    const sendOptions: SendOptions = {
      timeout: options?.timeout,
      endMarker: options?.endMarker || config?.endMarker || defaultEndMarker,
      useEndOfMessageMarker: config?.useEndOfMessageMarker || false
    };

    return this.processManager.sendAndReceive(
      agent.processId,
      preparedMessage,  // Send prepared message with [SYSTEM] if needed
      sendOptions
    );
  }

  /**
   * 停止 Agent
   */
  async stopAgent(roleId: string): Promise<void> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      return;  // 静默返回
    }

    // Call adapter cleanup if available
    if (agent.cleanup) {
      await agent.cleanup();
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
