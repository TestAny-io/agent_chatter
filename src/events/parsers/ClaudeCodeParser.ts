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
        const evs = this.jsonToEvents(json);
        if (evs.length) events.push(...evs);
      } catch (err: any) {
        events.push(this.parseErrorEvent(err));
        events.push(this.fallbackTextEvent(line));
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
        const evs = this.jsonToEvents(json);
        if (evs.length) return evs;
      } catch {
        // fall through to text event
      }
      return [this.fallbackTextEvent(text)];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }

  private jsonToEvents(json: any): AgentEvent[] {
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
          return [{ ...base, type: 'session.started' }];
        }
        return [];
      case 'content_block_delta':
        if (json.delta?.type === 'text_delta') {
          return [{ ...base, type: 'text', text: json.delta.text, role: 'assistant', category: 'assistant-message' }];
        }
        return [];
      case 'assistant': {
        const content = json.message?.content || [];
        const evs: AgentEvent[] = [];
        for (const item of content) {
          if (item.type === 'text') {
            evs.push({ ...base, eventId: randomUUID(), type: 'text', text: item.text, role: 'assistant', category: 'assistant-message' });
          } else if (item.type === 'tool_use') {
            evs.push({
              ...base,
              eventId: randomUUID(),
              type: 'tool.started',
              toolName: item.name,
              toolId: item.id,
              input: item.input || {}
            });
          }
        }
        return evs;
      }
      case 'user': {
        const content = json.message?.content || [];
        const evs: AgentEvent[] = [];
        for (const item of content) {
          if (item.type === 'tool_result') {
            evs.push({
              ...base,
              eventId: randomUUID(),
              type: 'tool.completed',
              toolId: item.tool_use_id,
              output: item.content || '',
              error: item.is_error ? item.content : undefined
            });
          }
        }
        return evs;
      }
      case 'tool_use':
        return [{
          ...base,
          type: 'tool.started',
          toolName: json.name,
          toolId: json.id,
          input: json.input || {}
        }];
      case 'tool_result':
        return [{
          ...base,
          type: 'tool.completed',
          toolId: json.tool_use_id,
          output: typeof json.content === 'string' ? json.content : undefined,
          error: json.is_error ? json.content : undefined
        }];
      case 'result': {
        const evs: AgentEvent[] = [];
        // Emit text event with result content for accumulation
        if (json.result && typeof json.result === 'string') {
          evs.push({
            ...base,
            eventId: randomUUID(),
            type: 'text',
            text: json.result,
            role: 'assistant',
            category: 'result'
          });
        }
        evs.push({
          ...base,
          eventId: randomUUID(),
          type: 'turn.completed',
          finishReason: json.is_error ? 'error' : 'done'
        });
        return evs;
      }
      case 'message_stop':
        return []; // ignore, rely on result
      default:
        return [];
    }
  }

  private fallbackTextEvent(text: string): AgentEvent {
    return {
      type: 'text',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      text,
      // Mark as result-like so downstream UI/accumulator can safely ignore/skip
      category: 'result'
    };
  }

  private parseErrorEvent(err: any): AgentEvent {
    return {
      type: 'error',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      error: `Failed to parse JSONL: ${err?.message ?? String(err)}`,
      code: 'JSONL_PARSE_ERROR'
    };
  }
}
