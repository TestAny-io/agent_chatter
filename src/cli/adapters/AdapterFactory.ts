/**
 * AdapterFactory - Factory for creating agent adapters
 *
 * Creates the appropriate adapter based on agent configuration.
 * Implements IAdapterFactory interface for Core abstraction.
 */

import type { IAgentAdapter } from '../../interfaces/IAgentAdapter.js';
import type { IAdapterFactory, AdapterFactoryFn } from '../../interfaces/IAdapterFactory.js';
import type { IExecutionEnvironment } from '../../interfaces/IExecutionEnvironment.js';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
import { OpenAICodexAdapter } from './OpenAICodexAdapter.js';
import { GenericShellAdapter } from './GenericShellAdapter.js';
import type { AgentConfig } from '../../models/AgentConfig.js';

/**
 * AdapterFactory implementing IAdapterFactory interface
 *
 * Manages adapter registration and creation with IExecutionEnvironment injection
 */
export class AdapterFactory implements IAdapterFactory {
  private factories = new Map<string, AdapterFactoryFn>();

  constructor(private executionEnv: IExecutionEnvironment) {
    // Register default adapters
    this.registerDefaultAdapters();
  }

  /**
   * Register default adapters for known agent types
   */
  private registerDefaultAdapters(): void {
    // Claude Code adapters
    this.register('claude', () => new ClaudeCodeAdapter(this.executionEnv, 'claude'));
    this.register('claude-code', () => new ClaudeCodeAdapter(this.executionEnv, 'claude'));

    // OpenAI Codex adapters
    this.register('codex', () => new OpenAICodexAdapter(this.executionEnv, 'codex'));
    this.register('openai-codex', () => new OpenAICodexAdapter(this.executionEnv, 'codex'));

    // Gemini adapters
    this.register('gemini', () => new GenericShellAdapter(this.executionEnv, {
      agentType: 'google-gemini',
      command: 'gemini',
      defaultArgs: []
    }));
    this.register('google-gemini', () => new GenericShellAdapter(this.executionEnv, {
      agentType: 'google-gemini',
      command: 'gemini',
      defaultArgs: []
    }));
  }

  /**
   * Register an adapter factory function
   */
  register(type: string, factory: AdapterFactoryFn): void {
    this.factories.set(type, factory);
  }

  /**
   * Create an adapter instance by type
   */
  create(type: string): IAgentAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      const available = this.getRegisteredTypes().join(', ') || 'none';
      throw new Error(`Unknown adapter type "${type}". Available types: ${available}`);
    }
    return factory();
  }

  /**
   * Check if an adapter type is registered
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  /**
   * Get all registered adapter types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Create an adapter based on agent configuration
   *
   * @param config - Agent configuration
   * @returns Appropriate adapter for the agent type
   */
  createAdapter(config: AgentConfig): IAgentAdapter {
    switch (config.type) {
      case 'claude-code':
        return new ClaudeCodeAdapter(this.executionEnv, config.command);

      case 'openai-codex':
        return new OpenAICodexAdapter(this.executionEnv, config.command);

      case 'google-gemini':
      case 'gemini':
        return new GenericShellAdapter(this.executionEnv, {
          agentType: 'google-gemini',
          command: config.command,
          defaultArgs: []
        });

      default:
        return new GenericShellAdapter(this.executionEnv, {
          agentType: config.type,
          command: config.command,
          defaultArgs: []
        });
    }
  }

  /**
   * Validate an agent configuration
   *
   * @param config - Agent configuration to validate
   * @returns true if valid and available, false otherwise
   */
  async validateAgentConfig(config: AgentConfig): Promise<boolean> {
    try {
      const adapter = this.createAdapter(config);
      return await adapter.validate();
    } catch {
      return false;
    }
  }
}
