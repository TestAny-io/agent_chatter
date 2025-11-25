/**
 * GeminiContextAssembler
 *
 * Assembles prompts for Google Gemini CLI.
 * Uses natural language headers (no brackets).
 */

import { Buffer } from 'buffer';
import type { IContextAssembler } from '../IContextAssembler.js';
import type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  PromptContextMessage,
} from '../types.js';

export class GeminiContextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'google-gemini';
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

    const sections: string[] = [];

    // Instructions:
    const instructionsBody = this.buildInstructionsBody(systemInstruction, instructionFileText);
    if (instructionsBody) {
      sections.push(`Instructions:\n${instructionsBody}`);
    }

    // Team Task:
    if (teamTask?.trim()) {
      sections.push(`Team Task:\n${teamTask.trim()}`);
    }

    // Conversation so far:
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `- ${msg.from}: ${msg.content}`
      );
      sections.push(`Conversation so far:\n${contextLines.join('\n')}`);
    }

    // Last message:
    if (currentMessage?.trim()) {
      sections.push(`Last message:\n${currentMessage.trim()}`);
    }

    let prompt = sections.join('\n\n');

    // Apply byte budget
    prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

    return { prompt, systemFlag: undefined };
  }

  /**
   * Builds the Instructions section body.
   */
  private buildInstructionsBody(
    systemInstruction?: string,
    instructionFileText?: string
  ): string | null {
    const parts: string[] = [];

    if (systemInstruction?.trim()) {
      parts.push(systemInstruction.trim());
    }

    if (instructionFileText?.trim()) {
      parts.push(instructionFileText.trim());
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  /**
   * Applies byte budget by trimming context.
   */
  private applyByteBudget(
    prompt: string,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): string {
    if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) {
      return prompt;
    }

    return this.trimPromptToFit(prompt, maxBytes, contextMessages);
  }

  /**
   * Trims the prompt to fit within byte limit.
   */
  private trimPromptToFit(
    prompt: string,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): string {
    if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) {
      return prompt;
    }

    // Extract sections using Gemini's format
    const instructionsMatch = prompt.match(/Instructions:\n([\s\S]*?)(?=\n\n[A-Z]|$)/);
    const teamTaskMatch = prompt.match(/Team Task:\n([\s\S]*?)(?=\n\n[A-Z]|$)/);
    const lastMessageMatch = prompt.match(/Last message:\n([\s\S]*)$/);

    const instructionsSection = instructionsMatch ? `Instructions:\n${instructionsMatch[1]}` : '';
    const teamTaskSection = teamTaskMatch ? `Team Task:\n${teamTaskMatch[1]}` : '';
    const lastMessageSection = lastMessageMatch ? `Last message:\n${lastMessageMatch[1]}` : '';

    // Try removing context messages one by one from oldest
    let remainingContext = [...contextMessages];

    while (remainingContext.length > 0) {
      const sections: string[] = [];

      if (instructionsSection) sections.push(instructionsSection);
      if (teamTaskSection) sections.push(teamTaskSection);

      if (remainingContext.length > 0) {
        const contextLines = remainingContext.map(msg =>
          `- ${msg.from}: ${msg.content}`
        );
        sections.push(`Conversation so far:\n${contextLines.join('\n')}`);
      }

      if (lastMessageSection) sections.push(lastMessageSection);

      const newPrompt = sections.join('\n\n');

      if (Buffer.byteLength(newPrompt, 'utf8') <= maxBytes) {
        return newPrompt;
      }

      remainingContext = remainingContext.slice(1);
    }

    // No context left
    const finalSections: string[] = [];
    if (instructionsSection) finalSections.push(instructionsSection);
    if (teamTaskSection) finalSections.push(teamTaskSection);
    if (lastMessageSection) finalSections.push(lastMessageSection);

    const finalPrompt = finalSections.join('\n\n');

    if (Buffer.byteLength(finalPrompt, 'utf8') > maxBytes) {
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
