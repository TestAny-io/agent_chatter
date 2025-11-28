/**
 * Integration tests for /agents CLI commands
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { AgentRegistry } from '../../../src/registry/AgentRegistry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 减少集成测试的外部调用/并发压力：
// 1) Mock AgentScanner：避免真实扫描本机 CLI，返回固定结果
// 2) Mock AgentValidator：避免重复执行 CLI 验证，只返回通过
vi.mock('../../../src/registry/AgentScanner.js', () => {
  class AgentScanner {
    async scanAll() {
      return [
        { name: 'claude', displayName: 'Claude Code', command: 'claude', found: true },
        { name: 'codex', displayName: 'OpenAI Codex', command: 'codex', found: true },
        { name: 'gemini', displayName: 'Google Gemini', command: 'gemini', found: true }
      ];
    }
    async scan(agentType: string) {
      const agents: Record<string, any> = {
        claude: { name: 'claude', displayName: 'Claude Code', command: 'claude', found: true },
        codex: { name: 'codex', displayName: 'OpenAI Codex', command: 'codex', found: true },
        gemini: { name: 'gemini', displayName: 'Google Gemini', command: 'gemini', found: true }
      };
      return agents[agentType] || { name: agentType, displayName: agentType, command: agentType, found: false };
    }
    createAgentDefinition(scanned: any) {
      return {
        name: scanned.name,
        displayName: scanned.displayName,
        command: scanned.command,
        version: scanned.version,
        installedAt: new Date().toISOString()
      };
    }
  }
  return { AgentScanner };
});

vi.mock('../../../src/registry/AgentValidator.js', () => {
  class AgentValidator {
    async verify(agent: { name: string }) {
      return {
        name: agent.name,
        status: 'verified' as const,
        checks: [
          { name: 'CLI Command Check', passed: true, message: 'mocked executable check' },
          { name: 'Version Check', passed: true, message: 'mocked version check' },
          { name: 'Authentication Check', passed: true, message: 'mocked auth check' }
        ]
      };
    }
  }
  return { AgentValidator };
});

describe.sequential('Agents CLI Commands (Integration)', () => {
  let testRegistryPath: string;
  let registry: AgentRegistry;
  let tempRoot: string;

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-cli-suite-'));
  });

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    // 每个测试独立的 registry 文件，避免状态串扰
    const testDir = path.join(tempRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    testRegistryPath = path.join(testDir, 'config.json');
    registry = new AgentRegistry(testRegistryPath);
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testRegistryPath)) {
      const dir = path.dirname(testRegistryPath);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('scanAgents', () => {
    it('scans system for installed agents', async () => {
      const scanned = await registry.scanAgents();

      expect(Array.isArray(scanned)).toBe(true);
      expect(scanned.length).toBeGreaterThan(0);

      scanned.forEach(agent => {
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('displayName');
        expect(agent).toHaveProperty('command');
        expect(agent).toHaveProperty('found');
        expect(typeof agent.found).toBe('boolean');
      });
    });

    it('includes known agent types', async () => {
      const scanned = await registry.scanAgents();
      const names = scanned.map(a => a.name);

      expect(names).toContain('claude');
      expect(names).toContain('codex');
      expect(names).toContain('gemini');
    });
  });

  describe('registerAgent', () => {
    it('registers agent successfully', async () => {
      const result = await registry.registerAgent('claude');

      // 如果系统中安装了 claude，应该成功
      if (result.success) {
        expect(result.error).toBeUndefined();

        const agents = await registry.listAgents();
        const claude = agents.find(a => a.name === 'claude');

        expect(claude).toBeDefined();
        expect(claude?.displayName).toBe('Claude Code');
      } else {
        // 如果没有安装，应该有错误消息
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    });

    it('prevents duplicate registration', async () => {
      // 第一次注册
      const result1 = await registry.registerAgent('claude');

      if (result1.success) {
        // 尝试再次注册
        const result2 = await registry.registerAgent('claude');

        expect(result2.success).toBe(false);
        expect(result2.error).toContain('already registered');
      }
    });

    it('accepts custom command path', async () => {
      const customPath = '/custom/path/to/claude';
      const result = await registry.registerAgent('claude', customPath);

      if (result.success) {
        const agents = await registry.listAgents();
        const claude = agents.find(a => a.name === 'claude');

        expect(claude?.command).toBe(customPath);
      }
    });
  });

  describe('listAgents', () => {
    it('returns empty array when no agents registered', async () => {
      const agents = await registry.listAgents();

      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBe(0);
    });

    it('returns registered agents', async () => {
      // 注册一个 agent
      await registry.registerAgent('claude');

      const agents = await registry.listAgents();

      if (agents.length > 0) {
        expect(agents[0]).toHaveProperty('name');
        expect(agents[0]).toHaveProperty('displayName');
        expect(agents[0]).toHaveProperty('command');
      }
    });
  });

  describe('getAgent', () => {
    it('returns agent by name', async () => {
      const result = await registry.registerAgent('claude');

      if (result.success) {
        const agent = await registry.getAgent('claude');

        expect(agent).toBeDefined();
        expect(agent?.name).toBe('claude');
        expect(agent?.displayName).toBe('Claude Code');
      }
    });

    it('returns undefined for non-existent agent', async () => {
      const agent = await registry.getAgent('nonexistent');

      expect(agent).toBeUndefined();
    });
  });

  describe('deleteAgent', () => {
    it('deletes agent successfully', async () => {
      // 先注册
      const registerResult = await registry.registerAgent('claude');

      // 如果注册失败（如 CI 环境中没有 claude），跳过此测试
      if (!registerResult.success) {
        console.log('Skipping test - claude CLI not available');
        return;
      }

      // 然后删除
      const result = await registry.deleteAgent('claude');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // 验证已删除
      const agent = await registry.getAgent('claude');
      expect(agent).toBeUndefined();
    });

    it('returns error when deleting non-existent agent', async () => {
      const result = await registry.deleteAgent('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });
  });

  describe('updateAgent', () => {
    it('updates agent configuration', async () => {
      // 先注册
      const registerResult = await registry.registerAgent('claude');

      if (registerResult.success) {
        // 更新配置
        const updates = {
          command: '/new/path/to/claude',
          args: ['--new-arg']
        };

        const result = await registry.updateAgent('claude', updates);

        expect(result.success).toBe(true);

        // 验证更新
        const agent = await registry.getAgent('claude');
        expect(agent?.command).toBe('/new/path/to/claude');
        expect(agent?.args).toEqual(['--new-arg']);
      }
    });

    it('preserves name and installedAt on update', async () => {
      const registerResult = await registry.registerAgent('claude');

      if (registerResult.success) {
        const originalAgent = await registry.getAgent('claude');
        const originalInstalledAt = originalAgent?.installedAt;

        // 更新
        await registry.updateAgent('claude', { command: '/new/path' });

        // 验证
        const updatedAgent = await registry.getAgent('claude');
        expect(updatedAgent?.name).toBe('claude');
        expect(updatedAgent?.installedAt).toBe(originalInstalledAt);
      }
    });

    it('returns error when updating non-existent agent', async () => {
      const result = await registry.updateAgent('nonexistent', {
        command: '/path'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyAgent', () => {
    it('verifies agent availability', async () => {
      const registerResult = await registry.registerAgent('claude');

      if (registerResult.success) {
        const result = await registry.verifyAgent('claude');

        expect(result).toBeDefined();
        expect(result.name).toBe('claude');
        expect(result.status).toBeDefined();
        expect(['verified', 'failed']).toContain(result.status);

        if (result.checks) {
          expect(Array.isArray(result.checks)).toBe(true);
          result.checks.forEach(check => {
            expect(check).toHaveProperty('name');
            expect(check).toHaveProperty('passed');
            expect(check).toHaveProperty('message');
          });
        }
      }
    }, 30000); // 增加超时时间到 30 秒，因为验证需要执行 CLI 命令

    it('updates lastVerified on successful verification', async () => {
      const registerResult = await registry.registerAgent('claude');

      if (registerResult.success) {
        const beforeVerify = await registry.getAgent('claude');
        const beforeTimestamp = beforeVerify?.lastVerified;

        // 等待 10ms 确保时间戳不同
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = await registry.verifyAgent('claude');

        if (result.status === 'verified') {
          const afterVerify = await registry.getAgent('claude');
          const afterTimestamp = afterVerify?.lastVerified;

          expect(afterTimestamp).toBeDefined();
          if (beforeTimestamp) {
            expect(afterTimestamp! > beforeTimestamp).toBe(true);
          }
        }
      }
    }, 30000); // 增加超时时间到 30 秒

    it('returns error for non-existent agent', async () => {
      const result = await registry.verifyAgent('nonexistent');

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not found');
    });
  });

  describe('persistence', () => {
    it('persists agents to file', async () => {
      const result = await registry.registerAgent('claude');

      if (result.success) {
        // 读取文件内容
        expect(fs.existsSync(testRegistryPath)).toBe(true);

        const content = fs.readFileSync(testRegistryPath, 'utf-8');
        const data = JSON.parse(content);

        expect(data).toHaveProperty('schemaVersion');
        expect(data.schemaVersion).toBe('1.1');
        expect(data).toHaveProperty('agents');
        expect(data.agents).toHaveProperty('claude');
      }
    });

    it('loads agents from file', async () => {
      // 注册并保存
      await registry.registerAgent('claude');

      // 创建新的 registry 实例
      const newRegistry = new AgentRegistry(testRegistryPath);
      const agents = await newRegistry.listAgents();

      if (agents.length > 0) {
        const claude = agents.find(a => a.name === 'claude');
        expect(claude).toBeDefined();
      }
    });
  });
});
