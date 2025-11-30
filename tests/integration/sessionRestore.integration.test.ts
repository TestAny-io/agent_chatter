/**
 * Session Restore Integration Tests
 *
 * Tests the complete session save/restore flow without mocking storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStorageService } from '../../src/infrastructure/SessionStorageService.js';
import { createSessionSnapshot, type ContextSnapshot } from '../../src/models/SessionSnapshot.js';
import type { ConversationSession } from '../../src/models/ConversationSession.js';

describe('Session Restore Integration', () => {
  let tempDir: string;
  let storage: SessionStorageService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-integration-'));
    storage = new SessionStorageService(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createSessionSnapshot', () => {
    it('should create valid snapshot from session and context', () => {
      const session: ConversationSession = {
        id: 'session-123',
        teamId: 'team-456',
        teamName: 'Test Team',
        title: 'Test Conversation',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        updatedAt: new Date('2024-01-15T11:00:00Z'),
        status: 'active',
        teamTask: 'Help with coding',
        messages: [],
        stats: {
          totalMessages: 5,
          messagesByRole: { 'human-1': 2, 'ai-1': 3 },
          duration: 3600000,
        },
      };

      const contextSnapshot: ContextSnapshot = {
        messages: [
          {
            id: 'msg-1',
            content: 'Hello',
            timestamp: new Date('2024-01-15T10:00:00.000Z'),
            speaker: {
              id: 'human-1',
              name: 'human',
              displayName: 'User',
              type: 'human',
            },
          },
        ],
        teamTask: 'Help with coding',
        timestamp: Date.now(),
        version: 1,
      };

      const snapshot = createSessionSnapshot(session, contextSnapshot);

      expect(snapshot.schemaVersion).toBe('1.0');
      expect(snapshot.teamId).toBe('team-456');
      expect(snapshot.sessionId).toBe('session-123');
      expect(snapshot.context.messages).toHaveLength(1);
      expect(snapshot.metadata.messageCount).toBe(1);
    });
  });

  describe('full save/restore cycle', () => {
    it('should save and restore session with all data intact', async () => {
      // Create original session
      const session: ConversationSession = {
        id: 'test-session',
        teamId: 'test-team',
        teamName: 'Integration Test Team',
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active',
        teamTask: 'Integration testing',
        messages: [],
        stats: { totalMessages: 3, messagesByRole: {}, duration: 0 },
      };

      const contextSnapshot: ContextSnapshot = {
        messages: [
          {
            id: 'msg-1',
            content: 'First message',
            timestamp: new Date(),
            speaker: { id: 'human-1', name: 'human', displayName: 'User', type: 'human' },
          },
          {
            id: 'msg-2',
            content: 'AI response',
            timestamp: new Date(),
            speaker: { id: 'ai-1', name: 'assistant', displayName: 'AI', type: 'ai' },
          },
          {
            id: 'msg-3',
            content: 'Follow up',
            timestamp: new Date(),
            speaker: { id: 'human-1', name: 'human', displayName: 'User', type: 'human' },
          },
        ],
        teamTask: 'Integration testing',
        timestamp: Date.now(),
        version: 1,
      };

      const snapshot = createSessionSnapshot(session, contextSnapshot);

      // Save
      await storage.saveSession('test-team', snapshot);

      // Load
      const restored = await storage.loadSession('test-team', 'test-session');

      // Verify
      expect(restored).not.toBeNull();
      expect(restored!.sessionId).toBe('test-session');
      expect(restored!.teamId).toBe('test-team');
      expect(restored!.context.messages).toHaveLength(3);
      expect(restored!.context.teamTask).toBe('Integration testing');
      expect(restored!.metadata.messageCount).toBe(3);

      // Verify message content preserved
      expect(restored!.context.messages[0].content).toBe('First message');
      expect(restored!.context.messages[1].content).toBe('AI response');
      expect(restored!.context.messages[2].content).toBe('Follow up');

      // Verify speaker info preserved
      expect(restored!.context.messages[0].speaker.type).toBe('human');
      expect(restored!.context.messages[1].speaker.type).toBe('ai');
    });

    it('should handle multiple sessions for same team', async () => {
      const createSnapshot = (sessionId: string, messageCount: number) => {
        const session: ConversationSession = {
          id: sessionId,
          teamId: 'multi-session-team',
          teamName: 'Test',
          title: 'Test',
          createdAt: new Date(),
          updatedAt: new Date(),
          status: 'active',
          teamTask: 'Test',
          messages: [],
          stats: { totalMessages: messageCount, messagesByRole: {}, duration: 0 },
        };

        const messages = Array.from({ length: messageCount }, (_, i) => ({
          id: `msg-${i}`,
          content: `Message ${i}`,
          timestamp: new Date(),
          speaker: { roleId: 'human-1', roleName: 'human', roleTitle: 'User', type: 'human' as const },
        }));

        return createSessionSnapshot(session, {
          messages,
          teamTask: 'Test',
          timestamp: Date.now(),
          version: 1,
        });
      };

      // Save multiple sessions
      await storage.saveSession('multi-session-team', createSnapshot('session-1', 2));
      await new Promise(r => setTimeout(r, 10));
      await storage.saveSession('multi-session-team', createSnapshot('session-2', 5));
      await new Promise(r => setTimeout(r, 10));
      await storage.saveSession('multi-session-team', createSnapshot('session-3', 3));

      // List should return all sessions
      const summaries = await storage.listSessions('multi-session-team');
      expect(summaries).toHaveLength(3);

      // Latest should be session-3
      const latest = await storage.getLatestSession('multi-session-team');
      expect(latest?.sessionId).toBe('session-3');

      // Can load specific session
      const session1 = await storage.loadSession('multi-session-team', 'session-1');
      expect(session1?.context.messages).toHaveLength(2);

      const session2 = await storage.loadSession('multi-session-team', 'session-2');
      expect(session2?.context.messages).toHaveLength(5);
    });

    it('should handle special characters in messages', async () => {
      const session: ConversationSession = {
        id: 'special-chars-session',
        teamId: 'test-team',
        teamName: 'Test',
        title: 'Test',
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active',
        teamTask: 'Test',
        messages: [],
        stats: { totalMessages: 1, messagesByRole: {}, duration: 0 },
      };

      const specialContent = `Test with special chars:
- Quotes: "double" and 'single'
- Unicode: \u00e9\u00e8\u00ea \u4e2d\u6587 \ud83d\ude00
- Newlines:
  multiple
  lines
- Backslash: C:\\Users\\test
- HTML-like: <script>alert('test')</script>`;

      const contextSnapshot: ContextSnapshot = {
        messages: [{
          id: 'msg-1',
          content: specialContent,
          timestamp: new Date(),
          speaker: { id: 'human-1', name: 'human', displayName: 'User', type: 'human' },
        }],
        teamTask: 'Test',
        timestamp: Date.now(),
        version: 1,
      };

      const snapshot = createSessionSnapshot(session, contextSnapshot);
      await storage.saveSession('test-team', snapshot);

      const restored = await storage.loadSession('test-team', 'special-chars-session');
      expect(restored!.context.messages[0].content).toBe(specialContent);
    });
  });

  describe('error handling', () => {
    it('should handle corrupted JSON gracefully', async () => {
      // Create team directory and corrupted file
      const teamDir = path.join(tempDir, 'corrupted-team');
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, '1234567890-bad-session.json'),
        '{ invalid json content'
      );

      // Should return null, not throw
      const result = await storage.loadSession('corrupted-team', 'bad-session');
      expect(result).toBeNull();

      // Latest should also handle gracefully
      const latest = await storage.getLatestSession('corrupted-team');
      expect(latest).toBeNull();
    });
  });
});
