/**
 * SchemaValidator Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateSessionSnapshot,
  validateSessionSnapshotWithVersion,
  checkSchemaVersion,
  checkSchemaFilesExist,
  SchemaValidationError,
} from '../../../src/utils/SchemaValidator.js';

describe('SchemaValidator', () => {
  // Create a valid session snapshot for testing (using NEW speaker format)
  const createValidSnapshot = (overrides: Record<string, unknown> = {}) => ({
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
            name: 'human',
            displayName: 'User',
            type: 'human',
          },
        },
      ],
      teamTask: 'Test task',
      timestamp: Date.now(),
      version: 1,
    },
    metadata: {
      messageCount: 1,
      summary: 'Test conversation',
    },
    ...overrides,
  });

  describe('checkSchemaFilesExist', () => {
    it('should find all schema files', () => {
      const result = checkSchemaFilesExist();

      expect(result.exists).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe('validateSessionSnapshot', () => {
    it('should validate correct snapshot', () => {
      const snapshot = createValidSnapshot();

      const result = validateSessionSnapshot(snapshot);

      expect(result.schemaVersion).toBe('1.0');
      expect(result.sessionId).toBe('test-session-123');
    });

    it('should throw on missing required fields', () => {
      const invalid = {
        schemaVersion: '1.0',
        // missing teamId, sessionId, etc.
      };

      expect(() => validateSessionSnapshot(invalid)).toThrow(SchemaValidationError);
    });

    it('should throw on invalid schemaVersion', () => {
      const invalid = createValidSnapshot({ schemaVersion: 'invalid' });

      expect(() => validateSessionSnapshot(invalid)).toThrow(SchemaValidationError);
    });

    it('should throw on invalid date format', () => {
      const invalid = createValidSnapshot({ createdAt: 'not-a-date' });

      expect(() => validateSessionSnapshot(invalid)).toThrow(SchemaValidationError);
    });

    it('should throw on invalid speaker type', () => {
      const invalid = createValidSnapshot({
        context: {
          messages: [
            {
              id: 'msg-1',
              content: 'Hello',
              timestamp: '2024-01-15T10:00:00.000Z',
              speaker: {
                id: 'test',
                name: 'test',
                displayName: 'Test',
                type: 'invalid-type', // not ai/human/system
              },
            },
          ],
          teamTask: 'Test',
          timestamp: Date.now(),
          version: 1,
        },
      });

      expect(() => validateSessionSnapshot(invalid)).toThrow(SchemaValidationError);
    });

    it('should allow optional summary field', () => {
      const validContext = {
        messages: [{
          id: 'msg-1',
          content: 'Hello',
          timestamp: '2024-01-15T10:00:00.000Z',
          speaker: {
            id: 'human-1',
            name: 'human',
            displayName: 'User',
            type: 'human',
          },
        }],
        teamTask: 'Test task',
        timestamp: Date.now(),
        version: 1,
      };

      const snapshot = createValidSnapshot({
        context: validContext,
        metadata: {
          messageCount: 1,
          // summary is optional
        },
      });

      const result = validateSessionSnapshot(snapshot);
      expect(result.metadata.summary).toBeUndefined();
    });

    it('should accept legacy speaker format (roleId/roleName/roleTitle)', () => {
      const legacySnapshot = {
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
                roleId: 'human-1',
                roleName: 'Human',
                roleTitle: 'User',
                type: 'human',
              },
            },
          ],
          teamTask: 'Test task',
          timestamp: Date.now(),
          version: 1,
        },
        metadata: {
          messageCount: 1,
          summary: 'Legacy test',
        },
      };

      // Should validate without errors
      const result = validateSessionSnapshot(legacySnapshot);
      expect(result.schemaVersion).toBe('1.0');
    });

    it('should accept new format resolvedAddressees (memberId/memberName)', () => {
      const newFormatSnapshot = {
        schemaVersion: '1.0',
        teamId: 'test-team',
        sessionId: 'test-session-456',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:30:00.000Z',
        context: {
          messages: [
            {
              id: 'msg-1',
              content: 'Hello',
              timestamp: '2024-01-15T10:00:00.000Z',
              speaker: {
                id: 'ai-1',
                name: 'claude',
                displayName: 'Claude',
                type: 'ai',
              },
              routing: {
                rawNextMarkers: ['[NEXT:human]'],
                resolvedAddressees: [
                  {
                    identifier: 'human',
                    memberId: 'human-1',
                    memberName: 'human',
                  },
                ],
              },
            },
          ],
          teamTask: 'Test task',
          timestamp: Date.now(),
          version: 1,
        },
        metadata: {
          messageCount: 1,
          lastSpeakerId: 'ai-1',
        },
      };

      // Should validate without errors
      const result = validateSessionSnapshot(newFormatSnapshot);
      expect(result.schemaVersion).toBe('1.0');
    });

    it('should accept legacy format resolvedAddressees (roleId/roleName)', () => {
      const legacyAddresseesSnapshot = {
        schemaVersion: '1.0',
        teamId: 'test-team',
        sessionId: 'test-session-789',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:30:00.000Z',
        context: {
          messages: [
            {
              id: 'msg-1',
              content: 'Hello',
              timestamp: '2024-01-15T10:00:00.000Z',
              speaker: {
                roleId: 'ai-1',
                roleName: 'claude',
                roleTitle: 'Claude',
                type: 'ai',
              },
              routing: {
                rawNextMarkers: ['[NEXT:human]'],
                resolvedAddressees: [
                  {
                    identifier: 'human',
                    roleId: 'human-1',
                    roleName: 'human',
                  },
                ],
              },
            },
          ],
          teamTask: 'Test task',
          timestamp: Date.now(),
          version: 1,
        },
        metadata: {
          messageCount: 1,
        },
      };

      // Should validate without errors
      const result = validateSessionSnapshot(legacyAddresseesSnapshot);
      expect(result.schemaVersion).toBe('1.0');
    });
  });

  describe('validateSessionSnapshotWithVersion', () => {
    it('should validate and check version', () => {
      const snapshot = createValidSnapshot();

      const result = validateSessionSnapshotWithVersion(snapshot);

      expect(result.schemaVersion).toBe('1.0');
    });
  });

  describe('checkSchemaVersion', () => {
    it('should pass for supported version', () => {
      // Should not throw
      checkSchemaVersion('1.0', 'sessionSnapshot');
    });

    it('should throw for version too new', () => {
      expect(() => checkSchemaVersion('99.0', 'sessionSnapshot'))
        .toThrow('not supported');
    });

    it('should throw for version too old', () => {
      expect(() => checkSchemaVersion('0.1', 'sessionSnapshot'))
        .toThrow('deprecated');
    });
  });

  describe('SchemaValidationError', () => {
    it('should format errors nicely', () => {
      const errors = [
        { instancePath: '/teamId', message: 'must be string' } as any,
        { instancePath: '/context/messages', message: 'must be array' } as any,
      ];

      const error = new SchemaValidationError('test-schema', errors, {});

      expect(error.message).toContain('/teamId');
      expect(error.message).toContain('/context/messages');
      expect(error.message).toContain('must be string');
      expect(error.schemaName).toBe('test-schema');
    });

    it('should include allowed values when present', () => {
      const errors = [
        {
          instancePath: '/type',
          message: 'must be equal to one of the allowed values',
          params: { allowedValues: ['ai', 'human', 'system'] },
        } as any,
      ];

      const error = new SchemaValidationError('test-schema', errors, {});

      expect(error.message).toContain('ai');
      expect(error.message).toContain('human');
      expect(error.message).toContain('system');
    });
  });
});
