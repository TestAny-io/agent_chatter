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
import type { ILogger } from '../interfaces/ILogger.js';
import { SilentLogger } from '../interfaces/ILogger.js';
import type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  ContextManagerOptions,
  ContextSnapshot,
  InternalContextMessage,
  PromptContextMessage,
  RouteContextOptions,
  RouteContextResult,
} from './types.js';
import {
  DEFAULT_CONTEXT_WINDOW_SIZE,
  DEFAULT_MAX_BYTES,
  MAX_TEAM_TASK_BYTES,
  DEFAULT_MAX_SIBLINGS,
  DEFAULT_SIBLING_CONTENT_LENGTH,
  DEFAULT_FORCE_PARENT_REINSERTION,
} from './types.js';
import type { RoutingItem } from '../models/RoutingItem.js';

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
  private readonly logger: ILogger;
  private nextMessageId: number = 1;

  // v3 configuration
  private readonly defaultMaxSiblings: number;
  private readonly defaultForceParentReinsertion: boolean;
  private readonly siblingContentMaxLength: number;

  constructor(options?: ContextManagerOptions) {
    this.contextWindowSize = options?.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.onMessageAdded = options?.onMessageAdded;
    this.onTeamTaskChanged = options?.onTeamTaskChanged;
    this.logger = options?.logger ?? new SilentLogger();

    // v3 configuration
    this.defaultMaxSiblings = options?.defaultMaxSiblings ?? DEFAULT_MAX_SIBLINGS;
    this.defaultForceParentReinsertion = options?.defaultForceParentReinsertion ?? DEFAULT_FORCE_PARENT_REINSERTION;
    this.siblingContentMaxLength = options?.siblingContentMaxLength ?? DEFAULT_SIBLING_CONTENT_LENGTH;

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
      this.logger.warn(
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
  // v3: Route-based Context Retrieval
  // --------------------------------------------------------------------------

  /**
   * v3: Get context based on a routing item
   *
   * Uses parentMessageId from the route to correctly position the context window,
   * ensuring the AI responds to the correct parent message.
   *
   * @param agentId - Target agent ID
   * @param agentType - Agent type (for assembler selection)
   * @param route - Routing item containing parentMessageId and intent
   * @param options - Context options
   * @returns Route context result with parent and sibling context
   */
  getContextForRoute(
    agentId: string,
    agentType: AgentType,
    route: RoutingItem,
    options?: RouteContextOptions
  ): RouteContextResult {
    const {
      windowSizeOverride,
      systemInstruction,
      instructionFileText,
      maxSiblings = this.defaultMaxSiblings,
      forceParentReinsertion = this.defaultForceParentReinsertion,
    } = options ?? {};

    const windowSize = windowSizeOverride ?? this.contextWindowSize;

    // Step 1: Find parent message
    const parentMsg = this.findMessageById(route.parentMessageId);
    if (!parentMsg) {
      // Parent message not found (abnormal), fall back to old logic
      this.logger.warn(
        `[ContextManager] Parent message ${route.parentMessageId} not found, falling back to latest`
      );
      const fallback = this.getContextForAgent(agentId, agentType, options);
      return {
        ...fallback,
        siblingContext: [],
        meta: {
          parentMessageId: undefined,
          intent: route.intent,
          targetMemberId: route.targetMemberId,
          siblingCount: 0,
          siblingTotalCount: 0,
          truncatedSiblings: false,
        },
      };
    }

    // Step 2: Build context window
    const parentIndex = this.messages.indexOf(parentMsg);
    const contextEndIndex = parentIndex; // Does not include parent message itself
    const contextStartIndex = Math.max(0, contextEndIndex - windowSize);
    const contextMessages = this.messages.slice(contextStartIndex, contextEndIndex);

    // Step 3: Check if parent message is in window
    const parentInWindow = contextMessages.some(m => m.id === parentMsg.id);

    // Step 4: Collect sibling messages (completed messages with same parent)
    const { siblings, totalCount, truncated } = this.collectSiblings(
      route.parentMessageId,
      maxSiblings
    );

    // Step 5: Convert to internal format
    const internalContext: InternalContextMessage[] = contextMessages.map(msg => ({
      from: msg.speaker.name,
      to: this.formatAddressees(msg.routing?.resolvedAddressees?.map(a => a.identifier)),
      content: stripAllMarkers(msg.content),
      messageId: msg.id,
    }));

    // Step 6: Deduplication
    const deduplicatedContext = this.deduplicateContextForRoute(
      internalContext,
      parentMsg,
      route.targetMemberId
    );

    // Step 7: Parent message reinsertion
    let parentContext: PromptContextMessage | undefined;
    if (forceParentReinsertion && !parentInWindow) {
      parentContext = {
        from: parentMsg.speaker.name,
        to: this.formatAddressees(parentMsg.routing?.resolvedAddressees?.map(a => a.identifier)),
        content: stripAllMarkers(parentMsg.content),
      };
    }

    // Step 8: Format sibling context
    const siblingContext: PromptContextMessage[] = siblings.map(msg =>
      this.formatSiblingEntry(msg)
    );

    // Step 9: Convert to output format
    const outputContext: PromptContextMessage[] = deduplicatedContext.map(msg => ({
      from: msg.from,
      to: msg.to,
      content: msg.content,
    }));

    return {
      contextMessages: outputContext,
      currentMessage: stripAllMarkers(parentMsg.content),
      teamTask: this.teamTask,
      systemInstruction,
      instructionFileText,
      maxBytes: this.maxBytes,
      parentContext,
      siblingContext,
      routeMeta: {
        parentMessageId: route.parentMessageId,
        intent: route.intent,
      },
      meta: {
        parentMessageId: route.parentMessageId,
        intent: route.intent,
        targetMemberId: route.targetMemberId,
        siblingCount: siblings.length,
        siblingTotalCount: totalCount,
        truncatedSiblings: truncated,
      },
    };
  }

  /**
   * Find message by ID
   */
  private findMessageById(messageId: string): ConversationMessage | undefined {
    return this.messages.find(m => m.id === messageId);
  }

  /**
   * Collect sibling messages (completed messages with same parent)
   *
   * @param parentMessageId - Parent message ID
   * @param maxCount - Maximum number of siblings
   * @returns { siblings, totalCount, truncated }
   */
  private collectSiblings(
    parentMessageId: string,
    maxCount: number
  ): { siblings: ConversationMessage[]; totalCount: number; truncated: boolean } {
    // Step 1: Collect all siblings (no truncation)
    const allSiblings: ConversationMessage[] = [];

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.routing?.parentMessageId === parentMessageId) {
        allSiblings.push(msg);
      }
    }

    const totalCount = allSiblings.length;

    // Step 2: Truncate based on maxCount
    const siblings = allSiblings.slice(0, maxCount);
    const truncated = totalCount > maxCount;

    return { siblings, totalCount, truncated };
  }

  /**
   * Summarize sibling message content
   *
   * Strategy:
   * - Keep speaker name (from)
   * - Keep intent marker (if available)
   * - Truncate to siblingContentMaxLength chars with ellipsis
   * - Remove code blocks, keep text description
   */
  private summarizeSiblingContent(msg: ConversationMessage): string {
    let stripped = stripAllMarkers(msg.content);

    // Remove code blocks
    stripped = stripped.replace(/```[\s\S]*?```/g, '[code block omitted]');

    // Truncate content
    if (stripped.length > this.siblingContentMaxLength) {
      stripped = stripped.slice(0, this.siblingContentMaxLength) + '...';
    }

    return stripped;
  }

  /**
   * Format sibling context entry
   *
   * Keeps speaker, intent, and other key information
   */
  private formatSiblingEntry(msg: ConversationMessage): PromptContextMessage {
    const content = this.summarizeSiblingContent(msg);
    const intent = msg.routing?.intent;

    // Format: "{speaker} [{intent}]"
    const intentSuffix = intent ? ` [${intent}]` : '';

    return {
      from: msg.speaker.name + intentSuffix,
      to: this.formatAddressees(msg.routing?.resolvedAddressees?.map(a => a.identifier)),
      content,
    };
  }

  /**
   * Deduplicate context for route-based retrieval
   *
   * Deduplication rules (per HLD):
   * 1. Remove parent message itself (avoid [MESSAGE] and [CONTEXT] duplication)
   * 2. Remove target member's most recent completed message (avoid self-repetition)
   * 3. Keep other necessary context
   */
  private deduplicateContextForRoute(
    contextMessages: InternalContextMessage[],
    parentMessage: ConversationMessage,
    targetMemberId: string
  ): InternalContextMessage[] {
    // Step 1: Remove parent message itself
    let filtered = contextMessages.filter(msg => msg.messageId !== parentMessage.id);

    // Step 2: Find and remove target member's most recent message
    const targetMemberLastMsgId = this.findTargetMemberLastMessage(
      filtered,
      targetMemberId
    );

    if (targetMemberLastMsgId) {
      filtered = filtered.filter(msg => msg.messageId !== targetMemberLastMsgId);
    }

    return filtered;
  }

  /**
   * Find target member's last message in context
   */
  private findTargetMemberLastMessage(
    contextMessages: InternalContextMessage[],
    targetMemberId: string
  ): string | null {
    // Iterate from end to find first message belonging to target member
    for (let i = contextMessages.length - 1; i >= 0; i--) {
      const ctxMsg = contextMessages[i];
      const originalMsg = this.messages.find(m => m.id === ctxMsg.messageId);

      if (originalMsg && originalMsg.speaker.id === targetMemberId) {
        return ctxMsg.messageId;
      }
    }

    return null;
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
      this.logger.warn(
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
