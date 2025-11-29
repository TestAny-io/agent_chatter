/**
 * Agent Adapters - Interface Re-exports (Core Layer)
 *
 * LLD-04: Core only exports interfaces.
 * Implementations are in CLI layer (src/cli/adapters/).
 *
 * For implementations, import from:
 *   import { AdapterFactory, ClaudeCodeAdapter, ... } from '../cli/index.js';
 */

// Re-export interfaces from interfaces/ directory
export type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult, AgentExecutionMode } from '../interfaces/IAgentAdapter.js';
export type { IAdapterFactory, AdapterFactoryFn } from '../interfaces/IAdapterFactory.js';

// NOTE: Implementations are NOT exported from Core.
// Import from src/cli/ for concrete implementations.
