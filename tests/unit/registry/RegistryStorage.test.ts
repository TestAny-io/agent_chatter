import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RegistryStorage, AgentDefinition, AgentRegistryData } from '../../../src/registry/RegistryStorage.js';

describe('RegistryStorage', () => {
  let testDir: string;
  let testRegistryPath: string;
  let storage: RegistryStorage;

  beforeEach(() => {
    // 创建临时测试目录（使用随机数确保唯一性）
    testDir = path.join(os.tmpdir(), `agent-chatter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testRegistryPath = path.join(testDir, 'agents', 'config.json');
    storage = new RegistryStorage(testRegistryPath);
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('load', () => {
    it('returns empty registry when file does not exist', async () => {
      const data = await storage.load();

      expect(data).toEqual({
        schemaVersion: '1.1',
        agents: {}
      });
    });

    it('loads existing registry file', async () => {
      // 准备测试数据
      const testData: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {
          claude: {
            name: 'claude',
            displayName: 'Claude Code',
            command: 'claude',
            args: ['--test'],
            endMarker: '[DONE]',
            usePty: false,
            installedAt: '2024-11-18T10:00:00Z'
          }
        }
      };

      // 写入测试文件
      const dir = path.dirname(testRegistryPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(testRegistryPath, JSON.stringify(testData, null, 2));

      // 加载
      const loaded = await storage.load();

      expect(loaded).toEqual(testData);
    });

    it('throws error on invalid schema version', async () => {
      // 写入旧版本
      const invalidData = {
        schemaVersion: '1.0',
        agents: {}
      };

      const dir = path.dirname(testRegistryPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(testRegistryPath, JSON.stringify(invalidData));

      await expect(storage.load()).rejects.toThrow('Unsupported registry schema version: 1.0');
    });

    it('throws error on invalid JSON', async () => {
      // 创建独立的测试路径和storage实例确保隔离
      const invalidTestDir = path.join(os.tmpdir(), `agent-chatter-invalid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const invalidTestPath = path.join(invalidTestDir, 'agents', 'config.json');
      const invalidStorage = new RegistryStorage(invalidTestPath);

      const dir = path.dirname(invalidTestPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(invalidTestPath, 'invalid json {');

      await expect(invalidStorage.load()).rejects.toThrow('Failed to load agent registry');

      // 清理
      fs.rmSync(invalidTestDir, { recursive: true, force: true });
    });
  });

  describe('save', () => {
    it('creates directory if not exists', async () => {
      const data: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {}
      };

      await storage.save(data);

      expect(fs.existsSync(path.dirname(testRegistryPath))).toBe(true);
    });

    it('saves registry data correctly', async () => {
      const testAgent: AgentDefinition = {
        name: 'claude',
        displayName: 'Claude Code',
        command: 'claude',
        args: ['--test'],
        endMarker: '[DONE]',
        usePty: false,
        installedAt: '2024-11-18T10:00:00Z'
      };

      const data: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {
          claude: testAgent
        }
      };

      await storage.save(data);

      // 验证文件存在
      expect(fs.existsSync(testRegistryPath)).toBe(true);

      // 验证文件内容
      const savedContent = fs.readFileSync(testRegistryPath, 'utf-8');
      const savedData = JSON.parse(savedContent);
      expect(savedData).toEqual(data);
    });

    it('sets file permissions to 0600', async () => {
      const data: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {}
      };

      await storage.save(data);

      const stats = fs.statSync(testRegistryPath);
      const mode = stats.mode & 0o777;

      // 验证权限为 0600
      expect(mode).toBe(0o600);
    });

    it('overwrites existing file', async () => {
      // 第一次保存
      const data1: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {
          claude: {
            name: 'claude',
            displayName: 'Claude Code',
            command: 'claude',
            args: [],
            endMarker: '[DONE]',
            usePty: false,
            installedAt: '2024-11-18T10:00:00Z'
          }
        }
      };
      await storage.save(data1);

      // 第二次保存（覆盖）
      const data2: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {
          codex: {
            name: 'codex',
            displayName: 'OpenAI Codex',
            command: 'codex',
            args: ['exec'],
            endMarker: '[DONE]',
            usePty: false,
            installedAt: '2024-11-18T11:00:00Z'
          }
        }
      };
      await storage.save(data2);

      // 验证只有第二次的数据
      const loaded = await storage.load();
      expect(loaded).toEqual(data2);
    });
  });

  describe('exists', () => {
    it('returns false when file does not exist', () => {
      expect(storage.exists()).toBe(false);
    });

    it('returns true when file exists', async () => {
      const data: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {}
      };

      await storage.save(data);

      expect(storage.exists()).toBe(true);
    });
  });

  describe('getPath', () => {
    it('returns the registry path', () => {
      expect(storage.getPath()).toBe(testRegistryPath);
    });
  });

  describe('delete', () => {
    it('deletes existing file', async () => {
      // 创建文件
      const data: AgentRegistryData = {
        schemaVersion: '1.1',
        agents: {}
      };
      await storage.save(data);

      expect(storage.exists()).toBe(true);

      // 删除
      await storage.delete();

      expect(storage.exists()).toBe(false);
    });

    it('does not throw when file does not exist', async () => {
      await expect(storage.delete()).resolves.not.toThrow();
    });
  });

  describe('path validation', () => {
    describe('valid paths', () => {
      it('accepts path in home directory', () => {
        const homePath = path.join(os.homedir(), 'test-registry.json');
        expect(() => new RegistryStorage(homePath)).not.toThrow();
      });

      it('accepts path in current working directory', () => {
        const cwdPath = path.join(process.cwd(), 'test-registry.json');
        expect(() => new RegistryStorage(cwdPath)).not.toThrow();
      });

      it('accepts path in temp directory', () => {
        const tmpPath = path.join(os.tmpdir(), 'test-registry.json');
        expect(() => new RegistryStorage(tmpPath)).not.toThrow();
      });

      it('accepts nested path in home directory', () => {
        const nestedPath = path.join(os.homedir(), 'foo', 'bar', 'test-registry.json');
        expect(() => new RegistryStorage(nestedPath)).not.toThrow();
      });

      it('accepts path with normalized .. that stays inside allowed directory', () => {
        const homePath = path.join(os.homedir(), 'foo', '..', 'test-registry.json');
        expect(() => new RegistryStorage(homePath)).not.toThrow();
      });
    });

    describe('invalid paths', () => {
      it('rejects path outside home, cwd, and tmp', () => {
        // Use /etc which is outside all allowed directories
        const outsidePath = '/etc/test-registry.json';
        expect(() => new RegistryStorage(outsidePath)).toThrow('Invalid registry path');
      });

      it('rejects path that escapes home directory', () => {
        const escapePath = path.join(os.homedir(), '..', 'test-registry.json');
        expect(() => new RegistryStorage(escapePath)).toThrow('Invalid registry path');
      });

      it('rejects path without .json extension', () => {
        const noExtPath = path.join(os.homedir(), 'test-registry');
        expect(() => new RegistryStorage(noExtPath)).toThrow('Registry path must end with .json');
      });

      it('rejects path with wrong extension', () => {
        const wrongExtPath = path.join(os.homedir(), 'test-registry.txt');
        expect(() => new RegistryStorage(wrongExtPath)).toThrow('Registry path must end with .json');
      });
    });

    describe('security - prevents directory traversal', () => {
      it('rejects ../../etc/passwd attack', () => {
        // Use absolute path to /etc to ensure it's outside allowed directories
        const attackPath = '/etc/passwd.json';
        expect(() => new RegistryStorage(attackPath)).toThrow('Invalid registry path');
      });

      it('rejects path escaping to another user directory', () => {
        // This tests the /Users/al vs /Users/alex issue
        const homeDir = os.homedir();
        // Try to access sibling directory by going up and down
        const escapePath = path.join(homeDir, '..', 'other-user', 'file.json');
        expect(() => new RegistryStorage(escapePath)).toThrow('Invalid registry path');
      });

      it('accepts normalized paths that resolve to allowed directories', () => {
        // This should work because it resolves to inside home
        const normalizedPath = path.join(os.homedir(), 'foo', '..', 'bar', 'test.json');
        const storage = new RegistryStorage(normalizedPath);
        expect(storage.getPath()).toContain(os.homedir());
      });
    });
  });
});
