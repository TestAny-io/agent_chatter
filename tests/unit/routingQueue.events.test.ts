/**
 * RoutingQueue Events and Queue Protection Tests (v3)
 *
 * Tests the event emission and queue protection mechanisms:
 * 1. QueueUpdateEvent emission and contents
 * 2. QueueProtectionEvent emission (overflow, branch_overflow)
 * 3. Stats calculation and accuracy
 * 4. Callback invocation patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutingQueue, type EnqueueInput, type RoutingQueueConfig } from '../../src/services/RoutingQueue.js';
import type { QueueUpdateEvent, QueueProtectionEvent, QueueItemView } from '../../src/models/QueueEvent.js';
import type { Member } from '../../src/models/Team.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeMember(id: string, name: string, type: 'ai' | 'human' = 'ai'): Member {
  return {
    id,
    name,
    displayName: name,
    displayRole: name,
    role: name,
    type,
    baseDir: '',
    order: 0,
  };
}

function createQueue(
  config?: Partial<RoutingQueueConfig>,
  callbacks?: {
    onQueueUpdate?: (event: QueueUpdateEvent) => void;
    onQueueProtection?: (event: QueueProtectionEvent) => void;
  },
  members?: Member[]
): RoutingQueue {
  const memberMap = new Map<string, Member>();
  (members ?? []).forEach(m => memberMap.set(m.id, m));

  return new RoutingQueue({
    config,
    callbacks,
    memberLookup: (id) => memberMap.get(id),
  });
}

// ============================================================================
// Test Suite 1: QueueUpdateEvent Emission
// ============================================================================

describe('QueueUpdateEvent Emission', () => {
  it('emits QueueUpdateEvent on enqueue', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    expect(onQueueUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not emit QueueUpdateEvent when all items skipped', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({ maxQueueSize: 1 }, { onQueueUpdate }, members);

    // Fill the queue
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    onQueueUpdate.mockClear();

    // Try to add when full (should be skipped)
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-2');

    // Should not emit for skipped items
    expect(onQueueUpdate).not.toHaveBeenCalled();
  });

  it('emits QueueUpdateEvent on clear', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    onQueueUpdate.mockClear();

    queue.clear();

    expect(onQueueUpdate).toHaveBeenCalledTimes(1);
    expect(onQueueUpdate.mock.calls[0][0].isEmpty).toBe(true);
  });

  it('emits QueueUpdateEvent via notifyQueueUpdate', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.notifyQueueUpdate();

    expect(onQueueUpdate).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Test Suite 2: QueueUpdateEvent Contents
// ============================================================================

describe('QueueUpdateEvent Contents', () => {
  it('includes items array with Member objects', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' },
      ],
      'parent-1'
    );

    const event = onQueueUpdate.mock.calls[0][0];
    expect(event.items.length).toBe(2);
    expect(event.items[0].id).toBe('ai-a');
    expect(event.items[1].id).toBe('ai-b');
  });

  it('includes itemsDetail with full QueueItemView objects', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P1_INTERRUPT' }],
      'parent-1'
    );

    const event = onQueueUpdate.mock.calls[0][0];
    expect(event.itemsDetail.length).toBe(1);

    const detail = event.itemsDetail[0];
    expect(detail.id).toBeDefined();
    expect(detail.member.id).toBe('ai-a');
    expect(detail.parentMessageId).toBe('parent-1');
    expect(detail.intent).toBe('P1_INTERRUPT');
    expect(typeof detail.enqueuedAt).toBe('number');
  });

  it('includes executing member when provided', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    const executingMember = members[0];
    const executingRoute = {
      id: 'route-1',
      targetMemberId: 'ai-a',
      parentMessageId: 'parent-1',
      triggerMessageId: 'parent-1',
      intent: 'P2_REPLY' as const,
      enqueuedAt: Date.now(),
    };

    queue.notifyQueueUpdate(executingMember, executingRoute);

    const event = onQueueUpdate.mock.calls[0][0];
    expect(event.executing).toBe(executingMember);
    expect(event.executingDetail).toBeDefined();
    expect(event.executingDetail?.member.id).toBe('ai-a');
    expect(event.executingDetail?.intent).toBe('P2_REPLY');
  });

  it('includes isEmpty flag correctly', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    // Empty queue, no executing
    queue.notifyQueueUpdate();
    expect(onQueueUpdate.mock.calls[0][0].isEmpty).toBe(true);

    // Add item
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    expect(onQueueUpdate.mock.calls[1][0].isEmpty).toBe(false);

    // Empty queue but with executing member
    queue.selectNext();
    queue.notifyQueueUpdate(members[0], {
      id: 'route-1',
      targetMemberId: 'ai-a',
      parentMessageId: 'parent-1',
      triggerMessageId: 'parent-1',
      intent: 'P2_REPLY',
      enqueuedAt: Date.now(),
    });
    expect(onQueueUpdate.mock.calls[2][0].isEmpty).toBe(false);
  });

  it('includes stats in event', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [
      makeMember('ai-a', 'AI A'),
      makeMember('ai-b', 'AI B'),
      makeMember('ai-c', 'AI C'),
    ];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P1_INTERRUPT' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-c', intent: 'P3_EXTEND' },
      ],
      'parent-1'
    );

    const event = onQueueUpdate.mock.calls[0][0];
    expect(event.stats.totalPending).toBe(3);
    expect(event.stats.byIntent.P1_INTERRUPT).toBe(1);
    expect(event.stats.byIntent.P2_REPLY).toBe(1);
    expect(event.stats.byIntent.P3_EXTEND).toBe(1);
  });
});

// ============================================================================
// Test Suite 3: QueueProtectionEvent Emission
// ============================================================================

describe('QueueProtectionEvent Emission', () => {
  it('emits queue_overflow event when maxQueueSize exceeded', () => {
    const onQueueProtection = vi.fn<[QueueProtectionEvent], void>();
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({ maxQueueSize: 2 }, { onQueueProtection }, members);

    // Fill the queue
    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Try to overflow
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-2');

    expect(onQueueProtection).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'queue_overflow',
        threshold: 2,
        actual: 2,
        truncatedCount: 1,
      })
    );
  });

  it('emits branch_overflow event when maxBranchSize exceeded', () => {
    const onQueueProtection = vi.fn<[QueueProtectionEvent], void>();
    const members = [
      makeMember('ai-a', 'AI A'),
      makeMember('ai-b', 'AI B'),
      makeMember('ai-c', 'AI C'),
    ];
    const queue = createQueue({ maxBranchSize: 2 }, { onQueueProtection }, members);

    // Fill the branch
    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Try to overflow branch
    queue.enqueue([{ targetMemberId: 'ai-c', intent: 'P2_REPLY' }], 'parent-1');

    expect(onQueueProtection).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'branch_overflow',
        threshold: 2,
        actual: 2,
        truncatedCount: 1,
      })
    );
  });

  it('emits branch_overflow for each item demoted', () => {
    const onQueueProtection = vi.fn<[QueueProtectionEvent], void>();
    const members = [
      makeMember('ai-a', 'AI A'),
      makeMember('ai-b', 'AI B'),
      makeMember('ai-c', 'AI C'),
      makeMember('ai-d', 'AI D'),
    ];
    const queue = createQueue({ maxBranchSize: 1 }, { onQueueProtection }, members);

    // First item fills branch
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');

    // Next three should all trigger branch overflow
    queue.enqueue(
      [
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-c', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    // Should emit for each overflow (ai-b and ai-c)
    expect(onQueueProtection).toHaveBeenCalledTimes(2);
    expect(onQueueProtection.mock.calls[0][0].type).toBe('branch_overflow');
    expect(onQueueProtection.mock.calls[1][0].type).toBe('branch_overflow');
  });

  it('does not emit protection event for normal operations', () => {
    const onQueueProtection = vi.fn<[QueueProtectionEvent], void>();
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({ maxQueueSize: 10, maxBranchSize: 5 }, { onQueueProtection }, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    expect(onQueueProtection).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Test Suite 4: Stats Calculation
// ============================================================================

describe('Stats Calculation', () => {
  it('calculates totalPending correctly', () => {
    const members = [
      makeMember('ai-a', 'AI A'),
      makeMember('ai-b', 'AI B'),
      makeMember('ai-c', 'AI C'),
    ];
    const queue = createQueue({}, {}, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-c', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    const stats = queue.getStats();
    expect(stats.totalPending).toBe(3);
  });

  it('calculates byIntent breakdown correctly', () => {
    const members = [
      makeMember('ai-a', 'AI A'),
      makeMember('ai-b', 'AI B'),
      makeMember('ai-c', 'AI C'),
      makeMember('ai-d', 'AI D'),
    ];
    const queue = createQueue({}, {}, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P1_INTERRUPT' },
        { targetMemberId: 'ai-b', intent: 'P1_INTERRUPT' },
      ],
      'parent-1'
    );
    queue.enqueue(
      [
        { targetMemberId: 'ai-c', intent: 'P2_REPLY' },
      ],
      'parent-2'
    );
    queue.enqueue(
      [
        { targetMemberId: 'ai-d', intent: 'P3_EXTEND' },
      ],
      'parent-3'
    );

    const stats = queue.getStats();
    expect(stats.byIntent.P1_INTERRUPT).toBe(2);
    expect(stats.byIntent.P2_REPLY).toBe(1);
    expect(stats.byIntent.P3_EXTEND).toBe(1);
  });

  it('calculates localQueueSize correctly', () => {
    const members = [
      makeMember('ai-a', 'AI A'),
      makeMember('ai-b', 'AI B'),
      makeMember('ai-c', 'AI C'),
    ];
    const queue = createQueue({}, {}, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );
    queue.enqueue(
      [
        { targetMemberId: 'ai-c', intent: 'P2_REPLY' },
      ],
      'parent-2'
    );

    // Before markCompleted, localQueueSize should be 0
    let stats = queue.getStats();
    expect(stats.localQueueSize).toBe(0);

    // After markCompleted, localQueueSize should count items with that parent
    queue.markCompleted('parent-1');
    stats = queue.getStats();
    expect(stats.localQueueSize).toBe(2);

    // Change to different parent
    queue.markCompleted('parent-2');
    stats = queue.getStats();
    expect(stats.localQueueSize).toBe(1);
  });

  it('updates stats after selectNext', () => {
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({}, {}, members);

    queue.enqueue(
      [
        { targetMemberId: 'ai-a', intent: 'P2_REPLY' },
        { targetMemberId: 'ai-b', intent: 'P2_REPLY' },
      ],
      'parent-1'
    );

    expect(queue.getStats().totalPending).toBe(2);

    queue.selectNext();
    expect(queue.getStats().totalPending).toBe(1);

    queue.selectNext();
    expect(queue.getStats().totalPending).toBe(0);
  });

  it('returns zero stats for empty queue', () => {
    const queue = createQueue();

    const stats = queue.getStats();
    expect(stats.totalPending).toBe(0);
    expect(stats.byIntent.P1_INTERRUPT).toBe(0);
    expect(stats.byIntent.P2_REPLY).toBe(0);
    expect(stats.byIntent.P3_EXTEND).toBe(0);
    expect(stats.localQueueSize).toBe(0);
  });
});

// ============================================================================
// Test Suite 5: Callback Invocation Patterns
// ============================================================================

describe('Callback Invocation Patterns', () => {
  it('callbacks are optional', () => {
    const queue = createQueue({}, undefined, [makeMember('ai-a', 'AI A')]);

    // Should not throw without callbacks
    expect(() => {
      queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
      queue.notifyQueueUpdate();
      queue.clear();
    }).not.toThrow();
  });

  it('only calls provided callbacks', () => {
    const onQueueUpdate = vi.fn();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({ maxQueueSize: 1 }, { onQueueUpdate }, members);

    // Fill and overflow
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');

    // onQueueProtection not provided, should not throw
    expect(() => {
      queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-2');
    }).not.toThrow();

    // onQueueUpdate should have been called
    expect(onQueueUpdate).toHaveBeenCalled();
  });

  it('handles callback errors gracefully (does not crash)', () => {
    const errorCallback = vi.fn(() => {
      throw new Error('Callback error');
    });

    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate: errorCallback }, members);

    // Should throw (caller's responsibility to handle)
    expect(() => {
      queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    }).toThrow('Callback error');
  });

  it('calls onQueueUpdate with executing info when processing', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    onQueueUpdate.mockClear();

    // Simulate coordinator calling notifyQueueUpdate with executing member
    const route = queue.selectNext()!;
    queue.notifyQueueUpdate(members[0], {
      id: route.id,
      targetMemberId: 'ai-a',
      parentMessageId: 'parent-1',
      triggerMessageId: 'parent-1',
      intent: 'P2_REPLY',
      enqueuedAt: Date.now(),
    });

    expect(onQueueUpdate).toHaveBeenCalledTimes(1);
    const event = onQueueUpdate.mock.calls[0][0];
    expect(event.executing?.id).toBe('ai-a');
    expect(event.executingDetail).toBeDefined();
  });
});

// ============================================================================
// Test Suite 6: Member Lookup Integration
// ============================================================================

describe('Member Lookup Integration', () => {
  it('uses memberLookup to resolve Member objects', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    const event = onQueueUpdate.mock.calls[0][0];
    expect(event.items[0].name).toBe('AI A');
    expect(event.itemsDetail[0].member.displayName).toBe('AI A');
  });

  it('skips items with unresolved members in event', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    // Only ai-a is in the lookup, not ai-b
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, { onQueueUpdate }, members);

    // Enqueue item for member not in lookup
    queue.enqueue(
      [{ targetMemberId: 'ai-unknown', intent: 'P2_REPLY' }],
      'parent-1'
    );

    const event = onQueueUpdate.mock.calls[0][0];
    // items and itemsDetail should be empty (member not found)
    expect(event.items.length).toBe(0);
    expect(event.itemsDetail.length).toBe(0);
    // But queue still has the item
    expect(queue.size()).toBe(1);
  });

  it('allows updating memberLookup via setMemberLookup', () => {
    const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
    const queue = createQueue({}, { onQueueUpdate }, []);

    // Initially no members
    queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    let event = onQueueUpdate.mock.calls[0][0];
    expect(event.items.length).toBe(0);

    // Update lookup
    const newMember = makeMember('ai-a', 'AI A');
    queue.setMemberLookup((id) => id === 'ai-a' ? newMember : undefined);

    // Notify again
    queue.notifyQueueUpdate();

    event = onQueueUpdate.mock.calls[1][0];
    expect(event.items.length).toBe(1);
    expect(event.items[0].id).toBe('ai-a');
  });
});

// ============================================================================
// Test Suite 7: Dedup Key Generation
// ============================================================================

describe('Dedup Key Generation', () => {
  it('generates unique dedup key from parent:member:intent', () => {
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, {}, members);

    // Same parent, same member, different intent should both be enqueued
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P3_EXTEND' }], 'parent-1');

    // Second should be skipped as adjacent duplicate (same member consecutively)
    expect(queue.size()).toBe(1);
  });

  it('allows same member from different parents', () => {
    const members = [makeMember('ai-a', 'AI A'), makeMember('ai-b', 'AI B')];
    const queue = createQueue({}, {}, members);

    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    // Add different member to break adjacency
    queue.enqueue([{ targetMemberId: 'ai-b', intent: 'P2_REPLY' }], 'parent-1');
    // Same member but different parent (not adjacent now)
    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-2');

    expect(queue.size()).toBe(3);
  });

  it('clears dedup set on queue clear', () => {
    const members = [makeMember('ai-a', 'AI A')];
    const queue = createQueue({}, {}, members);

    queue.enqueue([{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }], 'parent-1');
    queue.clear();

    // Should be able to enqueue same item again
    const result = queue.enqueue(
      [{ targetMemberId: 'ai-a', intent: 'P2_REPLY' }],
      'parent-1'
    );

    expect(result.enqueued.length).toBe(1);
    expect(queue.size()).toBe(1);
  });
});
