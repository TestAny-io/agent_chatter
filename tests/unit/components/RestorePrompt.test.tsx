/**
 * RestorePrompt Component Tests
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { RestorePrompt, formatTimeAgo } from '../../../src/repl/components/RestorePrompt.js';
import type { SessionSummary } from '../../../src/models/SessionSnapshot.js';

describe('RestorePrompt', () => {
  const createTestSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
    sessionId: 'test-session-123',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: new Date().toISOString(), // Use current time for "just now"
    messageCount: 5,
    summary: 'Test conversation about coding',
    ...overrides,
  });

  describe('formatTimeAgo', () => {
    it('should format "just now" for recent dates', () => {
      const now = new Date();
      const result = formatTimeAgo(now.toISOString());
      expect(result).toBe('just now');
    });

    it('should format minutes ago', () => {
      const date = new Date();
      date.setMinutes(date.getMinutes() - 5);
      const result = formatTimeAgo(date.toISOString());
      expect(result).toBe('5 minutes ago');
    });

    it('should format single minute', () => {
      const date = new Date();
      date.setMinutes(date.getMinutes() - 1);
      const result = formatTimeAgo(date.toISOString());
      expect(result).toBe('1 minute ago');
    });

    it('should format hours ago', () => {
      const date = new Date();
      date.setHours(date.getHours() - 3);
      const result = formatTimeAgo(date.toISOString());
      expect(result).toBe('3 hours ago');
    });

    it('should format single hour', () => {
      const date = new Date();
      date.setHours(date.getHours() - 1);
      const result = formatTimeAgo(date.toISOString());
      expect(result).toBe('1 hour ago');
    });

    it('should format days ago', () => {
      const date = new Date();
      date.setDate(date.getDate() - 2);
      const result = formatTimeAgo(date.toISOString());
      expect(result).toBe('2 days ago');
    });

    it('should format single day', () => {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      const result = formatTimeAgo(date.toISOString());
      expect(result).toBe('1 day ago');
    });
  });

  describe('RestorePrompt component', () => {
    it('should render team name', () => {
      const session = createTestSession();
      const { lastFrame } = render(
        <RestorePrompt session={session} teamName="My Test Team" />
      );

      expect(lastFrame()).toContain('My Test Team');
    });

    it('should render message count', () => {
      const session = createTestSession({ messageCount: 42 });
      const { lastFrame } = render(
        <RestorePrompt session={session} teamName="Test Team" />
      );

      expect(lastFrame()).toContain('42 messages');
    });

    it('should handle singular message', () => {
      const session = createTestSession({ messageCount: 1 });
      const { lastFrame } = render(
        <RestorePrompt session={session} teamName="Test Team" />
      );

      expect(lastFrame()).toContain('1 message');
      expect(lastFrame()).not.toContain('1 messages');
    });

    it('should render summary when provided', () => {
      const session = createTestSession({ summary: 'Discussion about API design' });
      const { lastFrame } = render(
        <RestorePrompt session={session} teamName="Test Team" />
      );

      expect(lastFrame()).toContain('Discussion about API design');
    });

    it('should not render summary when undefined', () => {
      const session = createTestSession({ summary: undefined });
      const { lastFrame } = render(
        <RestorePrompt session={session} teamName="Test Team" />
      );

      // Should render without crashing
      expect(lastFrame()).toContain('[R]');
      expect(lastFrame()).toContain('[N]');
    });

    it('should show R and N options', () => {
      const session = createTestSession();
      const { lastFrame } = render(
        <RestorePrompt session={session} teamName="Test Team" />
      );

      expect(lastFrame()).toContain('[R]');
      expect(lastFrame()).toContain('Resume');
      expect(lastFrame()).toContain('[N]');
      expect(lastFrame()).toContain('Start New');
    });
  });
});
