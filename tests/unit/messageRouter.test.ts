import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../../src/services/MessageRouter.js';

describe('MessageRouter', () => {
  it('parses NEXT markers and strips them from content (single addressee only)', () => {
    const router = new MessageRouter();
    const input = 'Security findings\n[NEXT: bob]\nMore text';

    const result = router.parseMessage(input);

    expect(result.addressees).toEqual(['bob']);
    expect(result.isDone).toBe(false);
    expect(result.cleanContent).toBe('Security findings\nMore text');
  });

  it('parses NEXT markers independently even when DONE is present', () => {
    const router = new MessageRouter();
    const result = router.parseMessage('[NEXT: bob]\n[DONE]');

    expect(result.addressees).toEqual(['bob']);
    expect(result.isDone).toBe(true);
    expect(result.cleanContent).toBe('');
  });

  it('parses both NEXT and DONE from message with content', () => {
    const router = new MessageRouter();
    const result = router.parseMessage('Great work! Please finish this. [NEXT: max] [DONE]');

    expect(result.addressees).toEqual(['max']);
    expect(result.isDone).toBe(true);
    expect(result.cleanContent).toBe('Great work! Please finish this.');
  });

  it('handles multiple NEXT markers with DONE', () => {
    const router = new MessageRouter();
    const result = router.parseMessage('[NEXT: alice] Some text [NEXT: carol] [DONE]');

    expect(result.addressees).toEqual(['alice', 'carol']);
    expect(result.isDone).toBe(true);
    expect(result.cleanContent).toBe('Some text');
  });

  it('removes markers appearing at file boundaries', () => {
    const router = new MessageRouter();
    const cleaned = router.stripMarkers('[NEXT: alice]\nBody\n[DONE]');

    expect(cleaned).toBe('Body');
  });

  it('ignores comma-separated NEXT markers', () => {
    const router = new MessageRouter();
    const result = router.parseMessage('Hi [NEXT: a,b] [NEXT: c ]');
    expect(result.addressees).toEqual(['c']);
  });
});
