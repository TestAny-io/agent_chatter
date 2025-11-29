import { randomUUID } from 'crypto';
import type { AgentEvent, AgentType, TodoItem } from '../AgentEvent.js';
import { isValidTodoItem } from '../AgentEvent.js';
import type { StreamParser } from '../StreamParser.js';
import type { TeamContext } from '../../models/Team.js';

/**
 * Parse Codex --json (JSONL) streaming output into unified AgentEvent objects.
 *
 * Key event mappings (see design/streaming-event-display.md):
 * - thread.started -> session.started
 * - item.started (command_execution/file_change) -> tool.started
 * - item.completed (reasoning/agent_message) -> text
 * - item.completed (command_execution/file_change) -> tool.completed
 * - turn.completed -> turn.completed
 */
export class CodexParser implements StreamParser {
  private buffer = '';
  private readonly agentType: AgentType = 'openai-codex';

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
        const ev = this.jsonToEvent(json);
        if (ev) return [ev];
      } catch {
        // fall through to text
      }
      return [this.fallbackTextEvent(text)];
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
      case 'thread.started':
        return { ...base, type: 'session.started' };

      case 'item.started':
      case 'item.updated': {
        const itemType = json.item?.type;

        // Handle todo_list items
        if (itemType === 'todo_list') {
          return this.parseTodoListEvent(json, base);
        }

        // Handle tool items (only for item.started)
        if (json.type === 'item.started') {
          const toolName = this.mapToolName(itemType);
          if (toolName) {
            return {
              ...base,
              type: 'tool.started',
              toolName,
              toolId: json.item.id,
              input: {
                command: json.item.command,
                path: json.item.path,
                content: json.item.content
              }
            };
          }
        }
        return null;
      }

      case 'item.completed': {
        const itemType = json.item?.type;

        // Handle todo_list completion
        if (itemType === 'todo_list') {
          return this.parseTodoListEvent(json, base);
        }

        if (itemType === 'reasoning') {
          return {
            ...base,
            type: 'text',
            text: json.item.text,
            role: 'assistant',
            category: 'reasoning'
          };
        }

        if (itemType === 'agent_message') {
          return {
            ...base,
            type: 'text',
            text: json.item.text,
            role: 'assistant',
            category: 'message'
          };
        }

        if (itemType === 'command_execution' || itemType === 'file_change' || itemType === 'file_read' || itemType === 'web_search') {
          return {
            ...base,
            type: 'tool.completed',
            toolId: json.item.id,
            output: json.item.aggregated_output || '',
            error: json.item.exit_code && json.item.exit_code !== 0
              ? `Exit code: ${json.item.exit_code}`
              : undefined
          };
        }
        return null;
      }

      case 'turn.completed':
        return {
          ...base,
          type: 'turn.completed',
          finishReason: 'done'
        };

      default:
        return null;
    }
  }

  /**
   * Parse Codex todo_list item into unified TodoListEvent.
   * Validates items and skips invalid ones.
   */
  private parseTodoListEvent(json: any, base: any): AgentEvent | null {
    const item = json.item;
    if (!item || !Array.isArray(item.items)) {
      return null;
    }

    const items: TodoItem[] = [];
    for (const todoItem of item.items) {
      const mapped: TodoItem = {
        text: todoItem.text,
        status: todoItem.completed ? 'completed' : 'pending'
      };
      if (isValidTodoItem(mapped)) {
        items.push(mapped);
      }
    }

    return {
      ...base,
      type: 'todo_list',
      todoId: item.id || randomUUID(),
      items
    };
  }

  private mapToolName(itemType?: string): string | null {
    if (!itemType) return null;
    const mapping: Record<string, string> = {
      command_execution: 'Bash',
      file_change: 'Write',
      file_read: 'Read',
      web_search: 'WebSearch'
    };
    return mapping[itemType] || itemType;
  }

  private fallbackTextEvent(text: string): AgentEvent {
    return {
      type: 'text',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      text
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
