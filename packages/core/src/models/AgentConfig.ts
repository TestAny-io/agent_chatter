/**
 * AgentConfig - AI Agent 配置
 */
export interface AgentConfig {
  id: string;
  name: string;            // 配置名称，例如 "claude-code-default"
  type: string;            // Agent 类型，例如 "claude-code", "gemini", "openai-codex"
  command: string;         // 命令，例如 "claude"
  args: string[];          // 参数，例如 ["--no-interactive"]
  env?: Record<string, string>;  // 环境变量
  cwd?: string;           // 工作目录
  description?: string;   // 配置描述
  usePty?: boolean;       // 是否使用伪终端（用于交互式 CLI 工具如 Claude Code）

  // 元数据
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Agent 可用性测试结果
 */
export interface TestResult {
  available: boolean;
  error?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * AgentConfig 工具函数
 */
export class AgentConfigUtils {
  static generateId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static createConfig(
    name: string,
    type: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
    cwd?: string,
    description?: string,
  ): AgentConfig {
    const now = new Date();
    return {
      id: this.generateId(),
      name,
      type,
      command,
      args,
      env,
      cwd,
      description,
      createdAt: now,
      updatedAt: now
    };
  }

  static validateConfig(config: AgentConfig): ValidationResult {
    const errors: string[] = [];

    if (!config.name || config.name.trim().length === 0) {
      errors.push('配置名称不能为空');
    }

    if (!config.type || config.type.trim().length === 0) {
      errors.push('Agent 类型不能为空');
    }

    if (!config.command || config.command.trim().length === 0) {
      errors.push('命令不能为空');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
