import { describe, it, expect } from 'vitest';
import { formatJsonl } from '../../src/utils/JsonlMessageFormatter.js';

describe('JsonlMessageFormatter', () => {
  it('parses Claude stream-json format', () => {
    const raw = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"result"}'
    ].join('\n');

    const result = formatJsonl('claude', raw);
    expect(result.text).toBe('Hello');
    expect(result.completed).toBe(true);
  });

  it('parses Codex item.* events', () => {
    const raw = [
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","aggregated_output":""}}',
      '{"type":"turn.completed"}'
    ].join('\n');

    const result = formatJsonl('codex', raw);
    expect(result.text).toContain('bash -lc ls');
    expect(result.completed).toBe(true);
  });

  it('parses Gemini message events', () => {
    const raw = [
      '{"type":"message","role":"assistant","content":"Hello from Gemini"}',
      '{"type":"result"}'
    ].join('\n');

    const result = formatJsonl('gemini', raw);
    expect(result.text).toBe('Hello from Gemini');
    expect(result.completed).toBe(true);
  });

  it('handles malformed JSON gracefully with fallback text', () => {
    const raw = 'malformed {json}\n{"type":"result"}';
    const result = formatJsonl('claude', raw);
    expect(result.text).toContain('malformed');
    expect(result.completed).toBe(true);
  });
});
