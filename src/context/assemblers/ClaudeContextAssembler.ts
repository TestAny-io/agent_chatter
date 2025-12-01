/**
 * ClaudeContextAssembler
 *
 * Assembles prompts for Claude Code CLI.
 * Uses --append-system-prompt for system instructions (separated from main prompt).
 *
 * v3 extension: Added PARENT_CONTEXT, RELATED_CONTEXT, and ROUTING_META sections
 * @see docs/design/route_rule/V3/detail/04-prompt-assembly.md
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
      // v3 new fields
      parentContext,
      siblingContext,
      routeMeta,
    } = input;

    // Build system instruction text (for --append-system-prompt AND inline [SYSTEM])
    const systemText = this.buildSystemFlag(systemInstruction, instructionFileText);

    // Build sections - order: [SYSTEM], [TEAM_TASK], [CONTEXT], [PARENT_CONTEXT], [RELATED_CONTEXT], [MESSAGE], [ROUTING_META]
    const sections: string[] = [];

    // [SYSTEM] - embed system instruction in prompt (before MESSAGE)
    if (systemText?.trim()) {
      sections.push(`[SYSTEM]\n${systemText.trim()}`);
    }

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

    // v3: [PARENT_CONTEXT] - parent message reinsertion (when pushed out of window)
    if (parentContext) {
      sections.push(
        `[PARENT_CONTEXT]\n` +
        `(This is the message you are replying to, reinserted for context)\n` +
        `- ${parentContext.from}: ${parentContext.content}`
      );
    }

    // v3: [RELATED_CONTEXT] - sibling context (other responses to the same message)
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

    // [MESSAGE] - only if content exists
    if (currentMessage?.trim()) {
      sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
    }

    // v3: [ROUTING_META] - optional debugging/advanced prompting info
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

    // Apply byte budget (systemFlag is now embedded in prompt, pass as undefined for --append-system-prompt)
    const result = this.applyByteBudgetV3(prompt, systemText, maxBytes, {
      contextMessages,
      parentContext,
      siblingContext,
    });

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
   * @deprecated Use applyByteBudgetV3 for v3 features
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
   * v3: Applies byte budget with priority-based trimming
   *
   * Priority order (highest to lowest):
   * 1. [MESSAGE] - cannot be truncated
   * 2. [SYSTEM] - cannot be truncated
   * 3. [TEAM_TASK] - can truncate (keep first 5KB)
   * 4. [PARENT_CONTEXT] - can truncate (keep first 1KB)
   * 5. [RELATED_CONTEXT] - can be removed or truncated
   * 6. [CONTEXT] - remove oldest messages first
   */
  private applyByteBudgetV3(
    prompt: string,
    systemFlag: string | undefined,
    maxBytes: number,
    sections: {
      contextMessages: PromptContextMessage[];
      parentContext?: PromptContextMessage;
      siblingContext?: PromptContextMessage[];
    }
  ): AssemblerOutput {
    const { contextMessages, parentContext, siblingContext } = sections;

    let currentBytes = Buffer.byteLength(prompt, 'utf8');
    const systemBytes = systemFlag ? Buffer.byteLength(systemFlag, 'utf8') : 0;
    const totalBytes = currentBytes + systemBytes;

    if (totalBytes <= maxBytes) {
      return { prompt, systemFlag };
    }

    // Need to trim
    let trimmedPrompt = prompt;

    // Step 1: Remove sibling context ([RELATED_CONTEXT])
    if (siblingContext && siblingContext.length > 0) {
      trimmedPrompt = this.removeSiblingSection(trimmedPrompt);
      currentBytes = Buffer.byteLength(trimmedPrompt, 'utf8');
      if (currentBytes + systemBytes <= maxBytes) {
        return { prompt: trimmedPrompt, systemFlag };
      }
    }

    // Step 2: Truncate parent context ([PARENT_CONTEXT]) - keep first 1KB
    if (parentContext) {
      trimmedPrompt = this.truncateParentSection(trimmedPrompt, 1024);
      currentBytes = Buffer.byteLength(trimmedPrompt, 'utf8');
      if (currentBytes + systemBytes <= maxBytes) {
        return { prompt: trimmedPrompt, systemFlag };
      }
    }

    // Step 3: Remove context messages from oldest
    let remainingContext = [...contextMessages];
    while (remainingContext.length > 0 && currentBytes + systemBytes > maxBytes) {
      remainingContext = remainingContext.slice(1); // Remove oldest
      trimmedPrompt = this.rebuildPromptWithContext(trimmedPrompt, remainingContext);
      currentBytes = Buffer.byteLength(trimmedPrompt, 'utf8');
    }

    // Step 4: If still too large, truncate the entire prompt
    if (currentBytes + systemBytes > maxBytes) {
      const availableForPrompt = maxBytes - systemBytes;
      if (availableForPrompt > 0) {
        trimmedPrompt = this.truncateToBytes(trimmedPrompt, availableForPrompt);
      } else {
        trimmedPrompt = '';
      }
    }

    return { prompt: trimmedPrompt, systemFlag };
  }

  /**
   * Remove [RELATED_CONTEXT] section from prompt
   */
  private removeSiblingSection(prompt: string): string {
    return prompt.replace(/\[RELATED_CONTEXT\]\n[\s\S]*?(?=\n\n\[|$)/, '').trim();
  }

  /**
   * Truncate [PARENT_CONTEXT] section to maxBytes
   */
  private truncateParentSection(prompt: string, maxContentBytes: number): string {
    const parentMatch = prompt.match(/(\[PARENT_CONTEXT\]\n[\s\S]*?)(?=\n\n\[|$)/);
    if (!parentMatch) {
      return prompt;
    }

    const parentSection = parentMatch[1];
    const parentBytes = Buffer.byteLength(parentSection, 'utf8');

    if (parentBytes <= maxContentBytes) {
      return prompt;
    }

    // Truncate the content
    const truncatedSection = this.truncateToBytes(parentSection, maxContentBytes) + '...';
    return prompt.replace(parentMatch[1], truncatedSection);
  }

  /**
   * Rebuild prompt with new context messages
   */
  private rebuildPromptWithContext(
    prompt: string,
    remainingContext: PromptContextMessage[]
  ): string {
    // Replace existing [CONTEXT] section
    const contextPattern = /\[CONTEXT\]\n[\s\S]*?(?=\n\n\[|$)/;

    if (remainingContext.length === 0) {
      // Remove context section entirely
      return prompt.replace(contextPattern, '').replace(/\n\n+/g, '\n\n').trim();
    }

    const contextLines = remainingContext.map(msg =>
      `- ${msg.from} -> ${msg.to ?? 'all'}: ${msg.content}`
    );
    const newContextSection = `[CONTEXT]\n${contextLines.join('\n')}`;

    return prompt.replace(contextPattern, newContextSection);
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
