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
    agentConfigId: 'config-1',
    agentType: 'codex',
    order: 0,
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
      [buildRole(), buildRole({ id: 'human', name: 'human', type: 'human', order: 1 })],
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
    const roleA = buildRole({ name: 'duplicate', order: 0 });
    const roleB = buildRole({ name: 'duplicate', id: 'role-b', order: 1 });
    const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('成员名称不能重复');
  });

  it('requires agentConfigId for ai roles', () => {
    const roleA = buildRole({ agentConfigId: undefined });
    const roleB = buildRole({ id: 'human', name: 'human', type: 'human', order: 1 });
    const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('缺少 agentConfigId');
  });

  it('accepts valid human-only team when size >= 2', () => {
    const humanA = buildRole({ id: 'h1', name: 'human1', type: 'human', order: 0 });
    const humanB = buildRole({ id: 'h2', name: 'human2', type: 'human', order: 1 });
    const result = TeamUtils.validateTeam(buildTeam([humanA, humanB]));

    expect(result.valid).toBe(true);
  });

  describe('New Member fields validation', () => {
    it('validates additionalArgs must be an array', () => {
      const roleA = buildRole({ additionalArgs: 'not-an-array' as any, order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('additionalArgs 必须是数组'))).toBe(true);
    });

    it('validates additionalArgs must contain strings', () => {
      const roleA = buildRole({ additionalArgs: ['--flag', 123 as any], order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('additionalArgs 必须包含字符串'))).toBe(true);
    });

    it('accepts valid additionalArgs', () => {
      const roleA = buildRole({ additionalArgs: ['--flag', '--option=value'], order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates env must be an object', () => {
      const roleA = buildRole({ env: 'not-an-object' as any, order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('env 必须是对象'))).toBe(true);
    });

    it('accepts valid env', () => {
      const roleA = buildRole({ env: { FOO: 'bar', BAZ: 'qux' }, order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates workDir must be a string', () => {
      const roleA = buildRole({ workDir: 123 as any, order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('workDir 必须是字符串'))).toBe(true);
    });

    it('accepts valid workDir', () => {
      const roleA = buildRole({ workDir: '/path/to/work', order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates member name pattern', () => {
      const roleA = buildRole({ name: 'invalid name!', order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'valid-name', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('包含无效字符'))).toBe(true);
    });

    it('accepts valid member names with alphanumeric, underscore, and hyphen', () => {
      const roleA = buildRole({ name: 'valid_name-123', order: 0 });
      const roleB = buildRole({ id: 'role2', name: 'another-valid-name_456', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });

    it('validates order must be a non-negative number', () => {
      const roleA = buildRole({ order: -1 });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('order 必须是非负数'))).toBe(true);
    });

    it('accepts all new fields together', () => {
      const roleA = buildRole({
        workDir: '/custom/work/dir',
        additionalArgs: ['--verbose', '--debug'],
        env: { DEBUG: 'true', LOG_LEVEL: 'info' },
        order: 0
      });
      const roleB = buildRole({ id: 'role2', name: 'role2', order: 1 });
      const result = TeamUtils.validateTeam(buildTeam([roleA, roleB]));

      expect(result.valid).toBe(true);
    });
  });
});
