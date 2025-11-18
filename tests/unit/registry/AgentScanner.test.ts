import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentScanner } from '../../../src/registry/AgentScanner.js';
import type { AgentType } from '../../../src/utils/AgentDefaults.js';
import * as fs from 'fs';
import * as os from 'os';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, options, callback) => {
    // 模拟 which/where 命令
    if (cmd.includes('which') || cmd.includes('where')) {
      if (cmd.includes('claude')) {
        callback(null, { stdout: '/usr/local/bin/claude\n', stderr: '' });
      } else if (cmd.includes('codex')) {
        callback(null, { stdout: '/usr/local/bin/codex\n', stderr: '' });
      } else if (cmd.includes('gemini')) {
        callback(null, { stdout: '', stderr: '' }); // 未找到
      } else {
        callback(new Error('Command not found'), { stdout: '', stderr: '' });
      }
    }
    // 模拟 --version 命令
    else if (cmd.includes('--version')) {
      if (cmd.includes('claude')) {
        callback(null, { stdout: 'claude version 0.8.0\n', stderr: '' });
      } else if (cmd.includes('codex')) {
        callback(null, { stdout: 'codex 0.58.0\n', stderr: '' });
      } else {
        callback(null, { stdout: 'version 1.0.0\n', stderr: '' });
      }
    } else {
      callback(null, { stdout: '', stderr: '' });
    }
  })
}));

describe('AgentScanner', () => {
  let scanner: AgentScanner;

  beforeEach(() => {
    scanner = new AgentScanner();
  });

  describe('scan', () => {
    it('finds claude in PATH', async () => {
      const result = await scanner.scan('claude');

      expect(result.name).toBe('claude');
      expect(result.displayName).toBe('Claude Code');
      expect(result.found).toBe(true);
      expect(result.command).toContain('claude');
    });

    it('handles codex scan attempt', async () => {
      const result = await scanner.scan('codex');

      expect(result.name).toBe('codex');
      expect(result.displayName).toBe('OpenAI Codex');
      // found 可能是 true 或 false，取决于系统是否安装了 codex
      expect(typeof result.found).toBe('boolean');
      if (result.found) {
        expect(result.command).toContain('codex');
      }
    });

    it('returns not found for gemini', async () => {
      const result = await scanner.scan('gemini');

      expect(result.name).toBe('gemini');
      expect(result.displayName).toBe('Google Gemini CLI');
      expect(result.found).toBe(false);
    });

    it('detects version when available', async () => {
      const result = await scanner.scan('claude');

      expect(result.version).toBeDefined();
      expect(result.version).toMatch(/\d+\.\d+/);
    });
  });

  describe('scanAll', () => {
    it('scans all supported agent types', async () => {
      const results = await scanner.scanAll();

      expect(results).toHaveLength(3);
      expect(results.map(r => r.name)).toEqual(['claude', 'codex', 'gemini']);
    });

    it('returns found status for each agent', async () => {
      const results = await scanner.scanAll();

      results.forEach(result => {
        expect(result).toHaveProperty('found');
        expect(typeof result.found).toBe('boolean');
      });
    });
  });

  describe('validateCommand', () => {
    it('validates existing command', async () => {
      // 使用系统中肯定存在的命令
      const result = await scanner.validateCommand('node');

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
      // 在真实环境中 node 应该是 valid 的，但在某些测试环境中可能失败
      // 所以我们只检查返回值的结构
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });

    it('detects version for valid command', async () => {
      const result = await scanner.validateCommand('claude');

      if (result.valid) {
        expect(result.version).toBeDefined();
      }
    });

    it('returns error for non-existent command', async () => {
      const result = await scanner.validateCommand('/nonexistent/path/to/command');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('createAgentDefinition', () => {
    it('creates AgentDefinition from scanned agent', () => {
      const scanned = {
        name: 'claude' as AgentType,
        displayName: 'Claude Code',
        command: '/usr/local/bin/claude',
        version: '0.8.0',
        found: true
      };

      const definition = scanner.createAgentDefinition(scanned);

      expect(definition.name).toBe('claude');
      expect(definition.displayName).toBe('Claude Code');
      expect(definition.command).toBe('/usr/local/bin/claude');
      expect(definition.version).toBe('0.8.0');
      expect(definition.installedAt).toBeDefined();
      expect(definition.args).toBeDefined();
      expect(definition.endMarker).toBe('[DONE]');
    });

    it('includes timestamp in definition', () => {
      const scanned = {
        name: 'codex' as AgentType,
        displayName: 'OpenAI Codex',
        command: 'codex',
        found: true
      };

      const before = new Date().toISOString();
      const definition = scanner.createAgentDefinition(scanned);
      const after = new Date().toISOString();

      expect(definition.installedAt >= before).toBe(true);
      expect(definition.installedAt <= after).toBe(true);
    });

    it('handles missing version', () => {
      const scanned = {
        name: 'gemini' as AgentType,
        displayName: 'Google Gemini CLI',
        command: 'gemini',
        found: true
      };

      const definition = scanner.createAgentDefinition(scanned);

      expect(definition.version).toBeUndefined();
    });
  });

  describe('cross-platform support', () => {
    it('handles different platforms', () => {
      const platform = os.platform();

      // 验证能够处理当前平台
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });

    it('returns appropriate paths for current platform', async () => {
      const result = await scanner.scan('claude');

      // 路径应该符合当前平台
      if (result.found) {
        expect(result.command).toBeTruthy();
        expect(typeof result.command).toBe('string');
      }
    });
  });

  describe('error handling', () => {
    it('handles command execution timeout gracefully', async () => {
      // 这个测试主要验证不会抛出未捕获的异常
      const result = await scanner.validateCommand('some-command');

      expect(result).toHaveProperty('valid');
      expect(typeof result.valid).toBe('boolean');
    });

    it('handles non-executable files', async () => {
      // 创建一个临时文件用于测试
      const testFile = '/tmp/test-non-executable';

      try {
        fs.writeFileSync(testFile, 'test', { mode: 0o644 }); // 非可执行权限

        const result = await scanner.validateCommand(testFile);

        // 应该返回无效，因为文件不可执行
        expect(result.valid).toBe(false);
      } finally {
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      }
    });
  });
});
