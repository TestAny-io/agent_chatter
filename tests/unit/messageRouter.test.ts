import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../../src/services/MessageRouter.js';

describe('MessageRouter', () => {
  const router = new MessageRouter();

  describe('parseMessage', () => {
    it('parses NEXT markers and strips them from content', () => {
      const input = 'Security findings\n[NEXT: bob]\nMore text';
      const result = router.parseMessage(input);

      expect(result.addressees).toEqual(['bob']);
      expect(result.cleanContent).toBe('Security findings\nMore text');
    });

    it('handles multiple NEXT markers', () => {
      const result = router.parseMessage('[NEXT: alice] Some text [NEXT: carol]');

      expect(result.addressees).toEqual(['alice', 'carol']);
      expect(result.cleanContent).toBe('Some text');
    });

    it('handles comma-separated NEXT markers (now supported)', () => {
      const result = router.parseMessage('Hi [NEXT: a,b] [NEXT: c ]');
      expect(result.addressees).toEqual(['a', 'b', 'c']);
      expect(result.cleanContent).toBe('Hi');
    });

    it('parses [FROM] marker', () => {
      const result = router.parseMessage('[FROM: kailai] Hello world');
      expect(result.fromMember).toBe('kailai');
      expect(result.cleanContent).toBe('[FROM: kailai] Hello world');
    });

    it('parses [TEAM_TASK] marker', () => {
      const result = router.parseMessage('[TEAM_TASK: Design auth] Let\'s start');
      expect(result.teamTask).toBe('Design auth');
      expect(result.cleanContent).toBe('[TEAM_TASK: Design auth] Let\'s start');
    });

    it('uses last [TEAM_TASK] if multiple present', () => {
      const result = router.parseMessage('[TEAM_TASK: Task A] ... [TEAM_TASK: Task B]');
      expect(result.teamTask).toBe('Task B');
    });

    it('parses all markers together', () => {
      const input = '[FROM: kailai][TEAM_TASK: Fix bugs][NEXT: max] Check this code';
      const result = router.parseMessage(input);

      expect(result.fromMember).toBe('kailai');
      expect(result.teamTask).toBe('Fix bugs');
      expect(result.addressees).toEqual(['max']);
      // cleanContent should still contain FROM and TEAM_TASK
      expect(result.cleanContent).toBe('[FROM: kailai][TEAM_TASK: Fix bugs] Check this code');
    });
  });

  describe('stripNextMarkers', () => {
    it('removes NEXT markers but keeps FROM and TEAM_TASK', () => {
      const input = '[FROM: user][TEAM_TASK: task][NEXT: ai] Content';
      const cleaned = router.stripNextMarkers(input);
      expect(cleaned).toBe('[FROM: user][TEAM_TASK: task] Content');
    });

    it('preserves formatting for content', () => {
      const input = 'Line 1\n[NEXT: a]\nLine 2';
      const cleaned = router.stripNextMarkers(input);
      expect(cleaned).toBe('Line 1\nLine 2');
    });
  });

  describe('stripAllMarkersForContext', () => {
    it('removes ALL markers including FROM and TEAM_TASK', () => {
      const input = '[FROM: user][TEAM_TASK: task][NEXT: ai] Content';
      const cleaned = router.stripAllMarkersForContext(input);
      expect(cleaned).toBe('Content');
    });

    it('handles multiple lines and spacing', () => {
      const input = `[FROM: kailai]
      [TEAM_TASK: new task]
      Real content here
      [NEXT: bob]`;

      const cleaned = router.stripAllMarkersForContext(input);
      expect(cleaned).toBe('Real content here');
    });
  });

  // v3: Intent parsing tests
  describe('v3 NEXT intent parsing', () => {
    it('parses single addressee without intent (defaults to P2)', () => {
      const result = router.parseMessage('[NEXT: sarah]');
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P2' }
      ]);
    });

    it('parses single addressee with P1 intent', () => {
      const result = router.parseMessage('[NEXT: sarah!P1]');
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P1' }
      ]);
    });

    it('parses lowercase intent', () => {
      const result = router.parseMessage('[NEXT: sarah!p3]');
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P3' }
      ]);
    });

    it('parses multiple addressees with mixed intents', () => {
      const result = router.parseMessage('[NEXT: sarah!P1, max, carol!P3]');
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P1' },
        { name: 'max', intent: 'P2' },
        { name: 'carol', intent: 'P3' }
      ]);
    });

    it('preserves special characters in name', () => {
      const result = router.parseMessage('[NEXT: Dr. Smith!P1]');
      expect(result.parsedAddressees).toEqual([
        { name: 'Dr. Smith', intent: 'P1' }
      ]);
    });

    it('handles name with spaces', () => {
      const result = router.parseMessage('[NEXT: John Doe !P2]');
      expect(result.parsedAddressees).toEqual([
        { name: 'John Doe', intent: 'P2' }
      ]);
    });

    it('trims leading and trailing spaces', () => {
      const result = router.parseMessage('[NEXT:   sarah !P1  ,  max  ]');
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P1' },
        { name: 'max', intent: 'P2' }
      ]);
    });

    it('skips empty segments', () => {
      const result = router.parseMessage('[NEXT: sarah, , , max]');
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P2' },
        { name: 'max', intent: 'P2' }
      ]);
    });

    it('treats invalid intent as part of name', () => {
      const result = router.parseMessage('[NEXT: sarah!P4]');
      // !P4 is not valid, so it's treated as part of the name
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah!P4', intent: 'P2' }
      ]);
    });

    it('maintains backward compatibility with addressees array', () => {
      const result = router.parseMessage('[NEXT: sarah!P1, max!P3]');
      // Legacy field contains names only
      expect(result.addressees).toEqual(['sarah', 'max']);
      // New field contains full info
      expect(result.parsedAddressees).toEqual([
        { name: 'sarah', intent: 'P1' },
        { name: 'max', intent: 'P3' }
      ]);
    });

    it('handles multiple NEXT markers with intents', () => {
      const result = router.parseMessage('Text [NEXT: alice!P1] more [NEXT: bob!P3]');
      expect(result.parsedAddressees).toEqual([
        { name: 'alice', intent: 'P1' },
        { name: 'bob', intent: 'P3' }
      ]);
    });
  });

  // v3.1: DROP parsing tests (Queue Cleaning Protocol)
  describe('v3.1 DROP parsing', () => {
    it('parses [DROP: ALL]', () => {
      const result = router.parseMessage('结束讨论 [DROP: ALL]');
      expect(result.dropTargets).toEqual(['ALL']);
    });

    it('parses [DROP: Sarah]', () => {
      const result = router.parseMessage('[DROP: Sarah] 继续');
      expect(result.dropTargets).toEqual(['Sarah']);
    });

    it('parses [DROP: Sarah, Max]', () => {
      const result = router.parseMessage('[DROP: Sarah, Max]');
      expect(result.dropTargets).toEqual(['Sarah', 'Max']);
    });

    it('handles case insensitivity for ALL', () => {
      expect(router.parseMessage('[drop: all]').dropTargets).toEqual(['ALL']);
      expect(router.parseMessage('[DROP: All]').dropTargets).toEqual(['ALL']);
      expect(router.parseMessage('[Drop: ALL]').dropTargets).toEqual(['ALL']);
    });

    it('preserves case for member names', () => {
      const result = router.parseMessage('[DROP: Sarah]');
      expect(result.dropTargets).toEqual(['Sarah']);
    });

    it('strips intent suffix from DROP targets', () => {
      const result = router.parseMessage('[DROP: Sarah!P1, Max!P2]');
      expect(result.dropTargets).toEqual(['Sarah', 'Max']);
    });

    it('prioritizes ALL over individual names', () => {
      const result = router.parseMessage('[DROP: Sarah] [DROP: ALL]');
      expect(result.dropTargets).toEqual(['ALL']);
    });

    it('returns ALL immediately when found', () => {
      const result = router.parseMessage('[DROP: ALL] [DROP: Max]');
      expect(result.dropTargets).toEqual(['ALL']);
    });

    it('handles [DROP: ALL] with [NEXT:]', () => {
      const result = router.parseMessage('[DROP: ALL] [NEXT: Max]');
      expect(result.dropTargets).toEqual(['ALL']);
      expect(result.addressees).toEqual(['Max']);
    });

    it('handles [DROP: Sarah] with [NEXT: Max]', () => {
      const result = router.parseMessage('[DROP: Sarah] [NEXT: Max]');
      expect(result.dropTargets).toEqual(['Sarah']);
      expect(result.addressees).toEqual(['Max']);
    });

    it('strips DROP markers from cleanContent', () => {
      const result = router.parseMessage('Hello [DROP: ALL] World');
      expect(result.cleanContent).toBe('Hello World');
    });

    it('strips both DROP and NEXT markers', () => {
      const result = router.parseMessage('Hi [DROP: Sarah] there [NEXT: Max]');
      expect(result.cleanContent).toBe('Hi there');
    });

    it('handles empty DROP', () => {
      const result = router.parseMessage('[DROP: ]');
      expect(result.dropTargets).toEqual([]);
    });

    it('handles whitespace in DROP', () => {
      const result = router.parseMessage('[DROP:   Sarah  ,  Max  ]');
      expect(result.dropTargets).toEqual(['Sarah', 'Max']);
    });

    it('returns empty array when no DROP marker', () => {
      const result = router.parseMessage('Hello [NEXT: Max]');
      expect(result.dropTargets).toEqual([]);
    });
  });
});
