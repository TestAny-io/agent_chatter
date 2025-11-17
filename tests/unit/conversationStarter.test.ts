import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildEnv,
  resolveInstructionFile,
  normalizeMemberPaths,
  loadInstructionContent,
  type TeamMemberConfig
} from '../../src/utils/ConversationStarter.js';

let tempDir: string;

function createMember(partial: Partial<TeamMemberConfig> = {}): TeamMemberConfig {
  return {
    displayName: 'Member',
    name: 'member-1',
    role: 'role',
    type: 'ai',
    agentType: partial.agentType ?? 'codex',
    roleDir: partial.roleDir ?? tempDir,
    instructionFile: partial.instructionFile,
    workDir: partial.workDir,
    env: partial.env,
    themeColor: partial.themeColor,
    displayRole: partial.displayRole
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-test-'));
});

describe('ConversationStarter helpers', () => {
  it('buildEnv merges user-provided environment variables', () => {
    const member = createMember({ env: { CUSTOM: '1', VAR: 'value' } });
    const env = buildEnv('codex', member);

    expect(env.CUSTOM).toBe('1');
    expect(env.VAR).toBe('value');
  });

  it('buildEnv returns empty object when no env provided', () => {
    const member = createMember({ env: undefined });
    const env = buildEnv('codex', member);

    expect(env).toEqual({});
  });

  it('resolveInstructionFile respects defaults and relative paths', () => {
    const roleDir = path.join(tempDir, 'role');
    fs.mkdirSync(roleDir, { recursive: true });
    const member = createMember({ agentType: 'gemini', roleDir });
    const resolved = resolveInstructionFile(member, roleDir);

    expect(resolved).toBe(path.join(roleDir, 'GEMINI.md'));
  });

  it('resolveInstructionFile keeps absolute paths untouched', () => {
    const absolute = path.join(tempDir, 'custom.md');
    const member = createMember({ instructionFile: absolute });
    const resolved = resolveInstructionFile(member, tempDir);

    expect(resolved).toBe(absolute);
  });

  it('normalizeMemberPaths creates missing directories and resolves absolute paths', () => {
    const roleDir = path.join(tempDir, 'roles', 'alpha');
    const member = createMember({ roleDir, workDir: undefined, instructionFile: 'AGENTS.md' });
    const normalized = normalizeMemberPaths(member);

    expect(normalized.roleDir).toBe(path.resolve(roleDir));
    expect(fs.existsSync(normalized.roleDir)).toBe(true);
    expect(fs.existsSync(normalized.workDir)).toBe(true);
    expect(normalized.instructionFile).toBe(path.join(normalized.roleDir, 'AGENTS.md'));
  });

  it('loadInstructionContent returns file content or undefined', () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(filePath, 'Hello');

    expect(loadInstructionContent(filePath)).toBe('Hello');
    expect(loadInstructionContent(path.join(tempDir, 'missing.md'))).toBeUndefined();
  });
});
