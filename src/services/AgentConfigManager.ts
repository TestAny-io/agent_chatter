/**
 * AgentConfigManager - 管理 Agent 配置
 *
 * 负责创建、更新、删除和查询 Agent 配置
 * 使用 StorageService 持久化配置数据
 */

import type { IStorageService } from '../infrastructure/StorageService.js';
import { StorageKeys } from '../infrastructure/StorageService.js';
import type { AgentConfig } from '../models/AgentConfig.js';
import { AgentConfigUtils } from '../models/AgentConfig.js';

export interface CreateAgentConfigInput {
  name: string;
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  description?: string;
  endMarker?: string;
  useEndOfMessageMarker?: boolean;
  usePty?: boolean;
}

export interface UpdateAgentConfigInput {
  name?: string;
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  description?: string;
  endMarker?: string;
  useEndOfMessageMarker?: boolean;
  usePty?: boolean;
}

/**
 * AgentConfigManager 类
 */
export class AgentConfigManager {
  constructor(private storageService: IStorageService) {}

  /**
   * 创建新配置
   */
  async createAgentConfig(input: CreateAgentConfigInput): Promise<AgentConfig> {
    const config = AgentConfigUtils.createConfig(
      input.name,
      input.type,
      input.command,
      input.args,
      input.env,
      input.cwd,
      input.description,
      input.endMarker
    );

    // 手动添加 useEndOfMessageMarker 字段
    if (input.useEndOfMessageMarker !== undefined) {
      config.useEndOfMessageMarker = input.useEndOfMessageMarker;
    }

    // 手动添加 usePty 字段
    if (input.usePty !== undefined) {
      config.usePty = input.usePty;
    }

    // 验证
    const validation = AgentConfigUtils.validateConfig(config);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    // 保存到存储
    await this.saveConfig(config);

    return config;
  }

  /**
   * 获取配置
   */
  async getAgentConfig(configId: string): Promise<AgentConfig | undefined> {
    const configs = await this.loadConfigs();
    return configs.find(c => c.id === configId);
  }

  /**
   * 获取所有配置
   */
  async getAllAgentConfigs(): Promise<AgentConfig[]> {
    return this.loadConfigs();
  }

  /**
   * 根据类型获取配置
   */
  async getConfigsByType(type: string): Promise<AgentConfig[]> {
    const configs = await this.loadConfigs();
    return configs.filter(c => c.type === type);
  }

  /**
   * 更新配置
   */
  async updateAgentConfig(
    configId: string,
    input: UpdateAgentConfigInput
  ): Promise<AgentConfig | undefined> {
    const configs = await this.loadConfigs();
    const index = configs.findIndex(c => c.id === configId);

    if (index === -1) {
      return undefined;
    }

    const existingConfig = configs[index];

    // 创建更新后的配置
    const updatedConfig: AgentConfig = {
      ...existingConfig,
      name: input.name ?? existingConfig.name,
      type: input.type ?? existingConfig.type,
      command: input.command ?? existingConfig.command,
      args: input.args ?? existingConfig.args,
      env: input.env ?? existingConfig.env,
      cwd: input.cwd ?? existingConfig.cwd,
      description: input.description ?? existingConfig.description,
      endMarker: input.endMarker ?? existingConfig.endMarker,
      useEndOfMessageMarker: input.useEndOfMessageMarker ?? existingConfig.useEndOfMessageMarker,
      usePty: input.usePty ?? existingConfig.usePty,
      updatedAt: new Date()
    };

    // 验证
    const validation = AgentConfigUtils.validateConfig(updatedConfig);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    // 更新数组
    configs[index] = updatedConfig;

    // 保存到存储
    await this.storageService.save(StorageKeys.AGENTS, configs);

    return updatedConfig;
  }

  /**
   * 删除配置
   */
  async deleteAgentConfig(configId: string): Promise<boolean> {
    const configs = await this.loadConfigs();
    const index = configs.findIndex(c => c.id === configId);

    if (index === -1) {
      return false;
    }

    configs.splice(index, 1);
    await this.storageService.save(StorageKeys.AGENTS, configs);

    return true;
  }

  /**
   * 从存储加载所有配置
   */
  private async loadConfigs(): Promise<AgentConfig[]> {
    const configs = await this.storageService.load<AgentConfig[]>(StorageKeys.AGENTS);
    return configs || [];
  }

  /**
   * 保存单个配置到存储
   */
  private async saveConfig(config: AgentConfig): Promise<void> {
    const configs = await this.loadConfigs();
    configs.push(config);
    await this.storageService.save(StorageKeys.AGENTS, configs);
  }
}
