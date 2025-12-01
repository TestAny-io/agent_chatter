/**
 * ConversationCoordinator Session Persistence Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationCoordinator } from '../../../src/services/ConversationCoordinator.js';
import { InMemorySessionStorage } from '../../../src/infrastructure/InMemorySessionStorage.js';
import { createTestCoordinator, createTestTeam } from './testUtils.js';
import type { Team } from '../../../src/models/Team.js';
import type { SessionSnapshot, PersistedContextSnapshot } from '../../../src/models/SessionSnapshot.js';

describe('ConversationCoordinator Session Persistence', () => {
  let coordinator: ConversationCoordinator;
  let storage: InMemorySessionStorage;
  let team: Team;

  // Create a valid test snapshot using NEW speaker format (id/name/displayName)
  const createTestSnapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => {
    const defaultContext: PersistedContextSnapshot = {
      messages: [
        {
          id: 'msg-1',
          content: 'Hello from human',
          timestamp: '2024-01-15T10:00:00.000Z',
          speaker: {
            id: 'human-1',
            name: 'human-member',
            displayName: 'Human',
            type: 'human',
          },
        },
        {
          id: 'msg-2',
          content: 'Hello from AI',
          timestamp: '2024-01-15T10:01:00.000Z',
          speaker: {
            id: 'ai-1',
            name: 'ai-member',
            displayName: 'AI Assistant',
            type: 'ai',
          },
        },
      ],
      teamTask: 'Test task',
      timestamp: Date.now(),
      version: 1,
    };

    return {
      schemaVersion: '1.0',
      teamId: team?.id ?? 'test-team',
      sessionId: 'test-session-123',
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
      context: defaultContext,
      metadata: {
        messageCount: 2,
        summary: 'Test conversation',
      },
      ...overrides,
    };
  };

  // Create a legacy format snapshot for backwards compatibility testing
  const createLegacySnapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => {
    return {
      schemaVersion: '1.0',
      teamId: team?.id ?? 'test-team',
      sessionId: 'test-session-123',
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
      context: {
        messages: [
          {
            id: 'msg-1',
            content: 'Hello from human',
            timestamp: '2024-01-15T10:00:00.000Z',
            speaker: {
              roleId: 'human-1',
              roleName: 'human-member',
              roleTitle: 'Human',
              type: 'human',
            } as any, // Legacy format
          },
        ],
        teamTask: 'Test task',
        timestamp: Date.now(),
        version: 1,
      },
      metadata: {
        messageCount: 1,
        summary: 'Legacy test',
      },
      ...overrides,
    } as SessionSnapshot;
  };

  beforeEach(() => {
    storage = new InMemorySessionStorage();
    const result = createTestCoordinator({ sessionStorage: storage });
    coordinator = result.coordinator;
    team = createTestTeam();
  });

  describe('setTeam with restore', () => {
    it('should restore session when resumeSessionId provided', async () => {
      // Save a session first
      const snapshot = createTestSnapshot({ teamId: team.id });
      await storage.saveSession(team.id, snapshot);

      // Set team with resume option
      await coordinator.setTeam(team, { resumeSessionId: 'test-session-123' });

      // Coordinator should be in paused state after restore
      expect(coordinator.getStatus()).toBe('paused');
    });

    it('should throw error if session not found', async () => {
      await expect(
        coordinator.setTeam(team, { resumeSessionId: 'non-existent-session' })
      ).rejects.toThrow('not found');
    });

    it('should throw error if teamId mismatch', async () => {
      // Save a session with different teamId
      const snapshot = createTestSnapshot({ teamId: 'different-team' });
      await storage.saveSession('different-team', snapshot);

      await expect(
        coordinator.setTeam(team, { resumeSessionId: 'test-session-123' })
      ).rejects.toThrow('not found');
    });

    it('should work without resume option (fresh start)', async () => {
      await coordinator.setTeam(team);

      // Should start normally
      expect(coordinator.getStatus()).toBe('active');
    });
  });

  describe('saveCurrentSession', () => {
    it('should save session to storage', async () => {
      await coordinator.setTeam(team);

      // Start a session by providing human input via sendMessage
      const humanMember = team.members.find(m => m.type === 'human');
      if (humanMember) {
        coordinator.setWaitingForMemberId(humanMember.id);
        await coordinator.sendMessage('Test message', humanMember.id);
      }

      // Save
      await coordinator.saveCurrentSession();

      // Verify saved
      const sessions = await storage.listSessions(team.id);
      expect(sessions.length).toBeGreaterThan(0);
    });

    it('should not throw when no session exists', async () => {
      // No team set, no session
      await expect(coordinator.saveCurrentSession()).resolves.not.toThrow();
    });
  });

  describe('member consistency warning', () => {
    it('should call onMemberConsistencyWarning when speaker missing', async () => {
      const warningCallback = vi.fn();

      const result = createTestCoordinator({
        sessionStorage: storage,
        onMemberConsistencyWarning: warningCallback,
      });
      coordinator = result.coordinator;

      // Create snapshot with speaker not in current team (using new format)
      const contextWithMissingSpeaker: PersistedContextSnapshot = {
        messages: [
          {
            id: 'msg-1',
            content: 'Hello',
            timestamp: '2024-01-15T10:00:00.000Z',
            speaker: {
              id: 'removed-member', // This member is not in team
              name: 'removed',
              displayName: 'Removed Member',
              type: 'ai',
            },
          },
        ],
        teamTask: 'Test',
        timestamp: Date.now(),
        version: 1,
      };

      const snapshot = createTestSnapshot({
        teamId: team.id,
        context: contextWithMissingSpeaker,
      });
      await storage.saveSession(team.id, snapshot);

      // Restore session
      await coordinator.setTeam(team, { resumeSessionId: 'test-session-123' });

      // Should have called the warning callback
      expect(warningCallback).toHaveBeenCalled();
      const [missingMembers] = warningCallback.mock.calls[0];
      expect(missingMembers).toHaveLength(1);
      expect(missingMembers[0].id).toBe('removed-member');
    });

    it('should not warn when all speakers exist in team', async () => {
      const warningCallback = vi.fn();

      const result = createTestCoordinator({
        sessionStorage: storage,
        onMemberConsistencyWarning: warningCallback,
      });
      coordinator = result.coordinator;

      // Create snapshot with speakers that exist in team (using new format)
      const humanMember = team.members.find(m => m.type === 'human')!;
      const contextWithExistingSpeaker: PersistedContextSnapshot = {
        messages: [
          {
            id: 'msg-1',
            content: 'Hello',
            timestamp: '2024-01-15T10:00:00.000Z',
            speaker: {
              id: humanMember.id,
              name: humanMember.name,
              displayName: humanMember.displayName,
              type: 'human',
            },
          },
        ],
        teamTask: 'Test',
        timestamp: Date.now(),
        version: 1,
      };

      const snapshot = createTestSnapshot({
        teamId: team.id,
        context: contextWithExistingSpeaker,
      });
      await storage.saveSession(team.id, snapshot);

      await coordinator.setTeam(team, { resumeSessionId: 'test-session-123' });

      // Should NOT have called warning
      expect(warningCallback).not.toHaveBeenCalled();
    });

    it('should handle legacy format snapshots (backwards compatibility)', async () => {
      const warningCallback = vi.fn();

      const result = createTestCoordinator({
        sessionStorage: storage,
        onMemberConsistencyWarning: warningCallback,
      });
      coordinator = result.coordinator;

      // Create snapshot with legacy format (roleId/roleName/roleTitle)
      const legacySnapshot = createLegacySnapshot({ teamId: team.id });
      await storage.saveSession(team.id, legacySnapshot);

      // Should restore without error
      await coordinator.setTeam(team, { resumeSessionId: 'test-session-123' });

      // Should be in paused state
      expect(coordinator.getStatus()).toBe('paused');
    });
  });
});
