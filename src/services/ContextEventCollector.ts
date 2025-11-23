import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import type { AgentEvent } from '../events/AgentEvent.js';

export interface ContextSummary {
  agentId: string;
  agentName?: string;
  finishReason?: 'done' | 'error' | 'cancelled' | 'timeout';
  text: string;
  tools: Array<{
    name?: string;
    id?: string;
    input?: Record<string, any>;
    output?: string;
    error?: string;
  }>;
  errors: string[];
  timestamp: number;
}

interface CollectorOptions {
  projectRoot?: string;
  persist?: boolean;
  sessionId?: string;
  maxEvents?: number;
  maxSummaries?: number;
}

/**
 * ContextEventCollector
 * - Subscribes to agent-event bus
 * - Maintains recent raw events + per-turn summaries for context building
 * - Optional persistence to JSONL under .agent-chatter/logs
 */
export class ContextEventCollector {
  private rawEvents: AgentEvent[] = [];
  private summaries: ContextSummary[] = [];
  private turnBuffers: Map<string, AgentEvent[]> = new Map();
  private listener: ((ev: AgentEvent) => void) | null = null;
  private readonly maxEvents: number;
  private readonly maxSummaries: number;
  private readonly persist: boolean;
  private readonly projectRoot: string;
  private readonly sessionId: string;
  private eventsFilePath: string | null = null;
  private summariesFilePath: string | null = null;

  constructor(private emitter: EventEmitter, opts: CollectorOptions = {}) {
    this.maxEvents = opts.maxEvents ?? 1000;
    this.maxSummaries = opts.maxSummaries ?? 200;
    this.persist = opts.persist ?? true;
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.sessionId = opts.sessionId ?? `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    if (this.persist) {
      const baseDir = path.join(this.projectRoot, '.agent-chatter', 'logs');
      fs.mkdirSync(baseDir, { recursive: true });
      this.eventsFilePath = path.join(baseDir, `${this.sessionId}.jsonl`);
      this.summariesFilePath = path.join(baseDir, `${this.sessionId}-summary.jsonl`);
    }

    this.listener = (ev: AgentEvent) => this.handleEvent(ev);
    this.emitter.on('agent-event', this.listener);
  }

  dispose(): void {
    if (this.listener) {
      this.emitter.off('agent-event', this.listener);
      this.emitter.removeListener?.('agent-event', this.listener);
      this.listener = null;
    }
  }

  getRecentEvents(count: number): AgentEvent[] {
    return this.rawEvents.slice(-count);
  }

  getRecentSummaries(count: number): ContextSummary[] {
    return this.summaries.slice(-count);
  }

  getLogPaths(): { events?: string; summaries?: string } {
    return { events: this.eventsFilePath ?? undefined, summaries: this.summariesFilePath ?? undefined };
  }

  private handleEvent(event: AgentEvent): void {
    this.rawEvents.push(event);
    if (this.rawEvents.length > this.maxEvents) {
      this.rawEvents.splice(0, this.rawEvents.length - this.maxEvents);
    }

    if (this.persist && this.eventsFilePath) {
      fs.appendFile(this.eventsFilePath, JSON.stringify(event) + '\n', () => {});
    }

    // Buffer events per agent until turn.completed
    const buffer = this.turnBuffers.get(event.agentId) ?? [];
    buffer.push(event);
    this.turnBuffers.set(event.agentId, buffer);

    if (event.type === 'turn.completed') {
      const summary = this.buildSummary(buffer, event.finishReason);
      this.turnBuffers.delete(event.agentId);
      this.summaries.push(summary);
      if (this.summaries.length > this.maxSummaries) {
        this.summaries.splice(0, this.summaries.length - this.maxSummaries);
      }
      if (this.persist && this.summariesFilePath) {
        fs.appendFile(this.summariesFilePath, JSON.stringify(summary) + '\n', () => {});
      }
    }
  }

  private buildSummary(events: AgentEvent[], finishReason?: ContextSummary['finishReason']): ContextSummary {
    const texts: string[] = [];
    const tools: ContextSummary['tools'] = [];
    const errors: string[] = [];
    let ts = Date.now();
    let agentName: string | undefined;

    for (const ev of events) {
      ts = ev.timestamp || ts;
      if (!agentName) {
        agentName = ev.teamMetadata?.memberDisplayName || ev.agentId;
      }
      if (ev.type === 'text' && ev.text) {
        texts.push(ev.text);
      } else if (ev.type === 'tool.started') {
        tools.push({ name: ev.toolName, id: ev.toolId, input: ev.input });
      } else if (ev.type === 'tool.completed') {
        tools.push({ name: 'tool-result', id: ev.toolId, output: ev.output, error: ev.error });
      } else if (ev.type === 'error' && ev.error) {
        errors.push(ev.error);
      }
    }

    return {
      agentId: events[0]?.agentId ?? '',
      agentName,
      finishReason: finishReason ?? 'done',
      text: texts.join('\n'),
      tools,
      errors,
      timestamp: ts
    };
  }
}
