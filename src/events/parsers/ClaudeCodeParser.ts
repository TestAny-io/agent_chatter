import { randomUUID } from 'crypto';
import type { AgentEvent, AgentType } from '../AgentEvent.js';
import type { StreamParser } from '../StreamParser.js';
import type { TeamContext } from '../../models/Team.js';

export class ClaudeCodeParser implements StreamParser {
  private buffer = '';
  private readonly agentType: AgentType = 'claude-code';

  constructor(private agentId: string, private teamContext: TeamContext) {}

  parseChunk(chunk: Buffer): AgentEvent[] {
    this.buffer += chunk.toString('utf-8');
    const events: AgentEvent[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        const ev = this.jsonToEvent(json);
        if (ev) events.push(ev);
      } catch (err: any) {
        events.push({
          type: 'error',
          eventId: randomUUID(),
          agentId: this.agentId,
          agentType: this.agentType,
          teamMetadata: this.teamContext,
          timestamp: Date.now(),
          error: `Failed to parse JSONL: ${err?.message ?? String(err)}`,
          code: 'JSONL_PARSE_ERROR'
        });
      }
    }
    return events;
  }

  flush(): AgentEvent[] {
    if (this.buffer.trim()) {
      const text = this.buffer;
      this.buffer = '';
      try {
        const json = JSON.parse(text);
        const ev = this.jsonToEvent(json);
        if (ev) return [ev];
      } catch {
        // fall through to text event
      }
      return [{
        type: 'text',
        eventId: randomUUID(),
        agentId: this.agentId,
        agentType: this.agentType,
        teamMetadata: this.teamContext,
        timestamp: Date.now(),
        text
      }];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }

  private jsonToEvent(json: any): AgentEvent | null {
    const base = {
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now()
    };

    switch (json.type) {
      case 'system':
        if (json.subtype === 'init') {
          return { ...base, type: 'session.started' };
        }
        return null;
      case 'content_block_delta':
        if (json.delta?.type === 'text_delta') {
          return { ...base, type: 'text', text: json.delta.text, role: 'assistant' };
        }
        return null;
      case 'tool_use':
        return {
          ...base,
          type: 'tool.started',
          toolName: json.name,
          toolId: json.id,
          input: json.input || {}
        };
      case 'tool_result':
        return {
          ...base,
          type: 'tool.completed',
          toolId: json.tool_use_id,
          output: typeof json.content === 'string' ? json.content : undefined,
          error: json.is_error ? json.content : undefined
        };
      case 'message_stop':
        return {
          ...base,
          type: 'turn.completed',
          finishReason: json.stop_reason === 'end_turn' ? 'done' : 'error'
        };
      default:
        return null;
    }
  }
}
