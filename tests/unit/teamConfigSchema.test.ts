import { describe, it, expect } from 'vitest';
import { validateTeamConfig } from '../../src/schemas/TeamConfigSchema.js';

describe('TeamConfigSchema', () => {
  describe('Basic structure validation', () => {
    it('rejects non-object config', () => {
      const result = validateTeamConfig(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('must be an object');
    });

    it('requires team property', () => {
      const result = validateTeamConfig({});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'team')).toBe(true);
    });

    it('requires team.name', () => {
      const result = validateTeamConfig({ team: { members: [] } });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'team.name')).toBe(true);
    });

    it('requires team.instructionContent', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'team.instructionContent')).toBe(true);
    });

    it('requires team.members to be an array', () => {
      const result = validateTeamConfig({ team: { name: 'test', members: 'not-array' } });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'team.members')).toBe(true);
    });

    it('requires at least 2 members', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'only-one', role: 'dev', type: 'human', order: 0 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('at least 2 members'))).toBe(true);
    });
  });

  describe('Member validation', () => {
    it('requires member.name', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { role: 'dev', type: 'human', order: 0 },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].name'))).toBe(true);
    });

    it('requires member.role', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', type: 'human', order: 0 },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].role'))).toBe(true);
    });

    it('requires member.instructionContent', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].instructionContent'))).toBe(true);
    });

    it('requires member.type to be "ai" or "human"', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'robot', order: 0 },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].type'))).toBe(true);
    });

    it('accepts member without order (optional)', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('rejects negative order', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: -1 },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].order'))).toBe(true);
    });

    it('detects duplicate member names', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0 },
            { name: 'alice', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Duplicate member name'))).toBe(true);
    });

    it('validates member name pattern', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'invalid name!', role: 'dev', type: 'human', order: 0 },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('invalid characters'))).toBe(true);
    });

    it('accepts AI member without agentConfigId (optional, can use agentType)', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('accepts AI member with agentConfigId', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', agentConfigId: 'claude', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('New fields validation (additionalArgs, env)', () => {
    it('validates additionalArgs must be an array', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, additionalArgs: 'not-array' },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].additionalArgs'))).toBe(true);
    });

    it('validates additionalArgs items must be strings', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, additionalArgs: ['--flag', 123] },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].additionalArgs[1]'))).toBe(true);
    });

    it('accepts valid additionalArgs', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, additionalArgs: ['--verbose', '--debug'], instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', order: 1, instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('validates env must be an object', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, env: 'not-object' },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].env'))).toBe(true);
    });

    it('rejects env as null', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, env: null },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].env') && e.message.includes('not null or array'))).toBe(true);
    });

    it('rejects env as array', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, env: ['FOO=bar'] },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('[0].env') && e.message.includes('not null or array'))).toBe(true);
    });

    it('rejects env with non-string values (number)', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, env: { FOO: 123 } },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('env["FOO"]') && e.message.includes('must be a string'))).toBe(true);
    });

    it('rejects env with non-string values (boolean)', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, env: { DEBUG: true } },
            { name: 'bob', role: 'dev', type: 'human', order: 1 }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('env["DEBUG"]') && e.message.includes('must be a string'))).toBe(true);
    });

    it('accepts valid env', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human', order: 0, env: { FOO: 'bar', BAZ: 'qux' }, instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', order: 1, instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('accepts all new fields together', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            {
              name: 'alice',
              role: 'dev',
              type: 'ai',
              agentType: 'claude',
              agentConfigId: 'claude',
              order: 0,
              additionalArgs: ['--verbose', '--debug'],
              env: { DEBUG: 'true', LOG_LEVEL: 'info' },
              systemInstruction: 'You are Alice, a helpful developer.',
              instructionContent: ''
            },
            { name: 'bob', role: 'dev', type: 'human', order: 1, instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Optional top-level fields', () => {
    it('accepts maxRounds: 0 (unlimited)', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        },
        maxRounds: 0
      });
      expect(result.valid).toBe(true);
    });

    it('rejects negative maxRounds', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'human' },
            { name: 'bob', role: 'dev', type: 'human' }
          ]
        },
        maxRounds: -1
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path === 'maxRounds')).toBe(true);
    });

    it('accepts valid maxRounds', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        },
        maxRounds: 10
      });
      expect(result.valid).toBe(true);
    });

    it('validates roleDefinitions if present', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          roleDefinitions: [
            { description: 'Missing name' }
          ],
          members: [
            { name: 'alice', role: 'dev', type: 'human' },
            { name: 'bob', role: 'dev', type: 'human' }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('roleDefinitions[0].name'))).toBe(true);
    });

    it('accepts valid roleDefinitions', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          roleDefinitions: [
            { name: 'developer', displayName: 'Developer', description: 'Writes code' }
          ],
          members: [
            { name: 'alice', role: 'developer', type: 'human', instructionContent: '' },
            { name: 'bob', role: 'developer', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('systemInstruction validation', () => {
    it('accepts string', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', systemInstruction: 'Test instruction', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('accepts string array', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', systemInstruction: ['Line 1', 'Line 2'], instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('accepts empty array', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', systemInstruction: [], instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });

    it('rejects number', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', systemInstruction: 123 },
            { name: 'bob', role: 'dev', type: 'human' }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('systemInstruction'))).toBe(true);
    });

    it('rejects mixed array (string + number)', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', systemInstruction: ['valid', 123] },
            { name: 'bob', role: 'dev', type: 'human' }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('systemInstruction'))).toBe(true);
    });

    it('rejects object', () => {
      const result = validateTeamConfig({
        team: {
          name: 'test',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', systemInstruction: { text: 'hello' } },
            { name: 'bob', role: 'dev', type: 'human' }
          ]
        }
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.path.includes('systemInstruction'))).toBe(true);
    });

    it('accepts systemInstruction on human members', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'test',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'ai', agentType: 'claude', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', systemInstruction: ['Human instruction'], instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Complete valid configurations', () => {
    it('accepts minimal valid config (no order)', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'minimal-team',
          instructionContent: '',
          members: [
            { name: 'alice', role: 'dev', type: 'human', instructionContent: '' },
            { name: 'bob', role: 'dev', type: 'human', instructionContent: '' }
          ]
        }
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts config matching phoenix-prd.json format', () => {
      // This test validates that phoenix-prd.json format is accepted
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        agents: [
          { name: 'claude', args: ['--output-format=stream-json', '--verbose'], usePty: false },
          { name: 'codex', args: ['exec', '--json', '--full-auto'], usePty: false }
        ],
        team: {
          name: 'phoenix-prd-team',
          displayName: 'Project Phoenix - PRD Team',
          description: 'A collaborative team',
          instructionContent: '',
          instructionFile: './teams/phoenix-prd/team_instruction.md',
          roleDefinitions: [
            { name: 'tech-lead', displayName: 'Tech Lead', description: 'Technical leadership' },
            { name: 'business-analyst', displayName: 'Business Analyst', description: 'Business analysis' }
          ],
          members: [
            {
              name: 'max',
              displayName: 'Max',
              displayRole: 'Business Analyst',
              role: 'business-analyst',
              type: 'ai',
              agentType: 'claude',  // Using agentType instead of agentConfigId
              themeColor: 'cyan',
              baseDir: './teams/phoenix-prd/max',
              instructionContent: '',
              instructionFile: 'CLAUDE.md',
              systemInstruction: ['You are Max, a Lead Business Analyst.']
            },
            {
              name: 'sarah',
              displayName: 'Sarah',
              displayRole: 'Tech Lead',
              role: 'tech-lead',
              type: 'ai',
              agentType: 'codex',
              themeColor: 'yellow',
              baseDir: './teams/phoenix-prd/sarah',
              instructionContent: '',
              instructionFile: 'AGENT.md',
              systemInstruction: ['You are Sarah, a Tech Lead.']
            },
            {
              name: 'kailai',
              displayName: 'Kailai',
              displayRole: 'Product Director',
              role: 'product-director',
              type: 'human',
              themeColor: 'green',
              baseDir: './teams/phoenix-prd/human',
              instructionContent: '',
              instructionFile: 'README.md'
            }
          ]
        },
        maxRounds: 0  // 0 = unlimited
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts full-featured valid config with order', () => {
      const result = validateTeamConfig({
        schemaVersion: '1.2',
        team: {
          name: 'full-featured-team',
          displayName: 'Full Featured Team',
          description: 'A team with all features',
          instructionContent: '',
          instructionFile: '/path/to/instructions.md',
          roleDefinitions: [
            { name: 'tech-lead', displayName: 'Tech Lead', description: 'Technical leadership' },
            { name: 'analyst', displayName: 'Business Analyst', description: 'Business analysis' }
          ],
          members: [
            {
              name: 'max',
              displayName: 'Max',
              displayRole: 'Tech Lead',
              role: 'tech-lead',
              type: 'ai',
              agentType: 'claude',
              agentConfigId: 'claude',
              themeColor: 'blue',
              baseDir: '/teams/max',
              instructionContent: '',
              instructionFile: '/teams/max/AGENT.md',
              env: { DEBUG: 'true' },
              systemInstruction: 'You are Max, an innovative tech lead.',
              additionalArgs: ['--verbose'],
              order: 0
            },
            {
              name: 'sarah',
              displayName: 'Sarah',
              displayRole: 'Business Analyst',
              role: 'analyst',
              type: 'ai',
              agentType: 'codex',
              agentConfigId: 'codex',
              themeColor: 'green',
              baseDir: '/teams/sarah',
              instructionContent: '',
              instructionFile: '/teams/sarah/AGENT.md',
              env: { LOG_LEVEL: 'info' },
              systemInstruction: 'You are Sarah, a conservative business analyst.',
              additionalArgs: ['--json', '--full-auto'],
              order: 1
            },
            {
              name: 'human',
              displayName: 'Human Owner',
              displayRole: 'Owner',
              role: 'tech-lead',
              type: 'human',
              baseDir: '/teams/human',
              instructionContent: ''
            }
          ]
        },
        maxRounds: 20
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
