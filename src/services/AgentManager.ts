/**
 * AgentManager - 管理 Agent 实例
 *
 * 负责启动、停止和管理 Agent 进程
 * 实现懒加载（按需启动 Agent）
 * 维护 Role ID 到 Process ID 的映射
 *
 * 简化版：适配简化的 ProcessManager
 */

import { ProcessManager, SendOptions } from '../infrastructure/ProcessManager';
import { AgentConfigManager } from './AgentConfigManager';

/**
 * Agent 实例信息
 */
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
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
   */
  async ensureAgentStarted(roleId: string, configId: string): Promise<string> {
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

    // 启动新进程
    const processId = await this.processManager.startProcess({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd
    });

    // 记录实例
    this.agents.set(roleId, {
      roleId,
      configId,
      processId
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

    const sendOptions: SendOptions = {
      timeout: options?.timeout,
      endMarker: options?.endMarker || config?.endMarker,
      useEndOfMessageMarker: config?.useEndOfMessageMarker || false
    };

    return this.processManager.sendAndReceive(
      agent.processId,
      message,
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
