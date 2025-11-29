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
  category?: string;
}

export interface ToolStartedEvent extends AgentEventBase {
  type: 'tool.started';
  toolName: string;
  toolId: string;
  input: Record<string, any>;
}

export interface ToolCompletedEvent extends AgentEventBase {
  type: 'tool.completed';
  toolName: string;
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

// ===== Todo List Types =====

/**
 * Status of a todo item.
 * - 'pending': Task not yet started
 * - 'in_progress': Task currently being worked on
 * - 'completed': Task finished successfully
 * - 'cancelled': Task was cancelled (Gemini only)
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * A single todo item in a todo list.
 */
export interface TodoItem {
  /** Task description (required, non-empty) */
  text: string;
  /** Current status of the task */
  status: TodoStatus;
}

/**
 * Event emitted when an agent updates its todo list.
 * Each event carries the full list of items (not deltas).
 * UI should replace the previous list entirely.
 */
export interface TodoListEvent extends AgentEventBase {
  type: 'todo_list';
  /** Unique identifier for this todo list instance */
  todoId: string;
  /** Complete list of todo items (replaces previous list) */
  items: TodoItem[];
}

/**
 * Validate a TodoItem. Returns true if valid.
 * Invalid items should be skipped (not crash).
 */
export function isValidTodoItem(item: unknown): item is TodoItem {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.text !== 'string' || obj.text.trim() === '') return false;
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(obj.status as string)) return false;
  return true;
}

// ===== End Todo List Types =====

export type AgentEvent =
  | SessionStartedEvent
  | TextEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | TurnCompletedEvent
  | ErrorEvent
  | TodoListEvent;
