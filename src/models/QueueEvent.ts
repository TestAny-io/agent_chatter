/**
 * Queue Events
 *
 * Used for UI display of routing queue status
 *
 * v3 extension: Added QueueItemView and detailed routing info
 * @see docs/design/route_rule/V3/detail/05-events-callbacks.md
 */
import type { Member } from './Team.js';
import type { RoutingIntent } from './RoutingItem.js';

/**
 * Routing queue item (UI view)
 *
 * Simplified version of RoutingItem for UI display
 */
export interface QueueItemView {
  /** Queue item ID */
  id: string;

  /** Target member */
  member: Member;

  /** Parent message ID (for thread display) */
  parentMessageId: string;

  /** Intent priority */
  intent: RoutingIntent;

  /** Enqueue timestamp */
  enqueuedAt: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  /** Count by intent */
  byIntent: {
    P1_INTERRUPT: number;
    P2_REPLY: number;
    P3_EXTEND: number;
  };
  /** Total pending count */
  totalPending: number;
  /** Local queue size (same parent) */
  localQueueSize: number;
}

/**
 * Queue update event
 *
 * Scheme C: items is pending queue, executing is current executor
 * items does not include current executor for clearer semantics
 *
 * v3 extension: Added itemsDetail, executingDetail, stats
 */
export interface QueueUpdateEvent {
  // === Existing fields (backward compatible) ===

  /** Pending queue (not including current executor) - Member only, backward compatible */
  items: Member[];

  /** Currently executing member (optional, undefined when Human paused) */
  executing?: Member;

  /** Whether queue is empty (items.length === 0 and no executing) */
  isEmpty: boolean;

  // === v3 New Fields (optional) ===

  /**
   * Pending queue details (with intent and parent message)
   *
   * Corresponds 1:1 with items, but includes more routing info.
   * UI can optionally use this field for richer information.
   */
  itemsDetail?: QueueItemView[];

  /**
   * Current executing item details
   */
  executingDetail?: QueueItemView;

  /**
   * Queue statistics
   */
  stats?: QueueStats;
}

/**
 * Skip reason for routing items
 */
export type SkipReason =
  | 'duplicate'           // Duplicate enqueue
  | 'member_not_found'    // Member not found
  | 'adjacent_duplicate'  // Adjacent duplicate
  | 'queue_overflow'      // Queue overflow truncation
  | 'branch_overflow';    // Branch overflow truncation

/**
 * Queue protection event
 */
export interface QueueProtectionEvent {
  type: 'queue_overflow' | 'branch_overflow';
  threshold: number;
  actual: number;
  truncatedCount: number;
  affectedItems?: QueueItemView[];
}
