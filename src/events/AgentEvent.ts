import type { TeamContext } from '../models/Team.js';

export type AgentType = 'claude-code' | 'openai-codex' | 'google-gemini';

export interface AgentEventBase {
  eventId: string;
  agentId: string;
  agentType: AgentType;
  timestamp: number;
  teamMetadata: TeamContext;
}

export interface SessionStartedEvent extends AgentEventBase {
  type: 'session.started';
}

export interface TextEvent extends AgentEventBase {
  type: 'text';
  text: string;
  role?: 'assistant' | 'system';
}

export interface ToolStartedEvent extends AgentEventBase {
  type: 'tool.started';
  toolName: string;
  toolId: string;
  input: Record<string, any>;
}

export interface ToolCompletedEvent extends AgentEventBase {
  type: 'tool.completed';
  toolId: string;
  output?: string;
  error?: string;
}

export interface TurnCompletedEvent extends AgentEventBase {
  type: 'turn.completed';
  finishReason: 'done' | 'error' | 'cancelled' | 'timeout';
}

export interface ErrorEvent extends AgentEventBase {
  type: 'error';
  error: string;
  code?: string;
  stack?: string;
}

export type AgentEvent =
  | SessionStartedEvent
  | TextEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | TurnCompletedEvent
  | ErrorEvent;

