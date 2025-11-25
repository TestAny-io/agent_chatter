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
});
