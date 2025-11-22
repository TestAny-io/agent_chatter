import { describe, it, expect } from 'vitest';
import { formatJsonl } from '../../src/utils/JsonlMessageFormatter.js';

describe('JsonlMessageFormatter', () => {
  it('parses Claude stream-json format', () => {
    const raw = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n{"type":"result"}';
    const result = formatJsonl('claude', raw);
    expect(result.text).toBe('Hello');
    expect(result.completed).toBe(true);
  });

  it('parses Codex item events', () => {
    const raw = '{"type":"item.completed","item":{"text":"Codex says hi"}}\n{"type":"turn.completed"}';
    const result = formatJsonl('codex', raw);
    expect(result.text).toBe('Codex says hi');
    expect(result.completed).toBe(true);
  });

  it('parses Gemini message events', () => {
    const raw = '{"type":"message","content":"Gemini hello"}\n{"type":"result"}';
    const result = formatJsonl('gemini', raw);
    expect(result.text).toBe('Gemini hello');
    expect(result.completed).toBe(true);
  });

  it('handles malformed JSON gracefully and still notices completion', () => {
    const raw = '{not json}\n{"type":"result","result":"done"}';
    const result = formatJsonl('claude', raw);
    expect(result.text).toContain('done');
    expect(result.completed).toBe(true);
  });
});
