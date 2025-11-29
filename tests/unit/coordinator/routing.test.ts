/**
 * ConversationCoordinator routing tests
 * Tests for message routing, NEXT markers, and round-robin fallback
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Role } from '../../../src/models/Team.js';
import type { ConversationMessage } from '../../../src/models/ConversationMessage.js';
import { SessionUtils } from '../../../src/models/ConversationSession.js';
import { createMember, buildTeam, StubAgentManager, createStubAsAgentManager } from './testUtils.js';

// Mock heavy dependencies BEFORE importing ConversationCoordinator
vi.mock('../../../src/services/AgentManager.js', () => ({
  AgentManager: class MockAgentManager {
    async ensureAgentStarted() { return 'mock-process'; }
    async sendAndReceive() { return { success: true, finishReason: 'done' }; }
    async stopAgent() {}
    cancelAgent() {}
    cleanup() {}
  }
}));

vi.mock('../../../src/utils/JsonlMessageFormatter.js', () => ({
  formatJsonl: vi.fn((type: string, raw: string) => ({ text: raw }))
}));

// Import after mocks
import { ConversationCoordinator } from '../../../src/services/ConversationCoordinator.js';
import { MessageRouter } from '../../../src/services/MessageRouter.js';

describe('ConversationCoordinator Routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes AI -> human -> AI with round robin fallback', async () => {
    const responses = {
      'ai-alpha': [{ success: true, finishReason: 'done' }],
      'ai-bravo': [{ success: true, finishReason: 'done' }]
    };
    const stub = new StubAgentManager(responses);
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const receivedMessages: ConversationMessage[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onMessage: (msg) => receivedMessages.push(msg)
    });

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-1', name: 'observer', displayName: 'Human', type: 'human', order: 1 }),
      createMember({ id: 'ai-bravo', name: 'bravo', order: 2, type: 'ai', agentConfigId: 'config-bravo' })
    ]);

    coordinator.setTeam(team);
    await coordinator.sendMessage('Start review [NEXT: ai-alpha]', 'human-1');

    expect(coordinator.getWaitingForMemberId()).toBe('human-1');
    expect(coordinator.getStatus()).toBe('paused');

    await coordinator.injectMessage('human-1', 'Handing off to next reviewer');

    expect(stub.startCalls.length).toBeGreaterThan(0);
    expect(stub.sendCalls).toHaveLength(1);
    expect(coordinator.getWaitingForMemberId()).toBe('human-1');
    expect(receivedMessages.some(msg => msg.content.includes('Handing off'))).toBe(true);
  });

  it('resolves addressees with fuzzy matching and normalization', () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(agentManager, router);

    const team = buildTeam([
      createMember({ id: 'alpha-id', name: 'Alpha-One', displayName: 'Alpha One', order: 0 }),
      createMember({ id: 'beta-id', name: 'BetaTwo', displayName: 'Beta Two', order: 1 })
    ]);

    (coordinator as any).team = team;

    const result = (coordinator as any).resolveAddressees([' alpha one ', 'BETATWO']);

    expect(result.resolved.map((role: Role) => role.id)).toEqual(['alpha-id', 'beta-id']);
    expect(result.unresolved).toEqual([]);

    const helper = (coordinator as any).normalizeIdentifier('A l-p h a');
    expect(helper).toBe('alpha');
  });

  it('seeds routing queue with multiple NEXT markers from initial message', async () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();

    const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
    const ai2 = createMember({ id: 'ai-beta', name: 'beta', type: 'ai', agentConfigId: 'config-beta', order: 1 });
    const ai3 = createMember({ id: 'ai-gamma', name: 'gamma', type: 'ai', agentConfigId: 'config-gamma', order: 2 });
    const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 3 });
    const team = buildTeam([ai1, ai2, ai3, human]);

    const coordinator = new ConversationCoordinator(agentManager, router);
    const sendSpy = vi
      .spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
      .mockResolvedValue(undefined);

    coordinator.setTeam(team);
    await coordinator.sendMessage('task [NEXT:ai-alpha][NEXT:ai-beta][NEXT:ai-gamma]', human.id);

    expect(sendSpy).toHaveBeenCalledTimes(3);
    expect(sendSpy).toHaveBeenNthCalledWith(1, ai1, 'task');
    expect(sendSpy).toHaveBeenNthCalledWith(2, ai2, 'task');
    expect(sendSpy).toHaveBeenNthCalledWith(3, ai3, 'task');
  });

  it('processes queued NEXT before falling back to human when current message has no NEXT', async () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(agentManager, router);

    const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
    const ai2 = createMember({ id: 'ai-beta', name: 'beta', type: 'ai', agentConfigId: 'config-beta', order: 1 });
    const ai3 = createMember({ id: 'ai-gamma', name: 'gamma', type: 'ai', agentConfigId: 'config-gamma', order: 2 });
    const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 3 });
    const team = buildTeam([ai1, ai2, ai3, human]);

    (coordinator as any).team = team;
    const session = SessionUtils.createSession(team.id, team.name);
    (coordinator as any).session = session;

    // Bug 7 fix: routingQueue only stores { member }, content is looked up dynamically
    (coordinator as any).routingQueue = [
      { member: ai2 },
      { member: ai3 }
    ];

    const sendSpy = vi
      .spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
      .mockResolvedValue(undefined);

    const message: ConversationMessage = {
      id: 'm-no-next',
      content: 'no next markers',
      speaker: { id: ai1.id, name: ai1.name, displayName: ai1.displayName, type: 'ai' },
      routing: { rawNextMarkers: [], resolvedAddressees: [] }
    } as any;

    // Add message to session so processRoutingQueue can find latest content
    session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    // Content is now dynamically retrieved from latest message
    expect(sendSpy).toHaveBeenNthCalledWith(1, ai2, 'no next markers');
    expect(sendSpy).toHaveBeenNthCalledWith(2, ai3, 'no next markers');
    expect((coordinator as any).waitingForMemberId).toBeNull();
  });

  it('AI completion continues round-robin and pauses on next human', async () => {
    const responses = {
      'ai-alpha': [{ success: true, finishReason: 'done' }],
      'ai-bravo': [{ success: true, finishReason: 'done' }]
    };
    const stub = new StubAgentManager(responses);
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const receivedMessages: ConversationMessage[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onMessage: (msg) => receivedMessages.push(msg)
    });

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', type: 'human', order: 1 }),
      createMember({ id: 'ai-bravo', name: 'bravo', order: 2, type: 'ai', agentConfigId: 'config-bravo' })
    ]);

    coordinator.setTeam(team);
    await coordinator.sendMessage('Start task [NEXT: ai-alpha]', 'human-bob');

    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForMemberId()).toBe('human-bob');
    expect(stub.startCalls.length).toBe(1);
    expect(stub.startCalls[0].roleId).toBe('ai-alpha');
    expect(receivedMessages.length).toBeGreaterThan(0);
  });

  // ============================================================================
  // Routing v2.0 新增测试
  // ============================================================================

  describe('Partial resolve failure (onPartialResolveFailure)', () => {
    it('triggers onPartialResolveFailure when some addressees resolve and some do not', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const partialFailures: string[][] = [];
      const unresolvedCalls: string[][] = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onPartialResolveFailure: (skipped) => partialFailures.push(skipped),
        onUnresolvedAddressees: (addressees) => unresolvedCalls.push(addressees)
      });

      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 1 });
      const team = buildTeam([ai1, human]);

      const sendSpy = vi
        .spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
        .mockResolvedValue(undefined);

      coordinator.setTeam(team);
      // alpha exists, typo does not
      await coordinator.sendMessage('task [NEXT:alpha][NEXT:typo]', human.id);

      // onPartialResolveFailure should be called with ['typo']
      expect(partialFailures).toHaveLength(1);
      expect(partialFailures[0]).toEqual(['typo']);

      // onUnresolvedAddressees should NOT be called (partial, not total failure)
      expect(unresolvedCalls).toHaveLength(0);

      // alpha should still be routed
      expect(sendSpy).toHaveBeenCalled();
    });

    it('does NOT trigger onPartialResolveFailure when all addressees resolve', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const partialFailures: string[][] = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onPartialResolveFailure: (skipped) => partialFailures.push(skipped)
      });

      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 1 });
      const team = buildTeam([ai1, human]);

      vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
        .mockResolvedValue(undefined);

      coordinator.setTeam(team);
      await coordinator.sendMessage('task [NEXT:alpha]', human.id);

      // No partial failures
      expect(partialFailures).toHaveLength(0);
    });
  });

  describe('Total resolve failure (onUnresolvedAddressees)', () => {
    it('triggers onUnresolvedAddressees and waits for same Human when Human sends invalid addressees', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const partialFailures: string[][] = [];
      const unresolvedCalls: string[][] = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onPartialResolveFailure: (skipped) => partialFailures.push(skipped),
        onUnresolvedAddressees: (addressees) => unresolvedCalls.push(addressees)
      });

      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 1 });
      const team = buildTeam([ai1, human]);

      coordinator.setTeam(team);
      // Human sends message with all invalid addressees
      await coordinator.sendMessage('task [NEXT:typo1][NEXT:typo2]', human.id);

      // onUnresolvedAddressees should be called
      expect(unresolvedCalls).toHaveLength(1);
      expect(unresolvedCalls[0]).toContain('typo1');
      expect(unresolvedCalls[0]).toContain('typo2');

      // onPartialResolveFailure should NOT be called (total failure)
      expect(partialFailures).toHaveLength(0);

      // Should be paused, waiting for the SAME Human to re-input
      expect(coordinator.getStatus()).toBe('paused');
      expect(coordinator.getWaitingForMemberId()).toBe('human-1');
    });

    it('triggers onUnresolvedAddressees and falls back to first Human when AI sends invalid addressees', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const unresolvedCalls: string[][] = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onUnresolvedAddressees: (addressees) => unresolvedCalls.push(addressees)
      });

      // Order: ai-alpha(0), human-charlie(1), human-alice(2)
      // First human by order should be human-charlie
      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const humanCharlie = createMember({ id: 'human-charlie', name: 'charlie', displayName: 'Charlie', type: 'human', order: 1 });
      const humanAlice = createMember({ id: 'human-alice', name: 'alice', displayName: 'Alice', type: 'human', order: 2 });
      const team = buildTeam([ai1, humanCharlie, humanAlice]);

      (coordinator as any).team = team;
      const session = SessionUtils.createSession(team.id, team.name);
      (coordinator as any).session = session;
      (coordinator as any).routingQueue = [];

      // Simulate AI message with all invalid addressees
      const message: ConversationMessage = {
        id: 'm-invalid-next',
        content: 'AI response [NEXT:typo1][NEXT:typo2]',
        speaker: { id: ai1.id, name: ai1.name, displayName: ai1.displayName, type: 'ai' },
        routing: { rawNextMarkers: ['typo1', 'typo2'], resolvedAddressees: [] }
      } as any;
      session.messages.push(message);

      await (coordinator as any).routeToNext(message);

      // onUnresolvedAddressees should be called
      expect(unresolvedCalls).toHaveLength(1);

      // Should fallback to first Human (Charlie, order 1)
      expect(coordinator.getStatus()).toBe('paused');
      expect(coordinator.getWaitingForMemberId()).toBe('human-charlie');
    });
  });

  describe('Fallback to first human (no round-robin)', () => {
    it('falls back to first human by order when AI completes without NEXT marker', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const coordinator = new ConversationCoordinator(agentManager, router);

      // Order: ai-alpha(0), human-charlie(1), human-alice(2), ai-bravo(3)
      // First human by order should be human-charlie
      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const humanCharlie = createMember({ id: 'human-charlie', name: 'charlie', displayName: 'Charlie', type: 'human', order: 1 });
      const humanAlice = createMember({ id: 'human-alice', name: 'alice', displayName: 'Alice', type: 'human', order: 2 });
      const ai2 = createMember({ id: 'ai-bravo', name: 'bravo', type: 'ai', agentConfigId: 'config-bravo', order: 3 });
      const team = buildTeam([ai1, humanCharlie, humanAlice, ai2]);

      (coordinator as any).team = team;
      const session = SessionUtils.createSession(team.id, team.name);
      (coordinator as any).session = session;
      (coordinator as any).routingQueue = [];

      // Simulate AI message without NEXT marker
      const message: ConversationMessage = {
        id: 'm-no-next',
        content: 'AI response without NEXT',
        speaker: { id: ai1.id, name: ai1.name, displayName: ai1.displayName, type: 'ai' },
        routing: { rawNextMarkers: [], resolvedAddressees: [] }
      } as any;
      session.messages.push(message);

      await (coordinator as any).routeToNext(message);

      // Should pause on first human (Charlie, order 1)
      expect(coordinator.getStatus()).toBe('paused');
      expect(coordinator.getWaitingForMemberId()).toBe('human-charlie');
    });
  });

  describe('Queue update events (onQueueUpdate)', () => {
    it('emits queue update when items are enqueued', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const queueEvents: Array<{ items: any[]; executing?: any; isEmpty: boolean }> = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onQueueUpdate: (event) => queueEvents.push({ ...event })
      });

      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const ai2 = createMember({ id: 'ai-beta', name: 'beta', type: 'ai', agentConfigId: 'config-beta', order: 1 });
      const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 2 });
      const team = buildTeam([ai1, ai2, human]);

      vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
        .mockResolvedValue(undefined);

      coordinator.setTeam(team);
      await coordinator.sendMessage('task [NEXT:alpha][NEXT:beta]', human.id);

      // Should have received queue update events
      expect(queueEvents.length).toBeGreaterThan(0);

      // At least one event should have items (when queue was populated)
      const hasItemsEvent = queueEvents.some(e => e.items.length > 0 || e.executing);
      expect(hasItemsEvent).toBe(true);
    });

    it('emits queue update with executing member during processing', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const queueEvents: Array<{ items: any[]; executing?: any; isEmpty: boolean }> = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onQueueUpdate: (event) => queueEvents.push({ ...event })
      });

      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 1 });
      const team = buildTeam([ai1, human]);

      vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
        .mockResolvedValue(undefined);

      coordinator.setTeam(team);
      await coordinator.sendMessage('task [NEXT:alpha]', human.id);

      // Should have at least one event with executing member
      const executingEvent = queueEvents.find(e => e.executing !== undefined);
      expect(executingEvent).toBeDefined();
      if (executingEvent) {
        expect(executingEvent.executing.id).toBe('ai-alpha');
      }
    });

    it('emits isEmpty=true when queue is cleared', async () => {
      const stub = new StubAgentManager({});
      const agentManager = createStubAsAgentManager(stub);
      const router = new MessageRouter();

      const queueEvents: Array<{ items: any[]; executing?: any; isEmpty: boolean }> = [];

      const coordinator = new ConversationCoordinator(agentManager, router, {
        onQueueUpdate: (event) => queueEvents.push({ ...event })
      });

      const ai1 = createMember({ id: 'ai-alpha', name: 'alpha', type: 'ai', agentConfigId: 'config-alpha', order: 0 });
      const human = createMember({ id: 'human-1', name: 'human', type: 'human', order: 1 });
      const team = buildTeam([ai1, human]);

      vi.spyOn(ConversationCoordinator.prototype as any, 'sendToAgent')
        .mockResolvedValue(undefined);

      coordinator.setTeam(team);
      await coordinator.sendMessage('task [NEXT:alpha]', human.id);

      // The final event should have isEmpty=true (queue cleared after processing)
      const lastEvent = queueEvents[queueEvents.length - 1];
      expect(lastEvent.isEmpty).toBe(true);
      expect(lastEvent.items).toHaveLength(0);
      expect(lastEvent.executing).toBeUndefined();
    });
  });
});
