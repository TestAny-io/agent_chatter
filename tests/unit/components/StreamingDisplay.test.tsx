import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StreamingDisplay } from '../../../src/repl/components/StreamingDisplay.js';
import type { AgentEvent } from '../../../src/events/AgentEvent.js';

const baseEvent = {
  agentId: 'agent-1',
  agentType: 'claude-code',
  teamMetadata: {
    teamName: 'team',
    memberName: 'member',
    memberDisplayName: 'Member',
    memberRole: 'dev'
  },
  timestamp: Date.now()
} as const;

describe('StreamingDisplay', () => {
  it('renders recent streaming events with labels', () => {
    const events: AgentEvent[] = [
      { ...baseEvent, eventId: '1', type: 'session.started' },
      { ...baseEvent, eventId: '2', type: 'text', text: 'hello', role: 'assistant' },
      { ...baseEvent, eventId: '3', type: 'tool.started', toolName: 'Bash', toolId: 't1', input: {} },
      { ...baseEvent, eventId: '4', type: 'tool.completed', toolId: 't1', output: 'done' },
      { ...baseEvent, eventId: '5', type: 'turn.completed', finishReason: 'done' }
    ];

    const { lastFrame } = render(<StreamingDisplay events={events} />);
    const frame = lastFrame();
    expect(frame).toContain('Streaming events');
    expect(frame).toContain('session started');
    expect(frame).toContain('hello');
    expect(frame).toContain('tool:start');
    expect(frame).toContain('turn completed');
  });
});
