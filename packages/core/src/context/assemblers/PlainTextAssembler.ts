/**
 * PlainTextAssembler
 *
 * Fallback assembler for unknown agent types.
 * Uses simple text concatenation with no special markers.
 */

import { Buffer } from 'buffer';
import type { IContextAssembler } from '../IContextAssembler.js';
import type {
  AgentType,
  AssemblerInput,
  AssemblerOutput,
  PromptContextMessage,
} from '../types.js';

export class PlainTextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'unknown' as AgentType;
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

    const parts: string[] = [];

    // System body (no title)
    const systemBody = this.buildSystemBody(systemInstruction, instructionFileText);
    if (systemBody) {
      parts.push(systemBody);
    }

    // Team task (no title)
    if (teamTask?.trim()) {
      parts.push(teamTask.trim());
    }

    // Context messages (simple format)
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `${msg.from}: ${msg.content}`
      );
      parts.push(contextLines.join('\n'));
    }

    // Current message (no title)
    if (currentMessage?.trim()) {
      parts.push(currentMessage.trim());
    }

    let prompt = parts.join('\n\n');

    // Apply byte budget
    prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

    return { prompt, systemFlag: undefined };
  }

  /**
   * Builds the system body.
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
   * For plain text, we try to preserve the structure while removing oldest context.
   */
  private trimPromptToFit(
    prompt: string,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): string {
    if (Buffer.byteLength(prompt, 'utf8') <= maxBytes) {
      return prompt;
    }

    // Split by double newlines to get parts
    const parts = prompt.split('\n\n');

    // Find the context part (lines with "from: content" format)
    let contextPartIndex = -1;
    for (let i = 0; i < parts.length; i++) {
      const lines = parts[i].split('\n');
      // Check if this looks like context (multiple lines with "name: content")
      if (lines.length > 1 && lines.every(l => /^[^:]+: /.test(l))) {
        contextPartIndex = i;
        break;
      }
    }

    // If we found context, try trimming it
    if (contextPartIndex >= 0 && contextMessages.length > 0) {
      let remainingContext = [...contextMessages];

      while (remainingContext.length > 0) {
        // Rebuild with remaining context
        const newParts = [...parts];
        if (remainingContext.length > 0) {
          const contextLines = remainingContext.map(msg =>
            `${msg.from}: ${msg.content}`
          );
          newParts[contextPartIndex] = contextLines.join('\n');
        } else {
          // Remove context part entirely
          newParts.splice(contextPartIndex, 1);
        }

        const newPrompt = newParts.join('\n\n');

        if (Buffer.byteLength(newPrompt, 'utf8') <= maxBytes) {
          return newPrompt;
        }

        remainingContext = remainingContext.slice(1);
      }

      // Remove context entirely
      const partsWithoutContext = parts.filter((_, i) => i !== contextPartIndex);
      const promptWithoutContext = partsWithoutContext.join('\n\n');

      if (Buffer.byteLength(promptWithoutContext, 'utf8') <= maxBytes) {
        return promptWithoutContext;
      }
    }

    // Last resort: truncate
    return this.truncateToBytes(prompt, maxBytes);
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
