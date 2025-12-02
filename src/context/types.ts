/**
 * Context Manager Types
 *
 * This file defines all types used by the ContextManager module.
 *
 * v3 extension: Added parentContext, siblingContext, routeMeta for causal routing
 * @see docs/design/route_rule/V3/detail/04-prompt-assembly.md
 */

import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { RoutingIntent } from '../models/RoutingItem.js';

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
 *
 * v3 extension: Added parentContext, siblingContext, routeMeta for causal routing
 */
export interface AssemblerInput {
  // === Existing fields (unchanged) ===
  contextMessages: PromptContextMessage[];
  currentMessage: string;
  teamTask: string | null;
  systemInstruction?: string | string[];
  instructionFileText?: string;
  maxBytes: number;

  // === v3 New Fields (optional for backward compatibility) ===

  /**
   * Parent message context
   * Used for forced reinsertion when parent message is pushed out of window
   */
  parentContext?: PromptContextMessage;

  /**
   * Sibling context list
   * Summaries of completed messages with same parent
   */
  siblingContext?: PromptContextMessage[];

  /**
   * Routing metadata
   */
  routeMeta?: {
    parentMessageId?: string;
    intent?: RoutingIntent;
  };
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
 *
 * v3 extension: Added sibling and parent reinsertion options
 */
export interface ContextManagerOptions {
  // === Existing fields ===

  /** Context window size (default 10 messages) */
  contextWindowSize?: number;

  /** Maximum bytes budget (default 768KB) */
  maxBytes?: number;

  /** Callback hook after message is added */
  onMessageAdded?: (msg: ConversationMessage) => void;

  /** Callback hook after teamTask changes */
  onTeamTaskChanged?: (task: string | null) => void;

  /** Logger interface for logging (defaults to silent) */
  logger?: ILogger;

  // === v3 New Fields ===

  /** Default max sibling context count (default 5) */
  defaultMaxSiblings?: number;

  /** Whether to force parent message reinsertion (default true) */
  defaultForceParentReinsertion?: boolean;

  /** Max sibling content summary length in chars (default 200) */
  siblingContentMaxLength?: number;

  /** Max bytes for parent reinsertion (default 1024) */
  parentReinsertionMaxBytes?: number;
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

// v3 constants
export const DEFAULT_MAX_SIBLINGS = 5;
export const DEFAULT_SIBLING_CONTENT_LENGTH = 200;
export const DEFAULT_PARENT_REINSERTION_MAX_BYTES = 1024;
export const DEFAULT_FORCE_PARENT_REINSERTION = true;

/**
 * v3: Options for route-based context retrieval
 */
export interface RouteContextOptions {
  /** Override default window size */
  windowSizeOverride?: number;

  /** System instruction (string or array of strings) */
  systemInstruction?: string | string[];

  /** Instruction file content */
  instructionFileText?: string;

  /** Max sibling context count (default 5) */
  maxSiblings?: number;

  /** Force parent message reinsertion (default true) */
  forceParentReinsertion?: boolean;
}

/**
 * v3: Result from route-based context retrieval
 */
export interface RouteContextResult extends AssemblerInput {
  /**
   * Parent message (required unless first message)
   */
  parentMessage?: PromptContextMessage;

  /**
   * Sibling context (completed messages with same parent)
   * Sorted by time descending, max maxSiblings entries
   */
  siblingContext: PromptContextMessage[];

  /**
   * Metadata for debugging and SYSTEM annotations
   */
  meta: {
    parentMessageId: string | undefined;
    intent: RoutingIntent | undefined;
    targetMemberId: string;
    /** Actual sibling count (after truncation) */
    siblingCount: number;
    /** Total sibling count (before truncation) */
    siblingTotalCount: number;
    /** Whether truncation occurred (siblingTotalCount > maxSiblings) */
    truncatedSiblings: boolean;
  };
}
