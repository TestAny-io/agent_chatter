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
    homeDir: partial.homeDir,
    env: partial.env,
    themeColor: partial.themeColor,
    displayRole: partial.displayRole
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-test-'));
});

describe('ConversationStarter helpers', () => {
  it('buildEnv sets HOME and CLI specific defaults', () => {
    const member = createMember({ env: { CUSTOM: '1' } });
    const env = buildEnv('codex', member, path.join(tempDir, 'home'));

    expect(env.HOME).toBe(path.join(tempDir, 'home'));
    expect(env.CODEX_HOME).toBe(path.join(path.join(tempDir, 'home'), '.codex'));
    expect(env.CUSTOM).toBe('1');
  });

  it('buildEnv allows user overrides', () => {
    const member = createMember({ env: { HOME: '/custom/home', CODEX_HOME: '/x' } });
    const env = buildEnv('codex', member, '/default');

    expect(env.HOME).toBe('/custom/home');
    expect(env.CODEX_HOME).toBe('/x');
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
    const member = createMember({ roleDir, workDir: undefined, homeDir: undefined, instructionFile: 'AGENTS.md' });
    const normalized = normalizeMemberPaths(member);

    expect(normalized.roleDir).toBe(path.resolve(roleDir));
    expect(fs.existsSync(normalized.roleDir)).toBe(true);
    expect(fs.existsSync(normalized.workDir)).toBe(true);
    expect(fs.existsSync(normalized.homeDir)).toBe(true);
    expect(normalized.instructionFile).toBe(path.join(normalized.roleDir, 'AGENTS.md'));
  });

  it('loadInstructionContent returns file content or undefined', () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(filePath, 'Hello');

    expect(loadInstructionContent(filePath)).toBe('Hello');
    expect(loadInstructionContent(path.join(tempDir, 'missing.md'))).toBeUndefined();
  });
});
