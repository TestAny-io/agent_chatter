import { Buffer } from 'buffer';

export interface PromptContextMessage {
  from: string;
  to?: string;
  content: string;
  timestamp?: Date;
}

export interface PromptInput {
  agentType: 'claude-code' | 'openai-codex' | 'google-gemini' | string;
  systemInstructionText?: string;
  instructionFileText?: string;
  contextMessages: PromptContextMessage[];
  message: string;
  maxBytes?: number; // fallback to DEFAULT_MAX_BYTES
}

export interface PromptOutput {
  prompt: string;
  systemFlag?: string; // used by Claude --append-system-prompt
}

const DEFAULT_MAX_BYTES = 768 * 1024; // 768KB

function buildSection(header: string, body: string | undefined): string {
  const trimmed = body?.trim();
  if (!trimmed) return '';
  return `${header}\n\n${trimmed}\n\n`;
}

function formatContext(contextMessages: PromptContextMessage[]): string {
  if (contextMessages.length === 0) return '';
  const lines = contextMessages.map(msg => {
    const to = msg.to ? ` -> ${msg.to}` : '';
    return `${msg.from}${to}: ${msg.content}`;
  });
  return buildSection('[CONTEXT]', lines.join('\n'));
}

function computeLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

function trimContext(
  systemSection: string,
  contextMessages: PromptContextMessage[],
  messageSection: string,
  maxBytes: number
): { contextSection: string; trimmed: number } {
  let workingContext = [...contextMessages];
  let contextSection = formatContext(workingContext);
  let total = computeLength(systemSection + contextSection + messageSection);

  let trimmed = 0;
  while (total > maxBytes && workingContext.length > 0) {
    workingContext.shift(); // drop oldest
    trimmed += 1;
    contextSection = formatContext(workingContext);
    total = computeLength(systemSection + contextSection + messageSection);
  }

  return { contextSection, trimmed };
}

function formatPlainContext(contextMessages: PromptContextMessage[]): string {
  if (contextMessages.length === 0) return '';
  const lines = contextMessages.map(msg => {
    const to = msg.to ? ` -> ${msg.to}` : '';
    return `- ${msg.from}${to}: ${msg.content}`;
  });
  return lines.join('\n');
}

function buildGeminiPrompt(input: PromptInput, maxBytes: number): PromptOutput {
  const systemParts = [input.systemInstructionText, input.instructionFileText].filter(Boolean);
  const systemBody = systemParts.join('\n\n').trim();
  const systemSection = systemBody ? `Instructions:\n${systemBody}\n\n` : '';
  const messageSection = `User message:\n${input.message.trim()}`;

  let workingContext = [...input.contextMessages];
  let prompt = '';
  let contextSection = '';

  const assemble = (ctx: PromptContextMessage[]) => {
    const ctxText = formatPlainContext(ctx);
    contextSection = ctxText ? `Conversation so far:\n${ctxText}\n\n` : '';
    prompt = `${systemSection}${contextSection}${messageSection}`;
  };

  assemble(workingContext);

  const systemAndMessageBytes = computeLength(systemSection + messageSection);
  if (systemAndMessageBytes > maxBytes) {
    throw new Error(
      `Input exceeds max length (${systemAndMessageBytes} > ${maxBytes} bytes). ` +
      'Please reduce message or system instruction size.'
    );
  }

  while (computeLength(prompt) > maxBytes && workingContext.length > 0) {
    workingContext.shift();
    assemble(workingContext);
  }

  return { prompt };
}

export function buildPrompt(input: PromptInput): PromptOutput {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  if (input.agentType === 'google-gemini') {
    return buildGeminiPrompt(input, maxBytes);
  }

  const systemParts = [input.systemInstructionText, input.instructionFileText].filter(Boolean);
  const systemBody = systemParts.join('\n\n').trim();
  const systemSection = systemBody ? buildSection('[SYSTEM]', systemBody) : '';

  const messageSection = buildSection('[MESSAGE]', input.message.trim());

  // First pass: format context
  const { contextSection, trimmed } = trimContext(systemSection, input.contextMessages, messageSection, maxBytes);

  let prompt = '';
  let systemFlag: string | undefined;

  if (input.agentType === 'claude-code' && systemSection) {
    // Claude: use system flag when available; prompt carries context+message
    systemFlag = systemBody;
    prompt = `${contextSection}${messageSection}`.trim();
  } else {
    // Inline for others
    prompt = `${systemSection}${contextSection}${messageSection}`.trim();
  }

  let totalBytes = computeLength((systemFlag ?? '') + prompt);
  if (totalBytes > maxBytes) {
    const minRequired = computeLength((systemFlag ?? '') + messageSection);
    if (minRequired > maxBytes) {
      throw new Error(
        `Input exceeds max length (${totalBytes} > ${maxBytes} bytes). System+message alone require ${minRequired} bytes; please reduce message or system instruction size.`
      );
    }
    // If still above, drop all context
    prompt = messageSection.trim();
    totalBytes = computeLength((systemFlag ?? '') + prompt);
  }

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.error(
      `[Debug][PromptBuilder] bytes=${totalBytes} trimmed_context=${trimmed} systemFlag=${Boolean(systemFlag)}`
    );
  }

  return { prompt, systemFlag };
}
