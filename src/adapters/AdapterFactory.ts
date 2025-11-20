/**
 * AdapterFactory - Factory for creating agent adapters
 *
 * Creates the appropriate adapter based on agent configuration
 */

import type { IAgentAdapter } from './IAgentAdapter.js';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
import { OpenAICodexAdapter } from './OpenAICodexAdapter.js';
import { GenericShellAdapter } from './GenericShellAdapter.js';
import type { AgentConfig } from '../models/AgentConfig.js';

export class AdapterFactory {
  /**
   * Create an adapter based on agent configuration
   *
   * @param config - Agent configuration
   * @returns Appropriate adapter for the agent type
   */
  static createAdapter(config: AgentConfig): IAgentAdapter {
    switch (config.type) {
      case 'claude-code':
        return new ClaudeCodeAdapter(config.command);

      case 'openai-codex':
        return new OpenAICodexAdapter(config.command);

      case 'google-gemini':
      case 'gemini':
        return new GenericShellAdapter({
          agentType: 'google-gemini',
          command: config.command,
          defaultArgs: config.args
        });

      default:
        // For unknown types, use GenericShellAdapter
        return new GenericShellAdapter({
          agentType: config.type,
          command: config.command,
          defaultArgs: config.args
        });
    }
  }

  /**
   * Validate an agent configuration by checking if the adapter can be created
   * and the command is available
   *
   * @param config - Agent configuration to validate
   * @returns true if valid and available, false otherwise
   */
  static async validateAgentConfig(config: AgentConfig): Promise<boolean> {
    try {
      const adapter = AdapterFactory.createAdapter(config);
      return await adapter.validate();
    } catch {
      return false;
    }
  }
}
