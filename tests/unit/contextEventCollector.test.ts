import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ContextEventCollector } from '../../src/services/ContextEventCollector.js';
import type { AgentEvent } from '../../src/events/AgentEvent.js';

const baseEvent = {
  agentId: 'agent-1',
  agentType: 'claude-code' as const,
  teamMetadata: {
    teamName: 'team',
    memberName: 'agent-1',
    memberDisplayName: 'Agent One',
    memberRole: 'dev'
  },
  timestamp: Date.now()
};

describe('ContextEventCollector', () => {
  let emitter: EventEmitter;
  let tmpDir: string;

  beforeEach(() => {
    emitter = new EventEmitter();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collects summaries and raw events, persists to disk', async () => {
    const collector = new ContextEventCollector(emitter, {
      projectRoot: tmpDir,
      persist: true,
      maxEvents: 10,
      maxSummaries: 5
    });

    const events: AgentEvent[] = [
      { ...baseEvent, eventId: '1', type: 'session.started' },
      { ...baseEvent, eventId: '2', type: 'text', text: 'hello' },
      { ...baseEvent, eventId: '3', type: 'tool.started', toolName: 'Bash', toolId: 't1', input: {} },
      { ...baseEvent, eventId: '4', type: 'tool.completed', toolId: 't1', output: 'done' },
      { ...baseEvent, eventId: '5', type: 'turn.completed', finishReason: 'done' }
    ];

    events.forEach(ev => emitter.emit('agent-event', ev));

    const summaries = collector.getRecentSummaries(1);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].text).toContain('hello');
    expect(summaries[0].tools.length).toBeGreaterThan(0);

    await new Promise(resolve => setTimeout(resolve, 10));
    const files = collector.getLogPaths();
    expect(files.events && fs.existsSync(files.events)).toBe(true);
    expect(files.summaries && fs.existsSync(files.summaries)).toBe(true);

    collector.dispose();
  });
});
