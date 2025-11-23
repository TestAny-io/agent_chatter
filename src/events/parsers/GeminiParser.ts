import { randomUUID } from 'crypto';
import type { AgentEvent, AgentType } from '../AgentEvent.js';
import type { StreamParser } from '../StreamParser.js';
import type { TeamContext } from '../../models/Team.js';

// Gemini stream-json is similar to Claude; map basic types
export class GeminiParser implements StreamParser {
  private buffer = '';
  private readonly agentType: AgentType = 'google-gemini';

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
        // fall through
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
      case 'init':
        return { ...base, type: 'session.started' };
      case 'message':
        return {
          ...base,
          type: 'text',
          text: json.content,
          role: ['assistant', 'system'].includes(json.role) ? json.role as 'assistant' | 'system' : undefined,
          category: json.role === 'assistant' ? 'message' : undefined
        };
      case 'tool_use':
        return {
          ...base,
          type: 'tool.started',
          toolName: json.tool_name ?? json.name,
          toolId: json.tool_id ?? json.id,
          input: json.parameters ?? json.input ?? {}
        };
      case 'tool_result':
        return {
          ...base,
          type: 'tool.completed',
          toolId: json.tool_id ?? json.tool_use_id,
          output: typeof json.output === 'string' ? json.output : json.output?.text ?? undefined,
          error: json.status && json.status !== 'success' ? json.status : undefined
        };
      case 'result':
        return {
          ...base,
          type: 'turn.completed',
          finishReason: json.status === 'success' ? 'done' : 'error'
        };
      default:
        return null;
    }
  }
}
