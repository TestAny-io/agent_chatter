import { describe, it, expect } from 'vitest';
import { TeamUtils, type Role, type Team } from '../../src/models/Team.js';

function buildRole(overrides: Partial<Role> = {}): Role {
  return {
    id: `role-${Math.random().toString(16).slice(2)}`,
    displayName: 'AI Reviewer',
    name: 'ai-reviewer',
    displayRole: 'Reviewer',
    role: 'reviewer',
    type: 'ai',
    agentType: 'codex',  // agentConfigId is now optional
    ...overrides
  };
}

function buildTeam(members: Role[]): Team {
  return {
    id: 'team-id',
    name: 'team',
    description: 'desc',
    createdAt: new Date(),
    updatedAt: new Date(),
    members
  };
}

describe('TeamUtils', () => {
  it('creates a team with metadata', () => {
    const team = TeamUtils.createTeam(
      'code-review',
      'test',
      [buildRole(), buildRole({ id: 'human', name: 'human', type: 'human' })],
      '/tmp/team.md'
    );

    expect(team.id).toBeDefined();
    expect(team.members).toHaveLength(2);
    expect(team.instructionFile).toBe('/tmp/team.md');
  });

  it('validates minimum constraints', () => {
    const result = TeamUtils.validateTeam(buildTeam([]));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('团队至少需要 2 个成员');
  });

  it('validates team name is required', () => {
    const base = buildTeam([buildRole(), buildRole({ id: 'human', name: 'human', type: 'human' })]);
    base.name = '';
    const result = TeamUtils.validateTeam(base);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('团队名称不能为空');
  });

  it('detects duplicate member names', () => {
    const roleA = buildRole({ name: 'duplicate' });
    const roleB = buildRole({ name: 'duplicate', id: 'role-b' });
    const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('成员名称不能重复');
  });

  it('accepts AI member without agentConfigId (can use agentType)', () => {
    const roleA = buildRole({ agentConfigId: undefined, agentType: 'claude' });
    const roleB = buildRole({ id: 'human', name: 'human', type: 'human' });
    const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

    expect(result.valid).toBe(true);
  });

  it('accepts valid human-only team when size >= 2', () => {
    const humanA = buildRole({ id: 'h1', name: 'human1', type: 'human' });
    const humanB = buildRole({ id: 'h2', name: 'human2', type: 'human' });
    const result = TeamUtils.validateTeam(buildTeam([humanA, humanB]));

    expect(result.valid).toBe(true);
  });

  it('rejects team with no human members', () => {
    const aiA = buildRole({ id: 'ai1', name: 'ai1', type: 'ai', agentType: 'claude' });
    const aiB = buildRole({ id: 'ai2', name: 'ai2', type: 'ai', agentType: 'codex' });
    const result = TeamUtils.validateTeam(buildTeam([aiA, aiB]));

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('至少需要 1 个 Human 成员'))).toBe(true);
  });

  describe('New Member fields validation', () => {
    it('validates additionalArgs must be an array', () => {
      const roleA = buildRole({ additionalArgs: 'not-an-array' as any });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('additionalArgs 必须是数组'))).toBe(true);
    });

    it('validates additionalArgs must contain strings', () => {
      const roleA = buildRole({ additionalArgs: ['--flag', 123 as any] });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('additionalArgs 必须包含字符串'))).toBe(true);
    });

    it('accepts valid additionalArgs', () => {
      const roleA = buildRole({ additionalArgs: ['--flag', '--option=value'] });
      const roleB = buildRole({ id: 'human1', name: 'human1', type: 'human' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates env must be an object', () => {
      const roleA = buildRole({ env: 'not-an-object' as any });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('env 必须是对象'))).toBe(true);
    });

    it('rejects env as null', () => {
      const roleA = buildRole({ env: null as any });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('不能是 null 或数组'))).toBe(true);
    });

    it('rejects env as array', () => {
      const roleA = buildRole({ env: ['FOO=bar'] as any });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('不能是 null 或数组'))).toBe(true);
    });

    it('rejects env with non-string values (number)', () => {
      const roleA = buildRole({ env: { FOO: 123 } as any });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('env["FOO"]') && e.includes('必须是字符串'))).toBe(true);
    });

    it('rejects env with non-string values (boolean)', () => {
      const roleA = buildRole({ env: { DEBUG: true } as any });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('env["DEBUG"]') && e.includes('必须是字符串'))).toBe(true);
    });

    it('accepts valid env', () => {
      const roleA = buildRole({ env: { FOO: 'bar', BAZ: 'qux' } });
      const roleB = buildRole({ id: 'human1', name: 'human1', type: 'human' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates member name pattern', () => {
      const roleA = buildRole({ name: 'invalid name!' });
      const roleB = buildRole({ id: 'role2', name: 'valid-name' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('包含无效字符'))).toBe(true);
    });

    it('accepts valid member names with alphanumeric, underscore, and hyphen', () => {
      const roleA = buildRole({ name: 'valid_name-123' });
      const roleB = buildRole({ id: 'human1', name: 'human1', type: 'human' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('accepts member without order (optional)', () => {
      const roleA = buildRole({});
      const roleB = buildRole({ id: 'human1', name: 'human1', type: 'human' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates order must be a non-negative number if provided', () => {
      const roleA = buildRole({ order: -1 });
      const roleB = buildRole({ id: 'role2', name: 'role2' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('order 必须是非负数'))).toBe(true);
    });

    it('accepts all new fields together', () => {
      const roleA = buildRole({
        additionalArgs: ['--verbose', '--debug'],
        env: { DEBUG: 'true', LOG_LEVEL: 'info' },
        order: 0
      });
      const roleB = buildRole({ id: 'human1', name: 'human1', type: 'human' });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });
  });
});
