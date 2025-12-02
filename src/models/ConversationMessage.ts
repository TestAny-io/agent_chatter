/**
 * ConversationMessage - Conversation message model
 *
 * Speaker fields use new format aligned with Team.Member:
 * - id: Speaker identifier (maps to Member.id)
 * - name: Speaker name (maps to Member.name)
 * - displayName: Display name for UI (maps to Member.displayName)
 * - type: 'ai' | 'human' | 'system'
 */

import type { SpeakerInfo } from './SpeakerInfo.js';

/**
 * Conversation message with speaker info
 */
export interface ConversationMessage {
  id: string;
  timestamp: Date;

  /**
   * Speaker information (new format)
   * Uses id/name/displayName aligned with Team.Member
   */
  speaker: SpeakerInfo;

  /**
   * Message content (NEXT markers stripped)
   */
  content: string;

  /**
   * Routing information (parsed from content)
   */
  routing?: MessageRouting;
}

/**
 * Routing information parsed from message content
 *
 * v3 extension: Added parentMessageId and intent for causal tracking
 * v3.1 extension: Added dropTargets for Queue Cleaning Protocol
 * @see docs/design/route_rule/V3/detail/01-data-model.md
 * @see docs/design/route_rule/V3/queue-cleaning-protocol-engineering.md
 */
export interface MessageRouting {
  /** Original [NEXT: ...] markers */
  rawNextMarkers: string[];

  /** Resolved addressees */
  resolvedAddressees: ResolvedAddressee[];

  // === v3 New Fields (optional for backward compatibility) ===

  /**
   * Parsed addressees with intent information (v3)
   *
   * Saved from parse result to preserve intent markers (!P1/!P2/!P3)
   * that would be lost after content is cleaned.
   *
   * @see docs/design/route_rule/V3/detail/02-parsing.md
   */
  parsedAddressees?: ParsedAddressee[];

  /**
   * Parent message ID
   *
   * Points to the message that triggered this message
   * (i.e., the message containing [NEXT: xxx])
   *
   * - For first human message: undefined (no parent)
   * - For AI reply: points to the [NEXT] trigger message
   * - For subsequent human input: points to previous message (or undefined for buzz-in)
   */
  parentMessageId?: string;

  /**
   * Intent of this message (determined by routing queue dispatch)
   *
   * - P1_INTERRUPT: Error correction/interruption, highest priority
   * - P2_REPLY: Direct response, default priority
   * - P3_EXTEND: Extension/new topic, lowest priority
   */
  intent?: 'P1_INTERRUPT' | 'P2_REPLY' | 'P3_EXTEND';

  // === v3.1 New Fields (Queue Cleaning Protocol) ===

  /**
   * DROP targets from [DROP: ...] markers (v3.1)
   *
   * @remarks
   * - 'ALL' means clear entire queue
   * - Member names for targeted removal
   * - Empty array or undefined means no DROP instruction
   *
   * @see docs/design/route_rule/V3/queue-cleaning-protocol-engineering.md
   */
  dropTargets?: string[];
}

/**
 * Resolved addressee from NEXT marker
 */
export interface ResolvedAddressee {
  /** User-specified identifier from [NEXT: xxx] */
  identifier: string;

  /** Resolved member ID (null if not resolved) */
  memberId: string | null;

  /** Resolved member name (null if not resolved) */
  memberName: string | null;
}

/**
 * MessageDelivery - Internal message delivery object
 *
 * Used in sendMessageToRole for message passing.
 * Not stored in history!
 */
export interface MessageDelivery {
  /** Recipient info */
  recipient: {
    id: string;
    name: string;
  };

  /** Message content (markers stripped + context added) */
  content: string;

  /** Context (recent N history messages) */
  context?: ConversationMessage[];
}

/**
 * Parsed addressee with intent
 *
 * @see docs/design/route_rule/V3/detail/01-data-model.md
 */
export interface ParsedAddressee {
  /** Addressee name (trimmed) */
  name: string;

  /**
   * Intent marker (optional)
   * Parsed from !P1 / !P2 / !P3, defaults to P2
   */
  intent: 'P1' | 'P2' | 'P3';
}

/**
 * ParseResult - Message parsing result
 *
 * Return value of MessageRouter.parseMessage()
 *
 * v3 extension: Added parsedAddressees with intent information
 * v3.1 extension: Added dropTargets for Queue Cleaning Protocol
 */
export interface ParseResult {
  /** Parsed addressee identifiers (legacy, for backward compatibility) */
  addressees: string[];

  /**
   * Parsed addressees with intent information (v3)
   *
   * Corresponds 1:1 with addressees, but includes intent info.
   * Use addressees for names only; use this for intent.
   */
  parsedAddressees: ParsedAddressee[];

  /** Clean content with markers stripped */
  cleanContent: string;

  /** Sender identifier from [FROM: xxx] marker */
  fromMember?: string;

  /** Team task from [TEAM_TASK: xxx] marker */
  teamTask?: string;

  /**
   * DROP targets parsed from [DROP: ...] markers (v3.1)
   *
   * @remarks
   * - 'ALL' means clear entire queue
   * - Member names indicate targeted removal (raw, pre-normalization)
   * - Empty array means no DROP instruction
   *
   * @see docs/design/route_rule/V3/queue-cleaning-protocol-engineering.md
   */
  dropTargets: string[];
}

/**
 * ConversationMessage utility functions
 */
export class MessageUtils {
  static generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a message with new speaker format
   */
  static createMessage(
    speakerId: string,
    speakerName: string,
    speakerDisplayName: string,
    speakerType: 'ai' | 'human' | 'system',
    content: string,
    routing?: MessageRouting
  ): ConversationMessage {
    return {
      id: this.generateId(),
      timestamp: new Date(),
      speaker: {
        id: speakerId,
        name: speakerName,
        displayName: speakerDisplayName,
        type: speakerType
      },
      content,
      routing
    };
  }

  /**
   * Create a message from a SpeakerInfo object
   */
  static createMessageFromSpeaker(
    speaker: SpeakerInfo,
    content: string,
    routing?: MessageRouting
  ): ConversationMessage {
    return {
      id: this.generateId(),
      timestamp: new Date(),
      speaker,
      content,
      routing
    };
  }

  static createSystemMessage(content: string): ConversationMessage {
    return this.createMessage(
      'system',
      'system',
      'System',
      'system',
      content
    );
  }
}
