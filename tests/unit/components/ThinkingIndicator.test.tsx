import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ThinkingIndicator } from '../../../src/repl/components/ThinkingIndicator.js';
import type { Member } from '../../../src/models/Team.js';

// Helper to wait for specific duration
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('ThinkingIndicator Component', () => {
  const createMockMember = (id: string, displayName: string): Member => ({
    id,
    displayName,
    displayRole: 'Developer',
    name: displayName.toLowerCase().replace(/\s+/g, '-'),
    type: 'ai',
    role: 'developer',
    agentType: 'claude',
    roleDir: '/tmp/test',
    workDir: '/tmp/test/work'
  });

  it('should start timer at 0 seconds when component mounts', () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    expect(lastFrame()).toContain('Test Agent');
    expect(lastFrame()).toContain('0s');
  });

  it('should increment timer every second', async () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    expect(lastFrame()).toContain('0s');

    // Wait for 1.1 seconds (accounting for slight timing variance)
    await wait(1100);
    expect(lastFrame()).toContain('1s');

    // Wait for another 2 seconds (total ~3s)
    await wait(2000);
    const frame = lastFrame();
    expect(frame).toMatch(/[23]s/); // Allow for 2s or 3s due to timing
  }, 10000);

  it('should format time correctly in minutes and seconds', async () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    // Wait for 65 seconds
    await wait(65100);
    expect(lastFrame()).toContain('1m 5s');
  }, 70000);

  it('should reset timer to 0 when member changes (anti-regression test)', async () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame, rerender } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    // Wait for 2 seconds for first agent
    await wait(2100);
    expect(lastFrame()).toContain('Test Agent');
    expect(lastFrame()).toMatch(/[12]s/); // 1s or 2s

    // Switch to a different member
    const newMember = createMockMember('member-2', 'Second Agent');

    rerender(
      <ThinkingIndicator
        member={newMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    // Wait for React to settle the rerender and new useEffect to run
    await wait(100);

    // Timer should reset to 0s for new agent
    expect(lastFrame()).toContain('Second Agent');
    expect(lastFrame()).toContain('0s');

    // Wait for 1 second for second agent
    await wait(1100);
    expect(lastFrame()).toContain('1s');
  }, 10000);

  it('should show ESC hint when allowEscCancel is true', () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    expect(lastFrame()).toContain('Press ESC to cancel');
  });

  it('should not show ESC hint when allowEscCancel is false', () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={false}
      />
    );

    expect(lastFrame()).not.toContain('Press ESC to cancel');
  });

  it('should display max timeout in minutes', () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const { lastFrame } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000} // 5 minutes
        allowEscCancel={true}
      />
    );

    expect(lastFrame()).toContain('Max timeout: 5 minutes');
  });

  it('should cleanup interval on unmount', () => {
    const mockMember = createMockMember('member-1', 'Test Agent');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = render(
      <ThinkingIndicator
        member={mockMember}
        maxTimeoutMs={300000}
        allowEscCancel={true}
      />
    );

    // Unmount the component
    unmount();

    // Verify that clearInterval was called
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });
});
