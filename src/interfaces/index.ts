/**
 * Interfaces - Core abstractions for dependency injection
 *
 * Exports all interface definitions for Core layer
 */

// Execution environment abstraction
export type {
  IExecutionEnvironment,
  IProcess,
  IPty,
  SpawnOptions,
  PtyOptions
} from './IExecutionEnvironment.js';

// Adapter interfaces
export type {
  IAgentAdapter,
  AgentSpawnConfig,
  AgentSpawnResult,
  AgentExecutionMode
} from './IAgentAdapter.js';

// Adapter factory
export type { IAdapterFactory, AdapterFactoryFn } from './IAdapterFactory.js';

// Logger interface
export type { ILogger } from './ILogger.js';
export { SilentLogger } from './ILogger.js';
