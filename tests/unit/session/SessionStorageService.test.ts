/**
 * SessionStorageService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionStorageService } from '../../../src/infrastructure/SessionStorageService.js';
import type { SessionSnapshot } from '../../../src/models/SessionSnapshot.js';

describe('SessionStorageService', () => {
  let tempDir: string;
  let storage: SessionStorageService;

  // Create a valid test snapshot
  const createTestSnapshot = (overrides: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
    schemaVersion: '1.0',
    teamId: 'test-team',
    sessionId: 'test-session-123',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
    context: {
      messages: [
        {
          id: 'msg-1',
          content: 'Hello',
          timestamp: '2024-01-15T10:00:00.000Z',
          speaker: {
            id: 'human-1',
            name: 'Human',
            displayName: 'User',
            type: 'human',
          },
        },
      ],
      teamTask: 'Test task',
    },
    metadata: {
      messageCount: 1,
      summary: 'Test conversation',
    },
    ...overrides,
  });

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    storage = new SessionStorageService(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('saveSession', () => {
    it('should save session to disk', async () => {
      const snapshot = createTestSnapshot();

      await storage.saveSession('test-team', snapshot);

      // Verify file exists
      const teamDir = path.join(tempDir, 'test-team');
      expect(fs.existsSync(teamDir)).toBe(true);

      const files = fs.readdirSync(teamDir);
      expect(files.length).toBe(1);
      expect(files[0]).toContain('test-session-123.json');
    });

    it('should create team directory if not exists', async () => {
      const snapshot = createTestSnapshot({ teamId: 'new-team' });

      await storage.saveSession('new-team', snapshot);

      const teamDir = path.join(tempDir, 'new-team');
      expect(fs.existsSync(teamDir)).toBe(true);
    });

    it('should sanitize unsafe teamId characters', async () => {
      const snapshot = createTestSnapshot({ teamId: 'team/with\\special:chars' });

      await storage.saveSession('team/with\\special:chars', snapshot);

      // Should create directory with safe name
      const teamDir = path.join(tempDir, 'team_with_special_chars');
      expect(fs.existsSync(teamDir)).toBe(true);
    });

    it('should update updatedAt timestamp', async () => {
      const snapshot = createTestSnapshot({
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const before = Date.now();
      await storage.saveSession('test-team', snapshot);
      const after = Date.now();

      const loaded = await storage.loadSession('test-team', 'test-session-123');
      expect(loaded).not.toBeNull();

      const updatedTime = new Date(loaded!.updatedAt).getTime();
      expect(updatedTime).toBeGreaterThanOrEqual(before);
      expect(updatedTime).toBeLessThanOrEqual(after);
    });
  });

  describe('loadSession', () => {
    it('should load saved session', async () => {
      const snapshot = createTestSnapshot();
      await storage.saveSession('test-team', snapshot);

      const loaded = await storage.loadSession('test-team', 'test-session-123');

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe('test-session-123');
      expect(loaded!.context.messages).toHaveLength(1);
    });

    it('should return null for non-existent session', async () => {
      const loaded = await storage.loadSession('test-team', 'non-existent');

      expect(loaded).toBeNull();
    });

    it('should return null for non-existent team', async () => {
      const loaded = await storage.loadSession('non-existent-team', 'test-session');

      expect(loaded).toBeNull();
    });

    it('should return null for incompatible schema version', async () => {
      const snapshot = createTestSnapshot({ schemaVersion: '99.0' as any });
      await storage.saveSession('test-team', snapshot);

      const loaded = await storage.loadSession('test-team', 'test-session-123');

      expect(loaded).toBeNull();
    });
  });

  describe('getLatestSession', () => {
    it('should return most recent session', async () => {
      // Save older session
      const older = createTestSnapshot({ sessionId: 'older-session' });
      await storage.saveSession('test-team', older);

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      // Save newer session
      const newer = createTestSnapshot({ sessionId: 'newer-session' });
      await storage.saveSession('test-team', newer);

      const latest = await storage.getLatestSession('test-team');

      expect(latest).not.toBeNull();
      expect(latest!.sessionId).toBe('newer-session');
    });

    it('should return null for team with no sessions', async () => {
      const latest = await storage.getLatestSession('non-existent-team');

      expect(latest).toBeNull();
    });

    it('should skip incompatible versions and return next valid', async () => {
      // Save incompatible session (newer timestamp)
      const incompatible = createTestSnapshot({
        sessionId: 'incompatible',
        schemaVersion: '99.0' as any,
      });
      await storage.saveSession('test-team', incompatible);

      // Wait and save compatible session (older timestamp but valid)
      await new Promise(resolve => setTimeout(resolve, 10));
      const compatible = createTestSnapshot({ sessionId: 'compatible' });
      await storage.saveSession('test-team', compatible);

      const latest = await storage.getLatestSession('test-team');

      // Should return the compatible one (most recent valid)
      expect(latest).not.toBeNull();
      expect(latest!.sessionId).toBe('compatible');
    });
  });

  describe('listSessions', () => {
    it('should list all sessions for team', async () => {
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-1' }));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-2' }));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-3' }));

      const summaries = await storage.listSessions('test-team');

      expect(summaries).toHaveLength(3);
    });

    it('should return empty array for team with no sessions', async () => {
      const summaries = await storage.listSessions('non-existent-team');

      expect(summaries).toEqual([]);
    });

    it('should sort by updatedAt descending', async () => {
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-1' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-2' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'session-3' }));

      const summaries = await storage.listSessions('test-team');

      // Most recent first
      expect(summaries[0].sessionId).toBe('session-3');
      expect(summaries[2].sessionId).toBe('session-1');
    });

    it('should skip incompatible versions silently', async () => {
      await storage.saveSession('test-team', createTestSnapshot({ sessionId: 'valid' }));
      await storage.saveSession('test-team', createTestSnapshot({
        sessionId: 'invalid',
        schemaVersion: '99.0' as any,
      }));

      const summaries = await storage.listSessions('test-team');

      expect(summaries).toHaveLength(1);
      expect(summaries[0].sessionId).toBe('valid');
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', async () => {
      await storage.saveSession('test-team', createTestSnapshot());

      await storage.deleteSession('test-team', 'test-session-123');

      const loaded = await storage.loadSession('test-team', 'test-session-123');
      expect(loaded).toBeNull();
    });

    it('should be idempotent (no error on non-existent)', async () => {
      // Should not throw
      await storage.deleteSession('non-existent-team', 'non-existent-session');
    });
  });
});
