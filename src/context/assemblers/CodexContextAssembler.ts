/**
 * CodexContextAssembler
 *
 * Assembles prompts for OpenAI Codex CLI.
 * System instruction is inlined in [SYSTEM] section.
 */

import { Buffer } from 'buffer';
import type { IContextAssembler } from '../IContextAssembler.js';
import type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  PromptContextMessage,
} from '../types.js';

export class CodexContextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'openai-codex';
  }

  assemble(input: AssemblerInput): AssemblerOutput {
    const {
      contextMessages,
      currentMessage,
      teamTask,
      systemInstruction,
      instructionFileText,
      maxBytes,
      // v3 new fields
      parentContext,
      siblingContext,
      routeMeta,
    } = input;

    const sections: string[] = [];

    // [SYSTEM] - inline system instruction
    const systemBody = this.buildSystemBody(systemInstruction, instructionFileText);
    if (systemBody) {
      sections.push(`[SYSTEM]\n${systemBody}`);
    }

    // [TEAM_TASK]
    if (teamTask?.trim()) {
      sections.push(`[TEAM_TASK]\n${teamTask.trim()}`);
    }

    // [CONTEXT]
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `- ${msg.from} -> ${msg.to ?? 'all'}: ${msg.content}`
      );
      sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
    }

    // v3: [PARENT_CONTEXT]
    if (parentContext) {
      sections.push(
        `[PARENT_CONTEXT]\n` +
        `(This is the message you are replying to, reinserted for context)\n` +
        `- ${parentContext.from}: ${parentContext.content}`
      );
    }

    // v3: [RELATED_CONTEXT]
    if (siblingContext && siblingContext.length > 0) {
      const siblingLines = siblingContext.map(msg =>
        `- ${msg.from}: ${msg.content}`
      );
      sections.push(
        `[RELATED_CONTEXT]\n` +
        `(Other responses to the same message - avoid repeating)\n` +
        siblingLines.join('\n')
      );
    }

    // [MESSAGE]
    if (currentMessage?.trim()) {
      sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
    }

    // v3: [ROUTING_META]
    if (routeMeta) {
      const metaLines: string[] = [];
      if (routeMeta.parentMessageId) {
        metaLines.push(`parentMessageId: ${routeMeta.parentMessageId}`);
      }
      if (routeMeta.intent) {
        metaLines.push(`intent: ${routeMeta.intent}`);
      }
      if (metaLines.length > 0) {
        sections.push(`[ROUTING_META]\n${metaLines.join('\n')}`);
      }
    }

    let prompt = sections.join('\n\n');

    // Apply byte budget
    prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

    return { prompt, systemFlag: undefined };
  }

  /**
   * Builds the [SYSTEM] section body.
   */
  private buildSystemBody(
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

    // Extract sections
    const systemMatch = prompt.match(/\[SYSTEM\]\n([\s\S]*?)(?=\n\n\[|$)/);
    const teamTaskMatch = prompt.match(/\[TEAM_TASK\]\n([\s\S]*?)(?=\n\n\[|$)/);
    const messageMatch = prompt.match(/\[MESSAGE\]\n([\s\S]*)$/);

    const systemSection = systemMatch ? `[SYSTEM]\n${systemMatch[1]}` : '';
    const teamTaskSection = teamTaskMatch ? `[TEAM_TASK]\n${teamTaskMatch[1]}` : '';
    const messageSection = messageMatch ? `[MESSAGE]\n${messageMatch[1]}` : '';

    // Try removing context messages one by one from oldest
    let remainingContext = [...contextMessages];

    while (remainingContext.length > 0) {
      const sections: string[] = [];

      if (systemSection) sections.push(systemSection);
      if (teamTaskSection) sections.push(teamTaskSection);

      if (remainingContext.length > 0) {
        const contextLines = remainingContext.map(msg =>
          `- ${msg.from} -> ${msg.to ?? 'all'}: ${msg.content}`
        );
        sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
      }

      if (messageSection) sections.push(messageSection);

      const newPrompt = sections.join('\n\n');

      if (Buffer.byteLength(newPrompt, 'utf8') <= maxBytes) {
        return newPrompt;
      }

      remainingContext = remainingContext.slice(1);
    }

    // No context left
    const finalSections: string[] = [];
    if (systemSection) finalSections.push(systemSection);
    if (teamTaskSection) finalSections.push(teamTaskSection);
    if (messageSection) finalSections.push(messageSection);

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
