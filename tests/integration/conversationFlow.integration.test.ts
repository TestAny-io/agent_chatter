import { describe, it, expect } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import type { Role, Team } from '../../src/models/Team.js';

class FlowAgentManager {
  public sendOrder: string[] = [];
  constructor(private responses: Record<string, { success: boolean; finishReason?: string }[]>) {}

  async ensureAgentStarted(): Promise<string> {
    return 'stub-process';
  }

  async sendAndReceive(roleId: string): Promise<{ success: boolean; finishReason?: string }> {
    this.sendOrder.push(roleId);
    const queue = this.responses[roleId] ?? [];
    return queue.shift() ?? { success: true, finishReason: 'done' };
  }

  async stopAgent(): Promise<void> {}
  cleanup(): void {}
}

function buildMember(overrides: Partial<Role>): Role {
  return {
    id: overrides.id ?? `id-${Math.random().toString(16).slice(2)}`,
    displayName: overrides.displayName ?? 'Member',
    name: overrides.name ?? 'member',
    role: overrides.role ?? 'role',
    type: overrides.type ?? 'ai',
    order: overrides.order ?? 0,
    agentConfigId: overrides.agentConfigId ?? 'cfg',
    systemInstruction: overrides.systemInstruction,
    ...overrides
  } as Role;
}

describe('Conversation flow integration', () => {
  it('routes messages according to NEXT markers across multiple agents', async () => {
    const responses = {
      'alpha-id': [{ success: true, finishReason: 'done' }],
      'beta-id': [{ success: true, finishReason: 'done' }]
    };
    const agentManager = new FlowAgentManager(responses) as unknown as import('../../src/services/AgentManager.js').AgentManager;
    const router = new MessageRouter();
    const received: string[] = [];

    const coordinator = new ConversationCoordinator(agentManager, router, {
      onMessage: (msg) => received.push(msg.content)
    });

    const team: Team = {
      id: 'team-flow',
      name: 'FlowTeam',
      description: 'Tests NEXT routing',
      createdAt: new Date(),
      updatedAt: new Date(),
      members: [
        buildMember({ id: 'alpha-id', name: 'Alpha', type: 'ai', order: 0, agentConfigId: 'cfg-alpha' }),
        buildMember({ id: 'beta-id', name: 'Beta', type: 'ai', order: 1, agentConfigId: 'cfg-beta' }),
        buildMember({ id: 'human-id', name: 'Human', type: 'human', order: 2 })
      ]
    };

    // New API: setTeam() + sendMessage()
    coordinator.setTeam(team);
    await coordinator.sendMessage('Start review');

    // After beta (AI) completes, conversation continues to human and pauses
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForRoleId()).toBe('human-id');
  });
});
