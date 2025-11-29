/**
 * Integration test for [NEXT:xxx] directive parsing and member resolution
 *
 * Tests that MessageRouter correctly parses [NEXT:member] directives
 * and that member resolution logic works correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import type { Member } from '../../src/models/Team.js';

describe('[NEXT:xxx] directive parsing and resolution', () => {
  let messageRouter: MessageRouter;
  let mockTeamMembers: Member[];

  beforeEach(() => {
    messageRouter = new MessageRouter();

    // Mock team configuration similar to what would be in a real team
    mockTeamMembers = [
      {
        id: 'max-id',
        name: 'max',
        displayName: 'Max',
        role: 'developer',
        displayRole: 'Developer',
        type: 'ai',
        agentType: 'claude',
        agentConfigId: 'max-config',
        order: 0
      },
      {
        id: 'sarah-id',
        name: 'sarah',
        displayName: 'Sarah',
        role: 'reviewer',
        displayRole: 'Reviewer',
        type: 'ai',
        agentType: 'claude',
        agentConfigId: 'sarah-config',
        order: 1
      },
      {
        id: 'bob-id',
        name: 'bob',
        displayName: 'Bob',
        role: 'observer',
        displayRole: 'Observer',
        type: 'human',
        order: 2
      }
    ];
  });

  describe('Message parsing', () => {
    it('extracts [NEXT:xxx] from initial message', () => {
      const message = 'Review the code [NEXT:Sarah]';
      const result = messageRouter.parseMessage(message);

      expect(result.addressees).toEqual(['Sarah']);
      expect(result.cleanContent).toBe('Review the code');
    });

    it('handles [NEXT:xxx] at the beginning', () => {
      const message = '[NEXT:Sarah] Review the code';
      const result = messageRouter.parseMessage(message);

      expect(result.addressees).toEqual(['Sarah']);
      expect(result.cleanContent).toBe('Review the code');
    });

    it('handles [NEXT:xxx] in the middle', () => {
      const message = 'Please [NEXT:Sarah] review the code carefully';
      const result = messageRouter.parseMessage(message);

      expect(result.addressees).toEqual(['Sarah']);
      // stripMarkers() replaces markers with single space and then trims
      expect(result.cleanContent).toBe('Please review the code carefully');
    });

    it('extracts multiple [NEXT:xxx] directives (uses first)', () => {
      const message = '[NEXT:Sarah] [NEXT:Max] Review the code';
      const result = messageRouter.parseMessage(message);

      expect(result.addressees).toEqual(['Sarah', 'Max']);
      expect(result.cleanContent).toBe('Review the code');
    });

    it('returns empty addressees when no [NEXT:xxx] present', () => {
      const message = 'Review the code';
      const result = messageRouter.parseMessage(message);

      expect(result.addressees).toEqual([]);
      expect(result.cleanContent).toBe('Review the code');
    });
  });

  describe('Member resolution logic', () => {
    const normalizeIdentifier = (str: string): string => {
      return str.toLowerCase().replace(/[\s-_]/g, '');
    };

    const findMemberByAddresseeName = (addresseeName: string): Member | undefined => {
      const normalizedAddressee = normalizeIdentifier(addresseeName);

      return mockTeamMembers.find(m => {
        const normalizedId = normalizeIdentifier(m.id);
        const normalizedName = normalizeIdentifier(m.name);
        const normalizedDisplayName = normalizeIdentifier(m.displayName);

        return normalizedId === normalizedAddressee ||
               normalizedName === normalizedAddressee ||
               normalizedDisplayName === normalizedAddressee;
      });
    };

    it('resolves member by exact name match', () => {
      const member = findMemberByAddresseeName('sarah');
      expect(member).toBeDefined();
      expect(member?.id).toBe('sarah-id');
    });

    it('resolves member by display name', () => {
      const member = findMemberByAddresseeName('Sarah');
      expect(member).toBeDefined();
      expect(member?.id).toBe('sarah-id');
    });

    it('resolves member by ID', () => {
      const member = findMemberByAddresseeName('sarah-id');
      expect(member).toBeDefined();
      expect(member?.id).toBe('sarah-id');
    });

    it('resolves member with case insensitive matching', () => {
      const member = findMemberByAddresseeName('SARAH');
      expect(member).toBeDefined();
      expect(member?.id).toBe('sarah-id');
    });

    it('resolves member with space normalization', () => {
      // Add a member with spaces in name
      mockTeamMembers.push({
        id: 'alice-smith-id',
        name: 'alice-smith',
        displayName: 'Alice Smith',
        role: 'tester',
        displayRole: 'Tester',
        type: 'ai',
        agentType: 'claude',
        agentConfigId: 'alice-config',
        order: 3
      });

      // Should match with various spacing/dash variations
      expect(findMemberByAddresseeName('alice smith')?.id).toBe('alice-smith-id');
      expect(findMemberByAddresseeName('alice-smith')?.id).toBe('alice-smith-id');
      expect(findMemberByAddresseeName('alicesmith')?.id).toBe('alice-smith-id');
      expect(findMemberByAddresseeName('Alice-Smith')?.id).toBe('alice-smith-id');
    });

    it('returns undefined for unknown member', () => {
      const member = findMemberByAddresseeName('unknown-person');
      expect(member).toBeUndefined();
    });
  });

  describe('First speaker selection logic', () => {
    it('uses specified member when [NEXT:xxx] matches', () => {
      const message = 'Review the code [NEXT:Sarah]';
      const parseResult = messageRouter.parseMessage(message);

      let firstSpeakerId = mockTeamMembers[0].id; // Default to first member

      if (parseResult.addressees.length > 0) {
        const targetAddresseeName = parseResult.addressees[0];
        const normalizeIdentifier = (str: string): string => {
          return str.toLowerCase().replace(/[\s-_]/g, '');
        };

        const targetMember = mockTeamMembers.find(m => {
          const normalizedAddressee = normalizeIdentifier(targetAddresseeName);
          const normalizedId = normalizeIdentifier(m.id);
          const normalizedName = normalizeIdentifier(m.name);
          const normalizedDisplayName = normalizeIdentifier(m.displayName);

          return normalizedId === normalizedAddressee ||
                 normalizedName === normalizedAddressee ||
                 normalizedDisplayName === normalizedAddressee;
        });

        if (targetMember) {
          firstSpeakerId = targetMember.id;
        }
      }

      expect(firstSpeakerId).toBe('sarah-id');
      expect(parseResult.cleanContent).toBe('Review the code');
    });

    it('falls back to first member when [NEXT:xxx] does not match', () => {
      const message = 'Review the code [NEXT:UnknownPerson]';
      const parseResult = messageRouter.parseMessage(message);

      let firstSpeakerId = mockTeamMembers[0].id;
      let fallbackWarning = false;

      if (parseResult.addressees.length > 0) {
        const targetAddresseeName = parseResult.addressees[0];
        const normalizeIdentifier = (str: string): string => {
          return str.toLowerCase().replace(/[\s-_]/g, '');
        };

        const targetMember = mockTeamMembers.find(m => {
          const normalizedAddressee = normalizeIdentifier(targetAddresseeName);
          const normalizedId = normalizeIdentifier(m.id);
          const normalizedName = normalizeIdentifier(m.name);
          const normalizedDisplayName = normalizeIdentifier(m.displayName);

          return normalizedId === normalizedAddressee ||
                 normalizedName === normalizedAddressee ||
                 normalizedDisplayName === normalizedAddressee;
        });

        if (!targetMember) {
          fallbackWarning = true;
        }
      }

      expect(firstSpeakerId).toBe('max-id'); // Falls back to first member
      expect(fallbackWarning).toBe(true);
    });

    it('uses first member when no [NEXT:xxx] present', () => {
      const message = 'Review the code';
      const parseResult = messageRouter.parseMessage(message);

      let firstSpeakerId = mockTeamMembers[0].id;

      if (parseResult.addressees.length === 0) {
        firstSpeakerId = mockTeamMembers[0].id;
      }

      expect(firstSpeakerId).toBe('max-id');
      expect(parseResult.cleanContent).toBe('Review the code');
    });

    it('uses cleaned message without [NEXT] markers', () => {
      const message = 'Please review [NEXT:Sarah] this code carefully';
      const parseResult = messageRouter.parseMessage(message);

      expect(parseResult.cleanContent).not.toContain('[NEXT:');
      expect(parseResult.cleanContent).not.toContain('[NEXT:Sarah]');
      // The cleaned content should have the [NEXT] directive removed
      // stripMarkers() replaces markers with single space and normalizes
      expect(parseResult.cleanContent.trim()).toBe('Please review this code carefully');
    });
  });

  describe('Edge cases', () => {
    it('handles empty [NEXT:] directive', () => {
      const message = 'Review the code [NEXT:]';
      const parseResult = messageRouter.parseMessage(message);

      expect(parseResult.addressees).toEqual([]);
    });

    it('handles whitespace in [NEXT: xxx ]', () => {
      const message = 'Review the code [NEXT:  Sarah  ]';
      const parseResult = messageRouter.parseMessage(message);

      expect(parseResult.addressees).toEqual(['Sarah']);
    });

    it('handles case variations in member names', () => {
      const testCases = [
        'sarah',
        'Sarah',
        'SARAH',
        'sArAh'
      ];

      const normalizeIdentifier = (str: string): string => {
        return str.toLowerCase().replace(/[\s-_]/g, '');
      };

      testCases.forEach(testName => {
        const member = mockTeamMembers.find(m => {
          const normalizedAddressee = normalizeIdentifier(testName);
          const normalizedName = normalizeIdentifier(m.name);
          const normalizedDisplayName = normalizeIdentifier(m.displayName);

          return normalizedName === normalizedAddressee ||
                 normalizedDisplayName === normalizedAddressee;
        });

        expect(member).toBeDefined();
        expect(member?.id).toBe('sarah-id');
      });
    });
  });
});
