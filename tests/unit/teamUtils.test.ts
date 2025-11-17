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
});
