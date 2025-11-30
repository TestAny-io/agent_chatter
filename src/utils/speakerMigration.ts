/**
 * Speaker Migration Utilities
 *
 * This module provides utilities for migrating speaker fields between
 * legacy format (roleId/roleName/roleTitle) and new format (id/name/displayName).
 *
 * Strategy: Write only new fields, read and migrate legacy fields.
 */

import type { SpeakerInfo, LegacySpeakerInfo, SpeakerInfoInput } from '../models/SpeakerInfo.js';
import type { Member } from '../models/Team.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';

// Re-export types for convenience
export type { SpeakerInfo, LegacySpeakerInfo, SpeakerInfoInput };

/**
 * Check if speaker info is in legacy format
 */
export function isLegacySpeaker(speaker: unknown): speaker is LegacySpeakerInfo {
  if (typeof speaker !== 'object' || speaker === null) {
    return false;
  }
  const s = speaker as Record<string, unknown>;
  return 'roleId' in s && !('id' in s);
}

/**
 * Check if speaker info is in new format
 */
export function isNewSpeaker(speaker: unknown): speaker is SpeakerInfo {
  if (typeof speaker !== 'object' || speaker === null) {
    return false;
  }
  const s = speaker as Record<string, unknown>;
  return 'id' in s && 'name' in s && 'displayName' in s;
}

/**
 * Migrate speaker from legacy format to new format
 *
 * @param speaker - Speaker info (legacy or new format)
 * @returns Speaker in new format
 *
 * If already new format, returns as-is.
 * If legacy format, maps fields:
 *   roleId → id
 *   roleName → name
 *   roleTitle → displayName
 */
export function migrateMessageSpeaker(speaker: SpeakerInfoInput): SpeakerInfo {
  // Already new format
  if (isNewSpeaker(speaker)) {
    return speaker;
  }

  // Legacy format - migrate
  if (isLegacySpeaker(speaker)) {
    return {
      id: speaker.roleId,
      name: speaker.roleName,
      displayName: speaker.roleTitle ?? speaker.roleName,
      type: speaker.type,
    };
  }

  // Unknown format - should not happen, but handle gracefully
  console.warn('Unknown speaker format, attempting fallback');
  const s = speaker as Record<string, unknown>;
  return {
    id: String(s.roleId ?? s.id ?? 'unknown'),
    name: String(s.roleName ?? s.name ?? 'unknown'),
    displayName: String(s.roleTitle ?? s.displayName ?? s.roleName ?? s.name ?? 'Unknown'),
    type: (s.type as 'ai' | 'human' | 'system') ?? 'ai',
  };
}

/**
 * Migrate all messages in an array
 *
 * @param messages - Array of messages (may contain mixed formats)
 * @returns New array with all speakers migrated (original unchanged)
 */
export function migrateMessages<T extends { speaker: SpeakerInfoInput }>(
  messages: T[]
): Array<Omit<T, 'speaker'> & { speaker: SpeakerInfo }> {
  return messages.map(msg => ({
    ...msg,
    speaker: migrateMessageSpeaker(msg.speaker),
  }));
}

/**
 * Create SpeakerInfo from Team Member
 * Used when creating new messages (write path - always use new format)
 *
 * @param member - Team member
 * @returns SpeakerInfo in new format
 */
export function createSpeakerFromMember(member: Member): SpeakerInfo {
  return {
    id: member.id,
    name: member.name,
    displayName: member.displayName,
    type: member.type,
  };
}

/**
 * Create system speaker info
 */
export function createSystemSpeaker(): SpeakerInfo {
  return {
    id: 'system',
    name: 'system',
    displayName: 'System',
    type: 'system',
  };
}

/**
 * Convert SpeakerInfo to legacy format for storage compatibility
 * Note: New snapshots should use new format. This is for transitional use only.
 *
 * @deprecated Prefer using new format in storage
 */
export function speakerToLegacy(speaker: SpeakerInfo): LegacySpeakerInfo {
  return {
    roleId: speaker.id,
    roleName: speaker.name,
    roleTitle: speaker.displayName,
    type: speaker.type,
  };
}

/**
 * Get speaker ID from either format
 * Helper for code that needs to work with both formats
 */
export function getSpeakerId(speaker: SpeakerInfoInput): string {
  if (isNewSpeaker(speaker)) {
    return speaker.id;
  }
  if (isLegacySpeaker(speaker)) {
    return speaker.roleId;
  }
  return 'unknown';
}

/**
 * Get speaker display name from either format
 * Helper for code that needs to work with both formats
 */
export function getSpeakerDisplayName(speaker: SpeakerInfoInput): string {
  if (isNewSpeaker(speaker)) {
    return speaker.displayName;
  }
  if (isLegacySpeaker(speaker)) {
    return speaker.roleTitle ?? speaker.roleName;
  }
  return 'Unknown';
}
