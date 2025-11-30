/**
 * ISessionStorage - Session storage interface
 *
 * Supports dependency injection for testing:
 * - Production: SessionStorageService (file-based)
 * - Testing: InMemorySessionStorage
 */

import type { SessionSnapshot, SessionSummary } from '../models/SessionSnapshot.js';

/**
 * Session storage interface
 */
export interface ISessionStorage {
  /**
   * Save a session snapshot
   *
   * @param teamId - Team identifier (used for directory grouping)
   * @param snapshot - Complete session snapshot to persist
   * @throws Error if write fails (disk full, permission denied, etc.)
   */
  saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void>;

  /**
   * Load a specific session by ID
   *
   * @param teamId - Team identifier
   * @param sessionId - Session identifier
   * @returns SessionSnapshot if found and valid, null otherwise
   *
   * Returns null for:
   * - Session not found
   * - File corrupted (invalid JSON)
   * - Schema version incompatible
   */
  loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null>;

  /**
   * Get the most recent session for a team
   *
   * @param teamId - Team identifier
   * @returns Most recent valid SessionSnapshot, or null if none exist
   *
   * Skips corrupted/incompatible files and returns next valid one.
   */
  getLatestSession(teamId: string): Promise<SessionSnapshot | null>;

  /**
   * List all sessions for a team (summaries only)
   *
   * @param teamId - Team identifier
   * @returns Array of SessionSummary, sorted by updatedAt descending (newest first)
   *
   * Skips corrupted/incompatible files silently.
   */
  listSessions(teamId: string): Promise<SessionSummary[]>;

  /**
   * Delete a session
   *
   * @param teamId - Team identifier
   * @param sessionId - Session identifier
   *
   * No-op if session doesn't exist (idempotent).
   */
  deleteSession(teamId: string, sessionId: string): Promise<void>;
}
