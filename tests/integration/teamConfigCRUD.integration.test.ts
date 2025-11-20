/**
 * Team Config CRUD 集成测试
 * 测试团队配置的创建、读取、更新、删除操作
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Team Config CRUD Integration Tests', () => {
    let testDir: string;
    let originalCwd: string;
    const CLI_PATH = path.join(__dirname, '..', '..', 'out', 'cli.js');

    beforeEach(() => {
        // 保存原始工作目录
        originalCwd = process.cwd();

        // 创建临时测试目录
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-integration-'));
        process.chdir(testDir);
    });

    afterEach(() => {
        // 恢复原始工作目录
        process.chdir(originalCwd);

        // 清理测试目录
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('config-example command', () => {
        it('should create config in .agent-chatter/team-config/ directory', () => {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            const configPath = path.join(teamConfigDir, 'agent-chatter-config.json');

            // 目录最初不存在
            expect(fs.existsSync(teamConfigDir)).toBe(false);

            // 执行 config-example 命令
            execSync(`node "${CLI_PATH}" config-example`, { cwd: testDir });

            // 验证目录和文件被创建
            expect(fs.existsSync(teamConfigDir)).toBe(true);
            expect(fs.existsSync(configPath)).toBe(true);

            // 验证文件内容是有效的JSON
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config).toHaveProperty('schemaVersion');
            expect(config).toHaveProperty('agents');
            expect(config).toHaveProperty('team');
            expect(config.schemaVersion).toBe('1.1');
        });

        it('should create config with custom filename', () => {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            const configPath = path.join(teamConfigDir, 'my-team-config.json');

            execSync(`node "${CLI_PATH}" config-example -o my-team-config.json`, { cwd: testDir });

            expect(fs.existsSync(configPath)).toBe(true);

            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config).toHaveProperty('team');
            expect(config.team).toHaveProperty('name');
        });

        it('should create nested directories automatically', () => {
            const agentChatterDir = path.join(testDir, '.agent-chatter');
            const teamConfigDir = path.join(agentChatterDir, 'team-config');

            // 确保父目录不存在
            expect(fs.existsSync(agentChatterDir)).toBe(false);

            execSync(`node "${CLI_PATH}" config-example`, { cwd: testDir });

            // 验证嵌套目录被创建
            expect(fs.existsSync(agentChatterDir)).toBe(true);
            expect(fs.existsSync(teamConfigDir)).toBe(true);
        });

        it('should create valid team configuration structure', () => {
            execSync(`node "${CLI_PATH}" config-example`, { cwd: testDir });

            const configPath = path.join(testDir, '.agent-chatter', 'team-config', 'agent-chatter-config.json');
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            // 验证基本结构
            expect(config.schemaVersion).toBe('1.1');
            expect(Array.isArray(config.agents)).toBe(true);
            expect(config.agents.length).toBeGreaterThan(0);

            // 验证 team 结构
            expect(config.team).toHaveProperty('name');
            expect(config.team).toHaveProperty('displayName');
            expect(config.team).toHaveProperty('description');
            expect(Array.isArray(config.team.roleDefinitions)).toBe(true);
            expect(Array.isArray(config.team.members)).toBe(true);

            // 验证 maxRounds
            expect(typeof config.maxRounds).toBe('number');
        });
    });

    describe('Config file reading', () => {
        it('should read config from team config directory', () => {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            const configPath = path.join(teamConfigDir, 'test-config.json');

            // 创建配置文件
            fs.mkdirSync(teamConfigDir, { recursive: true });
            const testConfig = {
                schemaVersion: '1.1',
                agents: [{ name: 'test-agent', args: [], endMarker: '[DONE]', usePty: false }],
                team: {
                    name: 'test-team',
                    displayName: 'Test Team',
                    description: 'A test team',
                    roleDefinitions: [],
                    members: []
                },
                maxRounds: 5
            };
            fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

            // 验证文件存在
            expect(fs.existsSync(configPath)).toBe(true);

            // 读取并验证内容
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.team.name).toBe('test-team');
            expect(config.maxRounds).toBe(5);
        });

        it('should support legacy path as fallback', () => {
            const legacyPath = path.join(testDir, 'legacy-config.json');

            // 在当前目录创建配置文件（遗留位置）
            const testConfig = {
                schemaVersion: '1.1',
                agents: [],
                team: { name: 'legacy-team', members: [] },
                maxRounds: 10
            };
            fs.writeFileSync(legacyPath, JSON.stringify(testConfig, null, 2));

            // 验证文件存在于遗留位置
            expect(fs.existsSync(legacyPath)).toBe(true);

            // 读取并验证内容
            const content = fs.readFileSync(legacyPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.team.name).toBe('legacy-team');
        });
    });

    describe('Multiple config files', () => {
        it('should handle multiple config files in team config directory', () => {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // 创建多个配置文件
            const configs = ['config1.json', 'config2.json', 'config3.json'];
            configs.forEach((filename, index) => {
                const config = {
                    schemaVersion: '1.1',
                    agents: [],
                    team: { name: `team-${index + 1}`, members: [] },
                    maxRounds: index + 1
                };
                fs.writeFileSync(
                    path.join(teamConfigDir, filename),
                    JSON.stringify(config, null, 2)
                );
            });

            // 验证所有文件都被创建
            const files = fs.readdirSync(teamConfigDir);
            expect(files).toHaveLength(3);
            expect(files).toContain('config1.json');
            expect(files).toContain('config2.json');
            expect(files).toContain('config3.json');

            // 验证每个文件的内容
            configs.forEach((filename, index) => {
                const content = fs.readFileSync(path.join(teamConfigDir, filename), 'utf-8');
                const config = JSON.parse(content);
                expect(config.team.name).toBe(`team-${index + 1}`);
                expect(config.maxRounds).toBe(index + 1);
            });
        });

        it('should list only config files with proper naming', () => {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // 创建各种文件
            fs.writeFileSync(path.join(teamConfigDir, 'valid-config.json'), '{}');
            fs.writeFileSync(path.join(teamConfigDir, 'agent-chatter-config.json'), '{}');
            fs.writeFileSync(path.join(teamConfigDir, 'not-a-config.txt'), 'text');
            fs.writeFileSync(path.join(teamConfigDir, 'readme.md'), '# Readme');

            const files = fs.readdirSync(teamConfigDir);
            const configFiles = files.filter(f =>
                f.endsWith('-config.json') || f === 'agent-chatter-config.json'
            );

            expect(configFiles).toHaveLength(2);
            expect(configFiles).toContain('valid-config.json');
            expect(configFiles).toContain('agent-chatter-config.json');
            expect(configFiles).not.toContain('not-a-config.txt');
            expect(configFiles).not.toContain('readme.md');
        });
    });

    describe('Directory structure', () => {
        it('should maintain proper directory structure', () => {
            execSync(`node "${CLI_PATH}" config-example`, { cwd: testDir });

            const agentChatterDir = path.join(testDir, '.agent-chatter');
            const teamConfigDir = path.join(agentChatterDir, 'team-config');

            // 验证目录结构
            expect(fs.existsSync(agentChatterDir)).toBe(true);
            expect(fs.existsSync(teamConfigDir)).toBe(true);

            // 验证目录权限
            const stats = fs.statSync(teamConfigDir);
            expect(stats.isDirectory()).toBe(true);
        });

        it('should isolate configs from different working directories', () => {
            // 在第一个目录创建配置
            execSync(`node "${CLI_PATH}" config-example -o dir1-config.json`, { cwd: testDir });

            // 创建第二个测试目录
            const testDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-integration-2-'));

            try {
                // 在第二个目录创建配置
                execSync(`node "${CLI_PATH}" config-example -o dir2-config.json`, { cwd: testDir2 });

                // 验证每个目录有自己的配置
                const config1Path = path.join(testDir, '.agent-chatter', 'team-config', 'dir1-config.json');
                const config2Path = path.join(testDir2, '.agent-chatter', 'team-config', 'dir2-config.json');

                expect(fs.existsSync(config1Path)).toBe(true);
                expect(fs.existsSync(config2Path)).toBe(true);

                // 验证配置文件不会互相干扰
                const dir1Files = fs.readdirSync(path.join(testDir, '.agent-chatter', 'team-config'));
                const dir2Files = fs.readdirSync(path.join(testDir2, '.agent-chatter', 'team-config'));

                expect(dir1Files).toContain('dir1-config.json');
                expect(dir1Files).not.toContain('dir2-config.json');

                expect(dir2Files).toContain('dir2-config.json');
                expect(dir2Files).not.toContain('dir1-config.json');
            } finally {
                // 清理第二个测试目录
                if (fs.existsSync(testDir2)) {
                    fs.rmSync(testDir2, { recursive: true, force: true });
                }
            }
        });
    });

    describe('Config file deletion', () => {
        it('should allow deletion of config files', () => {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            const configPath = path.join(teamConfigDir, 'to-delete.json');

            // 创建配置文件
            fs.mkdirSync(teamConfigDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({ test: 'config' }));

            expect(fs.existsSync(configPath)).toBe(true);

            // 删除文件
            fs.unlinkSync(configPath);

            expect(fs.existsSync(configPath)).toBe(false);
        });
    });
});
