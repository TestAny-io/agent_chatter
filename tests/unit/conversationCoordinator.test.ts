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
  private responses: Record<string, string[]> = {};

  constructor(responseMap: Record<string, string[]>) {
    this.responses = responseMap;
  }

  async ensureAgentStarted(roleId: string, configId: string): Promise<string> {
    this.startCalls.push({ roleId, configId });
    return `process-${roleId}`;
  }

  async sendAndReceive(roleId: string, message: string): Promise<string> {
    this.sendCalls.push({ roleId, message });
    const queue = this.responses[roleId] ?? [];
    if (queue.length === 0) {
      return '[DONE]';
    }
    return queue.shift()!;
  }

  async stopAgent(): Promise<void> {
    // no-op
  }

  cleanup(): void {
    // no-op
  }
}

describe('ConversationCoordinator', () => {
  it('routes AI -> human -> AI with round robin fallback', async () => {
    const responses = {
      'ai-alpha': ['Alpha response [NEXT: human-1]'],
      'ai-bravo': ['Bravo final [DONE]']
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

    await coordinator.injectMessage('human-1', 'Handing off to next reviewer');

    expect(stub.startCalls.length).toBeGreaterThan(0);
    expect(stub.sendCalls).toHaveLength(2);
    expect(coordinator.getWaitingForRoleId()).toBeNull();
    expect(receivedMessages.some(msg => msg.content.includes('Handing off'))).toBe(true);
    expect(coordinator.getStatus()).toBe('completed');
  });

  it('builds agent message with system prompt and context', () => {
    const stub = new StubAgentManager({});
    const agentManager = stub as unknown as AgentManager;
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(agentManager, router);

    const role = createMember({
      id: 'ai-alpha',
      name: 'alpha',
      systemInstruction: 'You are Alpha.'
    });

    const previousMessage = {
      speaker: { roleId: 'alpha', roleName: 'alpha', roleTitle: 'Alpha', type: 'ai' },
      content: 'Context message',
      timestamp: Date.now(),
      routing: {}
    } as unknown as ConversationMessage;

    (coordinator as any).session = { messages: [previousMessage, previousMessage] };

    const payload = (coordinator as any).buildAgentMessage(role, 'Review the patch');

    // System instruction is now handled by adapters (--append-system-prompt for Claude,
    // env vars for wrappers), so [SYSTEM] and systemInstruction content are no longer
    // in the message body
    expect(payload).toContain('[CONTEXT]');
    expect(payload).toContain('Context message');
    expect(payload).toContain('[MESSAGE]');
    expect(payload).toContain('Review the patch');
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

  it('terminates conversation immediately when [DONE] present, ignoring [NEXT]', async () => {
    // Regression test: when AI returns "[NEXT: bob] [DONE]",
    // MessageRouter parses both, but ConversationCoordinator should terminate immediately
    const responses = {
      'ai-alpha': ['Alpha response [NEXT: ai-bravo] [DONE]']
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
      createMember({ id: 'ai-bravo', name: 'bravo', order: 1, type: 'ai', agentConfigId: 'config-bravo' })
    ]);

    await coordinator.startConversation(team, 'Start task', 'ai-alpha');

    // Verify conversation terminated
    expect(coordinator.getStatus()).toBe('completed');

    // Verify no waiting for next agent
    expect(coordinator.getWaitingForRoleId()).toBeNull();

    // Verify ai-bravo was never started (only ai-alpha should have been called)
    expect(stub.startCalls.length).toBe(1);
    expect(stub.startCalls[0].roleId).toBe('ai-alpha');

    // Verify only one agent sent message (ai-alpha)
    expect(stub.sendCalls.length).toBe(1);
    expect(stub.sendCalls[0].roleId).toBe('ai-alpha');

    // Verify the [NEXT] addressee was parsed but ignored
    const alphaMessage = receivedMessages.find(msg => msg.speaker.roleId === 'ai-alpha');
    expect(alphaMessage).toBeDefined();
    expect(alphaMessage!.routing?.isDone).toBe(true);
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
});
