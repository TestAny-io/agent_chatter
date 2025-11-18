import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentRegistry } from '../../../src/registry/AgentRegistry.js';
import { AgentDefinition } from '../../../src/registry/RegistryStorage.js';

describe('AgentRegistry', () => {
  let testDir: string;
  let testRegistryPath: string;
  let registry: AgentRegistry;

  beforeEach(() => {
    // 创建临时测试目录（使用随机数确保唯一性）
    testDir = path.join(os.tmpdir(), `agent-chatter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testRegistryPath = path.join(testDir, 'agents', 'config.json');
    registry = new AgentRegistry(testRegistryPath);
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createTestAgent = (name: string = 'claude'): AgentDefinition => ({
    name,
    displayName: `${name} Agent`,
    command: name,
    args: ['--test'],
    endMarker: '[DONE]',
    usePty: false,
    installedAt: '2024-11-18T10:00:00Z'
  });

  describe('load', () => {
    it('loads empty registry when file does not exist', async () => {
      await registry.load();

      expect(registry.isEmpty()).toBe(true);
      expect(registry.count()).toBe(0);
    });

    it('loads existing registry data', async () => {
      // 准备测试数据
      const agent = createTestAgent('claude');
      const data = {
        schemaVersion: '1.1',
        agents: { claude: agent }
      };

      // 写入文件
      const dir = path.dirname(testRegistryPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(testRegistryPath, JSON.stringify(data));

      // 加载
      await registry.load();

      expect(registry.count()).toBe(1);
      expect(registry.get('claude')).toEqual(agent);
    });

    it('can be called multiple times', async () => {
      await registry.load();
      await registry.load();

      expect(registry.isEmpty()).toBe(true);
    });
  });

  describe('save', () => {
    it('throws error when not loaded', async () => {
      await expect(registry.save()).rejects.toThrow('Registry not loaded');
    });

    it('saves registry to file', async () => {
      await registry.load();
      const agent = createTestAgent('claude');
      await registry.register(agent);

      // 验证文件存在
      expect(fs.existsSync(testRegistryPath)).toBe(true);

      // 验证文件内容
      const content = fs.readFileSync(testRegistryPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.schemaVersion).toBe('1.1');
      expect(data.agents.claude).toEqual(agent);
    });
  });

  describe('register', () => {
    it('registers a new agent', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      expect(registry.get('claude')).toEqual(agent);
      expect(registry.count()).toBe(1);
    });

    it('auto-loads if not loaded', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      expect(registry.get('claude')).toEqual(agent);
    });

    it('throws error when agent already exists', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      await expect(registry.register(agent)).rejects.toThrow(
        "Agent 'claude' is already registered"
      );
    });

    it('saves to file after registration', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      expect(fs.existsSync(testRegistryPath)).toBe(true);
    });

    it('registers multiple agents', async () => {
      await registry.register(createTestAgent('claude'));
      await registry.register(createTestAgent('codex'));
      await registry.register(createTestAgent('gemini'));

      expect(registry.count()).toBe(3);
    });
  });

  describe('get', () => {
    it('throws error when not loaded', () => {
      expect(() => registry.get('claude')).toThrow('Registry not loaded');
    });

    it('returns undefined for non-existent agent', async () => {
      await registry.load();

      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('returns agent when exists', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      expect(registry.get('claude')).toEqual(agent);
    });
  });

  describe('list', () => {
    it('throws error when not loaded', () => {
      expect(() => registry.list()).toThrow('Registry not loaded');
    });

    it('returns empty array when no agents', async () => {
      await registry.load();

      expect(registry.list()).toEqual([]);
    });

    it('returns all registered agents', async () => {
      const claude = createTestAgent('claude');
      const codex = createTestAgent('codex');

      await registry.register(claude);
      await registry.register(codex);

      const agents = registry.list();

      expect(agents).toHaveLength(2);
      expect(agents).toContainEqual(claude);
      expect(agents).toContainEqual(codex);
    });
  });

  describe('delete', () => {
    it('auto-loads if not loaded', async () => {
      // 先注册一个 agent
      const agent = createTestAgent('claude');
      await registry.register(agent);

      // 创建新的 registry 实例
      const newRegistry = new AgentRegistry(testRegistryPath);

      // 删除（会自动加载）
      await newRegistry.delete('claude');

      expect(newRegistry.count()).toBe(0);
    });

    it('throws error when agent does not exist', async () => {
      await registry.load();

      await expect(registry.delete('nonexistent')).rejects.toThrow(
        "Agent 'nonexistent' not found in registry"
      );
    });

    it('deletes existing agent', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      expect(registry.count()).toBe(1);

      await registry.delete('claude');

      expect(registry.count()).toBe(0);
      expect(registry.get('claude')).toBeUndefined();
    });

    it('saves to file after deletion', async () => {
      const claude = createTestAgent('claude');
      const codex = createTestAgent('codex');

      await registry.register(claude);
      await registry.register(codex);

      await registry.delete('claude');

      // 重新加载验证
      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.load();

      expect(newRegistry.count()).toBe(1);
      expect(newRegistry.get('claude')).toBeUndefined();
      expect(newRegistry.get('codex')).toEqual(codex);
    });
  });

  describe('update', () => {
    it('auto-loads if not loaded', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.update('claude', { displayName: 'Updated Claude' });

      const updated = newRegistry.get('claude');
      expect(updated?.displayName).toBe('Updated Claude');
    });

    it('throws error when agent does not exist', async () => {
      await registry.load();

      await expect(registry.update('nonexistent', {})).rejects.toThrow(
        "Agent 'nonexistent' not found in registry"
      );
    });

    it('updates agent fields', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      await registry.update('claude', {
        displayName: 'Updated Claude',
        args: ['--new-args']
      });

      const updated = registry.get('claude');
      expect(updated?.displayName).toBe('Updated Claude');
      expect(updated?.args).toEqual(['--new-args']);
    });

    it('preserves name and installedAt', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      await registry.update('claude', {
        // @ts-expect-error Testing that name cannot be changed
        name: 'different-name',
        installedAt: '2025-01-01T00:00:00Z'
      });

      const updated = registry.get('claude');
      expect(updated?.name).toBe('claude');
      expect(updated?.installedAt).toBe('2024-11-18T10:00:00Z');
    });

    it('saves to file after update', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      await registry.update('claude', { displayName: 'Updated' });

      // 重新加载验证
      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.load();

      expect(newRegistry.get('claude')?.displayName).toBe('Updated');
    });
  });

  describe('isEmpty', () => {
    it('throws error when not loaded', () => {
      expect(() => registry.isEmpty()).toThrow('Registry not loaded');
    });

    it('returns true when no agents', async () => {
      await registry.load();

      expect(registry.isEmpty()).toBe(true);
    });

    it('returns false when agents exist', async () => {
      await registry.register(createTestAgent('claude'));

      expect(registry.isEmpty()).toBe(false);
    });
  });

  describe('has', () => {
    it('throws error when not loaded', () => {
      expect(() => registry.has('claude')).toThrow('Registry not loaded');
    });

    it('returns false for non-existent agent', async () => {
      await registry.load();

      expect(registry.has('claude')).toBe(false);
    });

    it('returns true for existing agent', async () => {
      await registry.register(createTestAgent('claude'));

      expect(registry.has('claude')).toBe(true);
    });
  });

  describe('count', () => {
    it('throws error when not loaded', () => {
      expect(() => registry.count()).toThrow('Registry not loaded');
    });

    it('returns 0 when empty', async () => {
      await registry.load();

      expect(registry.count()).toBe(0);
    });

    it('returns correct count', async () => {
      await registry.register(createTestAgent('claude'));
      await registry.register(createTestAgent('codex'));

      expect(registry.count()).toBe(2);
    });
  });

  describe('updateLastVerified', () => {
    it('auto-loads if not loaded', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.updateLastVerified('claude');

      const updated = newRegistry.get('claude');
      expect(updated?.lastVerified).toBeDefined();
    });

    it('throws error when agent does not exist', async () => {
      await registry.load();

      await expect(registry.updateLastVerified('nonexistent')).rejects.toThrow(
        "Agent 'nonexistent' not found in registry"
      );
    });

    it('updates lastVerified timestamp', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      const before = new Date().toISOString();
      await registry.updateLastVerified('claude');
      const after = new Date().toISOString();

      const updated = registry.get('claude');
      expect(updated?.lastVerified).toBeDefined();
      expect(updated!.lastVerified! >= before).toBe(true);
      expect(updated!.lastVerified! <= after).toBe(true);
    });

    it('saves to file after update', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      await registry.updateLastVerified('claude');

      // 重新加载验证
      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.load();

      expect(newRegistry.get('claude')?.lastVerified).toBeDefined();
    });
  });

  describe('clear', () => {
    it('auto-loads if not loaded', async () => {
      const agent = createTestAgent('claude');
      await registry.register(agent);

      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.clear();

      expect(newRegistry.isEmpty()).toBe(true);
    });

    it('removes all agents', async () => {
      await registry.register(createTestAgent('claude'));
      await registry.register(createTestAgent('codex'));
      await registry.register(createTestAgent('gemini'));

      expect(registry.count()).toBe(3);

      await registry.clear();

      expect(registry.isEmpty()).toBe(true);
      expect(registry.count()).toBe(0);
    });

    it('saves to file after clear', async () => {
      await registry.register(createTestAgent('claude'));
      await registry.clear();

      // 重新加载验证
      const newRegistry = new AgentRegistry(testRegistryPath);
      await newRegistry.load();

      expect(newRegistry.isEmpty()).toBe(true);
    });
  });

  describe('getPath', () => {
    it('returns the registry path', () => {
      expect(registry.getPath()).toBe(testRegistryPath);
    });
  });
});
