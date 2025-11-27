/**
 * Context Manager Types
 *
 * This file defines all types used by the ContextManager module.
 */

import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { IOutput } from '../outputs/IOutput.js';

/**
 * Supported agent types for context assembly
 */
export type AgentType = 'claude-code' | 'openai-codex' | 'google-gemini' | string;

/**
 * Internal context message type (includes messageId for deduplication)
 */
export interface InternalContextMessage {
  from: string;
  to: string;
  content: string;
  messageId: string;
}

/**
 * Output context message type for assemblers (no messageId)
 */
export interface PromptContextMessage {
  from: string;
  to?: string;
  content: string;
}

/**
 * Input for context assemblers
 */
export interface AssemblerInput {
  contextMessages: PromptContextMessage[];
  currentMessage: string;
  teamTask: string | null;
  systemInstruction?: string;
  instructionFileText?: string;
  maxBytes: number;
}

/**
 * Output from context assemblers
 */
export interface AssemblerOutput {
  prompt: string;
  systemFlag?: string;
}

/**
 * ContextManager configuration options
 */
export interface ContextManagerOptions {
  /** Context window size (default 5 messages) */
  contextWindowSize?: number;

  /** Maximum bytes budget (default 768KB) */
  maxBytes?: number;

  /** Callback hook after message is added */
  onMessageAdded?: (msg: ConversationMessage) => void;

  /** Callback hook after teamTask changes */
  onTeamTaskChanged?: (task: string | null) => void;

  /** Output interface for logging (defaults to silent) */
  output?: IOutput;
}

/**
 * ContextManager state snapshot (for persistence)
 */
export interface ContextSnapshot {
  messages: ConversationMessage[];
  teamTask: string | null;
  timestamp: number;
  version: 1;
}

/**
 * Constants
 */
export const DEFAULT_CONTEXT_WINDOW_SIZE = 10;
export const DEFAULT_MAX_BYTES = 768 * 1024; // 768KB
export const MAX_TEAM_TASK_BYTES = 5 * 1024; // 5KB
