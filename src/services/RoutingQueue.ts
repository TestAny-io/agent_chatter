/**
 * RoutingQueue - Routing queue with priority scheduling
 *
 * Implements the v3 routing queue with:
 * - Global P1 preemption
 * - Local set S1 (same parent as last completed)
 * - Global set S2 (all others)
 * - Anti-starvation via MAX_LOCAL_SEQ
 *
 * @see docs/design/route_rule/V3/detail/03-routing-queue.md
 */

import type { ILogger } from '../interfaces/ILogger.js';
import { SilentLogger } from '../interfaces/ILogger.js';
import type { RoutingItem, RoutingIntent } from '../models/RoutingItem.js';
import { generateRoutingItemId, getIntentPriority } from '../models/RoutingItem.js';
import type { Member } from '../models/Team.js';
import type {
  QueueUpdateEvent,
  QueueItemView,
  QueueStats,
  SkipReason,
  QueueProtectionEvent,
} from '../models/QueueEvent.js';

/**
 * Configuration for RoutingQueue
 */
export interface RoutingQueueConfig {
  /** Maximum total queue size (default 50) */
  maxQueueSize: number;
  /** Maximum items per parent branch (default 10) */
  maxBranchSize: number;
  /** Maximum consecutive local scheduling (default 5) */
  maxLocalSeq: number;
}

/**
 * Routing queue event callbacks
 */
export interface RoutingQueueCallbacks {
  /** Called when queue contents change */
  onQueueUpdate?: (event: QueueUpdateEvent) => void;
  /** Called when queue protection triggers */
  onQueueProtection?: (event: QueueProtectionEvent) => void;
}

/**
 * Input for enqueue operation (without generated fields)
 */
export interface EnqueueInput {
  targetMemberId: string;
  intent: RoutingIntent;
}

/**
 * Result of enqueue operation
 */
export interface EnqueueResult {
  /** Successfully enqueued items */
  enqueued: RoutingItem[];
  /** Skipped items with reasons */
  skipped: Array<{ input: EnqueueInput; reason: SkipReason }>;
}

/**
 * RoutingQueue class
 *
 * Manages the routing queue with priority-based scheduling algorithm.
 */
export class RoutingQueue {
  private items: RoutingItem[] = [];
  private readonly config: RoutingQueueConfig;
  private readonly callbacks: RoutingQueueCallbacks;
  private readonly logger: ILogger;

  /** Last completed message ID (for local set calculation) */
  private lastCompletedMessageId: string | null = null;

  /** Consecutive local scheduling count */
  private localSeqCount: number = 0;

  /** Deduplication set: parentMessageId:targetMemberId:intent */
  private dedupeSet: Set<string> = new Set();

  /** Member lookup function (injected) */
  private memberLookup?: (memberId: string) => Member | undefined;

  constructor(options?: {
    config?: Partial<RoutingQueueConfig>;
    callbacks?: RoutingQueueCallbacks;
    logger?: ILogger;
    memberLookup?: (memberId: string) => Member | undefined;
  }) {
    this.config = {
      maxQueueSize: options?.config?.maxQueueSize ?? 50,
      maxBranchSize: options?.config?.maxBranchSize ?? 10,
      maxLocalSeq: options?.config?.maxLocalSeq ?? 5,
    };
    this.callbacks = options?.callbacks ?? {};
    this.logger = options?.logger ?? new SilentLogger();
    this.memberLookup = options?.memberLookup;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Enqueue a batch of routing items
   *
   * @param inputs - Items to enqueue (without id and enqueuedAt)
   * @param parentMessageId - Parent message ID for all items
   * @returns Enqueue result with enqueued and skipped items
   */
  enqueue(inputs: EnqueueInput[], parentMessageId: string): EnqueueResult {
    const now = Date.now();
    const result: EnqueueResult = { enqueued: [], skipped: [] };

    for (const input of inputs) {
      // 1. Generate full routing item (initial intent)
      const fullItem: RoutingItem = {
        id: generateRoutingItemId(),
        targetMemberId: input.targetMemberId,
        parentMessageId: parentMessageId,
        triggerMessageId: parentMessageId,
        intent: input.intent,
        enqueuedAt: now,
      };

      // 2. Queue size limit check (before dedup to avoid unnecessary computation)
      if (this.items.length >= this.config.maxQueueSize) {
        this.logger.warn(
          `[RoutingQueue] Queue full (${this.config.maxQueueSize}), dropping: ${fullItem.targetMemberId}`
        );
        result.skipped.push({ input, reason: 'queue_overflow' });
        this.emitQueueProtection({
          type: 'queue_overflow',
          threshold: this.config.maxQueueSize,
          actual: this.items.length,
          truncatedCount: 1,
        });
        continue;
      }

      // 3. Branch size limit check -> demotion (must be before dedup!)
      const branchCount = this.items.filter(
        i => i.parentMessageId === fullItem.parentMessageId
      ).length;
      if (branchCount >= this.config.maxBranchSize) {
        this.logger.warn(
          `[RoutingQueue] Branch full (${this.config.maxBranchSize}) for parent ${fullItem.parentMessageId}, ` +
          `demoting ${fullItem.targetMemberId} from ${fullItem.intent} to P3_EXTEND`
        );
        fullItem.intent = 'P3_EXTEND'; // Demote to lowest priority
        this.emitQueueProtection({
          type: 'branch_overflow',
          threshold: this.config.maxBranchSize,
          actual: branchCount,
          truncatedCount: 1,
        });
      }

      // 4. Generate dedup key (after demotion, using final intent)
      const dedupeKey = this.getDedupeKey(fullItem);

      // 5. Global deduplication check
      if (this.dedupeSet.has(dedupeKey)) {
        this.logger.debug(`[RoutingQueue] Skipping duplicate: ${dedupeKey}`);
        result.skipped.push({ input, reason: 'duplicate' });
        continue;
      }

      // 6. Adjacent deduplication check
      const lastItem = this.items[this.items.length - 1];
      if (lastItem && lastItem.targetMemberId === fullItem.targetMemberId) {
        this.logger.debug(
          `[RoutingQueue] Skipping adjacent duplicate: ${fullItem.targetMemberId}`
        );
        result.skipped.push({ input, reason: 'adjacent_duplicate' });
        continue;
      }

      // 7. Enqueue and record dedup key
      this.items.push(fullItem);
      this.dedupeSet.add(dedupeKey);
      result.enqueued.push(fullItem);
    }

    // Emit queue update if any items were enqueued
    if (result.enqueued.length > 0) {
      this.emitQueueUpdate();
    }

    return result;
  }

  /**
   * Select next routing item to execute
   *
   * Scheduling algorithm:
   * 1. Global P1 preemption - any P1_INTERRUPT takes priority
   * 2. Local set S1 - same parent as lastCompletedMessageId (limited by maxLocalSeq)
   * 3. Global set S2 - all remaining items
   *
   * @returns Selected routing item, or null if queue is empty
   */
  selectNext(): RoutingItem | null {
    if (this.items.length === 0) {
      return null;
    }

    // === Phase 1: Global P1 preemption ===
    const p1Items = this.items.filter(i => i.intent === 'P1_INTERRUPT');
    if (p1Items.length > 0) {
      // Get earliest enqueued P1
      const earliest = p1Items.reduce((a, b) =>
        a.enqueuedAt < b.enqueuedAt ? a : b
      );
      this.localSeqCount = 0; // Reset local count
      return this.dequeueItem(earliest);
    }

    // === Phase 2: Local set S1 ===
    if (this.lastCompletedMessageId !== null) {
      const localItems = this.items.filter(
        i => i.parentMessageId === this.lastCompletedMessageId
      );

      if (localItems.length > 0 && this.localSeqCount < this.config.maxLocalSeq) {
        // Sort: P2 > P3, then by enqueuedAt
        const sorted = this.sortByPriorityAndTime(localItems, [
          'P2_REPLY',
          'P3_EXTEND',
        ]);
        this.localSeqCount++;
        return this.dequeueItem(sorted[0]);
      }
    }

    // === Phase 3: Global set S2 ===
    // Reset local count (switching to global)
    this.localSeqCount = 0;

    // Global sort: P2 > P3 (P1 handled above), then by enqueuedAt
    const sorted = this.sortByPriorityAndTime(this.items, [
      'P2_REPLY',
      'P3_EXTEND',
    ]);
    return this.dequeueItem(sorted[0]);
  }

  /**
   * Mark a message as completed
   *
   * Must be called after AI/Human successfully produces a response.
   *
   * @param messageId - The completed message ID
   */
  markCompleted(messageId: string): void {
    this.lastCompletedMessageId = messageId;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Clear the queue
   *
   * @remarks
   * Used by [DROP: ALL] instruction.
   * - Clears items[] and dedupeSet
   * - Resets localSeqCount to 0
   * - Does NOT clear lastCompletedMessageId (preserves local context for future routing)
   * - Emits V3 queue update event
   *
   * @see docs/design/route_rule/V3/queue-cleaning-protocol-engineering.md
   */
  clear(): void {
    const count = this.items.length;

    this.items = [];
    this.dedupeSet.clear();
    this.localSeqCount = 0;
    // Note: lastCompletedMessageId is intentionally NOT cleared

    if (count > 0) {
      this.logger.info(`[RoutingQueue] Cleared all ${count} items via DROP: ALL`);
    }

    this.emitQueueUpdate();
  }

  /**
   * Remove all items for a specific member (v3.1 Queue Cleaning Protocol)
   *
   * @param memberId - Member ID to remove
   * @returns Number of items removed
   *
   * @remarks
   * - Rebuilds dedupeSet after removal
   * - Resets localSeqCount to 0
   * - Preserves lastCompletedMessageId
   * - Emits queue update event with itemsDetail and stats
   *
   * @see docs/design/route_rule/V3/queue-cleaning-protocol-engineering.md
   */
  removeByTarget(memberId: string): number {
    const initialLength = this.items.length;

    // Filter out items targeting this member
    this.items = this.items.filter(item => item.targetMemberId !== memberId);

    const removedCount = initialLength - this.items.length;

    if (removedCount > 0) {
      // Rebuild dedupe set
      this.rebuildDedupeSet();
      // Reset local sequence count
      this.localSeqCount = 0;

      this.logger.info(
        `[RoutingQueue] Dropped ${removedCount} items for member ${memberId}`
      );

      // Emit V3 queue update event (with itemsDetail and stats)
      this.emitQueueUpdate();
    }

    return removedCount;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const byIntent = {
      P1_INTERRUPT: 0,
      P2_REPLY: 0,
      P3_EXTEND: 0,
    };

    for (const item of this.items) {
      byIntent[item.intent]++;
    }

    const localQueueSize = this.lastCompletedMessageId
      ? this.items.filter(i => i.parentMessageId === this.lastCompletedMessageId).length
      : 0;

    return {
      byIntent,
      totalPending: this.items.length,
      localQueueSize,
    };
  }

  /**
   * Peek at queue items (read-only)
   */
  peek(): readonly RoutingItem[] {
    return this.items;
  }

  /**
   * Get last completed message ID
   */
  getLastCompletedMessageId(): string | null {
    return this.lastCompletedMessageId;
  }

  /**
   * Set member lookup function
   */
  setMemberLookup(lookup: (memberId: string) => Member | undefined): void {
    this.memberLookup = lookup;
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Generate deduplication key
   */
  private getDedupeKey(item: RoutingItem): string {
    return `${item.parentMessageId}:${item.targetMemberId}:${item.intent}`;
  }

  /**
   * Rebuild dedupe set from current items (v3.1 Queue Cleaning Protocol)
   *
   * @remarks
   * Called after removing items to maintain consistency.
   * O(n) but acceptable since queue is typically small (<50 items).
   *
   * @see docs/design/route_rule/V3/queue-cleaning-protocol-engineering.md
   */
  private rebuildDedupeSet(): void {
    this.dedupeSet.clear();
    for (const item of this.items) {
      this.dedupeSet.add(this.getDedupeKey(item));
    }
  }

  /**
   * Sort items by priority and time
   */
  private sortByPriorityAndTime(
    items: RoutingItem[],
    priorityOrder: RoutingIntent[]
  ): RoutingItem[] {
    return [...items].sort((a, b) => {
      const priorityA = priorityOrder.indexOf(a.intent);
      const priorityB = priorityOrder.indexOf(b.intent);

      // Higher priority first (lower index = higher priority)
      if (priorityA !== priorityB) {
        // -1 means not in list (e.g., P1), put at end
        if (priorityA === -1) return 1;
        if (priorityB === -1) return -1;
        return priorityA - priorityB;
      }

      // Same priority: sort by enqueue time (FIFO)
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  /**
   * Dequeue and return specified item
   */
  private dequeueItem(item: RoutingItem): RoutingItem {
    const index = this.items.findIndex(i => i.id === item.id);
    if (index !== -1) {
      this.items.splice(index, 1);
      this.dedupeSet.delete(this.getDedupeKey(item));
    }
    return item;
  }

  /**
   * Convert RoutingItem to QueueItemView
   */
  private toQueueItemView(item: RoutingItem): QueueItemView | null {
    const member = this.memberLookup?.(item.targetMemberId);
    if (!member) {
      return null;
    }

    return {
      id: item.id,
      member,
      parentMessageId: item.parentMessageId,
      intent: item.intent,
      enqueuedAt: item.enqueuedAt,
    };
  }

  /**
   * Emit queue update event
   */
  private emitQueueUpdate(executingMember?: Member, executingRoute?: RoutingItem): void {
    if (!this.callbacks.onQueueUpdate) {
      return;
    }

    // Build items array (backward compatible)
    const items: Member[] = [];
    const itemsDetail: QueueItemView[] = [];

    for (const item of this.items) {
      const member = this.memberLookup?.(item.targetMemberId);
      if (member) {
        items.push(member);
        const view = this.toQueueItemView(item);
        if (view) {
          itemsDetail.push(view);
        }
      }
    }

    // Build executing detail
    let executingDetail: QueueItemView | undefined;
    if (executingMember && executingRoute) {
      executingDetail = {
        id: executingRoute.id,
        member: executingMember,
        parentMessageId: executingRoute.parentMessageId,
        intent: executingRoute.intent,
        enqueuedAt: executingRoute.enqueuedAt,
      };
    }

    const event: QueueUpdateEvent = {
      items,
      executing: executingMember,
      isEmpty: this.items.length === 0 && !executingMember,
      itemsDetail,
      executingDetail,
      stats: this.getStats(),
    };

    this.callbacks.onQueueUpdate(event);
  }

  /**
   * Emit queue protection event
   */
  private emitQueueProtection(event: QueueProtectionEvent): void {
    this.callbacks.onQueueProtection?.(event);
  }

  /**
   * Notify queue update (for external use by ConversationCoordinator)
   */
  notifyQueueUpdate(executingMember?: Member, executingRoute?: RoutingItem): void {
    this.emitQueueUpdate(executingMember, executingRoute);
  }
}
