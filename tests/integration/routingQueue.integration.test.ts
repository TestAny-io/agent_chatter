import { describe, it, expect, vi } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import type { Team, Member } from '../../src/models/Team.js';
import type { ConversationMessage } from '../../src/models/ConversationMessage.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import { SessionUtils } from '../../src/models/ConversationSession.js';

function makeMember(id: string, type: 'ai' | 'human', order: number): Member {
  return {
    id,
    name: id,
    displayName: id,
    displayRole: id,
    role: id,
    type,
    roleDir: '',
    order
  };
}

describe('Routing Queue Integration (no round-robin, FIFO NEXT)', () => {
  const aiA = makeMember('ai-a', 'ai', 0);
  const aiB = makeMember('ai-b', 'ai', 1);
  const aiC = makeMember('ai-c', 'ai', 2);
  const human = makeMember('human-x', 'human', 3);

  const team: Team = {
    id: 't1',
    name: 'team',
    displayName: 'team',
    description: '',
    members: [aiA, aiB, aiC, human]
  };

  const buildCoordinator = () => {
    const router = new MessageRouter();
    const coordinator = new ConversationCoordinator(
      {} as any, // AgentManager (mocked below)
      router,
      {
        onMessage: vi.fn(),
        onStatusChange: vi.fn()
      },
      {
        getRecentSummaries: () => []
      } as any
    );
    // seed session
    (coordinator as any).session = SessionUtils.createSession(team.id, team.name);
    (coordinator as any).team = team;
    return coordinator;
  };

  it('routes multiple NEXT markers in order after completion', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator();
    const message: ConversationMessage = {
      id: 'm1',
      content: 'task',
      speaker: { roleId: aiA.id, roleName: aiA.name, roleTitle: aiA.displayName, type: 'ai' },
      routing: { rawNextMarkers: ['ai-b', 'ai-c'], resolvedAddressees: [] }
    } as any;

    // Pre-add message to session so processRoutingQueue can find the latest message
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    // Both agents receive the latest message content dynamically
    expect(sendToAgent).toHaveBeenNthCalledWith(1, aiB, 'task');
    expect(sendToAgent).toHaveBeenNthCalledWith(2, aiC, 'task');
  });

  it('falls back to first human when no NEXT markers', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;
    const coordinator = buildCoordinator();

    const message: ConversationMessage = {
      id: 'm2',
      content: 'hello',
      speaker: { roleId: aiA.id, roleName: aiA.name, roleTitle: aiA.displayName, type: 'ai' },
      routing: { rawNextMarkers: [], resolvedAddressees: [] }
    } as any;

    // Pre-add message to session
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    expect((coordinator as any).waitingForRoleId).toBe(human.id);
    expect(sendToAgent).not.toHaveBeenCalled();
  });

  it('ignores comma NEXT and keeps FIFO for valid ones', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;
    const coordinator = buildCoordinator();

    const message: ConversationMessage = {
      id: 'm3',
      content: 'mix',
      speaker: { roleId: aiA.id, roleName: aiA.name, roleTitle: aiA.displayName, type: 'ai' },
      routing: { rawNextMarkers: ['ai-b', 'ai-c,d'], resolvedAddressees: [] }
    } as any;

    // Pre-add message to session
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent).toHaveBeenCalledWith(aiB, 'mix');
  });

  it('uses dynamic latest message for parallel NEXT routing', async () => {
    // This test verifies Bug 7 fix: subsequent agents in parallel NEXT get latest message
    let callCount = 0;
    const sendToAgent = vi.fn().mockImplementation(async (member: Member, content: string) => {
      callCount++;
      // Simulate agent adding its response to session
      const agentResponse: ConversationMessage = {
        id: `agent-resp-${callCount}`,
        content: `Response from ${member.name}`,
        speaker: { roleId: member.id, roleName: member.name, roleTitle: member.displayName, type: 'ai' },
        routing: { rawNextMarkers: [], resolvedAddressees: [] }
      } as any;
      (coordinator as any).session.messages.push(agentResponse);
    });
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator();
    const initialMessage: ConversationMessage = {
      id: 'm-initial',
      content: 'user question',
      speaker: { roleId: human.id, roleName: human.name, roleTitle: human.displayName, type: 'human' },
      routing: { rawNextMarkers: ['ai-a', 'ai-b', 'ai-c'], resolvedAddressees: [] }
    } as any;

    // Add initial user message to session
    (coordinator as any).session.messages.push(initialMessage);

    await (coordinator as any).routeToNext(initialMessage);

    // Verify each agent was called
    expect(sendToAgent).toHaveBeenCalledTimes(3);

    // ai-a gets user's message
    expect(sendToAgent).toHaveBeenNthCalledWith(1, aiA, 'user question');

    // ai-b gets ai-a's response (dynamic lookup)
    expect(sendToAgent).toHaveBeenNthCalledWith(2, aiB, 'Response from ai-a');

    // ai-c gets ai-b's response (dynamic lookup)
    expect(sendToAgent).toHaveBeenNthCalledWith(3, aiC, 'Response from ai-b');
  });
});
