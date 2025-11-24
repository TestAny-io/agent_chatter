import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/utils/PromptBuilder.js';

const baseContext = [
  { from: 'A', to: 'B', content: 'one' },
  { from: 'B', to: 'A', content: 'two' },
  { from: 'C', to: 'A', content: 'three' }
];

describe('PromptBuilder', () => {
  it('merges system instruction and file content, inlines for codex', () => {
    const out = buildPrompt({
      agentType: 'openai-codex',
      systemInstructionText: 'SYS',
      instructionFileText: 'FILE',
      contextMessages: baseContext,
      message: 'MSG',
      maxBytes: 1024 * 1024
    });
    expect(out.systemFlag).toBeUndefined();
    expect(out.prompt).toContain('[SYSTEM]');
    expect(out.prompt).toContain('SYS');
    expect(out.prompt).toContain('FILE');
    expect(out.prompt).toContain('[CONTEXT]');
    expect(out.prompt).toContain('A -> B: one');
    expect(out.prompt).toContain('[MESSAGE]');
    expect(out.prompt).toContain('MSG');
  });

  it('builds gemini prompt without bracketed tags', () => {
    const out = buildPrompt({
      agentType: 'google-gemini',
      systemInstructionText: 'SYS',
      instructionFileText: 'FILE',
      contextMessages: baseContext,
      message: 'MSG',
      maxBytes: 1024 * 1024
    });
    expect(out.systemFlag).toBeUndefined();
    expect(out.prompt).toContain('Instructions:');
    expect(out.prompt).toContain('SYS');
    expect(out.prompt).toContain('FILE');
    expect(out.prompt).toContain('Conversation so far:');
    expect(out.prompt).toContain('A -> B: one');
    expect(out.prompt).toContain('User message:');
    expect(out.prompt).toContain('MSG');
    expect(out.prompt).not.toContain('[SYSTEM]');
    expect(out.prompt).not.toContain('[CONTEXT]');
    expect(out.prompt).not.toContain('[MESSAGE]');
  });

  it('uses systemFlag for claude and prompt only has context+message', () => {
    const out = buildPrompt({
      agentType: 'claude-code',
      systemInstructionText: 'SYS',
      instructionFileText: 'FILE',
      contextMessages: baseContext,
      message: 'MSG',
      maxBytes: 1024 * 1024
    });
    expect(out.systemFlag).toContain('SYS');
    expect(out.systemFlag).toContain('FILE');
    expect(out.prompt).not.toContain('[SYSTEM]');
    expect(out.prompt).toContain('[CONTEXT]');
    expect(out.prompt).toContain('[MESSAGE]');
  });

  it('trims context from oldest when exceeding max bytes', () => {
    const bigContext = [
      { from: 'A', content: 'old'.repeat(2000) },
      { from: 'B', content: 'new'.repeat(500) }
    ];
    const out = buildPrompt({
      agentType: 'openai-codex',
      systemInstructionText: 'SYS',
      instructionFileText: undefined,
      contextMessages: bigContext,
      message: 'MSG',
      maxBytes: 5000
    });
    expect(out.prompt).toContain('new');
    expect(out.prompt).not.toContain('old');
  });

  it('throws when system + message exceed limit alone', () => {
    const big = 'Y'.repeat(800 * 1024);
    expect(() => buildPrompt({
      agentType: 'openai-codex',
      systemInstructionText: 'SYS',
      instructionFileText: undefined,
      contextMessages: [],
      message: big,
      maxBytes: 200 * 1024
    })).toThrow(/exceeds max length/i);
  });
});
