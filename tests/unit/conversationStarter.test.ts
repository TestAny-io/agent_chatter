import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildEnv,
  resolveInstructionFile,
  normalizeMemberPaths,
  loadInstructionContent,
  hasFlag,
  withBypassArgs,
  startConversation,
  type TeamMemberConfig
} from '../../src/utils/ConversationStarter.js';
import type { Team } from '../../src/models/Team.js';

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

  it('normalizeMemberPaths creates missing roleDir and resolves instruction file', () => {
    const roleDir = path.join(tempDir, 'roles', 'alpha');
    const member = createMember({ roleDir, instructionFile: 'AGENTS.md' });
    const normalized = normalizeMemberPaths(member);

    expect(normalized.roleDir).toBe(path.resolve(roleDir));
    expect(fs.existsSync(normalized.roleDir)).toBe(true);
    expect(normalized.instructionFile).toBe(path.join(normalized.roleDir, 'AGENTS.md'));
  });

  it('loadInstructionContent returns file content or undefined', () => {
    const filePath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(filePath, 'Hello');

    expect(loadInstructionContent(filePath)).toBe('Hello');
    expect(loadInstructionContent(path.join(tempDir, 'missing.md'))).toBeUndefined();
  });
});

describe('startConversation output wiring', () => {
  class MockOutput {
    calls: Array<{ method: string; args: any[] }> = [];
    info(message: string) { this.calls.push({ method: 'info', args: [message] }); }
    success(message: string) { this.calls.push({ method: 'success', args: [message] }); }
    warn(message: string) { this.calls.push({ method: 'warn', args: [message] }); }
    error(message: string) { this.calls.push({ method: 'error', args: [message] }); }
    progress(message: string) { this.calls.push({ method: 'progress', args: [message] }); }
    separator(char?: string, length?: number) { this.calls.push({ method: 'separator', args: [char, length] }); }
    keyValue(key: string, value: string) { this.calls.push({ method: 'keyValue', args: [key, value] }); }
  }

  it('emits error when first speaker is invalid via provided output', async () => {
    const output = new MockOutput();
    const coordinator = {
      startConversation: vi.fn(),
      getWaitingForRoleId: vi.fn(),
      stop: vi.fn(),
      injectMessage: vi.fn()
    } as any;

    const team: Team = {
      id: 't1',
      name: 'team',
      displayName: 'Team',
      description: '',
      members: []
    };

    await startConversation(coordinator, team, 'hello', 'missing', output as any);

    expect(output.calls[0]).toEqual({ method: 'error', args: ['Error: Invalid first speaker'] });
    expect(coordinator.startConversation).not.toHaveBeenCalled();
  });

  it('uses output for separators and info and clears interval when session completes', async () => {
    vi.useFakeTimers();
    const output = new MockOutput();
    const coordinator = {
      startConversation: vi.fn(async () => {
        (coordinator as any).session = { status: 'completed' };
      }),
      getWaitingForRoleId: vi.fn(() => undefined),
      stop: vi.fn(),
      injectMessage: vi.fn()
    } as any;

    const team: Team = {
      id: 't1',
      name: 'team',
      displayName: 'Team',
      description: '',
      members: [
        {
          id: 'm1',
          name: 'alpha',
          displayName: 'Alpha',
          displayRole: 'Dev',
          role: 'dev',
          type: 'ai',
          roleDir: '',
          order: 0
        }
      ]
    };

    await startConversation(coordinator, team, 'hello world', 'alpha', output as any);

    // Run interval once to process completion path
    vi.advanceTimersByTime(600);
    vi.useRealTimers();

    const methods = output.calls.map(c => c.method);
    expect(methods.filter(m => m === 'separator').length).toBe(3); // start, divider, completion
    expect(output.calls.find(c => c.method === 'info' && c.args[0].includes('初始消息'))).toBeTruthy();
    expect(output.calls.find(c => c.method === 'info' && c.args[0].includes('第一个发言者'))).toBeTruthy();
    expect(coordinator.startConversation).toHaveBeenCalledWith(team, 'hello world', 'm1');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Bypass Args Injection', () => {
  describe('hasFlag', () => {
    it('detects exact flag match', () => {
      expect(hasFlag(['--verbose', '--output'], '--verbose')).toBe(true);
    });

    it('detects flag with equals syntax', () => {
      expect(hasFlag(['--output-format=json'], '--output-format')).toBe(true);
    });

    it('returns false when flag not present', () => {
      expect(hasFlag(['--verbose'], '--output-format')).toBe(false);
    });

    it('handles empty args array', () => {
      expect(hasFlag([], '--verbose')).toBe(false);
    });

    it('does not match partial flag names', () => {
      expect(hasFlag(['--output-format'], '--output')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(hasFlag(['--Verbose'], '--verbose')).toBe(false);
    });
  });

  describe('withBypassArgs - Claude', () => {
    it('adds bypass and output-format when both missing', () => {
      const result = withBypassArgs('claude', ['--verbose']);
      expect(result).toContain('--permission-mode');
      expect(result).toContain('bypassPermissions');
      expect(result).toContain('--output-format');
      expect(result).toContain('stream-json');
    });

    it('does not duplicate --permission-mode if already present', () => {
      const result = withBypassArgs('claude', ['--permission-mode', 'acceptEdits']);
      const count = result.filter(arg => arg === '--permission-mode').length;
      expect(count).toBe(1);
      expect(result).toContain('acceptEdits');
    });

    it('does not duplicate --permission-mode with equals syntax', () => {
      const result = withBypassArgs('claude', ['--permission-mode=acceptEdits']);
      expect(result.filter(arg => arg.startsWith('--permission-mode')).length).toBe(1);
    });

    it('does not duplicate --output-format if already present', () => {
      const result = withBypassArgs('claude', ['--output-format', 'json']);
      expect(result.filter(arg => arg === '--output-format').length).toBe(1);
    });

    it('preserves all other args', () => {
      const result = withBypassArgs('claude', ['--verbose', '--debug']);
      expect(result).toContain('--verbose');
      expect(result).toContain('--debug');
    });

    it('does not mutate original args array', () => {
      const original = ['--verbose'];
      const result = withBypassArgs('claude', original);
      expect(original).toEqual(['--verbose']);
      expect(result).not.toBe(original);
    });

    it('handles empty args array', () => {
      const result = withBypassArgs('claude', []);
      expect(result).toContain('--permission-mode');
      expect(result).toContain('--output-format');
    });

    it('maintains arg order (bypass at end)', () => {
      const result = withBypassArgs('claude', ['--verbose']);
      const verboseIndex = result.indexOf('--verbose');
      const permissionIndex = result.indexOf('--permission-mode');
      expect(verboseIndex).toBeLessThan(permissionIndex);
    });
  });

  describe('withBypassArgs - Gemini', () => {
    it('adds --yolo when neither --yolo nor --approval-mode present', () => {
      const result = withBypassArgs('gemini', []);
      expect(result).toContain('--yolo');
    });

    it('does not add --yolo if already present', () => {
      const result = withBypassArgs('gemini', ['--yolo']);
      expect(result.filter(arg => arg === '--yolo').length).toBe(1);
    });

    it('does not add --yolo if --approval-mode present', () => {
      const result = withBypassArgs('gemini', ['--approval-mode', 'yolo']);
      expect(result).not.toContain('--yolo');
    });

    it('adds --output-format stream-json when missing', () => {
      const result = withBypassArgs('gemini', []);
      expect(result).toContain('--output-format');
      expect(result).toContain('stream-json');
    });

    it('does not duplicate --output-format', () => {
      const result = withBypassArgs('gemini', ['--output-format', 'json']);
      expect(result.filter(arg => arg === '--output-format').length).toBe(1);
    });

    it('does not mutate original args', () => {
      const original = ['--verbose'];
      const result = withBypassArgs('gemini', original);
      expect(original).toEqual(['--verbose']);
    });
  });

  describe('withBypassArgs - Codex', () => {
    it('adds --dangerously-bypass-approvals-and-sandbox when missing', () => {
      const result = withBypassArgs('codex', ['exec']);
      expect(result).toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('does not duplicate bypass flag if already present', () => {
      const result = withBypassArgs('codex', ['exec', '--dangerously-bypass-approvals-and-sandbox']);
      const count = result.filter(arg => arg === '--dangerously-bypass-approvals-and-sandbox').length;
      expect(count).toBe(1);
    });

    it('does not add bypass if --yolo alias present', () => {
      const result = withBypassArgs('codex', ['exec', '--yolo']);
      expect(result).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('does NOT add --output-format', () => {
      const result = withBypassArgs('codex', ['exec']);
      expect(result).not.toContain('--output-format');
    });

    it('removes --full-auto because it conflicts with bypass', () => {
      const result = withBypassArgs('codex', ['exec', '--full-auto']);
      expect(result).not.toContain('--full-auto');
    });

    it('preserves exec command at start', () => {
      const result = withBypassArgs('codex', ['exec', '--json']);
      expect(result[0]).toBe('exec');
    });
  });

  describe('withBypassArgs - Edge Cases', () => {
    it('returns original args for unknown agent type', () => {
      const original = ['--verbose'];
      const result = withBypassArgs('unknown-agent', original);
      expect(result).toEqual(original);
    });

    it('handles agent type case sensitivity', () => {
      const result = withBypassArgs('CLAUDE', []);
      expect(result).not.toContain('--permission-mode');
    });

    it('handles very long args arrays efficiently', () => {
      const longArgs = Array(100).fill('--verbose');
      const result = withBypassArgs('claude', longArgs);
      expect(result.length).toBeGreaterThan(100);
    });
  });
});
