import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../../src/services/MessageRouter.js';

describe('MessageRouter', () => {
  it('parses NEXT markers and strips them from content', () => {
    const router = new MessageRouter();
    const input = 'Security findings\n[NEXT: bob,  carol ]\nMore text';

    const result = router.parseMessage(input);

    expect(result.addressees).toEqual(['bob', 'carol']);
    expect(result.isDone).toBe(false);
    expect(result.cleanContent).toBe('Security findings\nMore text');
  });

  it('ignores NEXT markers when DONE is present', () => {
    const router = new MessageRouter();
    const result = router.parseMessage('[NEXT: ignored]\n[DONE]');

    expect(result.addressees).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(result.cleanContent).toBe('');
  });

  it('removes markers appearing at file boundaries', () => {
    const router = new MessageRouter();
    const cleaned = router.stripMarkers('[NEXT: alice]\nBody\n[DONE]');

    expect(cleaned).toBe('Body');
  });
});
