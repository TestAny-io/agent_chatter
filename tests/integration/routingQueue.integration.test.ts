import { describe, it, expect, vi } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import type { Team, Member } from '../../src/models/Team.js';
import type { ConversationMessage } from '../../src/models/ConversationMessage.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import { SessionUtils } from '../../src/models/ConversationSession.js';
import type { QueueUpdateEvent } from '../../src/models/QueueEvent.js';

function makeMember(id: string, type: 'ai' | 'human', order: number): Member {
  return {
    id,
    name: id,
    displayName: id,
    displayRole: id,
    role: id,
    type,
    baseDir: '',
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
      speaker: { id: aiA.id, name: aiA.name, displayName: aiA.displayName, type: 'ai' },
      routing: { rawNextMarkers: ['ai-b', 'ai-c'], resolvedAddressees: [] }
    } as any;

    // Pre-add message to session so processRoutingQueue can find the latest message
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    // Both agents receive the latest message content dynamically
    // v3: sendToAgent now receives optional third parameter (route)
    expect(sendToAgent).toHaveBeenNthCalledWith(1, aiB, 'task', expect.anything());
    expect(sendToAgent).toHaveBeenNthCalledWith(2, aiC, 'task', expect.anything());
  });

  it('falls back to first human when no NEXT markers', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;
    const coordinator = buildCoordinator();

    const message: ConversationMessage = {
      id: 'm2',
      content: 'hello',
      speaker: { id: aiA.id, name: aiA.name, displayName: aiA.displayName, type: 'ai' },
      routing: { rawNextMarkers: [], resolvedAddressees: [] }
    } as any;

    // Pre-add message to session
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    expect((coordinator as any).waitingForMemberId).toBe(human.id);
    expect(sendToAgent).not.toHaveBeenCalled();
  });

  it('ignores comma NEXT and keeps FIFO for valid ones', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;
    const coordinator = buildCoordinator();

    const message: ConversationMessage = {
      id: 'm3',
      content: 'mix',
      speaker: { id: aiA.id, name: aiA.name, displayName: aiA.displayName, type: 'ai' },
      routing: { rawNextMarkers: ['ai-b', 'ai-c,d'], resolvedAddressees: [] }
    } as any;

    // Pre-add message to session
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    // v3: sendToAgent now receives optional third parameter (route)
    expect(sendToAgent).toHaveBeenCalledWith(aiB, 'mix', expect.anything());
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
        speaker: { id: member.id, name: member.name, displayName: member.displayName, type: 'ai' },
        routing: { rawNextMarkers: [], resolvedAddressees: [] }
      } as any;
      (coordinator as any).session.messages.push(agentResponse);
    });
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator();
    const initialMessage: ConversationMessage = {
      id: 'm-initial',
      content: 'user question',
      speaker: { id: human.id, name: human.name, displayName: human.displayName, type: 'human' },
      routing: { rawNextMarkers: ['ai-a', 'ai-b', 'ai-c'], resolvedAddressees: [] }
    } as any;

    // Add initial user message to session
    (coordinator as any).session.messages.push(initialMessage);

    await (coordinator as any).routeToNext(initialMessage);

    // Verify each agent was called
    expect(sendToAgent).toHaveBeenCalledTimes(3);

    // ai-a gets user's message
    // v3: sendToAgent now receives optional third parameter (route)
    expect(sendToAgent).toHaveBeenNthCalledWith(1, aiA, 'user question', expect.anything());

    // ai-b gets ai-a's response (dynamic lookup)
    expect(sendToAgent).toHaveBeenNthCalledWith(2, aiB, 'Response from ai-a', expect.anything());

    // ai-c gets ai-b's response (dynamic lookup)
    expect(sendToAgent).toHaveBeenNthCalledWith(3, aiC, 'Response from ai-b', expect.anything());
  });
});

describe('Routing Queue v3 Integration (Intent-based Priority)', () => {
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
      {} as any,
      router,
      {
        onMessage: vi.fn(),
        onStatusChange: vi.fn()
      },
      {
        getRecentSummaries: () => []
      } as any
    );
    (coordinator as any).session = SessionUtils.createSession(team.id, team.name);
    (coordinator as any).team = team;
    return coordinator;
  };

  it('parses intent markers from NEXT and routes with priority', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator();
    const router = new MessageRouter();

    // Test intent parsing via MessageRouter
    const parsed = router.parseMessage('Please review [NEXT: ai-a!P1, ai-b!P3]');

    expect(parsed.parsedAddressees).toEqual([
      { name: 'ai-a', intent: 'P1' },
      { name: 'ai-b', intent: 'P3' }
    ]);
    expect(parsed.addressees).toEqual(['ai-a', 'ai-b']);
  });

  it('v3 queue emits stats on queue update', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const coordinator = buildCoordinator();

    // Access v3 queue directly
    const v3Queue = (coordinator as any).routingQueueV3;
    if (v3Queue) {
      // Set up callback
      (v3Queue as any).callbacks = { onQueueUpdate };

      // Enqueue items
      v3Queue.enqueue(
        [
          { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
          { targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' }
        ],
        'msg-1'
      );

      // Notify queue update
      v3Queue.notifyQueueUpdate();

      expect(onQueueUpdate).toHaveBeenCalled();
      const event = onQueueUpdate.mock.calls[0][0];
      expect(event.stats.totalPending).toBe(2);
      expect(event.stats.byIntent.P1_INTERRUPT).toBe(1);
      expect(event.stats.byIntent.P2_REPLY).toBe(1);
    }
  });

  it('v3 queue selects P1 before P2 items', () => {
    const coordinator = buildCoordinator();
    const v3Queue = (coordinator as any).routingQueueV3;

    if (v3Queue) {
      // Enqueue P2 first, then P1
      v3Queue.enqueue(
        [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
        'msg-1'
      );
      v3Queue.enqueue(
        [{ targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' }],
        'msg-2'
      );

      // P1 should be selected first despite being enqueued later
      const selected = v3Queue.selectNext();
      expect(selected?.targetMemberId).toBe('ai-b');
      expect(selected?.intent).toBe('P1_INTERRUPT');
    }
  });

  it('v3 queue tracks parent message ID for routing context', () => {
    const coordinator = buildCoordinator();
    const v3Queue = (coordinator as any).routingQueueV3;

    if (v3Queue) {
      const parentMsgId = 'parent-msg-123';

      v3Queue.enqueue(
        [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
        parentMsgId
      );

      const selected = v3Queue.selectNext();
      expect(selected?.parentMessageId).toBe(parentMsgId);
    }
  });

  it('v3 queue prevents adjacent duplicate members', () => {
    const coordinator = buildCoordinator();
    const v3Queue = (coordinator as any).routingQueueV3;

    if (v3Queue) {
      // Enqueue same member twice consecutively
      const result1 = v3Queue.enqueue(
        [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
        'msg-1'
      );
      const result2 = v3Queue.enqueue(
        [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
        'msg-1'
      );

      expect(result1.enqueued).toHaveLength(1);
      expect(result2.enqueued).toHaveLength(0);
      expect(result2.skipped.some(s => s.reason === 'duplicate')).toBe(true);
    }
  });

  it('v3 queue demotes to P3 when branch is full', () => {
    const coordinator = buildCoordinator();
    const v3Queue = (coordinator as any).routingQueueV3;

    if (v3Queue) {
      // Override config for small branch size
      (v3Queue as any).config = { maxQueueSize: 50, maxBranchSize: 2, maxLocalSeq: 5 };

      // Fill branch with P1 items
      v3Queue.enqueue(
        [
          { targetMemberId: 'ai-a', intent: 'P1_INTERRUPT' },
          { targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' }
        ],
        'msg-1'
      );

      // Third P1 should be demoted to P3
      const result = v3Queue.enqueue(
        [{ targetMemberId: 'ai-c', intent: 'P1_INTERRUPT' }],
        'msg-1'
      );

      expect(result.enqueued).toHaveLength(1);
      expect(result.enqueued[0].intent).toBe('P3_EXTEND');
    }
  });

  it('v3 queue local scheduling prefers same parent after completion', () => {
    const coordinator = buildCoordinator();
    const v3Queue = (coordinator as any).routingQueueV3;

    if (v3Queue) {
      // Enqueue items with different parents (all P2 - same priority)
      v3Queue.enqueue(
        [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
        'parent-1'
      );
      v3Queue.enqueue(
        [{ targetMemberId: 'ai-b', intent: 'P2_REPLY' }],
        'parent-2'
      );

      // Mark parent-1 as completed (sets local context)
      v3Queue.markCompleted('parent-1');

      // Should select ai-a (local to completed parent-1)
      const selected = v3Queue.selectNext();
      expect(selected?.targetMemberId).toBe('ai-a');
      expect(selected?.parentMessageId).toBe('parent-1');
    }
  });
});
