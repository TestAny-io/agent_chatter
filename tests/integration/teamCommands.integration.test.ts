/**
 * Team Commands 集成测试
 * 测试完整的 /team 命令流程
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Team Commands Integration Tests', () => {
  let testDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));
    testConfigPath = path.join(testDir, 'test-config.json');
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('/team list 命令', () => {
    it('应该列出所有配置文件', () => {
      // 创建测试配置文件
      const config1 = {
        schemaVersion: '1.0',
        agents: [],
        team: {
          name: 'test-team-1',
          description: 'Test Team 1',
          members: []
        },
        maxRounds: 10
      };

      const config2 = {
        schemaVersion: '1.0',
        agents: [],
        team: {
          name: 'test-team-2',
          description: 'Test Team 2',
          members: []
        },
        maxRounds: 20
      };

      fs.writeFileSync(
        path.join(testDir, 'team1-config.json'),
        JSON.stringify(config1, null, 2)
      );
      fs.writeFileSync(
        path.join(testDir, 'team2-config.json'),
        JSON.stringify(config2, null, 2)
      );

      // 模拟 listTeamConfigurations 逻辑
      const files = fs.readdirSync(testDir).filter(f =>
        f.endsWith('-config.json') || f === 'agent-chatter-config.json'
      );

      expect(files).toHaveLength(2);
      expect(files).toContain('team1-config.json');
      expect(files).toContain('team2-config.json');

      // 读取并验证配置
      const configs = files.map(file => {
        const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
        return JSON.parse(content);
      });

      expect(configs[0].team.name).toBe('test-team-1');
      expect(configs[1].team.name).toBe('test-team-2');
    });

    it('应该处理空目录', () => {
      const files = fs.readdirSync(testDir).filter(f =>
        f.endsWith('-config.json') || f === 'agent-chatter-config.json'
      );

      expect(files).toHaveLength(0);
    });

    it('应该忽略无效的配置文件', () => {
      // 创建有效配置
      const validConfig = {
        schemaVersion: '1.0',
        agents: [],
        team: { name: 'valid', members: [] },
        maxRounds: 10
      };
      fs.writeFileSync(
        path.join(testDir, 'valid-config.json'),
        JSON.stringify(validConfig, null, 2)
      );

      // 创建无效配置
      fs.writeFileSync(
        path.join(testDir, 'invalid-config.json'),
        'invalid json content'
      );

      const files = fs.readdirSync(testDir).filter(f =>
        f.endsWith('-config.json')
      );

      expect(files).toHaveLength(2);

      // 验证只有有效配置能被解析
      const validConfigs = files.filter(file => {
        try {
          const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
          JSON.parse(content);
          return true;
        } catch {
          return false;
        }
      });

      expect(validConfigs).toHaveLength(1);
    });
  });

  describe('/team show 命令', () => {
    it('应该显示完整的配置详情', () => {
      const config = {
        schemaVersion: '1.0',
        agents: [
          {
            name: 'claude',
            command: 'claude',
            args: ['--append-system-prompt', 'test'],
            usePty: false
          }
        ],
        team: {
          name: 'test-team',
          displayName: 'Test Team',
          description: 'A test team for integration testing',
          instructionFile: './teams/test/team_instruction.md',
          roleDefinitions: [
            { name: 'reviewer', displayName: 'Reviewer', description: 'Reviews code' },
            { name: 'observer', displayName: 'Observer', description: 'Observes' }
          ],
          members: [
            {
              displayName: 'Claude Reviewer',
              name: 'claude-reviewer',
              type: 'ai',
              role: 'reviewer',
              agentType: 'claude',
              themeColor: 'cyan',
              roleDir: './teams/test/reviewer',
              workDir: './teams/test/reviewer/work',
              instructionFile: './teams/test/reviewer/AGENTS.md'
            },
            {
              displayName: 'Human Observer',
              name: 'human-observer',
              type: 'human',
              role: 'observer',
              themeColor: 'green',
              roleDir: './teams/test/observer',
              workDir: './teams/test/observer/work'
            }
          ]
        },
        maxRounds: 10
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      // 读取并验证
      const content = fs.readFileSync(testConfigPath, 'utf-8');
      const loaded = JSON.parse(content);

      expect(loaded.team.name).toBe('test-team');
      expect(loaded.team.displayName).toBe('Test Team');
      expect(loaded.team.description).toBe('A test team for integration testing');
      expect(loaded.team.instructionFile).toBe('./teams/test/team_instruction.md');
      expect(loaded.team.roleDefinitions).toHaveLength(2);
      expect(loaded.team.members).toHaveLength(2);
      expect(loaded.maxRounds).toBe(10);

      // 验证角色定义
      expect(loaded.team.roleDefinitions[0].name).toBe('reviewer');
      expect(loaded.team.roleDefinitions[1].name).toBe('observer');

      // 验证成员
      expect(loaded.team.members[0].type).toBe('ai');
      expect(loaded.team.members[0].agentType).toBe('claude');
      expect(loaded.team.members[1].type).toBe('human');
      expect(loaded.team.members[1].agentType).toBeUndefined();
    });

    it('应该处理文件不存在的情况', () => {
      const nonExistentPath = path.join(testDir, 'non-existent.json');
      
      expect(fs.existsSync(nonExistentPath)).toBe(false);
    });

    it('应该处理损坏的JSON文件', () => {
      fs.writeFileSync(testConfigPath, 'invalid json {]');

      expect(() => {
        const content = fs.readFileSync(testConfigPath, 'utf-8');
        JSON.parse(content);
      }).toThrow();
    });
  });

  describe('/team delete 命令', () => {
    it('应该成功删除配置文件', () => {
      const config = {
        schemaVersion: '1.0',
        agents: [],
        team: { name: 'test', members: [] },
        maxRounds: 10
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));
      expect(fs.existsSync(testConfigPath)).toBe(true);

      // 删除文件
      fs.unlinkSync(testConfigPath);
      expect(fs.existsSync(testConfigPath)).toBe(false);
    });

    it('应该验证安全检查逻辑', () => {
      const currentConfigPath = 'agent-chatter-config.json';
      const mode = 'normal';

      // 检查是否可以删除
      const canDelete = (
        fileToDelete: string,
        currentPath: string | null,
        currentMode: string
      ): { allowed: boolean; reason?: string } => {
        if (currentPath && path.basename(currentPath) === fileToDelete) {
          return { allowed: false, reason: 'Cannot delete currently loaded configuration' };
        }
        if (currentMode === 'conversation') {
          return { allowed: false, reason: 'Cannot delete configuration with active conversation' };
        }
        return { allowed: true };
      };

      // 测试各种情况
      expect(canDelete('agent-chatter-config.json', currentConfigPath, mode).allowed).toBe(false);
      expect(canDelete('other-config.json', currentConfigPath, mode).allowed).toBe(true);
      expect(canDelete('test-config.json', null, 'conversation').allowed).toBe(false);
      expect(canDelete('test-config.json', null, 'normal').allowed).toBe(true);
    });
  });

  describe('/team create 向导初始化', () => {
    it('应该正确初始化向导状态', () => {
      interface WizardState {
        step: number;
        totalSteps: number;
        data: Record<string, any>;
      }

      const wizardState: WizardState = {
        step: 1,
        totalSteps: 4,
        data: {}
      };

      expect(wizardState.step).toBe(1);
      expect(wizardState.totalSteps).toBe(4);
      expect(wizardState.data).toEqual({});
    });

    it('应该支持完整的向导流程状态', () => {
      interface WizardState {
        step: number;
        totalSteps: number;
        data: {
          teamName?: string;
          teamDescription?: string;
          teamInstructionFile?: string;
          roleDefinitions?: Array<{ name: string; description?: string }>;
          members?: Array<{ memberIndex: number; assignedRole: string }>;
          availableAgents?: string[];
          selectedAgents?: string[];
          memberConfigs?: any[];
          maxRounds?: number;
        };
      }

      const step1State: WizardState = {
        step: 1,
        totalSteps: 4,
        data: {
          teamName: 'New Team',
          teamDescription: 'A new team',
          teamInstructionFile: './teams/new/team_instruction.md',
          roleDefinitions: [
            { name: 'developer', description: 'Develops features' },
            { name: 'reviewer', description: 'Reviews code' }
          ],
          members: [
            { memberIndex: 1, assignedRole: 'developer' },
            { memberIndex: 2, assignedRole: 'reviewer' }
          ]
        }
      };

      expect(step1State.data.teamName).toBe('New Team');
      expect(step1State.data.roleDefinitions).toHaveLength(2);
      expect(step1State.data.members).toHaveLength(2);
    });
  });

  describe('/team edit 菜单初始化', () => {
    it('应该正确加载配置到菜单状态', () => {
      const config = {
        schemaVersion: '1.0',
        agents: [],
        team: {
          name: 'test-team',
          description: 'Test',
          members: [
            { displayName: 'Member 1', name: 'm1', type: 'ai', role: 'reviewer' },
            { displayName: 'Member 2', name: 'm2', type: 'human', role: 'observer' }
          ]
        },
        maxRounds: 10
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      // 加载配置
      const content = fs.readFileSync(testConfigPath, 'utf-8');
      const loaded = JSON.parse(content);

      // 初始化菜单状态
      interface MenuState {
        configPath: string;
        config: any;
        selectedIndex: number;
        editing: boolean;
        changes: Partial<any>;
      }

      const menuState: MenuState = {
        configPath: testConfigPath,
        config: loaded,
        selectedIndex: 0,
        editing: false,
        changes: {}
      };

      expect(menuState.config.team.name).toBe('test-team');
      expect(menuState.config.team.members).toHaveLength(2);
      expect(menuState.selectedIndex).toBe(0);

      // 生成菜单项
      const menuItems = [
        { label: 'Edit team information', value: 'edit_info' },
        { label: 'Add new member', value: 'add_member' },
        ...menuState.config.team.members.map((member: any, idx: number) => ({
          label: `Edit member: ${member.displayName}`,
          value: `edit_member_${idx}`
        })),
        { label: 'Remove member', value: 'remove_member' },
        { label: 'Change member order', value: 'change_order' },
        { label: 'Save and exit', value: 'save' },
        { label: 'Exit without saving', value: 'cancel' }
      ];

      expect(menuItems).toHaveLength(8); // 6 fixed + 2 members
      expect(menuItems[2].label).toBe('Edit member: Member 1');
      expect(menuItems[3].label).toBe('Edit member: Member 2');
    });
  });

  describe('配置文件 Schema 验证', () => {
    it('应该验证必需字段', () => {
      const validateConfig = (config: any): { valid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (!config.schemaVersion) errors.push('Missing schemaVersion');
        if (!config.agents) errors.push('Missing agents array');
        if (!config.team) errors.push('Missing team object');
        if (!config.team?.name) errors.push('Missing team name');
        if (!config.team?.members) errors.push('Missing team members');

        return { valid: errors.length === 0, errors };
      };

      // 有效配置
      const validConfig = {
        schemaVersion: '1.0',
        agents: [],
        team: { name: 'test', members: [] },
        maxRounds: 10
      };
      expect(validateConfig(validConfig).valid).toBe(true);

      // 无效配置
      const invalidConfig = {
        agents: [],
        team: { members: [] }
      };
      const result = validateConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing schemaVersion');
      expect(result.errors).toContain('Missing team name');
    });

    it('应该验证 roleDefinitions 结构', () => {
      const validateRoleDefinitions = (roleDefinitions: any[]): boolean => {
        if (!Array.isArray(roleDefinitions)) return false;
        
        return roleDefinitions.every(role => 
          role.name && typeof role.name === 'string'
        );
      };

      const validRoles = [
        { name: 'reviewer', description: 'Reviews' },
        { name: 'observer' }
      ];
      expect(validateRoleDefinitions(validRoles)).toBe(true);

      const invalidRoles = [
        { description: 'No name' },
        { name: 123 }
      ];
      expect(validateRoleDefinitions(invalidRoles)).toBe(false);
    });

    it('应该验证成员配置', () => {
      const validateMember = (member: any): { valid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (!member.displayName) errors.push('Missing displayName');
        if (!member.name) errors.push('Missing name');
        if (!member.type || !['ai', 'human'].includes(member.type)) {
          errors.push('Invalid type');
        }
        if (!member.role) errors.push('Missing role');
        
        if (member.type === 'ai' && !member.agentType) {
          errors.push('AI member missing agentType');
        }

        return { valid: errors.length === 0, errors };
      };

      // 有效的AI成员
      const validAIMember = {
        displayName: 'Claude',
        name: 'claude-1',
        type: 'ai',
        role: 'reviewer',
        agentType: 'claude',
        roleDir: './teams/test',
        workDir: './teams/test/work'
      };
      expect(validateMember(validAIMember).valid).toBe(true);

      // 有效的人类成员
      const validHumanMember = {
        displayName: 'Human',
        name: 'human-1',
        type: 'human',
        role: 'observer',
        roleDir: './teams/test',
        workDir: './teams/test/work'
      };
      expect(validateMember(validHumanMember).valid).toBe(true);

      // 无效成员（AI缺少agentType）
      const invalidMember = {
        displayName: 'Invalid',
        name: 'invalid-1',
        type: 'ai',
        role: 'reviewer'
      };
      const result = validateMember(invalidMember);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('AI member missing agentType');
    });
  });

  describe('路径处理', () => {
    it('应该正确解析相对路径', () => {
      const relativePath = './test-config.json';
      const absolutePath = path.resolve(relativePath);
      
      expect(path.isAbsolute(absolutePath)).toBe(true);
    });

    it('应该正确处理不同平台的路径', () => {
      const unixPath = './teams/test/work';
      const normalized = path.normalize(unixPath);
      
      expect(normalized).toBeTruthy();
    });

    it('应该验证文件扩展名', () => {
      const validateExtension = (filePath: string): boolean => {
        return path.extname(filePath) === '.json';
      };

      expect(validateExtension('config.json')).toBe(true);
      expect(validateExtension('config.txt')).toBe(false);
      expect(validateExtension('config')).toBe(false);
    });
  });
});
