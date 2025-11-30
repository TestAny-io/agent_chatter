/**
 * Context Module Public Exports
 *
 * This module provides context management for multi-agent conversations.
 */

// Main class
export { ContextManager } from './ContextManager.js';

// Interfaces
export type { IContextProvider } from './IContextProvider.js';
export type { IContextAssembler } from './IContextAssembler.js';

// Types
export type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  ContextManagerOptions,
  ContextSnapshot,
  InternalContextMessage,
  PromptContextMessage,
} from './types.js';

// Constants
export {
  DEFAULT_CONTEXT_WINDOW_SIZE,
  DEFAULT_MAX_BYTES,
  MAX_TEAM_TASK_BYTES,
} from './types.js';

// Assemblers
export { ClaudeContextAssembler } from './assemblers/ClaudeContextAssembler.js';
export { CodexContextAssembler } from './assemblers/CodexContextAssembler.js';
export { GeminiContextAssembler } from './assemblers/GeminiContextAssembler.js';
export { PlainTextAssembler } from './assemblers/PlainTextAssembler.js';
