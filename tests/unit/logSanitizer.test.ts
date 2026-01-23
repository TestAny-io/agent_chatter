import { describe, it, expect } from 'vitest';
import { DefaultLogSanitizer } from '../../src/utils/LogSanitizer.js';

describe('DefaultLogSanitizer', () => {
  it('redacts sensitive fields', () => {
    const sanitizer = new DefaultLogSanitizer();
    const result = sanitizer.sanitize({
      team: {
        name: 'alpha',
        instructionContent: 'secret team prompt',
      },
      member: {
        systemInstruction: 'secret system prompt',
        note: 'keep this',
      },
    });

    expect(result.team.name).toBe('alpha');
    expect(result.team.instructionContent).toMatch(/\[REDACTED:instructionContent:len=\d+]/);
    expect(result.member.systemInstruction).toMatch(/\[REDACTED:systemInstruction:len=\d+]/);
    expect(result.member.note).toBe('keep this');
  });

  it('handles nested arrays', () => {
    const sanitizer = new DefaultLogSanitizer();
    const result = sanitizer.sanitize({
      members: [
        { name: 'alice', instructionContent: 'secret' },
        { name: 'bob', systemInstruction: 'top secret' },
      ],
    });

    expect(result.members[0].name).toBe('alice');
    expect(result.members[0].instructionContent).toMatch(/\[REDACTED:instructionContent:len=\d+]/);
    expect(result.members[1].systemInstruction).toMatch(/\[REDACTED:systemInstruction:len=\d+]/);
  });
});
