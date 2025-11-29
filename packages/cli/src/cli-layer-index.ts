/**
 * CLI Layer - Concrete Implementations
 *
 * This module exports all CLI layer implementations.
 * These are the concrete implementations of Core interfaces.
 *
 * LLD-04: Core only depends on interfaces; CLI provides implementations.
 */

// Execution environment implementation
export { LocalExecutionEnvironment } from './LocalExecutionEnvironment.js';

// Adapter implementations
export {
  ClaudeCodeAdapter,
  OpenAICodexAdapter,
  GenericShellAdapter,
  AdapterFactory
} from './adapters/index.js';

export type { GenericShellAdapterConfig } from './adapters/index.js';

// Config utilities (LLD-05)
export {
  ConfigAdapter,
  splitConfig,
  mergeConfig,
  DEFAULT_UI_PREFERENCES
} from './config/index.js';

export type { UIPreferences } from './config/index.js';
