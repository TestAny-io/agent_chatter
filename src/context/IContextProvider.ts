/**
 * IContextProvider Interface
 *
 * Defines the contract for the ContextManager.
 */

import type { ConversationMessage } from '../models/ConversationMessage.js';
import type {
  AgentType,
  AssemblerInput,
  ContextSnapshot,
  PromptContextMessage,
} from './types.js';

/**
 * Interface for the context provider (ContextManager).
 */
export interface IContextProvider {
  /**
   * Adds a new message to the context store.
   *
   * @param msg - Message without ID (ID will be generated)
   * @returns The complete message with generated ID
   */
  addMessage(msg: Omit<ConversationMessage, 'id'>): ConversationMessage;

  /**
   * Returns all stored messages.
   */
  getMessages(): ConversationMessage[];

  /**
   * Returns the latest message, or null if empty.
   */
  getLatestMessage(): ConversationMessage | null;

  /**
   * Sets the team task with 5KB limit enforcement.
   *
   * @param task - The team task text
   */
  setTeamTask(task: string): void;

  /**
   * Returns the current team task, or null if not set.
   */
  getTeamTask(): string | null;

  /**
   * Prepares context input for a specific agent.
   *
   * @param agentId - The agent's ID
   * @param agentType - The agent type (will be normalized internally)
   * @param options - Optional overrides
   * @returns AssemblerInput ready for the assembler
   */
  getContextForAgent(
    agentId: string,
    agentType: AgentType,
    options?: {
      windowSizeOverride?: number;
      systemInstruction?: string | string[];
      instructionFileText?: string;
    }
  ): AssemblerInput;

  /**
   * Clears all messages and team task.
   */
  clear(): void;

  /**
   * Exports current state as a serializable snapshot.
   */
  exportSnapshot(): ContextSnapshot;

  /**
   * Restores state from a snapshot.
   *
   * @param snapshot - The snapshot to import
   */
  importSnapshot(snapshot: ContextSnapshot): void;
}
