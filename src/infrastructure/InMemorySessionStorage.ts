/**
 * InMemorySessionStorage - In-memory session storage for testing
 *
 * Features:
 * - No file I/O
 * - Fast execution
 * - Isolated per test (via clear())
 */

import type { ISessionStorage } from './ISessionStorage.js';
import type { SessionSnapshot, SessionSummary } from '../models/SessionSnapshot.js';
import { extractSessionSummary } from '../models/SessionSnapshot.js';

/**
 * In-memory session storage for unit testing
 */
export class InMemorySessionStorage implements ISessionStorage {
  // Map<teamId, Map<sessionId, SessionSnapshot>>
  private sessions: Map<string, Map<string, SessionSnapshot>> = new Map();

  async saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void> {
    if (!this.sessions.has(teamId)) {
      this.sessions.set(teamId, new Map());
    }

    // Clone to prevent external mutations
    const cloned: SessionSnapshot = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
      context: { ...snapshot.context },
      metadata: { ...snapshot.metadata },
    };

    this.sessions.get(teamId)!.set(snapshot.sessionId, cloned);
  }

  async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions) return null;

    const snapshot = teamSessions.get(sessionId);
    if (!snapshot) return null;

    // Return clone to prevent external mutations
    return {
      ...snapshot,
      context: { ...snapshot.context },
      metadata: { ...snapshot.metadata },
    };
  }

  async getLatestSession(teamId: string): Promise<SessionSnapshot | null> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions || teamSessions.size === 0) return null;

    // Find most recent by updatedAt
    const sorted = [...teamSessions.values()].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const latest = sorted[0];
    if (!latest) return null;

    // Return clone
    return {
      ...latest,
      context: { ...latest.context },
      metadata: { ...latest.metadata },
    };
  }

  async listSessions(teamId: string): Promise<SessionSummary[]> {
    const teamSessions = this.sessions.get(teamId);
    if (!teamSessions) return [];

    return [...teamSessions.values()]
      .map(s => extractSessionSummary(s))
      .sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
  }

  async deleteSession(teamId: string, sessionId: string): Promise<void> {
    this.sessions.get(teamId)?.delete(sessionId);
  }

  // Test helpers

  /**
   * Clear all sessions (call in beforeEach)
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get total session count (for assertions)
   */
  getSessionCount(teamId?: string): number {
    if (teamId) {
      return this.sessions.get(teamId)?.size ?? 0;
    }
    let total = 0;
    for (const teamSessions of this.sessions.values()) {
      total += teamSessions.size;
    }
    return total;
  }

  /**
   * Check if a specific session exists
   */
  hasSession(teamId: string, sessionId: string): boolean {
    return this.sessions.get(teamId)?.has(sessionId) ?? false;
  }
}
