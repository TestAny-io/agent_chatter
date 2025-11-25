import { Buffer } from 'buffer';
import { MessageRouter } from '../services/MessageRouter.js';

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
  teamTask?: string | null; // [TEAM_TASK] content
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
  const router = new MessageRouter();
  const lines = contextMessages.map(msg => {
    const to = msg.to ? ` -> ${msg.to}` : '';
    // Strip markers to avoid duplication in context
    const cleanContent = router.stripAllMarkersForContext(msg.content);
    return `${msg.from}${to}: ${cleanContent}`;
  });
  return buildSection('[CONTEXT]', lines.join('\n'));
}

function computeLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

function trimContext(
  systemSection: string,
  teamTaskSection: string,
  contextMessages: PromptContextMessage[],
  messageSection: string,
  maxBytes: number
): { contextSection: string; trimmed: number } {
  let workingContext = [...contextMessages];
  let contextSection = formatContext(workingContext);
  let total = computeLength(systemSection + teamTaskSection + contextSection + messageSection);

  let trimmed = 0;
  while (total > maxBytes && workingContext.length > 0) {
    workingContext.shift(); // drop oldest
    trimmed += 1;
    contextSection = formatContext(workingContext);
    total = computeLength(systemSection + teamTaskSection + contextSection + messageSection);
  }

  return { contextSection, trimmed };
}

function formatPlainContext(contextMessages: PromptContextMessage[]): string {
  if (contextMessages.length === 0) return '';
  const router = new MessageRouter();
  const lines = contextMessages.map(msg => {
    const to = msg.to ? ` -> ${msg.to}` : '';
    const cleanContent = router.stripAllMarkersForContext(msg.content);
    return `- ${msg.from}${to}: ${cleanContent}`;
  });
  return lines.join('\n');
}

function buildGeminiPrompt(input: PromptInput, maxBytes: number): PromptOutput {
  const systemParts = [input.systemInstructionText, input.instructionFileText].filter(Boolean);
  const systemBody = systemParts.join('\n\n').trim();
  const systemSection = systemBody ? `Instructions:\n${systemBody}\n\n` : '';
  
  const teamTaskBody = input.teamTask?.trim();
  const teamTaskSection = teamTaskBody ? `Team Task:\n${teamTaskBody}\n\n` : '';

  const messageSection = `User message:\n${input.message.trim()}`;

  let workingContext = [...input.contextMessages];
  let prompt = '';
  let contextSection = '';

  const assemble = (ctx: PromptContextMessage[]) => {
    const ctxText = formatPlainContext(ctx);
    contextSection = ctxText ? `Conversation so far:\n${ctxText}\n\n` : '';
    prompt = `${systemSection}${teamTaskSection}${contextSection}${messageSection}`;
  };

  assemble(workingContext);

  const fixedBytes = computeLength(systemSection + teamTaskSection + messageSection);
  if (fixedBytes > maxBytes) {
    // If fixed parts exceed budget, we must prioritize message and task?
    // For now, just throw as before, but include task in error msg context
    throw new Error(
      `Input exceeds max length (${fixedBytes} > ${maxBytes} bytes). ` +
      'Please reduce message, system instruction, or team task size.'
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

  const teamTaskBody = input.teamTask?.trim();
  const teamTaskSection = teamTaskBody ? buildSection('[TEAM_TASK]', teamTaskBody) : '';

  const messageSection = buildSection('[MESSAGE]', input.message.trim());

  // First pass: format context
  const { contextSection, trimmed } = trimContext(
    systemSection, 
    teamTaskSection, 
    input.contextMessages, 
    messageSection, 
    maxBytes
  );

  let prompt = '';
  let systemFlag: string | undefined;

  if (input.agentType === 'claude-code' && systemSection) {
    // Claude: use system flag when available; prompt carries task+context+message
    systemFlag = systemBody;
    prompt = `${teamTaskSection}${contextSection}${messageSection}`.trim();
  } else {
    // Inline for others: SYSTEM -> TEAM_TASK -> CONTEXT -> MESSAGE
    prompt = `${systemSection}${teamTaskSection}${contextSection}${messageSection}`.trim();
  }

  let totalBytes = computeLength((systemFlag ?? '') + prompt);
  if (totalBytes > maxBytes) {
    const minRequired = computeLength((systemFlag ?? '') + teamTaskSection + messageSection);
    if (minRequired > maxBytes) {
      throw new Error(
        `Input exceeds max length (${totalBytes} > ${maxBytes} bytes). System+task+message alone require ${minRequired} bytes; please reduce message or system instruction size.`
      );
    }
    // If still above, drop all context
    prompt = (input.agentType === 'claude-code' && systemSection) 
      ? `${teamTaskSection}${messageSection}`.trim()
      : `${systemSection}${teamTaskSection}${messageSection}`.trim();
      
    totalBytes = computeLength((systemFlag ?? '') + prompt);
  }

  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.error(
      `[Debug][PromptBuilder] bytes=${totalBytes} trimmed_context=${trimmed} systemFlag=${Boolean(systemFlag)} teamTask=${Boolean(teamTaskSection)}`
    );
  }

  return { prompt, systemFlag };
}
