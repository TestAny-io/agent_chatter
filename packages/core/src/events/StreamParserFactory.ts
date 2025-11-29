import type { StreamParser } from './StreamParser.js';
import { ClaudeCodeParser } from './parsers/ClaudeCodeParser.js';
import { GeminiParser } from './parsers/GeminiParser.js';
import { CodexParser } from './parsers/CodexParser.js';
import type { TeamContext } from '../models/Team.js';
import type { AgentType } from './AgentEvent.js';
import type { AgentEvent } from './AgentEvent.js';
import { randomUUID } from 'crypto';

export class StreamParserFactory {
  static create(agentType: string, agentId: string, teamContext: TeamContext): StreamParser {
    switch (agentType as AgentType) {
      case 'claude-code':
        return new ClaudeCodeParser(agentId, teamContext);
      case 'google-gemini':
        return new GeminiParser(agentId, teamContext);
      case 'openai-codex':
      case 'codex': // backward-compat alias used in existing configs
        return new CodexParser(agentId, teamContext);
      default:
        return new LineParser(agentId, agentType, teamContext);
    }
  }
}

class LineParser implements StreamParser {
  private buffer = '';

  constructor(
    private agentId: string,
    private agentType: string,
    private teamContext: TeamContext
  ) {}

  parseChunk(chunk: Buffer): AgentEvent[] {
    this.buffer += chunk.toString('utf-8');
    const events: AgentEvent[] = [];
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      events.push(this.textEvent(line));
    }
    return events;
  }

  flush(): AgentEvent[] {
    if (this.buffer.trim()) {
      const text = this.buffer;
      this.buffer = '';
      return [this.textEvent(text)];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }

  private textEvent(text: string): AgentEvent {
    return {
      type: 'text',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType as AgentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      text
    };
  }
}
