/**
 * Agent Adapters - Unified interface for different AI agent CLIs
 *
 * Exports all adapter interfaces and implementations
 */

export type { IAgentAdapter, AgentSpawnConfig, AgentSpawnResult } from './IAgentAdapter.js';
export { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
export { OpenAICodexAdapter } from './OpenAICodexAdapter.js';
export { GenericShellAdapter } from './GenericShellAdapter.js';
export type { GenericShellAdapterConfig } from './GenericShellAdapter.js';
export { AdapterFactory } from './AdapterFactory.js';
