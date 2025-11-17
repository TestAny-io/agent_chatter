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
});
