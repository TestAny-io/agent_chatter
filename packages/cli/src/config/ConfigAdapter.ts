/**
 * ConfigAdapter - 配置适配器
 *
 * @file src/cli/config/ConfigAdapter.ts
 * @layer CLI
 *
 * @remarks
 * 将旧版 CLIConfig 拆分为 CoreTeamConfig + UIPreferences。
 * 保持向后兼容性，用户配置文件格式无需更改。
 */

import type { CLIConfig, ConversationConfig } from '@testany/agent-chatter-core';
import type { CoreTeamConfig, CoreConversationConfig } from '@testany/agent-chatter-core';
import { type UIPreferences, DEFAULT_UI_PREFERENCES } from './UIPreferences.js';

/**
 * 配置适配器
 *
 * 将旧版 CLIConfig 拆分为 CoreTeamConfig + UIPreferences
 */
export class ConfigAdapter {
  /**
   * 拆分配置
   *
   * @param config - 旧版完整配置
   * @returns 拆分后的 Core 配置和 UI 偏好
   */
  static split(config: CLIConfig): {
    coreConfig: CoreTeamConfig;
    uiPrefs: UIPreferences;
  } {
    const conversation = config.conversation;

    // 提取 Core 配置
    const coreConfig: CoreTeamConfig = {
      schemaVersion: config.schemaVersion,
      agents: config.agents,
      team: config.team,
      maxRounds: config.maxRounds,
      conversation: this.extractCoreConversation(conversation),
    };

    // 提取 UI 偏好
    const uiPrefs: UIPreferences = this.extractUIPreferences(conversation);

    return { coreConfig, uiPrefs };
  }

  /**
   * 提取 Core 对话配置
   */
  private static extractCoreConversation(
    conversation?: ConversationConfig
  ): CoreConversationConfig | undefined {
    if (!conversation) {
      return undefined;
    }

    // 仅保留 Core 字段
    const { maxAgentResponseTime } = conversation;

    // 如果没有 Core 字段，返回 undefined
    if (maxAgentResponseTime === undefined) {
      return undefined;
    }

    return { maxAgentResponseTime };
  }

  /**
   * 提取 UI 偏好
   */
  private static extractUIPreferences(conversation?: ConversationConfig): UIPreferences {
    return {
      showThinkingTimer: conversation?.showThinkingTimer ?? DEFAULT_UI_PREFERENCES.showThinkingTimer,
      allowEscCancel: conversation?.allowEscCancel ?? DEFAULT_UI_PREFERENCES.allowEscCancel,
    };
  }

  /**
   * 合并配置（用于保存）
   *
   * @param coreConfig - Core 配置
   * @param uiPrefs - UI 偏好
   * @returns 合并后的旧版配置（用于保存到文件）
   */
  static merge(coreConfig: CoreTeamConfig, uiPrefs: UIPreferences): CLIConfig {
    return {
      schemaVersion: coreConfig.schemaVersion,
      agents: coreConfig.agents,
      team: coreConfig.team,
      maxRounds: coreConfig.maxRounds,
      conversation: {
        ...coreConfig.conversation,
        showThinkingTimer: uiPrefs.showThinkingTimer,
        allowEscCancel: uiPrefs.allowEscCancel,
      },
    };
  }
}

/**
 * 便捷函数：拆分配置
 */
export function splitConfig(config: CLIConfig) {
  return ConfigAdapter.split(config);
}

/**
 * 便捷函数：合并配置
 */
export function mergeConfig(coreConfig: CoreTeamConfig, uiPrefs: UIPreferences) {
  return ConfigAdapter.merge(coreConfig, uiPrefs);
}
