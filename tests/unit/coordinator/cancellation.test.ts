/**
 * ConversationCoordinator cancellation tests
 * Tests for user cancellation (ESC key) handling
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Role } from '../../../src/models/Team.js';
import type { ConversationMessage } from '../../../src/models/ConversationMessage.js';
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

describe('ConversationCoordinator User Cancellation (ESC key)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handleUserCancellation sets waitingForRoleId to first human member', () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(agentManager, router);

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' }),
      createMember({ id: 'ai-charlie', name: 'charlie', order: 2, type: 'ai', agentConfigId: 'config-charlie' })
    ]);

    (coordinator as any).team = team;
    (coordinator as any).currentExecutingMember = team.members[0];

    coordinator.handleUserCancellation();

    expect(coordinator.getWaitingForRoleId()).toBe('human-bob');
  });

  it('handleUserCancellation pauses conversation', () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(agentManager, router);

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' })
    ]);

    (coordinator as any).team = team;
    (coordinator as any).status = 'active';
    (coordinator as any).currentExecutingMember = team.members[0];

    coordinator.handleUserCancellation();

    expect(coordinator.getStatus()).toBe('paused');
  });

  it('handleUserCancellation calls onAgentCompleted callback', () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const completedMembers: Role[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onAgentCompleted: (member) => completedMembers.push(member)
    });

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' })
    ]);

    (coordinator as any).team = team;
    (coordinator as any).currentExecutingMember = team.members[0];

    coordinator.handleUserCancellation();

    expect(completedMembers).toHaveLength(1);
    expect(completedMembers[0].id).toBe('ai-alpha');
  });

  it('handleUserCancellation calls AgentManager.cancelAgent', () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(agentManager, router);

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' })
    ]);

    (coordinator as any).team = team;
    (coordinator as any).currentExecutingMember = team.members[0];

    coordinator.handleUserCancellation();

    expect(stub.cancelCalls).toHaveLength(1);
    expect(stub.cancelCalls[0]).toBe('ai-alpha');
  });

  it('sendToAgent swallows [CANCELLED_BY_USER] error gracefully', async () => {
    const stub = new StubAgentManager({});
    stub.setShouldRejectWithCancellation('ai-alpha', true);

    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();
    const completedMembers: Role[] = [];
    const receivedMessages: ConversationMessage[] = [];
    const statusChanges: string[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onAgentCompleted: (member) => completedMembers.push(member),
      onMessage: (msg) => receivedMessages.push(msg),
      onStatusChange: (status) => statusChanges.push(status)
    });

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' })
    ]);

    coordinator.setTeam(team);
    await coordinator.sendMessage('Initial task [NEXT: ai-alpha]', 'human-bob');

    expect(completedMembers).toHaveLength(1);
    expect(completedMembers[0].id).toBe('ai-alpha');
    expect(coordinator.getStatus()).toBe('active');
  });

  it('sendToAgent rethrows non-cancellation errors', async () => {
    const stub = new StubAgentManager({});
    const agentManager = createStubAsAgentManager(stub);
    const router = new MessageRouter();

    stub.sendAndReceive = async () => {
      throw new Error('Network timeout');
    };

    const coordinator = new ConversationCoordinator(agentManager, router);

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', type: 'human', order: 1 })
    ]);

    coordinator.setTeam(team);
    await expect(
      coordinator.sendMessage('Initial task [NEXT: ai-alpha]', 'human-bob')
    ).rejects.toThrow('Network timeout');
  });
});
