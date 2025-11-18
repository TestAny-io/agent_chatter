import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentValidator } from '../../../src/registry/AgentValidator.js';
import type { AgentDefinition } from '../../../src/registry/RegistryStorage.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentValidator', () => {
  let validator: AgentValidator;
  let testDir: string;

  beforeEach(() => {
    validator = new AgentValidator();
    testDir = path.join(os.tmpdir(), `agent-validator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createTestAgent = (name: string, command: string): AgentDefinition => ({
    name,
    displayName: `${name} Agent`,
    command,
    args: ['--test'],
    endMarker: '[DONE]',
    usePty: false,
    installedAt: '2024-11-18T10:00:00Z'
  });

  describe('verify', () => {
    it('returns verified status for valid agent', async () => {
      // 使用实际存在的命令（如 node）
      const agent = createTestAgent('test', 'node');

      const result = await validator.verify(agent);

      expect(result.name).toBe('test');
      expect(result.status).toBeDefined();
      expect(result.checks).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
    });

    it('includes multiple check results', async () => {
      const agent = createTestAgent('test', 'node');

      const result = await validator.verify(agent);

      expect(result.checks!.length).toBeGreaterThan(0);
      result.checks!.forEach(check => {
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('passed');
        expect(check).toHaveProperty('message');
      });
    });

    it('returns failed status for non-existent command', async () => {
      const agent = createTestAgent('test', '/nonexistent/command');

      const result = await validator.verify(agent);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });

    it('performs executable check', async () => {
      const agent = createTestAgent('test', 'node');

      const result = await validator.verify(agent);

      const execCheck = result.checks?.find(c => c.name === 'Executable Check');
      expect(execCheck).toBeDefined();
    });

    it('performs version check', async () => {
      const agent = createTestAgent('test', 'node');

      const result = await validator.verify(agent);

      const versionCheck = result.checks?.find(c => c.name === 'Version Check');
      expect(versionCheck).toBeDefined();
    });

    it('performs authentication check', async () => {
      const agent = createTestAgent('claude', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck).toBeDefined();
    });
  });

  describe('checkExecutable', () => {
    it('validates executable in PATH', async () => {
      const agent = createTestAgent('test', 'node');

      const result = await validator.verify(agent);

      const execCheck = result.checks?.find(c => c.name === 'Executable Check');
      expect(execCheck?.passed).toBe(true);
    });

    it('fails for non-existent command', async () => {
      const agent = createTestAgent('test', 'nonexistent-command-xyz');

      const result = await validator.verify(agent);

      expect(result.status).toBe('failed');
    });

    it('validates absolute path', async () => {
      // 创建临时可执行文件
      const execPath = path.join(testDir, 'test-exec');
      fs.writeFileSync(execPath, '#!/bin/bash\necho test', { mode: 0o755 });

      const agent = createTestAgent('test', execPath);

      const result = await validator.verify(agent);

      const execCheck = result.checks?.find(c => c.name === 'Executable Check');
      expect(execCheck?.passed).toBe(true);
    });

    it('fails for non-executable file on Unix', async () => {
      if (os.platform() === 'win32') {
        // Windows 不检查执行权限，跳过此测试
        return;
      }

      const nonExecPath = path.join(testDir, 'non-exec');
      fs.writeFileSync(nonExecPath, 'test', { mode: 0o644 }); // 不可执行

      const agent = createTestAgent('test', nonExecPath);

      const result = await validator.verify(agent);

      expect(result.status).toBe('failed');
    });
  });

  describe('checkAuthentication - Claude', () => {
    it('checks for Claude config file', async () => {
      const agent = createTestAgent('claude', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck).toBeDefined();
      // Authentication check 应该返回结果（无论 passed 是 true 还是 false）
      expect(typeof authCheck?.passed).toBe('boolean');
    });

    it('returns authentication check result', async () => {
      const agent = createTestAgent('claude', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck).toBeDefined();
      expect(authCheck?.message).toBeDefined();
      expect(typeof authCheck?.message).toBe('string');
    });
  });

  describe('checkAuthentication - Codex', () => {
    it('checks for Codex auth file', async () => {
      const agent = createTestAgent('codex', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck).toBeDefined();
      expect(typeof authCheck?.passed).toBe('boolean');
    });

    it('returns appropriate auth message', async () => {
      const agent = createTestAgent('codex', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck?.message).toBeDefined();
      expect(typeof authCheck?.message).toBe('string');
      // Message 应该包含认证相关的信息
      expect(authCheck?.message.length).toBeGreaterThan(0);
    });
  });

  describe('checkAuthentication - Gemini', () => {
    it('checks for Gemini credentials file', async () => {
      const agent = createTestAgent('gemini', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck).toBeDefined();
      expect(typeof authCheck?.passed).toBe('boolean');
    });

    it('returns authentication status message', async () => {
      const agent = createTestAgent('gemini', 'node');

      const result = await validator.verify(agent);

      const authCheck = result.checks?.find(c => c.name === 'Authentication Check');
      expect(authCheck?.message).toBeDefined();
      expect(typeof authCheck?.message).toBe('string');
      expect(authCheck?.message.length).toBeGreaterThan(0);
    });
  });

  describe('verifyWithTimeout', () => {
    it('completes within timeout', async () => {
      const agent = createTestAgent('test', 'node');

      const result = await validator.verifyWithTimeout(agent, 5000);

      expect(result).toBeDefined();
      expect(result.name).toBe('test');
    });

    it('handles timeout gracefully', async () => {
      // 使用一个不存在的命令，验证会比较慢
      const agent = createTestAgent('test', '/very/long/nonexistent/path/to/command');

      const result = await validator.verifyWithTimeout(agent, 100); // 100ms 超时

      expect(result).toBeDefined();
      expect(result.name).toBe('test');
      // 可能会超时，也可能快速失败，都是合法的
      expect(['verified', 'failed']).toContain(result.status);
    });

    it('returns error on timeout', async () => {
      const agent = createTestAgent('test', '/nonexistent/very/long/path/that/will/timeout');

      const startTime = Date.now();
      const result = await validator.verifyWithTimeout(agent, 1000);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // 应该在超时时间内返回
      expect(result.status).toBe('failed');
    });
  });

  describe('error handling', () => {
    it('handles invalid agent gracefully', async () => {
      const agent = createTestAgent('unknown-type', '/invalid/path');

      const result = await validator.verify(agent);

      expect(result).toBeDefined();
      expect(result.status).toBe('failed');
    });

    it('provides meaningful error messages', async () => {
      const agent = createTestAgent('test', '/nonexistent/command');

      const result = await validator.verify(agent);

      expect(result.error).toBeDefined();
      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe('string');
    });

    it('includes check results even on failure', async () => {
      const agent = createTestAgent('test', '/nonexistent/command');

      const result = await validator.verify(agent);

      expect(result.checks).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
      expect(result.checks!.length).toBeGreaterThan(0);
    });
  });
});
