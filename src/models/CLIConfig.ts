/**
 * CLIConfig - CLI 配置类型定义
 *
 * 从 ConversationStarter 迁移，作为独立的配置模型
 */

export interface AgentDefinition {
  name: string;
  command?: string; // Optional in schema 1.1 when referencing registry agent
  args?: string[];
  usePty?: boolean;
}

export interface RoleDefinitionConfig {
  name: string;
  displayName?: string;
  description?: string;
}

export interface TeamMemberConfig {
  displayName: string;
  name: string;
  displayRole?: string;
  role: string;
  type: 'ai' | 'human';
  agentType?: string;
  themeColor?: string;
  roleDir: string;
  instructionFile?: string;
  env?: Record<string, string>;
  systemInstruction?: string; // Schema 1.2+
}

export interface TeamConfig {
  name: string;
  displayName?: string;
  description: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinitionConfig[];
  members: TeamMemberConfig[];
}

export interface ConversationConfig {
  maxAgentResponseTime?: number;  // Maximum timeout for agent response in ms (default: 1800000 = 30 minutes)
  showThinkingTimer?: boolean;     // Show timer when agent is thinking in REPL (default: true)
  allowEscCancel?: boolean;         // Allow ESC key to cancel agent execution in REPL (default: true)
}

export interface CLIConfig {
  schemaVersion?: string;
  agents?: AgentDefinition[]; // Optional in schema 1.1+, agents loaded from global registry
  team: TeamConfig;
  maxRounds?: number;
  conversation?: ConversationConfig;  // Conversation-level configuration
}
