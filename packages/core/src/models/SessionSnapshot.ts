/**
 * SessionSnapshot - Session persistence types
 *
 * This module defines types for persisting and restoring conversation sessions.
 * Storage path: ~/.agent-chatter/sessions/<teamId>/<timestamp>-<sessionId>.json
 *
 * Speaker field strategy:
 * - Write path: Always use new format (id/name/displayName)
 * - Read path: Accept both formats, migrate legacy to new
 */

import type { ContextSnapshot } from '../context/types.js';
import type { ConversationMessage } from './ConversationMessage.js';
import type { ConversationSession } from './ConversationSession.js';
import type { SpeakerInfo } from './SpeakerInfo.js';

/**
 * Current schema version for session snapshots
 */
export const SESSION_SNAPSHOT_SCHEMA_VERSION = '1.0' as const;

/**
 * Persisted message format (for session snapshots)
 * Uses new speaker format (id/name/displayName)
 */
export interface PersistedMessage {
  id: string;
  timestamp: string;  // ISO 8601 format for JSON serialization
  speaker: SpeakerInfo;  // Always new format in persisted data
  content: string;
  routing?: {
    rawNextMarkers: string[];
    resolvedAddressees: Array<{
      identifier: string;
      memberId: string | null;
      memberName: string | null;
    }>;
  };
}

/**
 * Persisted context snapshot
 * Uses PersistedMessage with SpeakerInfo (new format)
 */
export interface PersistedContextSnapshot {
  messages: PersistedMessage[];
  teamTask: string | null;
  timestamp: number;
  version: 1;
}

/**
 * Metadata for session display and restore logic
 */
export interface SessionMetadata {
  /**
   * Last speaker's ID (for display/debug)
   * Uses speaker.id (new format)
   */
  lastSpeakerId?: string;

  /**
   * Total message count (for quick display without parsing messages)
   */
  messageCount: number;

  /**
   * Human-readable summary for restore prompt
   * Format: "{count} messages - \"{preview}...\""
   */
  summary?: string;
}

/**
 * Persisted session snapshot
 * Storage path: ~/.agent-chatter/sessions/<teamId>/<timestamp>-<sessionId>.json
 */
export interface SessionSnapshot {
  /**
   * Schema version for file format migration
   * Current: "1.0"
   */
  schemaVersion: '1.0';

  /**
   * Team identifier
   * Must match current team on restore
   */
  teamId: string;

  /**
   * Unique session identifier
   * Format: session-<timestamp>-<random>
   */
  sessionId: string;

  /**
   * Session creation timestamp
   * Format: ISO 8601 (e.g., "2025-11-27T10:30:00.000Z")
   */
  createdAt: string;

  /**
   * Last update timestamp
   * Format: ISO 8601
   */
  updatedAt: string;

  /**
   * Core context data with persisted message format
   *
   * Note: Uses PersistedContextSnapshot with SpeakerInfo (new format).
   * Does NOT include todos (todos are UI state, not persisted).
   */
  context: PersistedContextSnapshot;

  /**
   * Additional metadata for restore logic and display
   */
  metadata: SessionMetadata;
}

/**
 * Lightweight session info for listing
 * Used by listSessions() to avoid loading full snapshots
 */
export interface SessionSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
}

/**
 * Convert ConversationMessage to PersistedMessage
 * Now uses new format directly (no migration needed since ConversationMessage uses new format)
 */
function toPersistedMessage(msg: ConversationMessage): PersistedMessage {
  // Convert routing to use new field names
  const routing = msg.routing ? {
    rawNextMarkers: msg.routing.rawNextMarkers,
    resolvedAddressees: msg.routing.resolvedAddressees.map(addr => ({
      identifier: addr.identifier,
      memberId: addr.memberId,
      memberName: addr.memberName,
    })),
  } : undefined;

  return {
    id: msg.id,
    timestamp: msg.timestamp instanceof Date
      ? msg.timestamp.toISOString()
      : String(msg.timestamp),
    speaker: msg.speaker,  // Already in new format
    content: msg.content,
    routing,
  };
}

/**
 * Create a new SessionSnapshot from current session state
 */
export function createSessionSnapshot(
  session: ConversationSession,
  contextSnapshot: ContextSnapshot
): SessionSnapshot {
  const messages = contextSnapshot.messages;
  const lastMessage = messages[messages.length - 1];

  // Convert messages to persisted format
  const persistedMessages = messages.map(toPersistedMessage);
  const persistedContext: PersistedContextSnapshot = {
    messages: persistedMessages,
    teamTask: contextSnapshot.teamTask,
    timestamp: contextSnapshot.timestamp,
    version: 1,
  };

  return {
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    teamId: session.teamId,
    sessionId: session.id,
    createdAt: session.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
    context: persistedContext,
    metadata: {
      lastSpeakerId: lastMessage?.speaker.id,
      messageCount: messages.length,
      summary: generateSummary(messages),
    },
  };
}

/**
 * Generate human-readable summary from messages
 */
function generateSummary(messages: ConversationMessage[]): string {
  if (messages.length === 0) {
    return 'Empty conversation';
  }

  const firstMsg = messages[0];
  const preview = firstMsg.content.substring(0, 50);
  const ellipsis = firstMsg.content.length > 50 ? '...' : '';

  return `${messages.length} messages - "${preview}${ellipsis}"`;
}

/**
 * Extract SessionSummary from SessionSnapshot
 * For use in listSessions() to avoid returning full context
 */
export function extractSessionSummary(snapshot: SessionSnapshot): SessionSummary {
  return {
    sessionId: snapshot.sessionId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    messageCount: snapshot.metadata.messageCount,
    summary: snapshot.metadata.summary,
  };
}
