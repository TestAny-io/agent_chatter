/**
 * AgentDefaults - 各 Agent 的默认配置模板
 *
 * 提供 Claude Code, OpenAI Codex, Google Gemini 的默认配置
 */

import type { AgentDefinition } from '../registry/RegistryStorage.js';

export type AgentType = 'claude' | 'codex' | 'gemini';

/**
 * 获取指定 agent 类型的默认配置
 */
export function getDefaultAgentConfig(agentType: AgentType, command?: string): Omit<AgentDefinition, 'installedAt' | 'version' | 'lastVerified'> {
  switch (agentType) {
    case 'claude':
      return {
        name: 'claude',
        displayName: 'Claude Code',
        command: command || 'claude',
        args: ['--output-format=stream-json', '--verbose'],
        usePty: false
      };

    case 'codex':
      return {
        name: 'codex',
        displayName: 'OpenAI Codex',
        command: command || 'codex',
        args: ['exec', '--json', '--full-auto', '--skip-git-repo-check'],
        usePty: false
      };

    case 'gemini':
      return {
        name: 'gemini',
        displayName: 'Google Gemini CLI',
        command: command || 'gemini',
        args: ['--output-format', 'stream-json'],
        usePty: false
      };

    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

/**
 * 获取所有支持的 agent 类型
 */
export function getSupportedAgentTypes(): AgentType[] {
  return ['claude', 'codex', 'gemini'];
}

/**
 * 检查是否为支持的 agent 类型
 */
export function isSupportedAgentType(agentType: string): agentType is AgentType {
  return ['claude', 'codex', 'gemini'].includes(agentType);
}

/**
 * 获取 agent 类型的显示名称
 */
export function getAgentDisplayName(agentType: AgentType): string {
  const config = getDefaultAgentConfig(agentType);
  return config.displayName;
}

/**
 * 创建默认的 AgentDefinition（包含时间戳）
 */
export function createDefaultAgentDefinition(
  agentType: AgentType,
  command?: string,
  version?: string
): AgentDefinition {
  const baseConfig = getDefaultAgentConfig(agentType, command);
  return {
    ...baseConfig,
    version,
    installedAt: new Date().toISOString()
  };
}
