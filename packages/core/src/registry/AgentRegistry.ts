/**
 * AgentRegistry - Agent registry 管理类
 *
 * 负责管理全局 agent registry 的 CRUD 操作
 */

import { RegistryStorage } from './RegistryStorage.js';
import type { AgentDefinition, AgentRegistryData } from './RegistryStorage.js';
import { AgentScanner } from './AgentScanner.js';
import type { ScannedAgent } from './AgentScanner.js';
import { AgentValidator } from './AgentValidator.js';
import { getDefaultAgentConfig } from '../utils/AgentDefaults.js';
import type { AgentType } from '../utils/AgentDefaults.js';
import type { VerificationResult, CheckResult } from '../services/validation/types.js';

// Re-export for backward compatibility
export type { VerificationResult, CheckResult };

/**
 * AgentRegistry 类
 */
export class AgentRegistry {
  private storage: RegistryStorage;
  private agents: Map<string, AgentDefinition>;
  private loaded: boolean = false;

  constructor(registryPath?: string) {
    this.storage = new RegistryStorage(registryPath);
    this.agents = new Map();
  }

  /**
   * 加载 registry
   */
  async load(): Promise<void> {
    const data = await this.storage.load();
    this.agents.clear();

    // 将对象转换为 Map
    for (const [name, agent] of Object.entries(data.agents)) {
      this.agents.set(name, agent);
    }

    this.loaded = true;
  }

  /**
   * 保存 registry
   */
  async save(): Promise<void> {
    if (!this.loaded) {
      throw new Error('Registry not loaded. Call load() first.');
    }

    // 将 Map 转换为对象
    const agentsObject: { [key: string]: AgentDefinition } = {};
    for (const [name, agent] of this.agents.entries()) {
      agentsObject[name] = agent;
    }

    const data: AgentRegistryData = {
      schemaVersion: '1.1',
      agents: agentsObject
    };

    await this.storage.save(data);
  }

  /**
   * 注册 agent
   */
  async register(agent: AgentDefinition): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    // 检查是否已存在
    if (this.agents.has(agent.name)) {
      throw new Error(
        `Agent '${agent.name}' is already registered.\n` +
        `Use update() to modify existing agent or delete() first.`
      );
    }

    // 添加到 Map
    this.agents.set(agent.name, agent);

    // 保存到文件
    await this.save();
  }

  /**
   * 获取 agent
   */
  get(name: string): AgentDefinition | undefined {
    if (!this.loaded) {
      throw new Error('Registry not loaded. Call load() first.');
    }

    return this.agents.get(name);
  }

  /**
   * 列出所有 agents
   */
  list(): AgentDefinition[] {
    if (!this.loaded) {
      throw new Error('Registry not loaded. Call load() first.');
    }

    return Array.from(this.agents.values());
  }

  /**
   * 删除 agent
   */
  async delete(name: string): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    if (!this.agents.has(name)) {
      throw new Error(`Agent '${name}' not found in registry.`);
    }

    this.agents.delete(name);
    await this.save();
  }

  /**
   * 更新 agent
   */
  async update(name: string, updates: Partial<AgentDefinition>): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    const existing = this.agents.get(name);
    if (!existing) {
      throw new Error(`Agent '${name}' not found in registry.`);
    }

    // 合并更新
    const updated: AgentDefinition = {
      ...existing,
      ...updates,
      // 保留原始的 name 和 installedAt
      name: existing.name,
      installedAt: existing.installedAt
    };

    this.agents.set(name, updated);
    await this.save();
  }

  /**
   * 检查 registry 是否为空
   */
  isEmpty(): boolean {
    if (!this.loaded) {
      throw new Error('Registry not loaded. Call load() first.');
    }

    return this.agents.size === 0;
  }

  /**
   * 检查 agent 是否存在
   */
  has(name: string): boolean {
    if (!this.loaded) {
      throw new Error('Registry not loaded. Call load() first.');
    }

    return this.agents.has(name);
  }

  /**
   * 获取 registry 文件路径
   */
  getPath(): string {
    return this.storage.getPath();
  }

  /**
   * 获取 agent 数量
   */
  count(): number {
    if (!this.loaded) {
      throw new Error('Registry not loaded. Call load() first.');
    }

    return this.agents.size;
  }

  /**
   * 更新 agent 的最后验证时间
   */
  async updateLastVerified(name: string): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent '${name}' not found in registry.`);
    }

    agent.lastVerified = new Date().toISOString();
    this.agents.set(name, agent);
    await this.save();
  }

  /**
   * 清空 registry（主要用于测试）
   */
  async clear(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    this.agents.clear();
    await this.save();
  }

  // ========== 便捷方法（Convenience Methods for CLI） ==========

  /**
   * 扫描系统中已安装的 agents
   */
  async scanAgents(): Promise<ScannedAgent[]> {
    const scanner = new AgentScanner();
    return scanner.scanAll();
  }

  /**
   * 注册 agent（便捷方法，返回操作结果）
   */
  async registerAgent(
    agentType: AgentType,
    commandPath?: string,
    version?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const scanner = new AgentScanner();
      const scanned = await scanner.scan(agentType);

      if (!scanned.found && !commandPath) {
        return {
          success: false,
          error: `Agent '${agentType}' not found in system`
        };
      }

      const definition = scanner.createAgentDefinition({
        ...scanned,
        command: commandPath || scanned.command,
        version: version || scanned.version
      });

      await this.register(definition);

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * 验证 agent（便捷方法）
   */
  async verifyAgent(name: string): Promise<VerificationResult> {
    if (!this.loaded) {
      await this.load();
    }

    const agent = this.agents.get(name);
    if (!agent) {
      return {
        name,
        status: 'failed',
        error: `Agent '${name}' not found in registry`,
        checks: []
      };
    }

    const validator = new AgentValidator();
    const result = await validator.verify(agent);

    // 更新最后验证时间
    if (result.status === 'verified') {
      await this.updateLastVerified(name);
    }

    return result;
  }

  /**
   * 列出所有 agents（便捷方法，异步版本）
   */
  async listAgents(): Promise<AgentDefinition[]> {
    if (!this.loaded) {
      await this.load();
    }

    return this.list();
  }

  /**
   * 获取 agent（便捷方法，异步版本）
   */
  async getAgent(name: string): Promise<AgentDefinition | undefined> {
    if (!this.loaded) {
      await this.load();
    }

    return this.get(name);
  }

  /**
   * 删除 agent（便捷方法，返回操作结果）
   */
  async deleteAgent(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.delete(name);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * 更新 agent（便捷方法，返回操作结果）
   */
  async updateAgent(
    name: string,
    updates: Partial<AgentDefinition>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.update(name, updates);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }
}
