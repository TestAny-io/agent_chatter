/**
 * IAdapterFactory - Adapter factory interface
 *
 * @file src/interfaces/IAdapterFactory.ts
 *
 * Core uses this interface to obtain Agent adapters
 * Concrete adapter registration happens in CLI or other UI packages
 */

import type { IAgentAdapter } from './IAgentAdapter.js';
import type { AgentConfig } from '../models/AgentConfig.js';

/**
 * Adapter factory interface
 *
 * Core uses this interface to obtain Agent adapters
 * Concrete adapter registration happens in CLI or other UI packages
 */
export interface IAdapterFactory {
  /**
   * Create adapter instance by type string
   *
   * @param type - Adapter type (e.g., 'claude', 'codex', 'gemini')
   * @returns Adapter instance
   * @throws If type is not registered
   */
  create(type: string): IAgentAdapter;

  /**
   * Create adapter based on agent configuration
   *
   * @param config - Agent configuration
   * @returns Appropriate adapter for the agent type
   */
  createAdapter(config: AgentConfig): IAgentAdapter;

  /**
   * Register adapter factory function
   *
   * @param type - Adapter type
   * @param factory - Factory function
   */
  register(type: string, factory: AdapterFactoryFn): void;

  /**
   * Check if adapter is registered
   */
  has(type: string): boolean;

  /**
   * Get all registered adapter types
   */
  getRegisteredTypes(): string[];
}

/**
 * Adapter factory function type
 */
export type AdapterFactoryFn = () => IAgentAdapter;
