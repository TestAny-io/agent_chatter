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

    expect(coordinator.getWaitingForRoleId()).toBe('human-1');
    expect(coordinator.getStatus()).toBe('paused');

    await coordinator.injectMessage('human-1', 'Handing off to next reviewer');

    expect(stub.startCalls.length).toBeGreaterThan(0);
    expect(stub.sendCalls).toHaveLength(1);
    expect(coordinator.getWaitingForRoleId()).toBe('human-1');
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

    const normalized = (coordinator as any).resolveAddressees([' alpha one ', 'BETATWO']);

    expect(normalized.map((role: Role) => role.id)).toEqual(['alpha-id', 'beta-id']);

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
      speaker: { roleId: ai1.id, roleName: ai1.name, roleTitle: ai1.displayName, type: 'ai' },
      routing: { rawNextMarkers: [], resolvedAddressees: [] }
    } as any;

    // Add message to session so processRoutingQueue can find latest content
    session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    // Content is now dynamically retrieved from latest message
    expect(sendSpy).toHaveBeenNthCalledWith(1, ai2, 'no next markers');
    expect(sendSpy).toHaveBeenNthCalledWith(2, ai3, 'no next markers');
    expect((coordinator as any).waitingForRoleId).toBeNull();
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
    expect(coordinator.getWaitingForRoleId()).toBe('human-bob');
    expect(stub.startCalls.length).toBe(1);
    expect(stub.startCalls[0].roleId).toBe('ai-alpha');
    expect(receivedMessages.length).toBeGreaterThan(0);
  });
});
