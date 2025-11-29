/**
 * CLI Adapter Implementations
 *
 * This module exports concrete adapter implementations for the CLI layer.
 * Core only depends on interfaces (IAgentAdapter, IAdapterFactory).
 */

// Export adapter implementations
export { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
export { OpenAICodexAdapter } from './OpenAICodexAdapter.js';
export { GenericShellAdapter } from './GenericShellAdapter.js';
export type { GenericShellAdapterConfig } from './GenericShellAdapter.js';
export { AdapterFactory } from './AdapterFactory.js';
