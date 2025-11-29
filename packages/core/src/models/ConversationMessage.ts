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
 */
export interface MessageRouting {
  /** Original [NEXT: ...] markers */
  rawNextMarkers: string[];

  /** Resolved addressees */
  resolvedAddressees: ResolvedAddressee[];
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
 * ParseResult - Message parsing result
 *
 * Return value of MessageRouter.parseMessage()
 */
export interface ParseResult {
  /** Parsed addressee identifiers */
  addressees: string[];

  /** Clean content with markers stripped */
  cleanContent: string;
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
