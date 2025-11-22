import { describe, it, expect } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import type { Team, Role } from '../../src/models/Team.js';
import type { ConversationMessage } from '../../src/models/ConversationMessage.js';
import type { AgentManager } from '../../src/services/AgentManager.js';

function createMember(overrides: Partial<Role>): Role {
  return {
    id: overrides.id ?? `member-${Math.random().toString(36).slice(2)}`,
    displayName: overrides.displayName ?? 'Member',
    name: overrides.name ?? 'member',
    role: overrides.role ?? 'reviewer',
    type: overrides.type ?? 'ai',
    order: overrides.order ?? 0,
    agentConfigId: overrides.agentConfigId ?? `${overrides.id}-config`,
    systemInstruction: overrides.systemInstruction ?? 'Follow the plan.',
    ...overrides
  };
}

function buildTeam(members: Role[]): Team {
  return {
    id: 'team-test',
    name: 'Test Team',
    description: 'Testing round robin routing',
    createdAt: new Date(),
    updatedAt: new Date(),
    members
  };
}

class StubAgentManager {
  public startCalls: Array<{ roleId: string; configId: string }> = [];
  public sendCalls: Array<{ roleId: string; message: string }> = [];
  public cancelCalls: string[] = [];
  private responses: Record<string, string[]> = {};
  private shouldRejectWithCancellation: Record<string, boolean> = {};

  constructor(responseMap: Record<string, string[]>) {
    this.responses = responseMap;
  }

  // Allow tests to configure rejection behavior
  setShouldRejectWithCancellation(roleId: string, shouldReject: boolean) {
    this.shouldRejectWithCancellation[roleId] = shouldReject;
  }

  async ensureAgentStarted(roleId: string, configId: string): Promise<string> {
    this.startCalls.push({ roleId, configId });
    return `process-${roleId}`;
  }

  async sendAndReceive(roleId: string, message: string): Promise<string> {
    this.sendCalls.push({ roleId, message });

    // Check if this should reject with cancellation
    if (this.shouldRejectWithCancellation[roleId]) {
      throw new Error('[CANCELLED_BY_USER]');
    }

    const queue = this.responses[roleId] ?? [];
    if (queue.length === 0) {
      return '[DONE]';
    }
    return queue.shift()!;
  }

  async stopAgent(): Promise<void> {
    // no-op
  }

  cancelAgent(roleId: string): void {
    this.cancelCalls.push(roleId);
  }

  cleanup(): void {
    // no-op
  }
}

describe('ConversationCoordinator', () => {
  it('routes AI -> human -> AI with round robin fallback', async () => {
    const responses = {
      'ai-alpha': ['Alpha response [NEXT: human-1]'],
      'ai-bravo': ['Bravo final']
    };
    const stub = new StubAgentManager(responses);
    const agentManager = stub as unknown as AgentManager;
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

    await coordinator.startConversation(team, 'Start review', 'ai-alpha');

    expect(coordinator.getWaitingForRoleId()).toBe('human-1');

    // Human terminates conversation with [DONE]
    await coordinator.injectMessage('human-1', 'Handing off to next reviewer [DONE]');

    expect(stub.startCalls.length).toBeGreaterThan(0);
    expect(stub.sendCalls).toHaveLength(1); // Only ai-alpha sent (ai-bravo never called due to [DONE])
    expect(coordinator.getWaitingForRoleId()).toBeNull();
    expect(receivedMessages.some(msg => msg.content.includes('Handing off'))).toBe(true);
    expect(coordinator.getStatus()).toBe('completed');
  });

  it('resolves addressees with fuzzy matching and normalization', () => {
    const stub = new StubAgentManager({});
    const agentManager = stub as unknown as AgentManager;
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

  it('AI message with [DONE] continues to next agent, not terminating conversation', async () => {
    // NEW BEHAVIOR: When AI returns "[DONE]", it only indicates the agent's reply is complete.
    // The conversation should continue to the next agent (via round-robin), not terminate.
    // Conversation termination is controlled by human actions (human [DONE] or /end command).
    const responses = {
      'ai-alpha': ['{"type":"assistant","message":{"content":[{"type":"text","text":"Alpha response"}]}}\\n{"type":"result"}']
    };
    const stub = new StubAgentManager(responses);
    const agentManager = stub as unknown as AgentManager;
    const router = new MessageRouter();
    const receivedMessages: ConversationMessage[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onMessage: (msg) => receivedMessages.push(msg)
    });

    const team = buildTeam([
      createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', type: 'human', order: 1 })
    ]);

    await coordinator.startConversation(team, 'Start task', 'ai-alpha');

    // Verify conversation did NOT terminate - it continues to next member (human-bob)
    expect(coordinator.getStatus()).toBe('paused');

    // Verify conversation is waiting for human input
    expect(coordinator.getWaitingForRoleId()).toBe('human-bob');

    // Verify ai-alpha was called
    expect(stub.startCalls.length).toBe(1);
    expect(stub.startCalls[0].roleId).toBe('ai-alpha');

    // Verify completion was parsed but conversation continued to next member
    const alphaMessage = receivedMessages.find(msg => msg.speaker.roleId === 'ai-alpha');
    expect(alphaMessage).toBeDefined();
    expect(alphaMessage!.routing?.isDone).toBe(false);
  });

  it('AI message with [NEXT] routes to specified member, not terminating', async () => {
    // NEW BEHAVIOR: When AI returns completion + NEXT, the conversation routes and continues.
    const responses = {
      'ai-alpha': ['{"type":"assistant","message":{"content":[{"type":"text","text":"Alpha response [NEXT: ai-bravo]"}]}}\n{"type":"result"}'],
      'ai-bravo': ['{"type":"assistant","message":{"content":[{"type":"text","text":"Bravo response"}]}}\n{"type":"result"}']
    };
    const stub = new StubAgentManager(responses);
    const agentManager = stub as unknown as AgentManager;
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

    await coordinator.startConversation(team, 'Start task', 'ai-alpha');

    // Verify conversation did NOT terminate - after ai-bravo's [DONE], round-robin continues to human-bob
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForRoleId()).toBe('human-bob');

    // Verify ai-alpha and ai-bravo were called
    // Note: ai-alpha may be called multiple times due to round-robin cycling back
    expect(stub.startCalls.length).toBeGreaterThanOrEqual(2);
    expect(stub.startCalls[0].roleId).toBe('ai-alpha');
    expect(stub.startCalls[1].roleId).toBe('ai-bravo');

    // Verify [NEXT] was honored and completion did not terminate
    const alphaMessage = receivedMessages.find(msg => msg.speaker.roleId === 'ai-alpha');
    expect(alphaMessage).toBeDefined();
    expect(alphaMessage!.routing?.isDone).toBe(false);
    expect(alphaMessage!.routing?.rawNextMarkers).toEqual(['ai-bravo']);
  });

  it('terminates immediately when human injects [NEXT] + [DONE]', async () => {
    // Regression test: when human uses injectMessage with "[NEXT: alice] [DONE]",
    // the coordinator should parse both but terminate immediately without routing
    const responses = {
      'ai-alice': ['Should never be called']
    };
    const stub = new StubAgentManager(responses);
    const agentManager = stub as unknown as AgentManager;
    const router = new MessageRouter();
    const receivedMessages: ConversationMessage[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onMessage: (msg) => receivedMessages.push(msg)
    });

    const team = buildTeam([
      createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 0, type: 'human' }),
      createMember({ id: 'ai-alice', name: 'alice', order: 1, type: 'ai', agentConfigId: 'config-alice' })
    ]);

    // Start conversation with human as first speaker
    await coordinator.startConversation(team, 'Initial task', 'human-bob');

    // Verify conversation is paused, waiting for human input
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForRoleId()).toBe('human-bob');

    // Human injects message with both [NEXT] and [DONE]
    await coordinator.injectMessage('human-bob', 'Here is my input [NEXT: alice] [DONE]');

    // Verify conversation terminated immediately
    expect(coordinator.getStatus()).toBe('completed');
    expect(coordinator.getWaitingForRoleId()).toBeNull();

    // Verify ai-alice was never started or called
    expect(stub.startCalls.length).toBe(0);
    expect(stub.sendCalls.length).toBe(0);

    // Verify the human message was parsed correctly
    const humanMessage = receivedMessages.find(msg => msg.speaker.roleId === 'human-bob');
    expect(humanMessage).toBeDefined();
    expect(humanMessage!.routing?.isDone).toBe(true);
    expect(humanMessage!.routing?.rawNextMarkers).toEqual(['alice']);
    expect(humanMessage!.content).toBe('Here is my input');
  });

  describe('User cancellation (ESC key)', () => {
    it('handleUserCancellation sets waitingForRoleId to first human member', () => {
      const stub = new StubAgentManager({});
      const agentManager = stub as unknown as AgentManager;
      const router = new MessageRouter();
      const coordinator = new ConversationCoordinator(agentManager, router);

      const team = buildTeam([
        createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
        createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' }),
        createMember({ id: 'ai-charlie', name: 'charlie', order: 2, type: 'ai', agentConfigId: 'config-charlie' })
      ]);

      // Set up coordinator with team
      (coordinator as any).team = team;
      (coordinator as any).currentExecutingMember = team.members[0]; // ai-alpha is executing

      // Call handleUserCancellation
      coordinator.handleUserCancellation();

      // Verify waitingForRoleId is set to first human
      expect(coordinator.getWaitingForRoleId()).toBe('human-bob');
    });

    it('handleUserCancellation pauses conversation', () => {
      const stub = new StubAgentManager({});
      const agentManager = stub as unknown as AgentManager;
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
      const agentManager = stub as unknown as AgentManager;
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
      (coordinator as any).currentExecutingMember = team.members[0]; // ai-alpha

      coordinator.handleUserCancellation();

      // Verify onAgentCompleted was called with the executing member
      expect(completedMembers).toHaveLength(1);
      expect(completedMembers[0].id).toBe('ai-alpha');
    });

    it('handleUserCancellation calls AgentManager.cancelAgent', () => {
      const stub = new StubAgentManager({});
      const agentManager = stub as unknown as AgentManager;
      const router = new MessageRouter();
      const coordinator = new ConversationCoordinator(agentManager, router);

      const team = buildTeam([
        createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' }),
        createMember({ id: 'human-bob', name: 'bob', displayName: 'Bob', order: 1, type: 'human' })
      ]);

      (coordinator as any).team = team;
      (coordinator as any).currentExecutingMember = team.members[0];

      coordinator.handleUserCancellation();

      // Verify cancelAgent was called
      expect(stub.cancelCalls).toHaveLength(1);
      expect(stub.cancelCalls[0]).toBe('ai-alpha');
    });

    it('sendToAgent swallows [CANCELLED_BY_USER] error gracefully', async () => {
      const stub = new StubAgentManager({});
      stub.setShouldRejectWithCancellation('ai-alpha', true);

      const agentManager = stub as unknown as AgentManager;
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

      // Start conversation - this will trigger sendToAgent which will reject with [CANCELLED_BY_USER]
      await coordinator.startConversation(team, 'Initial task', 'ai-alpha');

      // Verify the error was swallowed (conversation did not crash)
      // The coordinator should have called onAgentCompleted
      expect(completedMembers).toHaveLength(1);
      expect(completedMembers[0].id).toBe('ai-alpha');

      // Verify no error was thrown (test completes successfully)
      // Verify conversation is still in valid state
      expect(coordinator.getStatus()).toBe('active');
    });

    it('sendToAgent rethrows non-cancellation errors', async () => {
      const stub = new StubAgentManager({});
      const agentManager = stub as unknown as AgentManager;
      const router = new MessageRouter();

      // Override sendAndReceive to throw a different error
      stub.sendAndReceive = async () => {
        throw new Error('Network timeout');
      };

      const coordinator = new ConversationCoordinator(agentManager, router);

      const team = buildTeam([
        createMember({ id: 'ai-alpha', name: 'alpha', order: 0, type: 'ai', agentConfigId: 'config-alpha' })
      ]);

      // Verify non-cancellation errors are rethrown
      await expect(
        coordinator.startConversation(team, 'Initial task', 'ai-alpha')
      ).rejects.toThrow('Network timeout');
    });
  });
});
