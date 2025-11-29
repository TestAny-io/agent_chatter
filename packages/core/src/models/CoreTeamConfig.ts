/**
 * CoreTeamConfig - Core 层团队配置
 *
 * @file src/models/CoreTeamConfig.ts
 * @layer Core
 *
 * @remarks
 * 仅包含业务逻辑相关字段，不包含任何 UI 偏好。
 * UI 偏好字段（如 showThinkingTimer、allowEscCancel）在 CLI 层的 UIPreferences 中定义。
 */

import type { TeamConfig, AgentDefinition } from './CLIConfig.js';

/**
 * Core 对话配置
 * 仅包含业务逻辑字段
 */
export interface CoreConversationConfig {
  /** Agent 响应超时时间（毫秒） */
  maxAgentResponseTime?: number;
}

/**
 * Core 层团队配置
 *
 * @remarks
 * - 与 CLIConfig 的 Core 字段完全兼容
 * - 不包含 UI 偏好字段（showThinkingTimer、allowEscCancel）
 * - 用于 initializeServices 等 Core API
 */
export interface CoreTeamConfig {
  /** 配置 schema 版本 */
  schemaVersion?: string;

  /** Agent 定义列表 */
  agents?: AgentDefinition[];

  /** 团队配置 */
  team: TeamConfig;

  /** 最大对话轮次 */
  maxRounds?: number;

  /** 对话配置（仅 Core 字段） */
  conversation?: CoreConversationConfig;
}
