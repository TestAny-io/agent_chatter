import { randomUUID } from 'crypto';
import type { AgentEvent, AgentType, TodoItem, TodoStatus } from '../AgentEvent.js';
import { isValidTodoItem } from '../AgentEvent.js';
import type { StreamParser } from '../StreamParser.js';
import type { TeamContext } from '../../models/Team.js';

export class ClaudeCodeParser implements StreamParser {
  private buffer = '';
  private readonly agentType: AgentType = 'claude-code';
  private toolIdToName = new Map<string, string>();

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
    this.toolIdToName.clear();
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
            // Check for TodoWrite - emit TodoListEvent instead of tool.started
            if (item.name === 'TodoWrite') {
              const todoEvent = this.parseTodoWriteEvent(item, base);
              if (todoEvent) {
                evs.push(todoEvent);
              }
              // Do NOT emit tool.started for TodoWrite (suppression)
            } else {
              // Track toolId -> toolName for tool.completed lookup
              this.toolIdToName.set(item.id, item.name);
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
        }
        return evs;
      }
      case 'user': {
        const content = json.message?.content || [];
        const evs: AgentEvent[] = [];
        for (const item of content) {
          if (item.type === 'tool_result') {
            const toolId = item.tool_use_id;
            evs.push({
              ...base,
              eventId: randomUUID(),
              type: 'tool.completed',
              toolName: this.toolIdToName.get(toolId) || 'unknown',
              toolId,
              output: item.content || '',
              error: item.is_error ? item.content : undefined
            });
          }
        }
        return evs;
      }
      case 'tool_use':
        // Check for TodoWrite - emit TodoListEvent instead of tool.started
        if (json.name === 'TodoWrite') {
          const todoEvent = this.parseTodoWriteEvent(json, base);
          return todoEvent ? [todoEvent] : [];
        }
        // Track toolId -> toolName for tool.completed lookup
        this.toolIdToName.set(json.id, json.name);
        return [{
          ...base,
          type: 'tool.started',
          toolName: json.name,
          toolId: json.id,
          input: json.input || {}
        }];
      case 'tool_result': {
        const toolId = json.tool_use_id;
        return [{
          ...base,
          type: 'tool.completed',
          toolName: this.toolIdToName.get(toolId) || 'unknown',
          toolId,
          output: typeof json.content === 'string' ? json.content : undefined,
          error: json.is_error ? json.content : undefined
        }];
      }
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

  /**
   * Parse Claude TodoWrite tool call into unified TodoListEvent.
   */
  private parseTodoWriteEvent(item: any, base: any): AgentEvent | null {
    const input = item.input;
    if (!input || !Array.isArray(input.todos)) {
      return null;
    }

    const items: TodoItem[] = [];
    for (const todoItem of input.todos) {
      const mapped: TodoItem = {
        text: todoItem.content,
        status: todoItem.status as TodoStatus
      };
      if (isValidTodoItem(mapped)) {
        items.push(mapped);
      }
    }

    return {
      ...base,
      eventId: randomUUID(),
      type: 'todo_list',
      todoId: item.id || randomUUID(),
      items
    };
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

  // Minimal instrumentation to detect empty/idle streams during debugging
  // Note: avoid noisy logging in production; only used when consumers log AgentEvent:error
  private parseNoopEvent(): AgentEvent {
    return {
      type: 'error',
      eventId: randomUUID(),
      agentId: this.agentId,
      agentType: this.agentType,
      teamMetadata: this.teamContext,
      timestamp: Date.now(),
      error: 'No data received before parser fallback',
      code: 'NO_DATA'
    };
  }
}
