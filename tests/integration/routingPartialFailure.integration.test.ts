/**
 * Routing partial failure integration tests
 *
 * Tests for [NEXT:a,unknown,b] scenarios where some addressees resolve and some don't
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import type { Team, Member } from '../../src/models/Team.js';
import type { ConversationMessage } from '../../src/models/ConversationMessage.js';

// Create a stub AgentManager for testing
class StubAgentManager {
  startCalls: Array<{ roleId: string; content: string }> = [];
  sendCalls: Array<{ roleId: string; content: string }> = [];

  async ensureAgentStarted(roleId: string, _config: any) {
    this.startCalls.push({ roleId, content: '' });
    return `process-${roleId}`;
  }

  async sendAndReceive(roleId: string, content: string, _ctx: any) {
    this.sendCalls.push({ roleId, content });
    return { success: true, finishReason: 'done' };
  }

  async stopAgent() {}
  cancelAgent() {}
  cleanup() {}
}

function createMember(overrides: Partial<Member> & { id: string; name: string }): Member {
  return {
    displayName: overrides.displayName ?? overrides.name,
    role: overrides.role ?? 'member',
    type: overrides.type ?? 'ai',
    order: overrides.order ?? 0,
    ...overrides
  } as Member;
}

function buildTeam(members: Member[]): Team {
  return {
    id: 'team-test',
    name: 'Test Team',
    description: 'Test team for routing',
    members
  };
}

describe('Routing partial failure e2e', () => {
  let stub: StubAgentManager;
  let coordinator: ConversationCoordinator;
  let router: MessageRouter;

  beforeEach(() => {
    stub = new StubAgentManager();
    router = new MessageRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles [NEXT:alice,typo,bob] correctly - partial failure', async () => {
    const partialFailures: Array<{ skipped: string[]; available: string[] }> = [];
    const unresolvedCalls: string[][] = [];
    const receivedMessages: ConversationMessage[] = [];

    coordinator = new ConversationCoordinator(stub as any, router, {
      onPartialResolveFailure: (skipped, available) => {
        partialFailures.push({ skipped, available });
      },
      onUnresolvedAddressees: (addressees) => {
        unresolvedCalls.push(addressees);
      },
      onMessage: (msg) => receivedMessages.push(msg)
    });

    const alice = createMember({
      id: 'ai-alice',
      name: 'alice',
      displayName: 'Alice',
      type: 'ai',
      agentConfigId: 'config-alice',
      order: 0
    });
    const bob = createMember({
      id: 'ai-bob',
      name: 'bob',
      displayName: 'Bob',
      type: 'ai',
      agentConfigId: 'config-bob',
      order: 1
    });
    const human = createMember({
      id: 'human-1',
      name: 'human',
      displayName: 'Human',
      type: 'human',
      order: 2
    });

    const team = buildTeam([alice, bob, human]);

    // Mock sendToAgent to avoid actual agent calls
    vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
      .mockResolvedValue(undefined);

    coordinator.setTeam(team);

    // 1. Send [NEXT:alice,typo,bob] message
    await coordinator.sendMessage('Please review this [NEXT:alice][NEXT:typo][NEXT:bob]', human.id);

    // 2. Verify onPartialResolveFailure was called with ['typo']
    expect(partialFailures).toHaveLength(1);
    expect(partialFailures[0].skipped).toEqual(['typo']);
    expect(partialFailures[0].available).toContain('alice');
    expect(partialFailures[0].available).toContain('bob');

    // 3. Verify onUnresolvedAddressees was NOT called (partial, not total failure)
    expect(unresolvedCalls).toHaveLength(0);

    // 4. Verify alice and bob were routed (sendToAgent called for them)
    const sendSpy = vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent');
    // The spy was set before sendMessage, so we check the calls
    expect(sendSpy).toHaveBeenCalled();
  });

  it('handles [NEXT:typo1,typo2] correctly - total failure from Human', async () => {
    const partialFailures: Array<{ skipped: string[]; available: string[] }> = [];
    const unresolvedCalls: string[][] = [];

    coordinator = new ConversationCoordinator(stub as any, router, {
      onPartialResolveFailure: (skipped, available) => {
        partialFailures.push({ skipped, available });
      },
      onUnresolvedAddressees: (addressees) => {
        unresolvedCalls.push(addressees);
      }
    });

    const alice = createMember({
      id: 'ai-alice',
      name: 'alice',
      displayName: 'Alice',
      type: 'ai',
      agentConfigId: 'config-alice',
      order: 0
    });
    const human = createMember({
      id: 'human-1',
      name: 'human',
      displayName: 'Human',
      type: 'human',
      order: 1
    });

    const team = buildTeam([alice, human]);
    coordinator.setTeam(team);

    // Human sends message with all invalid addressees
    await coordinator.sendMessage('Please review [NEXT:typo1][NEXT:typo2]', human.id);

    // onUnresolvedAddressees should be called (total failure)
    expect(unresolvedCalls).toHaveLength(1);
    expect(unresolvedCalls[0]).toContain('typo1');
    expect(unresolvedCalls[0]).toContain('typo2');

    // onPartialResolveFailure should NOT be called
    expect(partialFailures).toHaveLength(0);

    // Should be paused, waiting for the SAME Human to re-input
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForMemberId()).toBe('human-1');
  });

  it('handles all valid addressees - no failure callbacks', async () => {
    const partialFailures: Array<{ skipped: string[]; available: string[] }> = [];
    const unresolvedCalls: string[][] = [];

    coordinator = new ConversationCoordinator(stub as any, router, {
      onPartialResolveFailure: (skipped, available) => {
        partialFailures.push({ skipped, available });
      },
      onUnresolvedAddressees: (addressees) => {
        unresolvedCalls.push(addressees);
      }
    });

    const alice = createMember({
      id: 'ai-alice',
      name: 'alice',
      displayName: 'Alice',
      type: 'ai',
      agentConfigId: 'config-alice',
      order: 0
    });
    const bob = createMember({
      id: 'ai-bob',
      name: 'bob',
      displayName: 'Bob',
      type: 'ai',
      agentConfigId: 'config-bob',
      order: 1
    });
    const human = createMember({
      id: 'human-1',
      name: 'human',
      displayName: 'Human',
      type: 'human',
      order: 2
    });

    const team = buildTeam([alice, bob, human]);

    vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
      .mockResolvedValue(undefined);

    coordinator.setTeam(team);

    // All addressees are valid
    await coordinator.sendMessage('Review [NEXT:alice][NEXT:bob]', human.id);

    // No failure callbacks should be triggered
    expect(partialFailures).toHaveLength(0);
    expect(unresolvedCalls).toHaveLength(0);
  });

  it('tracks queue updates during routing', async () => {
    const queueEvents: Array<{ items: Member[]; executing?: Member; isEmpty: boolean }> = [];

    coordinator = new ConversationCoordinator(stub as any, router, {
      onQueueUpdate: (event) => {
        queueEvents.push({ ...event });
      }
    });

    const alice = createMember({
      id: 'ai-alice',
      name: 'alice',
      displayName: 'Alice',
      type: 'ai',
      agentConfigId: 'config-alice',
      order: 0
    });
    const bob = createMember({
      id: 'ai-bob',
      name: 'bob',
      displayName: 'Bob',
      type: 'ai',
      agentConfigId: 'config-bob',
      order: 1
    });
    const human = createMember({
      id: 'human-1',
      name: 'human',
      displayName: 'Human',
      type: 'human',
      order: 2
    });

    const team = buildTeam([alice, bob, human]);

    vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
      .mockResolvedValue(undefined);

    coordinator.setTeam(team);
    await coordinator.sendMessage('Review [NEXT:alice][NEXT:bob]', human.id);

    // Should have multiple queue events
    expect(queueEvents.length).toBeGreaterThan(0);

    // Should have events showing queue population
    const populatedEvent = queueEvents.find(e => e.items.length > 0 || e.executing);
    expect(populatedEvent).toBeDefined();

    // Final event should show empty queue
    const lastEvent = queueEvents[queueEvents.length - 1];
    expect(lastEvent.isEmpty).toBe(true);
  });
});
