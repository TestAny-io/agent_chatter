/**
 * SpeakerInfo - Speaker information types for messages
 *
 * This module defines the speaker structure used in ConversationMessage.
 * Supports both legacy (roleId/roleName/roleTitle) and new (id/name/displayName) formats.
 */

/**
 * Speaker information for messages (new format)
 * Aligned with Team.Member field naming
 */
export interface SpeakerInfo {
  /**
   * Speaker identifier
   * Maps to Team.Member.id
   */
  id: string;

  /**
   * Speaker name (internal identifier)
   * Maps to Team.Member.name
   */
  name: string;

  /**
   * Display name for UI
   * Maps to Team.Member.displayName
   */
  displayName: string;

  /**
   * Speaker type
   */
  type: 'ai' | 'human' | 'system';
}

/**
 * Legacy speaker format (for backwards compatibility)
 * @deprecated Use SpeakerInfo instead
 */
export interface LegacySpeakerInfo {
  roleId: string;
  roleName: string;
  roleTitle: string;
  type: 'ai' | 'human' | 'system';
}

/**
 * Union type for reading (accepts both formats)
 */
export type SpeakerInfoInput = SpeakerInfo | LegacySpeakerInfo;
