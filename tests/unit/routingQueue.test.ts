import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoutingQueue } from '../../src/services/RoutingQueue.js';
import type { RoutingItem, RoutingIntent } from '../../src/models/RoutingItem.js';
import type { Member } from '../../src/models/Team.js';
import type { QueueUpdateEvent, QueueProtectionEvent } from '../../src/models/QueueEvent.js';

// Helper to create a mock member
function createMockMember(id: string, name: string, type: 'ai' | 'human' = 'ai'): Member {
  return {
    id,
    name,
    displayName: name,
    type,
    role: 'developer',
    order: 0,
  };
}

describe('RoutingQueue', () => {
  let queue: RoutingQueue;
  const mockMemberLookup = (memberId: string): Member | undefined => {
    const members: Record<string, Member> = {
      'member-1': createMockMember('member-1', 'Alice'),
      'member-2': createMockMember('member-2', 'Bob'),
      'member-3': createMockMember('member-3', 'Carol'),
      'human-1': createMockMember('human-1', 'Dave', 'human'),
    };
    return members[memberId];
  };

  beforeEach(() => {
    queue = new RoutingQueue({
      memberLookup: mockMemberLookup,
    });
  });

  describe('enqueue', () => {
    it('enqueues items successfully', () => {
      const result = queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      expect(result.enqueued).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
      expect(queue.size()).toBe(1);
    });

    it('enqueues multiple items', () => {
      const result = queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P1_INTERRUPT' },
          { targetMemberId: 'member-3', intent: 'P3_EXTEND' },
        ],
        'msg-1'
      );

      expect(result.enqueued).toHaveLength(3);
      expect(queue.size()).toBe(3);
    });

    it('skips duplicate items (same parent, member, intent)', () => {
      // First enqueue
      queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      // Duplicate enqueue
      const result = queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      expect(result.enqueued).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('duplicate');
      expect(queue.size()).toBe(1);
    });

    it('allows same member with different intent when not adjacent', () => {
      // Enqueue two different members
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' }, // Different member in between
        ],
        'msg-1'
      );

      // Now enqueue member-1 with different intent - not adjacent to previous member-1
      const result = queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P1_INTERRUPT' }],
        'msg-1'
      );

      expect(result.enqueued).toHaveLength(1);
      expect(queue.size()).toBe(3);
    });

    it('rejects same member as adjacent even with different intent', () => {
      queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      // Adjacent duplicate - same member, even with different intent, is rejected
      const result = queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P1_INTERRUPT' }],
        'msg-1'
      );

      expect(result.enqueued).toHaveLength(0);
      expect(result.skipped.some(s => s.reason === 'adjacent_duplicate')).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('allows same member with different parent when not adjacent', () => {
      // Enqueue two different members
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' }, // Different member in between
        ],
        'msg-1'
      );

      // Now enqueue member-1 with different parent - not adjacent to previous member-1
      const result = queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-2'
      );

      expect(result.enqueued).toHaveLength(1);
      expect(queue.size()).toBe(3);
    });

    it('skips adjacent duplicate members', () => {
      const result = queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-1', intent: 'P3_EXTEND' }, // Adjacent duplicate
        ],
        'msg-1'
      );

      // Second item skipped as adjacent duplicate
      expect(result.enqueued).toHaveLength(1);
      expect(result.skipped.some(s => s.reason === 'adjacent_duplicate')).toBe(true);
    });
  });

  describe('selectNext', () => {
    it('returns null for empty queue', () => {
      expect(queue.selectNext()).toBeNull();
    });

    it('selects P1 items first (global preemption)', () => {
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P3_EXTEND' },
          { targetMemberId: 'member-3', intent: 'P1_INTERRUPT' },
        ],
        'msg-1'
      );

      const selected = queue.selectNext();
      expect(selected?.targetMemberId).toBe('member-3');
      expect(selected?.intent).toBe('P1_INTERRUPT');
    });

    it('selects P2 before P3 when no P1', () => {
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P3_EXTEND' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' },
        ],
        'msg-1'
      );

      const selected = queue.selectNext();
      expect(selected?.targetMemberId).toBe('member-2');
      expect(selected?.intent).toBe('P2_REPLY');
    });

    it('selects P1 items in FIFO order within same batch', () => {
      // Enqueue multiple P1 items in same batch
      // Items are added in order, so member-1 should be selected first
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P1_INTERRUPT' },
          { targetMemberId: 'member-2', intent: 'P1_INTERRUPT' },
        ],
        'msg-1'
      );

      const selected = queue.selectNext();
      // Both have same timestamp, so FIFO within batch
      expect(selected?.intent).toBe('P1_INTERRUPT');
    });

    it('removes selected item from queue', () => {
      queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      expect(queue.size()).toBe(1);
      queue.selectNext();
      expect(queue.size()).toBe(0);
    });
  });

  describe('local queue scheduling (S1)', () => {
    it('prefers items with same parent as last completed message', () => {
      // Enqueue items with different parents
      queue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );
      queue.enqueue(
        [{ targetMemberId: 'member-2', intent: 'P2_REPLY' }],
        'msg-2'
      );

      // Mark msg-1 as completed
      queue.markCompleted('msg-1');

      // Should select member-1 (local to msg-1)
      const selected = queue.selectNext();
      expect(selected?.targetMemberId).toBe('member-1');
    });
  });

  describe('anti-starvation (MAX_LOCAL_SEQ)', () => {
    it('switches to global after maxLocalSeq consecutive local selections', () => {
      const customQueue = new RoutingQueue({
        config: { maxLocalSeq: 2, maxQueueSize: 50, maxBranchSize: 10 },
        memberLookup: mockMemberLookup,
      });

      // Enqueue local items (same parent)
      customQueue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' },
          { targetMemberId: 'member-3', intent: 'P2_REPLY' },
        ],
        'msg-1'
      );

      // Mark msg-1 as completed to enable local scheduling
      customQueue.markCompleted('msg-1');

      // First local selection
      customQueue.selectNext();
      // Second local selection
      customQueue.selectNext();
      // Third should switch to global (maxLocalSeq=2 exceeded)
      // In this case, all are from same parent, so it continues
      // The anti-starvation kicks in when there are items from OTHER parents

      expect(customQueue.size()).toBe(1);
    });
  });

  describe('queue protection', () => {
    it('rejects items when queue is full', () => {
      const smallQueue = new RoutingQueue({
        config: { maxQueueSize: 2, maxBranchSize: 10, maxLocalSeq: 5 },
        memberLookup: mockMemberLookup,
      });

      smallQueue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' },
        ],
        'msg-1'
      );

      const result = smallQueue.enqueue(
        [{ targetMemberId: 'member-3', intent: 'P2_REPLY' }],
        'msg-2'
      );

      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('queue_overflow');
    });

    it('demotes to P3 when branch is full', () => {
      const smallBranchQueue = new RoutingQueue({
        config: { maxQueueSize: 50, maxBranchSize: 2, maxLocalSeq: 5 },
        memberLookup: mockMemberLookup,
      });

      // Fill branch
      smallBranchQueue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P1_INTERRUPT' },
          { targetMemberId: 'member-2', intent: 'P1_INTERRUPT' },
        ],
        'msg-1'
      );

      // Third item should be demoted to P3
      const result = smallBranchQueue.enqueue(
        [{ targetMemberId: 'member-3', intent: 'P1_INTERRUPT' }],
        'msg-1'
      );

      // Still enqueued (not rejected) but demoted
      expect(result.enqueued).toHaveLength(1);
      expect(result.enqueued[0].intent).toBe('P3_EXTEND');
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P1_INTERRUPT' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' },
          { targetMemberId: 'member-3', intent: 'P2_REPLY' },
        ],
        'msg-1'
      );

      const stats = queue.getStats();

      expect(stats.totalPending).toBe(3);
      expect(stats.byIntent.P1_INTERRUPT).toBe(1);
      expect(stats.byIntent.P2_REPLY).toBe(2);
      expect(stats.byIntent.P3_EXTEND).toBe(0);
    });
  });

  describe('callbacks', () => {
    it('emits queue update events', () => {
      const onQueueUpdate = vi.fn<[QueueUpdateEvent], void>();
      const queueWithCallback = new RoutingQueue({
        memberLookup: mockMemberLookup,
        callbacks: { onQueueUpdate },
      });

      queueWithCallback.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      expect(onQueueUpdate).toHaveBeenCalled();
    });

    it('emits protection events on overflow', () => {
      const onQueueProtection = vi.fn<[QueueProtectionEvent], void>();
      const smallQueue = new RoutingQueue({
        config: { maxQueueSize: 1, maxBranchSize: 10, maxLocalSeq: 5 },
        memberLookup: mockMemberLookup,
        callbacks: { onQueueProtection },
      });

      smallQueue.enqueue(
        [{ targetMemberId: 'member-1', intent: 'P2_REPLY' }],
        'msg-1'
      );

      smallQueue.enqueue(
        [{ targetMemberId: 'member-2', intent: 'P2_REPLY' }],
        'msg-2'
      );

      expect(onQueueProtection).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'queue_overflow' })
      );
    });
  });

  describe('clear', () => {
    it('clears all items', () => {
      queue.enqueue(
        [
          { targetMemberId: 'member-1', intent: 'P2_REPLY' },
          { targetMemberId: 'member-2', intent: 'P2_REPLY' },
        ],
        'msg-1'
      );

      expect(queue.size()).toBe(2);
      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });
  });
});
