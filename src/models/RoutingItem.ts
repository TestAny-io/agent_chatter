/**
 * RoutingItem - Routing queue item
 *
 * Internal data structure for the routing queue.
 * Not persisted to storage.
 *
 * @see docs/design/route_rule/V3/detail/01-data-model.md
 */

/**
 * Intent priority levels for routing
 *
 * P1_INTERRUPT: Error correction/interruption, highest priority
 * P2_REPLY: Direct response, default priority
 * P3_EXTEND: Extension/new topic, lowest priority
 */
export type RoutingIntent = 'P1_INTERRUPT' | 'P2_REPLY' | 'P3_EXTEND';

/**
 * Short intent format used in NEXT markers
 * e.g., [NEXT: sarah!P1]
 */
export type ShortIntent = 'P1' | 'P2' | 'P3';

/**
 * Routing queue item
 *
 * Represents a pending routing request in the queue.
 */
export interface RoutingItem {
  /**
   * Queue item unique identifier
   * Format: route-<timestamp>-<random>
   */
  id: string;

  /**
   * Target member ID
   * Maps to Team.Member.id
   */
  targetMemberId: string;

  /**
   * Parent message ID (required)
   * Points to the message that produced [NEXT: xxx]
   *
   * Note: In most cases same as triggerMessageId,
   * but may differ in fallback routing scenarios.
   */
  parentMessageId: string;

  /**
   * Trigger message ID
   * The message that produced the [NEXT: xxx] marker
   */
  triggerMessageId: string;

  /**
   * Intent priority
   */
  intent: RoutingIntent;

  /**
   * Enqueue timestamp (milliseconds)
   * Used for FIFO ordering
   */
  enqueuedAt: number;
}

/**
 * Generate a unique routing item ID
 */
export function generateRoutingItemId(): string {
  return `route-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Map short intent to full enum value
 */
export function intentToEnum(shortIntent: ShortIntent): RoutingIntent {
  const map: Record<ShortIntent, RoutingIntent> = {
    'P1': 'P1_INTERRUPT',
    'P2': 'P2_REPLY',
    'P3': 'P3_EXTEND',
  };
  return map[shortIntent];
}

/**
 * Map full enum to short intent
 */
export function enumToShortIntent(intent: RoutingIntent): ShortIntent {
  const map: Record<RoutingIntent, ShortIntent> = {
    'P1_INTERRUPT': 'P1',
    'P2_REPLY': 'P2',
    'P3_EXTEND': 'P3',
  };
  return map[intent];
}

/**
 * Get intent priority (lower = higher priority)
 */
export function getIntentPriority(intent: RoutingIntent): number {
  const priorities: Record<RoutingIntent, number> = {
    'P1_INTERRUPT': 1,
    'P2_REPLY': 2,
    'P3_EXTEND': 3,
  };
  return priorities[intent];
}

/**
 * Compare two intents for sorting
 * Returns negative if a has higher priority than b
 */
export function compareIntents(a: RoutingIntent, b: RoutingIntent): number {
  return getIntentPriority(a) - getIntentPriority(b);
}
