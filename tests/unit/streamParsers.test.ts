import { describe, it, expect } from 'vitest';
import { ClaudeCodeParser } from '../../src/events/parsers/ClaudeCodeParser.js';
import { GeminiParser } from '../../src/events/parsers/GeminiParser.js';
import { CodexParser } from '../../src/events/parsers/CodexParser.js';
import type { TeamContext } from '../../src/models/Team.js';

const teamContext: TeamContext = {
  teamName: 'team',
  memberName: 'agent',
  memberDisplayName: 'Agent',
  memberRole: 'dev'
};

describe('Stream parsers', () => {
  it('parses Claude Code stream-json events', () => {
    const parser = new ClaudeCodeParser('claude-1', teamContext);
    const events = [
      ...parser.parseChunk(Buffer.from([
        '{"type":"system","subtype":"init"}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
        '{"type":"tool_use","name":"Bash","id":"tool-1","input":{"cmd":"ls"}}',
        '{"type":"tool_result","tool_use_id":"tool-1","content":"ok"}',
        '{"type":"message_stop","stop_reason":"end_turn"}'
      ].join('\n'))),
      ...parser.flush()
    ];

    expect(events.map(e => e.type)).toEqual([
      'session.started',
      'text',
      'tool.started',
      'tool.completed',
      'turn.completed'
    ]);
    expect(events[1]).toMatchObject({ text: 'hi', agentId: 'claude-1' });
    expect(events[2]).toMatchObject({ toolId: 'tool-1', toolName: 'Bash' });
    expect(events[3]).toMatchObject({ toolId: 'tool-1', output: 'ok' });
    expect(events[4]).toMatchObject({ finishReason: 'done' });
  });

  it('parses Gemini stream-json events', () => {
    const parser = new GeminiParser('gemini-1', teamContext);
    const events = [
      ...parser.parseChunk(Buffer.from([
        '{"type":"init","model":"g-1"}',
        '{"type":"message","role":"assistant","content":"hello"}',
        '{"type":"tool_use","tool_name":"bash","tool_id":"t-1","parameters":{"cmd":"pwd"}}',
        '{"type":"tool_result","tool_id":"t-1","output":"ok"}',
        '{"type":"result","status":"success"}'
      ].join('\n'))),
      ...parser.flush()
    ];

    expect(events.map(e => e.type)).toEqual([
      'session.started',
      'text',
      'tool.started',
      'tool.completed',
      'turn.completed'
    ]);
    expect(events[1]).toMatchObject({ text: 'hello', role: 'assistant' });
    expect(events[2]).toMatchObject({ toolId: 't-1' });
    expect(events[3]).toMatchObject({ toolId: 't-1', output: 'ok' });
    expect(events[4]).toMatchObject({ finishReason: 'done' });
  });

  it('parses Codex JSONL events', () => {
    const parser = new CodexParser('codex-1', teamContext);
    const events = [
      ...parser.parseChunk(Buffer.from([
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"pwd"}}',
        '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","aggregated_output":"ok\\n","exit_code":0}}',
        '{"type":"item.completed","item":{"id":"item_2","type":"reasoning","text":"thinking"}}',
        '{"type":"turn.completed"}'
      ].join('\n'))),
      ...parser.flush()
    ];

    expect(events.map(e => e.type)).toEqual([
      'session.started',
      'tool.started',
      'tool.completed',
      'text',
      'turn.completed'
    ]);
    expect(events[1]).toMatchObject({ toolId: 'item_1', toolName: 'Bash' });
    expect(events[2]).toMatchObject({ toolId: 'item_1', output: 'ok\n' });
    expect(events[3]).toMatchObject({ text: 'thinking', role: 'assistant' });
    expect(events[4]).toMatchObject({ finishReason: 'done' });
  });

  it('emits error event on invalid JSON', () => {
    const parser = new CodexParser('codex-err', teamContext);
    const events = parser.parseChunk(Buffer.from('{"type":"turn.started"}\n{invalid}\n'));
    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any).code).toBe('JSONL_PARSE_ERROR');
  });
});
