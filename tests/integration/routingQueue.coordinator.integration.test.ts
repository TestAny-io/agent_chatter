/**
 * Routing Queue + Coordinator Integration Tests (v3)
 *
 * Tests the integration between RoutingQueue and ConversationCoordinator:
 * 1. Intent matching with id/name/displayName
 * 2. maxLocalSeq anti-starvation mechanism
 * 3. Queue/branch protection (overflow handling)
 * 4. markCompleted path (local scheduling context)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import { SessionUtils } from '../../src/models/ConversationSession.js';
import type { Team, Member } from '../../src/models/Team.js';
import type { ConversationMessage } from '../../src/models/ConversationMessage.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeMember(
  id: string,
  name: string,
  displayName: string,
  type: 'ai' | 'human',
  order: number
): Member {
  return {
    id,
    name,
    displayName,
    displayRole: name,
    role: name,
    type,
    baseDir: '',
    order,
  };
}

function makeTeam(members: Member[]): Team {
  return {
    id: 'test-team',
    name: 'Test Team',
    displayName: 'Test Team',
    description: 'Test team for v3 routing',
    members,
  };
}

function buildCoordinator(team: Team, options?: {
  maxQueueSize?: number;
  maxBranchSize?: number;
  maxLocalSeq?: number;
}) {
  const router = new MessageRouter();
  const coordinator = new ConversationCoordinator(
    {} as any, // AgentManager (mocked)
    router,
    {
      onMessage: vi.fn(),
      onStatusChange: vi.fn(),
      routingQueueConfig: {
        maxQueueSize: options?.maxQueueSize ?? 50,
        maxBranchSize: options?.maxBranchSize ?? 10,
        maxLocalSeq: options?.maxLocalSeq ?? 5,
      },
    }
  );

  // Seed session
  (coordinator as any).session = SessionUtils.createSession(team.id, team.name);
  (coordinator as any).team = team;

  return coordinator;
}

function makeMessage(
  id: string,
  speaker: Member,
  content: string,
  rawNextMarkers: string[],
  parsedAddressees?: Array<{ name: string; intent: 'P1' | 'P2' | 'P3' }>
): ConversationMessage {
  return {
    id,
    content,
    timestamp: new Date(),
    speaker: {
      id: speaker.id,
      name: speaker.name,
      displayName: speaker.displayName,
      type: speaker.type,
    },
    routing: {
      rawNextMarkers,
      resolvedAddressees: [],
      parsedAddressees,
    },
  };
}

// ============================================================================
// Test Suite 1: Intent Matching with id/name/displayName
// ============================================================================

describe('v3 Intent Matching (id/name/displayName)', () => {
  const aiClaude = makeMember('claude-ai', 'claude', 'Claude Code', 'ai', 0);
  const aiCodex = makeMember('codex-ai', 'codex', 'OpenAI Codex', 'ai', 1);
  const human = makeMember('human-1', 'kai', 'Kai Chen', 'human', 2);

  const team = makeTeam([aiClaude, aiCodex, human]);

  it('matches by member.id with intent', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Message with [NEXT: claude-ai!P1]
    const message = makeMessage('msg-1', human, 'Fix the bug', ['claude-ai'], [
      { name: 'claude-ai', intent: 'P1' },
    ]);

    (coordinator as any).session.messages.push(message);
    await (coordinator as any).routeToNext(message);

    // Verify P1 intent was preserved
    const queuePeek = v3Queue.peek();
    expect(sendToAgent).toHaveBeenCalledTimes(1);
    // Route should have P1_INTERRUPT intent
    expect(sendToAgent.mock.calls[0][2].intent).toBe('P1_INTERRUPT');
  });

  it('matches by member.name with intent', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);

    // Message with [NEXT: claude!P2]
    const message = makeMessage('msg-2', human, 'Review code', ['claude'], [
      { name: 'claude', intent: 'P2' },
    ]);

    (coordinator as any).session.messages.push(message);
    await (coordinator as any).routeToNext(message);

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0].id).toBe('claude-ai');
    expect(sendToAgent.mock.calls[0][2].intent).toBe('P2_REPLY');
  });

  it('matches by member.displayName with intent', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);

    // Message with [NEXT: OpenAI Codex!P3]
    const message = makeMessage('msg-3', human, 'Extend feature', ['OpenAI Codex'], [
      { name: 'OpenAI Codex', intent: 'P3' },
    ]);

    (coordinator as any).session.messages.push(message);
    await (coordinator as any).routeToNext(message);

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0].id).toBe('codex-ai');
    expect(sendToAgent.mock.calls[0][2].intent).toBe('P3_EXTEND');
  });

  it('normalizes identifiers (case-insensitive, strips spaces/hyphens)', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);

    // Message with [NEXT: CLAUDE-AI] (uppercase with hyphen)
    const message = makeMessage('msg-4', human, 'Test normalization', ['CLAUDE-AI'], [
      { name: 'CLAUDE-AI', intent: 'P2' },
    ]);

    (coordinator as any).session.messages.push(message);
    await (coordinator as any).routeToNext(message);

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0].id).toBe('claude-ai');
  });

  it('defaults to P2 when no matching parsedAddressee found', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);

    // Message with rawNextMarkers but no parsedAddressees
    const message = makeMessage('msg-5', human, 'No intent', ['claude'], undefined);

    (coordinator as any).session.messages.push(message);
    await (coordinator as any).routeToNext(message);

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    // Should default to P2_REPLY
    expect(sendToAgent.mock.calls[0][2].intent).toBe('P2_REPLY');
  });
});

// ============================================================================
// Test Suite 2: maxLocalSeq Anti-Starvation Mechanism
// ============================================================================

describe('v3 maxLocalSeq Anti-Starvation', () => {
  const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
  const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
  const aiC = makeMember('ai-c', 'ai-c', 'AI C', 'ai', 2);
  const human = makeMember('human-x', 'human-x', 'Human X', 'human', 3);

  const team = makeTeam([aiA, aiB, aiC, human]);

  it('switches to global scheduling after maxLocalSeq consecutive local selections', () => {
    const coordinator = buildCoordinator(team, { maxLocalSeq: 2 });
    const v3Queue = (coordinator as any).routingQueueV3;

    // First enqueue items from parent-1 (local set)
    v3Queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Then enqueue item from parent-2 (global set) - use P3 so it has lower priority
    // This ensures global item only wins when local exhausted or maxLocalSeq reached
    v3Queue.enqueue(
      [{ targetMemberId: 'human-x', intent: 'P2_REPLY' }],
      'parent-2'
    );

    // Mark parent-1 as completed (sets local context)
    v3Queue.markCompleted('parent-1');

    // First 2 selections should be from parent-1 (local, maxLocalSeq=2)
    const first = v3Queue.selectNext();
    expect(first?.parentMessageId).toBe('parent-1');
    expect(first?.targetMemberId).toBe('ai-a');

    const second = v3Queue.selectNext();
    expect(second?.parentMessageId).toBe('parent-1');
    expect(second?.targetMemberId).toBe('ai-b');

    // After maxLocalSeq reached, local set is exhausted, so global item is selected
    const third = v3Queue.selectNext();
    expect(third?.parentMessageId).toBe('parent-2');
    expect(third?.targetMemberId).toBe('human-x');
  });

  it('resets local count after P1 preemption', () => {
    const coordinator = buildCoordinator(team, { maxLocalSeq: 3 });
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue P2 items from parent-1
    v3Queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Set local context to parent-1
    v3Queue.markCompleted('parent-1');

    // Select first local item
    const first = v3Queue.selectNext();
    expect(first?.targetMemberId).toBe('ai-a');

    // Now add a P1 item from different parent
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-c', intent: 'P1_INTERRUPT' }],
      'parent-2'
    );

    // P1 should preempt and reset local count
    const p1Item = v3Queue.selectNext();
    expect(p1Item?.intent).toBe('P1_INTERRUPT');
    expect(p1Item?.targetMemberId).toBe('ai-c');

    // After P1, local count is reset, should select from global (remaining P2)
    const next = v3Queue.selectNext();
    expect(next?.targetMemberId).toBe('ai-b');
  });

  it('continues local scheduling when maxLocalSeq not reached', () => {
    const coordinator = buildCoordinator(team, { maxLocalSeq: 10 });
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue 5 items from parent-1
    v3Queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-c', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Add item from parent-2
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-2'
    );

    // Set local context
    v3Queue.markCompleted('parent-1');

    // All parent-1 items should be selected first (maxLocalSeq=10)
    for (let i = 0; i < 3; i++) {
      const item = v3Queue.selectNext();
      expect(item?.parentMessageId).toBe('parent-1');
    }

    // Now parent-2 item
    const lastItem = v3Queue.selectNext();
    expect(lastItem?.parentMessageId).toBe('parent-2');
  });
});

// ============================================================================
// Test Suite 3: Queue/Branch Protection (Overflow Handling)
// ============================================================================

describe('v3 Queue/Branch Protection', () => {
  const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
  const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
  const aiC = makeMember('ai-c', 'ai-c', 'AI C', 'ai', 2);
  const aiD = makeMember('ai-d', 'ai-d', 'AI D', 'ai', 3);
  const human = makeMember('human-x', 'human-x', 'Human X', 'human', 4);

  const team = makeTeam([aiA, aiB, aiC, aiD, human]);

  it('drops items when queue reaches maxQueueSize', () => {
    const onQueueProtection = vi.fn();
    const coordinator = buildCoordinator(team, { maxQueueSize: 3 });
    const v3Queue = (coordinator as any).routingQueueV3;
    (v3Queue as any).callbacks.onQueueProtection = onQueueProtection;

    // Enqueue 3 items (fills queue)
    v3Queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-c', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    expect(v3Queue.size()).toBe(3);

    // Try to enqueue 4th item
    const result = v3Queue.enqueue(
      [{ targetMemberId: 'ai-d', intent: 'P2_REPLY' }],
      'parent-2'
    );

    // Should be skipped due to queue_overflow
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].reason).toBe('queue_overflow');
    expect(v3Queue.size()).toBe(3);

    // Protection event should be emitted
    expect(onQueueProtection).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'queue_overflow',
        threshold: 3,
      })
    );
  });

  it('demotes to P3 when branch reaches maxBranchSize', () => {
    const onQueueProtection = vi.fn();
    const coordinator = buildCoordinator(team, { maxBranchSize: 2 });
    const v3Queue = (coordinator as any).routingQueueV3;
    (v3Queue as any).callbacks.onQueueProtection = onQueueProtection;

    // Enqueue 2 items for parent-1 (fills branch)
    v3Queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P1_INTERRUPT' },
        { targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' },
      ],
      'parent-1'
    );

    // Enqueue 3rd item for same parent with P1 intent
    const result = v3Queue.enqueue(
      [{ targetMemberId: 'ai-c', intent: 'P1_INTERRUPT' }],
      'parent-1'
    );

    // Should be demoted to P3_EXTEND
    expect(result.enqueued.length).toBe(1);
    expect(result.enqueued[0].intent).toBe('P3_EXTEND');

    // Protection event should be emitted
    expect(onQueueProtection).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'branch_overflow',
        threshold: 2,
      })
    );
  });

  it('skips duplicate items (same parent + member + intent)', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue first item
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    // Try to enqueue duplicate
    const result = v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].reason).toBe('duplicate');
    expect(v3Queue.size()).toBe(1);
  });

  it('skips adjacent duplicate members', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue first item
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    // Try to enqueue same member with different intent (adjacent duplicate)
    const result = v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P1_INTERRUPT' }],
      'parent-2'
    );

    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].reason).toBe('adjacent_duplicate');
    expect(v3Queue.size()).toBe(1);
  });

  it('allows same member from different positions (not adjacent)', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue ai-a
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    // Enqueue ai-b (breaks adjacency)
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-b', intent: 'P2_REPLY' }],
      'parent-2'
    );

    // Enqueue ai-a again (not adjacent)
    const result = v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-3'
    );

    // Should succeed (different dedup key due to different parent)
    expect(result.enqueued.length).toBe(1);
    expect(v3Queue.size()).toBe(3);
  });
});

// ============================================================================
// Test Suite 4: markCompleted Path (Local Scheduling Context)
// ============================================================================

describe('v3 markCompleted Path', () => {
  const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
  const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
  const aiC = makeMember('ai-c', 'ai-c', 'AI C', 'ai', 2);
  const human = makeMember('human-x', 'human-x', 'Human X', 'human', 3);

  const team = makeTeam([aiA, aiB, aiC, human]);

  it('updates lastCompletedMessageId on markCompleted', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    expect(v3Queue.getLastCompletedMessageId()).toBeNull();

    v3Queue.markCompleted('msg-123');
    expect(v3Queue.getLastCompletedMessageId()).toBe('msg-123');

    v3Queue.markCompleted('msg-456');
    expect(v3Queue.getLastCompletedMessageId()).toBe('msg-456');
  });

  it('prefers local items (same parent as lastCompleted) over global', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue items from different parents (all P2)
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-b', intent: 'P2_REPLY' }],
      'parent-2'
    );
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-c', intent: 'P2_REPLY' }],
      'parent-1'
    );

    // Mark parent-1 as completed
    v3Queue.markCompleted('parent-1');

    // Should select local items (parent-1) first
    const first = v3Queue.selectNext();
    expect(first?.parentMessageId).toBe('parent-1');

    const second = v3Queue.selectNext();
    expect(second?.parentMessageId).toBe('parent-1');

    // Then global (parent-2)
    const third = v3Queue.selectNext();
    expect(third?.parentMessageId).toBe('parent-2');
  });

  it('storeMessage calls markCompleted on v3 queue', async () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Create a message
    const message: ConversationMessage = {
      id: 'test-msg-id',
      content: 'Test content',
      timestamp: new Date(),
      speaker: {
        id: human.id,
        name: human.name,
        displayName: human.displayName,
        type: 'human',
      },
    };

    // Call storeMessage
    (coordinator as any).storeMessage(message);

    // Verify markCompleted was called
    expect(v3Queue.getLastCompletedMessageId()).toBe('test-msg-id');
  });

  it('clear does not reset lastCompletedMessageId', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Set up state
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );
    v3Queue.markCompleted('msg-completed');

    // Clear queue
    v3Queue.clear();

    // Queue should be empty but lastCompleted preserved
    expect(v3Queue.isEmpty()).toBe(true);
    expect(v3Queue.getLastCompletedMessageId()).toBe('msg-completed');
  });
});

// ============================================================================
// Test Suite 5: P1 Global Preemption
// ============================================================================

describe('v3 P1 Global Preemption', () => {
  const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
  const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
  const aiC = makeMember('ai-c', 'ai-c', 'AI C', 'ai', 2);
  const human = makeMember('human-x', 'human-x', 'Human X', 'human', 3);

  const team = makeTeam([aiA, aiB, aiC, human]);

  it('P1 preempts P2 even when P2 is local', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue P2 items from parent-1
    v3Queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Set local context to parent-1
    v3Queue.markCompleted('parent-1');

    // Enqueue P1 from different parent
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-c', intent: 'P1_INTERRUPT' }],
      'parent-2'
    );

    // P1 should be selected first despite P2 being local
    const first = v3Queue.selectNext();
    expect(first?.intent).toBe('P1_INTERRUPT');
    expect(first?.targetMemberId).toBe('ai-c');
  });

  it('P1 items are all processed before P2', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue P2 first, then P1
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' }],
      'parent-2'
    );

    // P1 should be selected first
    const first = v3Queue.selectNext();
    expect(first?.intent).toBe('P1_INTERRUPT');
    expect(first?.targetMemberId).toBe('ai-b');

    // Then P2
    const second = v3Queue.selectNext();
    expect(second?.intent).toBe('P2_REPLY');
    expect(second?.targetMemberId).toBe('ai-a');
  });

  it('after P1 processing, continues with P2 in priority order', () => {
    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Enqueue P2 items
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-b', intent: 'P3_EXTEND' }],
      'parent-2'
    );

    // Enqueue P1
    v3Queue.enqueue(
      [{ targetMemberId: 'ai-c', intent: 'P1_INTERRUPT' }],
      'parent-3'
    );

    // Process P1 first
    const p1 = v3Queue.selectNext();
    expect(p1?.intent).toBe('P1_INTERRUPT');

    // Then P2
    const p2 = v3Queue.selectNext();
    expect(p2?.intent).toBe('P2_REPLY');

    // Then P3
    const p3 = v3Queue.selectNext();
    expect(p3?.intent).toBe('P3_EXTEND');
  });
});

// ============================================================================
// Test Suite 6: Full Coordinator Integration
// ============================================================================

describe('v3 Full Coordinator Integration', () => {
  const aiClaude = makeMember('claude-ai', 'claude', 'Claude Code', 'ai', 0);
  const aiCodex = makeMember('codex-ai', 'codex', 'OpenAI Codex', 'ai', 1);
  const human = makeMember('human-1', 'kai', 'Kai Chen', 'human', 2);

  const team = makeTeam([aiClaude, aiCodex, human]);

  it('parsedAddressees are preserved from sendMessage to routeToNext', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);

    // Parse message with intent markers
    const router = new MessageRouter();
    const parsed = router.parseMessage('Fix bug [NEXT: claude!P1, codex!P3]');

    expect(parsed.parsedAddressees).toEqual([
      { name: 'claude', intent: 'P1' },
      { name: 'codex', intent: 'P3' },
    ]);

    // Simulate sendMessage flow (manual since we mock AgentManager)
    const message = makeMessage(
      'test-msg',
      human,
      parsed.cleanContent,
      parsed.addressees,
      parsed.parsedAddressees
    );

    (coordinator as any).session.messages.push(message);
    await (coordinator as any).routeToNext(message);

    // Verify both agents were called with correct intents
    expect(sendToAgent).toHaveBeenCalledTimes(2);

    // First call: claude with P1
    expect(sendToAgent.mock.calls[0][0].id).toBe('claude-ai');
    expect(sendToAgent.mock.calls[0][2].intent).toBe('P1_INTERRUPT');

    // Second call: codex with P3
    expect(sendToAgent.mock.calls[1][0].id).toBe('codex-ai');
    expect(sendToAgent.mock.calls[1][2].intent).toBe('P3_EXTEND');
  });

  it('v3 queue is the single source of truth for routing', async () => {
    const sendToAgent = vi.fn().mockResolvedValue(undefined);
    (ConversationCoordinator.prototype as any).sendToAgent = sendToAgent;

    const coordinator = buildCoordinator(team);
    const v3Queue = (coordinator as any).routingQueueV3;

    // Pre-populate v3 queue
    v3Queue.enqueue(
      [
        { targetMemberId: 'claude-ai', intent: 'P2_REPLY' },
        { targetMemberId: 'codex-ai', intent: 'P2_REPLY' },
      ],
      'parent-msg-1'
    );

    // Message with no NEXT markers (should process queue)
    const message = makeMessage('trigger-msg', human, 'Continue', [], []);
    (coordinator as any).session.messages.push(message);

    await (coordinator as any).routeToNext(message);

    // Both agents should have been called from v3 queue
    expect(sendToAgent).toHaveBeenCalledTimes(2);
    expect(sendToAgent.mock.calls[0][0].id).toBe('claude-ai');
    expect(sendToAgent.mock.calls[1][0].id).toBe('codex-ai');
  });
});
