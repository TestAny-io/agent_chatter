/**
 * InMemorySessionStorage Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStorage } from '../../../src/infrastructure/InMemorySessionStorage.js';
import type { SessionSnapshot } from '../../../src/models/SessionSnapshot.js';

describe('InMemorySessionStorage', () => {
  let storage: InMemorySessionStorage;

  // Create a valid test snapshot
  const createTestSnapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
    schemaVersion: '1.0',
    teamId: 'test-team',
    sessionId: 'test-session-123',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
    context: {
      messages: [
        {
          id: 'msg-1',
          content: 'Hello',
          timestamp: '2024-01-15T10:00:00.000Z',
          speaker: {
            id: 'human-1',
            name: 'Human',
            displayName: 'User',
            type: 'human',
          },
        },
      ],
      teamTask: 'Test task',
    },
    metadata: {
      messageCount: 1,
      summary: 'Test conversation',
    },
    ...overrides,
  });

  beforeEach(() => {
    storage = new InMemorySessionStorage();
  });

  describe('saveSession', () => {
    it('should save session to memory', async () => {
      const snapshot = createTestSnapshot();

      await storage.saveSession('test-team', snapshot);

      expect(storage.hasSession('test-team', 'test-session-123')).toBe(true);
      expect(storage.getSessionCount('test-team')).toBe(1);
    });

    it('should update updatedAt timestamp', async () => {
      const snapshot = createTestSnapshot({
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const before = Date.now();
      await storage.saveSession('test-team', snapshot);
      const after = Date.now();

      const loaded = await storage.loadSession('test-team', 'test-session-123');
      expect(loaded).not.toBeNull();

      const updatedTime = new Date(loaded!.updatedAt).getTime();
      expect(updatedTime).toBeGreaterThanOrEqual(before);
      expect(updatedTime).toBeLessThanOrEqual(after);
    });

    it('should clone data to prevent external mutations', async () => {
      const snapshot = createTestSnapshot();
      await storage.saveSession('test-team', snapshot);

      // Mutate original
      snapshot.context.teamTask = 'Mutated task';

      const loaded = await storage.loadSession('test-team', 'test-session-123');
      expect(loaded!.context.teamTask).toBe('Test task');
    });
  });

  describe('loadSession', () => {
    it('should load saved session', async () => {
      const snapshot = createTestSnapshot();
      await storage.saveSession('test-team', snapshot);

      const loaded = await storage.loadSession('test-team', 'test-session-123');

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe('test-session-123');
      expect(loaded!.context.messages).toHaveLength(1);
    });

    it('should return null for non-existent session', async () => {
      const loaded = await storage.loadSession('test-team', 'non-existent');

      expect(loaded).toBeNull();
    });

    it('should return null for non-existent team', async () => {
      const loaded = await storage.loadSession('non-existent-team', 'test-session');

      expect(loaded).toBeNull();
    });

    it('should return clone to prevent external mutations', async () => {
      await storage.saveSession('test-team', createTestSnapshot());

      const loaded1 = await storage.loadSession('test-team', 'test-session-123');
      loaded1!.context.teamTask = 'Mutated';

      const loaded2 = await storage.loadSession('test-team', 'test-session-123');
      expect(loaded2!.context.teamTask).toBe('Test task');
    });
  });

  describe('getLatestSession', () => {
    it('should return most recent session by updatedAt', async () => {
      // Save sessions with different timestamps
      await storage.saveSession('test-team', createTestSnapshot({
        sessionId: 'session-1',
        updatedAt: '2024-01-15T10:00:00.000Z',
      }));

      await new Promise(resolve => setTimeout(resolve, 10));

      await storage.saveSession('test-team', createTestSnapshot({
        sessionId: 'session-2',
        updatedAt: '2024-01-15T11:00:00.000Z',
      }));

      const latest = await storage.getLatestSession('test-team');

      expect(latest).not.toBeNull();
      expect(latest!.sessionId).toBe('session-2');
    });

    it('should return null for team with no sessions', async () => {
      const latest = await storage.getLatestSession('non-existent-team');

      expect(latest).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('should list all sessions for team', async () => {
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-1' }));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-2' }));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-3' }));

      const summaries = await storage.listSessions('test-team');

      expect(summaries).toHaveLength(3);
    });

    it('should return empty array for team with no sessions', async () => {
      const summaries = await storage.listSessions('non-existent-team');

      expect(summaries).toEqual([]);
    });

    it('should sort by updatedAt descending', async () => {
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-1' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-2' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-3' }));

      const summaries = await storage.listSessions('test-team');

      // Most recent first
      expect(summaries[0].sessionId).toBe('session-3');
      expect(summaries[2].sessionId).toBe('session-1');
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', async () => {
      await storage.saveSession('test-team', createTestSnapshot());

      await storage.deleteSession('test-team', 'test-session-123');

      expect(storage.hasSession('test-team', 'test-session-123')).toBe(false);
      expect(storage.getSessionCount('test-team')).toBe(0);
    });

    it('should be idempotent (no error on non-existent)', async () => {
      // Should not throw
      await storage.deleteSession('non-existent-team', 'non-existent-session');
    });
  });

  describe('test helpers', () => {
    it('clear() should remove all sessions', async () => {
      await storage.saveSession('team-1', createTestSnapshot({ sessionId: 'session-1' }));
      await storage.saveSession('team-2', createTestSnapshot({ sessionId: 'session-2' }));

      expect(storage.getSessionCount()).toBe(2);

      storage.clear();

      expect(storage.getSessionCount()).toBe(0);
    });

    it('getSessionCount() should return correct counts', async () => {
      await storage.saveSession('team-1', createTestSnapshot({ sessionId: 'session-1' }));
      await storage.saveSession('team-1', createTestSnapshot({ sessionId: 'session-2' }));
      await storage.saveSession('team-2', createTestSnapshot({ sessionId: 'session-3' }));

      expect(storage.getSessionCount()).toBe(3);
      expect(storage.getSessionCount('team-1')).toBe(2);
      expect(storage.getSessionCount('team-2')).toBe(1);
      expect(storage.getSessionCount('team-3')).toBe(0);
    });

    it('hasSession() should check existence correctly', async () => {
      await storage.saveSession('test-team', createTestSnapshot());

      expect(storage.hasSession('test-team', 'test-session-123')).toBe(true);
      expect(storage.hasSession('test-team', 'non-existent')).toBe(false);
      expect(storage.hasSession('non-existent-team', 'test-session-123')).toBe(false);
    });
  });
});
