/**
 * ClaudeContextAssembler
 *
 * Assembles prompts for Claude Code CLI.
 * Uses --append-system-prompt for system instructions (separated from main prompt).
 */

import { Buffer } from 'buffer';
import type { IContextAssembler } from '../IContextAssembler.js';
import type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  PromptContextMessage,
} from '../types.js';

export class ClaudeContextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'claude-code';
  }

  assemble(input: AssemblerInput): AssemblerOutput {
    const {
      contextMessages,
      currentMessage,
      teamTask,
      systemInstruction,
      instructionFileText,
      maxBytes,
    } = input;

    // Build systemFlag (for --append-system-prompt)
    const systemFlag = this.buildSystemFlag(systemInstruction, instructionFileText);

    // Build sections
    const sections: string[] = [];

    // [TEAM_TASK] - only if content exists
    if (teamTask?.trim()) {
      sections.push(`[TEAM_TASK]\n${teamTask.trim()}`);
    }

    // [CONTEXT] - only if messages exist
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `- ${msg.from} -> ${msg.to ?? 'all'}: ${msg.content}`
      );
      sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
    }

    // [MESSAGE] - only if content exists
    if (currentMessage?.trim()) {
      sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
    }

    let prompt = sections.join('\n\n');

    // Apply byte budget
    const result = this.applyByteBudget(prompt, systemFlag, maxBytes, contextMessages);

    return result;
  }

  /**
   * Builds the system flag string for --append-system-prompt.
   */
  private buildSystemFlag(
    systemInstruction?: string,
    instructionFileText?: string
  ): string | undefined {
    const parts: string[] = [];

    if (systemInstruction?.trim()) {
      parts.push(systemInstruction.trim());
    }

    if (instructionFileText?.trim()) {
      parts.push(instructionFileText.trim());
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  /**
   * Applies byte budget, trimming context if necessary.
   */
  private applyByteBudget(
    prompt: string,
    systemFlag: string | undefined,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): AssemblerOutput {
    const promptBytes = Buffer.byteLength(prompt, 'utf8');
    const systemBytes = systemFlag ? Buffer.byteLength(systemFlag, 'utf8') : 0;
    const totalBytes = promptBytes + systemBytes;

    if (totalBytes <= maxBytes) {
      return { prompt, systemFlag };
    }

    // Need to trim: prioritize trimming context
    const availableForPrompt = maxBytes - systemBytes;

    if (availableForPrompt <= 0) {
      // systemFlag alone exceeds budget - just return what we have
      return { prompt: '', systemFlag };
    }

    // Try to fit by removing oldest context messages
    const trimmedPrompt = this.trimPromptToFit(prompt, availableForPrompt, contextMessages);

    return { prompt: trimmedPrompt, systemFlag };
  }

  /**
   * Trims the prompt to fit within byte limit by removing oldest context.
   */
  private trimPromptToFit(
    prompt: string,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): string {
    // If already fits, return as-is
    if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) {
      return prompt;
    }

    // Extract sections
    const teamTaskMatch = prompt.match(/\[TEAM_TASK\]\n([\s\S]*?)(?=\n\n\[|$)/);
    const messageMatch = prompt.match(/\[MESSAGE\]\n([\s\S]*)$/);

    const teamTaskSection = teamTaskMatch ? `[TEAM_TASK]\n${teamTaskMatch[1]}` : '';
    const messageSection = messageMatch ? `[MESSAGE]\n${messageMatch[1]}` : '';

    // Try removing context messages one by one from oldest
    let remainingContext = [...contextMessages];

    while (remainingContext.length > 0) {
      // Build prompt with remaining context
      const sections: string[] = [];

      if (teamTaskSection) {
        sections.push(teamTaskSection);
      }

      if (remainingContext.length > 0) {
        const contextLines = remainingContext.map(msg =>
          `- ${msg.from} -> ${msg.to ?? 'all'}: ${msg.content}`
        );
        sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
      }

      if (messageSection) {
        sections.push(messageSection);
      }

      const newPrompt = sections.join('\n\n');

      if (Buffer.byteLength(newPrompt, 'utf8') <= maxBytes) {
        return newPrompt;
      }

      // Remove oldest message
      remainingContext = remainingContext.slice(1);
    }

    // No context left, just return team_task + message
    const finalSections: string[] = [];
    if (teamTaskSection) finalSections.push(teamTaskSection);
    if (messageSection) finalSections.push(messageSection);

    const finalPrompt = finalSections.join('\n\n');

    // If still too large, truncate message
    if (Buffer.byteLength(finalPrompt, 'utf8') > maxBytes) {
      // Just truncate the entire prompt
      return this.truncateToBytes(finalPrompt, maxBytes);
    }

    return finalPrompt;
  }

  /**
   * Truncates string to fit within byte limit.
   */
  private truncateToBytes(str: string, maxBytes: number): string {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);

    if (encoded.length <= maxBytes) {
      return str;
    }

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
}
