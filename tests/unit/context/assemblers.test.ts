import { describe, it, expect } from 'vitest';
import { ClaudeContextAssembler } from '../../../src/context/assemblers/ClaudeContextAssembler.js';
import { CodexContextAssembler } from '../../../src/context/assemblers/CodexContextAssembler.js';
import { GeminiContextAssembler } from '../../../src/context/assemblers/GeminiContextAssembler.js';
import { PlainTextAssembler } from '../../../src/context/assemblers/PlainTextAssembler.js';
import type { AssemblerInput } from '../../../src/context/types.js';

// Helper to create test input
function createInput(overrides: Partial<AssemblerInput> = {}): AssemblerInput {
  return {
    contextMessages: [],
    currentMessage: '',
    teamTask: null,
    maxBytes: 768 * 1024,
    ...overrides,
  };
}

// =============================================================================
// ClaudeContextAssembler Tests
// =============================================================================

describe('ClaudeContextAssembler', () => {
  const assembler = new ClaudeContextAssembler();

  it('getAgentType returns claude-code', () => {
    expect(assembler.getAgentType()).toBe('claude-code');
  });

  describe('assemble', () => {
    it('produces correct format with all sections', () => {
      const input = createInput({
        contextMessages: [
          { from: 'User', to: 'Max', content: 'Hello' },
        ],
        currentMessage: 'How are you?',
        teamTask: 'Build a feature',
        systemInstruction: 'You are Max',
        instructionFileText: 'Be helpful',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).toContain('[TEAM_TASK]');
      expect(output.prompt).toContain('Build a feature');
      expect(output.prompt).toContain('[CONTEXT]');
      expect(output.prompt).toContain('User -> Max: Hello');
      expect(output.prompt).toContain('[MESSAGE]');
      expect(output.prompt).toContain('How are you?');

      expect(output.systemFlag).toBe('You are Max\n\nBe helpful');
    });

    it('separates systemFlag from prompt', () => {
      const input = createInput({
        currentMessage: 'Hello',
        systemInstruction: 'System text',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).not.toContain('System text');
      expect(output.systemFlag).toBe('System text');
    });

    it('joins systemInstruction and instructionFileText', () => {
      const input = createInput({
        currentMessage: 'Hi',
        systemInstruction: 'Part 1',
        instructionFileText: 'Part 2',
      });

      const output = assembler.assemble(input);
      expect(output.systemFlag).toBe('Part 1\n\nPart 2');
    });
  });

  describe('empty section handling', () => {
    it('omits [TEAM_TASK] when teamTask is null', () => {
      const input = createInput({ currentMessage: 'Hi', teamTask: null });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('[TEAM_TASK]');
    });

    it('omits [TEAM_TASK] when teamTask is whitespace', () => {
      const input = createInput({ currentMessage: 'Hi', teamTask: '   ' });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('[TEAM_TASK]');
    });

    it('omits [CONTEXT] when contextMessages is empty', () => {
      const input = createInput({ currentMessage: 'Hi' });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('[CONTEXT]');
    });

    it('omits [MESSAGE] when currentMessage is empty', () => {
      const input = createInput({
        teamTask: 'Task',
        currentMessage: '',
      });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('[MESSAGE]');
    });

    it('returns undefined systemFlag when no instructions', () => {
      const input = createInput({ currentMessage: 'Hi' });
      const output = assembler.assemble(input);
      expect(output.systemFlag).toBeUndefined();
    });
  });
});

// =============================================================================
// CodexContextAssembler Tests
// =============================================================================

describe('CodexContextAssembler', () => {
  const assembler = new CodexContextAssembler();

  it('getAgentType returns openai-codex', () => {
    expect(assembler.getAgentType()).toBe('openai-codex');
  });

  describe('assemble', () => {
    it('produces correct format with all sections', () => {
      const input = createInput({
        contextMessages: [{ from: 'User', to: 'Sarah', content: 'Question' }],
        currentMessage: 'Answer this',
        teamTask: 'Review code',
        systemInstruction: 'You are Sarah',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).toContain('[SYSTEM]');
      expect(output.prompt).toContain('You are Sarah');
      expect(output.prompt).toContain('[TEAM_TASK]');
      expect(output.prompt).toContain('[CONTEXT]');
      expect(output.prompt).toContain('[MESSAGE]');
      expect(output.systemFlag).toBeUndefined();
    });

    it('follows correct section order: SYSTEM -> TEAM_TASK -> CONTEXT -> MESSAGE', () => {
      const input = createInput({
        contextMessages: [{ from: 'A', content: 'B' }],
        currentMessage: 'C',
        teamTask: 'D',
        systemInstruction: 'E',
      });

      const output = assembler.assemble(input);
      const systemIdx = output.prompt.indexOf('[SYSTEM]');
      const taskIdx = output.prompt.indexOf('[TEAM_TASK]');
      const contextIdx = output.prompt.indexOf('[CONTEXT]');
      const messageIdx = output.prompt.indexOf('[MESSAGE]');

      expect(systemIdx).toBeLessThan(taskIdx);
      expect(taskIdx).toBeLessThan(contextIdx);
      expect(contextIdx).toBeLessThan(messageIdx);
    });
  });

  describe('empty section handling', () => {
    it('omits [SYSTEM] when no instructions', () => {
      const input = createInput({ currentMessage: 'Hi' });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('[SYSTEM]');
    });
  });
});

// =============================================================================
// GeminiContextAssembler Tests
// =============================================================================

describe('GeminiContextAssembler', () => {
  const assembler = new GeminiContextAssembler();

  it('getAgentType returns google-gemini', () => {
    expect(assembler.getAgentType()).toBe('google-gemini');
  });

  describe('assemble', () => {
    it('produces correct format with all sections', () => {
      const input = createInput({
        contextMessages: [{ from: 'User', content: 'Design question' }],
        currentMessage: 'Please help',
        teamTask: 'Design UI',
        systemInstruction: 'You are Carol',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).toContain('Instructions:');
      expect(output.prompt).toContain('You are Carol');
      expect(output.prompt).toContain('Team Task:');
      expect(output.prompt).toContain('Conversation so far:');
      expect(output.prompt).toContain('Your task:');
      expect(output.systemFlag).toBeUndefined();
    });

    it('uses natural language headers (no brackets)', () => {
      const input = createInput({
        currentMessage: 'Hi',
        systemInstruction: 'Test',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).not.toContain('[');
      expect(output.prompt).not.toContain(']');
    });

    it('formats messages as "- from: content" (no to)', () => {
      const input = createInput({
        contextMessages: [
          { from: 'Max', to: 'Carol', content: 'Hello Carol' },
        ],
        currentMessage: 'Reply',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).toContain('- Max: Hello Carol');
      expect(output.prompt).not.toContain('->');
    });
  });

  describe('empty section handling', () => {
    it('omits Instructions when no instructions', () => {
      const input = createInput({ currentMessage: 'Hi' });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('Instructions:');
    });

    it('omits Team Task when teamTask is null', () => {
      const input = createInput({ currentMessage: 'Hi' });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('Team Task:');
    });

    it('omits Conversation so far when contextMessages is empty', () => {
      const input = createInput({ currentMessage: 'Hi' });
      const output = assembler.assemble(input);
      expect(output.prompt).not.toContain('Conversation so far:');
    });
  });
});

// =============================================================================
// PlainTextAssembler Tests
// =============================================================================

describe('PlainTextAssembler', () => {
  const assembler = new PlainTextAssembler();

  it('getAgentType returns unknown', () => {
    expect(assembler.getAgentType()).toBe('unknown');
  });

  describe('assemble', () => {
    it('produces plain text output without markers', () => {
      const input = createInput({
        currentMessage: 'Hello',
        systemInstruction: 'You are an assistant',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).not.toContain('[');
      expect(output.prompt).not.toContain(']');
      expect(output.prompt).not.toContain('Instructions:');
    });

    it('returns undefined systemFlag', () => {
      const input = createInput({
        currentMessage: 'Hi',
        systemInstruction: 'Test',
      });

      const output = assembler.assemble(input);
      expect(output.systemFlag).toBeUndefined();
    });

    it('joins parts with double newlines', () => {
      const input = createInput({
        currentMessage: 'Message',
        teamTask: 'Task',
        systemInstruction: 'System',
      });

      const output = assembler.assemble(input);

      // Should have double newlines between sections
      expect(output.prompt).toContain('System\n\nTask\n\nMessage');
    });

    it('formats messages as "from: content"', () => {
      const input = createInput({
        contextMessages: [{ from: 'User', content: 'Hello' }],
        currentMessage: 'Reply',
      });

      const output = assembler.assemble(input);

      expect(output.prompt).toContain('User: Hello');
    });
  });

  describe('empty section handling', () => {
    it('returns empty prompt when all parts empty', () => {
      const input = createInput({
        currentMessage: '',
        teamTask: null,
        contextMessages: [],
      });

      const output = assembler.assemble(input);
      expect(output.prompt).toBe('');
    });
  });
});

// =============================================================================
// Byte Budget Tests (common across assemblers)
// =============================================================================

describe('Byte Budget', () => {
  it('ClaudeContextAssembler trims context when over budget', () => {
    const assembler = new ClaudeContextAssembler();
    const input = createInput({
      contextMessages: [
        { from: 'A', content: 'x'.repeat(1000) },
        { from: 'B', content: 'y'.repeat(1000) },
      ],
      currentMessage: 'Short',
      maxBytes: 500, // Very small
    });

    const output = assembler.assemble(input);

    expect(Buffer.byteLength(output.prompt, 'utf8')).toBeLessThanOrEqual(500);
  });

  it('CodexContextAssembler trims context when over budget', () => {
    const assembler = new CodexContextAssembler();
    const input = createInput({
      contextMessages: [
        { from: 'A', content: 'x'.repeat(1000) },
      ],
      currentMessage: 'Short',
      maxBytes: 200,
    });

    const output = assembler.assemble(input);

    expect(Buffer.byteLength(output.prompt, 'utf8')).toBeLessThanOrEqual(200);
  });

  it('GeminiContextAssembler trims context when over budget', () => {
    const assembler = new GeminiContextAssembler();
    const input = createInput({
      contextMessages: [
        { from: 'A', content: 'x'.repeat(1000) },
      ],
      currentMessage: 'Short',
      maxBytes: 200,
    });

    const output = assembler.assemble(input);

    expect(Buffer.byteLength(output.prompt, 'utf8')).toBeLessThanOrEqual(200);
  });

  it('PlainTextAssembler trims context when over budget', () => {
    const assembler = new PlainTextAssembler();
    const input = createInput({
      contextMessages: [
        { from: 'A', content: 'x'.repeat(1000) },
      ],
      currentMessage: 'Short',
      maxBytes: 200,
    });

    const output = assembler.assemble(input);

    expect(Buffer.byteLength(output.prompt, 'utf8')).toBeLessThanOrEqual(200);
  });
});
