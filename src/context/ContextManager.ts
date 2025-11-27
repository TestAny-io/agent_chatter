/**
 * ContextManager
 *
 * Single source of truth for conversation context management.
 * Handles message storage, team task, context preparation, and deduplication.
 */

import { Buffer } from 'buffer';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { IContextProvider } from './IContextProvider.js';
import type { IContextAssembler } from './IContextAssembler.js';
import type { IOutput } from '../outputs/IOutput.js';
import { SilentOutput } from '../outputs/IOutput.js';
import type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  ContextManagerOptions,
  ContextSnapshot,
  InternalContextMessage,
  PromptContextMessage,
} from './types.js';
import {
  DEFAULT_CONTEXT_WINDOW_SIZE,
  DEFAULT_MAX_BYTES,
  MAX_TEAM_TASK_BYTES,
} from './types.js';

// Import assemblers (will be implemented next)
import { ClaudeContextAssembler } from './assemblers/ClaudeContextAssembler.js';
import { CodexContextAssembler } from './assemblers/CodexContextAssembler.js';
import { GeminiContextAssembler } from './assemblers/GeminiContextAssembler.js';
import { PlainTextAssembler } from './assemblers/PlainTextAssembler.js';

// ============================================================================
// Internal Pure Functions for Marker Stripping
// ============================================================================

const FROM_PATTERN = /\[FROM:[^\]]+\]/gi;
const NEXT_PATTERN = /\[NEXT:[^\]]*\]/gi;
// Match both forms: [TEAM_TASK: xxx] (inline) and [TEAM_TASK]\n... (block)
const TEAM_TASK_INLINE_PATTERN = /\[TEAM_TASK:[^\]]*\]/gi;
const TEAM_TASK_BLOCK_PATTERN = /\[TEAM_TASK\][\s\S]*?(?=\n\n\[|$)/gi;

/**
 * Strips all routing markers from a message.
 */
function stripAllMarkers(message: string): string {
  let result = message;
  result = result.replace(FROM_PATTERN, '');
  result = result.replace(TEAM_TASK_INLINE_PATTERN, '');
  result = result.replace(TEAM_TASK_BLOCK_PATTERN, '');
  result = result.replace(NEXT_PATTERN, '');
  return cleanupWhitespace(result);
}

/**
 * Cleans up whitespace while preserving line structure.
 */
function cleanupWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/\s{2,}/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}

/**
 * Truncates a string to fit within a byte limit.
 */
function truncateToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) {
    return str;
  }

  // Binary search for the right truncation point
  let low = 0;
  let high = str.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return str.slice(0, low);
}

/**
 * Normalizes agent type to canonical form.
 */
function normalizeAgentType(type: string): AgentType {
  const mapping: Record<string, AgentType> = {
    'claude': 'claude-code',
    'claude-code': 'claude-code',
    'codex': 'openai-codex',
    'openai-codex': 'openai-codex',
    'gemini': 'google-gemini',
    'google-gemini': 'google-gemini',
  };
  return mapping[type.toLowerCase()] ?? type;
}

// ============================================================================
// ContextManager Class
// ============================================================================

export class ContextManager implements IContextProvider {
  private messages: ConversationMessage[] = [];
  private teamTask: string | null = null;
  private readonly contextWindowSize: number;
  private readonly maxBytes: number;
  private readonly assemblers: Map<AgentType, IContextAssembler>;
  private readonly onMessageAdded?: (msg: ConversationMessage) => void;
  private readonly onTeamTaskChanged?: (task: string | null) => void;
  private readonly output: IOutput;
  private nextMessageId: number = 1;

  constructor(options?: ContextManagerOptions) {
    this.contextWindowSize = options?.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.onMessageAdded = options?.onMessageAdded;
    this.onTeamTaskChanged = options?.onTeamTaskChanged;
    this.output = options?.output ?? new SilentOutput();

    // Initialize assembler map
    this.assemblers = new Map();
    this.assemblers.set('claude-code', new ClaudeContextAssembler());
    this.assemblers.set('openai-codex', new CodexContextAssembler());
    this.assemblers.set('google-gemini', new GeminiContextAssembler());
  }

  // --------------------------------------------------------------------------
  // Message Management
  // --------------------------------------------------------------------------

  addMessage(msg: Omit<ConversationMessage, 'id'>): ConversationMessage {
    // Validate message
    if (!msg) {
      throw new TypeError('Message cannot be null or undefined');
    }
    if (typeof msg.content !== 'string') {
      throw new TypeError('Message content must be a string');
    }
    if (!msg.speaker) {
      throw new TypeError('Message speaker is required');
    }
    if (!msg.speaker.id) {
      throw new TypeError('Message speaker.id is required');
    }

    // Generate ID and create full message
    const id = `msg-${this.nextMessageId++}`;
    const fullMsg: ConversationMessage = { id, ...msg } as ConversationMessage;

    // Store message
    this.messages.push(fullMsg);

    // Call hook if provided
    this.onMessageAdded?.(fullMsg);

    return fullMsg;
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  getLatestMessage(): ConversationMessage | null {
    return this.messages.length > 0
      ? this.messages[this.messages.length - 1]
      : null;
  }

  // --------------------------------------------------------------------------
  // TeamTask Management
  // --------------------------------------------------------------------------

  setTeamTask(task: string): void {
    const bytes = Buffer.byteLength(task, 'utf8');

    if (bytes > MAX_TEAM_TASK_BYTES) {
      // Truncate and warn
      const truncated = truncateToBytes(task, MAX_TEAM_TASK_BYTES);
      const truncatedBytes = Buffer.byteLength(truncated, 'utf8');
      this.output.warn(
        `[ContextManager] TeamTask exceeded 5KB limit (${bytes} bytes), truncated to ${truncatedBytes} bytes`
      );
      this.teamTask = truncated;
    } else {
      this.teamTask = task;
    }

    this.onTeamTaskChanged?.(this.teamTask);
  }

  getTeamTask(): string | null {
    return this.teamTask;
  }

  // --------------------------------------------------------------------------
  // Context Preparation
  // --------------------------------------------------------------------------

  getContextForAgent(
    agentId: string,
    agentType: AgentType,
    options?: {
      windowSizeOverride?: number;
      systemInstruction?: string;
      instructionFileText?: string;
    }
  ): AssemblerInput {
    // Get latest message
    const latestMsg = this.getLatestMessage();

    // Empty state
    if (!latestMsg) {
      return {
        contextMessages: [],
        currentMessage: '',
        teamTask: this.teamTask,
        systemInstruction: options?.systemInstruction,
        instructionFileText: options?.instructionFileText,
        maxBytes: this.maxBytes,
      };
    }

    // Normalize agent type (not used in this method but kept for consistency)
    // const normalizedType = normalizeAgentType(agentType);

    // Determine window size
    const windowSize = options?.windowSizeOverride ?? this.contextWindowSize;

    // Extract context messages (all except last)
    const allExceptLast = this.messages.slice(0, -1);
    const contextMessages = allExceptLast.slice(-windowSize);

    // Convert to internal format with marker stripping
    const internalContext: InternalContextMessage[] = contextMessages.map(msg => ({
      from: msg.speaker.name,
      to: this.formatAddressees(msg.routing?.resolvedAddressees?.map(a => a.identifier)),
      content: stripAllMarkers(msg.content),
      messageId: msg.id,
    }));

    // Strip markers from current message
    const strippedCurrentMsg = stripAllMarkers(latestMsg.content);

    // Execute deduplication (AI->AI only)
    const deduplicatedContext = this.deduplicateContext(internalContext, latestMsg);

    // Convert to output format (remove messageId)
    const outputContext: PromptContextMessage[] = deduplicatedContext.map(msg => ({
      from: msg.from,
      to: msg.to,
      content: msg.content,
    }));

    return {
      contextMessages: outputContext,
      currentMessage: strippedCurrentMsg,
      teamTask: this.teamTask,
      systemInstruction: options?.systemInstruction,
      instructionFileText: options?.instructionFileText,
      maxBytes: this.maxBytes,
    };
  }

  /**
   * Formats addressees array to string.
   */
  private formatAddressees(addressees?: string[]): string {
    if (!addressees || addressees.length === 0) {
      return 'all';
    }
    if (addressees.length === 1) {
      return addressees[0];
    }
    return addressees.join(', ');
  }

  /**
   * Deduplicates context for AI->AI routing.
   */
  private deduplicateContext(
    contextMessages: InternalContextMessage[],
    currentMessage: ConversationMessage
  ): InternalContextMessage[] {
    // Only deduplicate for AI senders
    if (currentMessage.speaker.type !== 'ai') {
      return contextMessages;
    }

    // Check if context is empty
    if (contextMessages.length === 0) {
      return contextMessages;
    }

    // Get last context message
    const last = contextMessages[contextMessages.length - 1];

    // Priority: match by ID
    if (last.messageId === currentMessage.id) {
      return contextMessages.slice(0, -1);
    }

    // Fallback: match by speaker + content
    const currentContent = stripAllMarkers(currentMessage.content);
    if (last.from === currentMessage.speaker.name && last.content === currentContent) {
      return contextMessages.slice(0, -1);
    }

    // No match, return unchanged
    return contextMessages;
  }

  // --------------------------------------------------------------------------
  // Prompt Assembly
  // --------------------------------------------------------------------------

  /**
   * Assembles the prompt using the appropriate assembler.
   */
  assemblePrompt(agentType: AgentType, input: AssemblerInput): AssemblerOutput {
    // Normalize agent type
    const normalizedType = normalizeAgentType(agentType);

    // Find assembler
    let assembler = this.assemblers.get(normalizedType);

    // Fallback to PlainTextAssembler
    if (!assembler) {
      this.output.warn(
        `[ContextManager] Unknown agentType "${agentType}" (normalized: "${normalizedType}"), using PlainTextAssembler`
      );
      assembler = new PlainTextAssembler();
    }

    return assembler.assemble(input);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  clear(): void {
    this.messages = [];
    this.teamTask = null;
    this.nextMessageId = 1;
    this.onTeamTaskChanged?.(null);
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  exportSnapshot(): ContextSnapshot {
    return {
      messages: [...this.messages],
      teamTask: this.teamTask,
      timestamp: Date.now(),
      version: 1,
    };
  }

  importSnapshot(snapshot: ContextSnapshot): void {
    // Validate snapshot format
    if (!snapshot || snapshot.version !== 1) {
      throw new Error('Invalid snapshot format');
    }

    // Restore messages
    this.messages = [...snapshot.messages];

    // Restore team task
    this.teamTask = snapshot.teamTask;

    // Recalculate next message ID
    this.nextMessageId = this.calculateNextMessageId();

    // Call hook
    this.onTeamTaskChanged?.(this.teamTask);
  }

  /**
   * Calculates the next message ID based on existing messages.
   */
  private calculateNextMessageId(): number {
    if (this.messages.length === 0) {
      return 1;
    }

    const maxId = this.messages
      .map(m => {
        const match = m.id.match(/^msg-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .reduce((max, id) => Math.max(max, id), 0);

    return maxId + 1;
  }
}
