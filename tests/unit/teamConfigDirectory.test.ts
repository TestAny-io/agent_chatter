/**
 * Team Config Directory 单元测试
 * 测试团队配置目录的helper函数和路径解析逻辑
 *
 * IMPORTANT: This test imports and tests the REAL implementation from src/utils/TeamConfigPaths.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    getTeamConfigDir,
    ensureTeamConfigDir,
    resolveTeamConfigPath,
    formatMissingConfigError,
    discoverTeamConfigs
} from '../../src/utils/TeamConfigPaths.js';

describe('Team Config Directory Functions', () => {
    let testDir: string;
    let originalCwd: string;

    beforeEach(() => {
        // 保存原始工作目录
        originalCwd = process.cwd();

        // 创建临时测试目录
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));
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

    describe('getTeamConfigDir', () => {
        it('should return correct team config directory path', () => {
            const expectedPath = path.join(process.cwd(), '.agent-chatter', 'team-config');
            expect(getTeamConfigDir()).toBe(expectedPath);
        });

        it('should return path relative to current working directory', () => {
            const result = getTeamConfigDir();
            expect(result).toContain('.agent-chatter');
            expect(result).toContain('team-config');
            expect(path.isAbsolute(result)).toBe(true);
        });
    });

    describe('ensureTeamConfigDir', () => {
        it('should create directory if it does not exist', () => {
            const teamConfigDir = getTeamConfigDir();

            expect(fs.existsSync(teamConfigDir)).toBe(false);

            ensureTeamConfigDir();

            expect(fs.existsSync(teamConfigDir)).toBe(true);
        });

        it('should not error if directory already exists', () => {
            const teamConfigDir = getTeamConfigDir();

            // 第一次创建
            ensureTeamConfigDir();
            expect(fs.existsSync(teamConfigDir)).toBe(true);

            // 第二次调用应该不会报错
            expect(() => ensureTeamConfigDir()).not.toThrow();
        });

        it('should create nested directories recursively', () => {
            const teamConfigDir = getTeamConfigDir();
            const parentDir = path.join(process.cwd(), '.agent-chatter');

            expect(fs.existsSync(parentDir)).toBe(false);
            expect(fs.existsSync(teamConfigDir)).toBe(false);

            ensureTeamConfigDir();

            expect(fs.existsSync(parentDir)).toBe(true);
            expect(fs.existsSync(teamConfigDir)).toBe(true);
        });
    });

    describe('resolveTeamConfigPath', () => {
        it('should return absolute path as-is', () => {
            const absolutePath = '/absolute/path/to/config.json';

            const result = resolveTeamConfigPath(absolutePath);
            expect(result.path).toBe(absolutePath);
            expect(result.exists).toBe(false);
            expect(result.searchedPaths).toEqual([absolutePath]);
        });

        it('should find file in team config directory', () => {
            const filename = 'test-config.json';
            const teamConfigDir = getTeamConfigDir();
            const teamConfigPath = path.join(teamConfigDir, filename);

            // 创建目录和文件
            fs.mkdirSync(teamConfigDir, { recursive: true });
            fs.writeFileSync(teamConfigPath, '{}');

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(teamConfigPath);
            expect(result.exists).toBe(true);
            expect(result.searchedPaths).toEqual([teamConfigPath]);
            expect(result.warning).toBeUndefined();
        });

        it('should NOT find file in root directory (legacy path removed)', () => {
            const filename = 'legacy-config.json';
            const rootPath = path.join(process.cwd(), filename);
            const teamConfigPath = path.join(getTeamConfigDir(), filename);

            // Create file ONLY in root directory (legacy location)
            fs.writeFileSync(rootPath, '{}');

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(teamConfigPath); // Should look in team-config
            expect(result.exists).toBe(false); // Should NOT find it
            expect(result.searchedPaths).toEqual([teamConfigPath]); // Should only search team-config
            expect(result.warning).toBeUndefined(); // No warning
        });

        it('should return non-existing path with single search path when file not found', () => {
            const filename = 'non-existent.json';
            const teamConfigPath = path.join(getTeamConfigDir(), filename);

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(teamConfigPath);
            expect(result.exists).toBe(false);
            expect(result.searchedPaths).toEqual([teamConfigPath]);
        });

        it('should only check team config directory, not root directory', () => {
            const filename = 'both-locations.json';
            const teamConfigDir = getTeamConfigDir();
            const teamConfigPath = path.join(teamConfigDir, filename);
            const rootPath = path.join(process.cwd(), filename);

            // Create files in both locations
            fs.mkdirSync(teamConfigDir, { recursive: true });
            fs.writeFileSync(teamConfigPath, JSON.stringify({ location: 'team-config' }));
            fs.writeFileSync(rootPath, JSON.stringify({ location: 'root' }));

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(teamConfigPath);
            expect(result.exists).toBe(true);
            expect(result.searchedPaths).toEqual([teamConfigPath]);

            // Verify it reads from team-config directory
            const content = fs.readFileSync(result.path, 'utf-8');
            const config = JSON.parse(content);
            expect(config.location).toBe('team-config');
        });
    });

    describe('formatMissingConfigError', () => {
        it('should format error with expected location', () => {
            const filename = 'test.json';
            const teamConfigPath = path.join(getTeamConfigDir(), filename);
            const resolution = {
                path: teamConfigPath,
                exists: false,
                searchedPaths: [teamConfigPath]
            };

            const result = formatMissingConfigError(filename, resolution);
            expect(result).toContain('Error: Configuration file not found:');
            expect(result).toContain(teamConfigPath);
            expect(result).toContain('Expected location:');
            expect(result).toContain('.agent-chatter/team-config/');
        });

        it('should not mention root directory in error message', () => {
            const filename = 'test.json';
            const teamConfigPath = path.join(getTeamConfigDir(), filename);
            const resolution = {
                path: teamConfigPath,
                exists: false,
                searchedPaths: [teamConfigPath]
            };

            const result = formatMissingConfigError(filename, resolution);
            expect(result).not.toContain('Checked:');
            expect(result).not.toContain(process.cwd() + '/test.json');
        });
    });

    describe('discoverTeamConfigs', () => {
        const createValidTeamConfig = (overrides: any = {}) => ({
            schemaVersion: '1.2',
            team: {
                name: 'test-team',
                displayName: 'Test Team',
                description: 'A test team',
                members: [
                    {
                        name: 'alice',
                        displayName: 'Alice',
                        role: 'developer',
                        type: 'ai',
                        agentConfigId: 'claude-config',
                        order: 0
                    },
                    {
                        name: 'bob',
                        displayName: 'Bob',
                        role: 'reviewer',
                        type: 'human',
                        order: 1
                    }
                ],
                ...overrides
            }
        });

        it('should return empty array when team-config directory does not exist', () => {
            const result = discoverTeamConfigs();
            expect(result).toEqual([]);
        });

        it('should discover valid team config files', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Create a valid config file
            const config = createValidTeamConfig();
            fs.writeFileSync(
                path.join(teamConfigDir, 'my-team.json'),
                JSON.stringify(config)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(1);
            expect(result[0].filename).toBe('my-team.json');
            expect(result[0].displayName).toBe('Test Team');
            expect(result[0].teamName).toBe('test-team');
            expect(result[0].memberCount).toBe(2);
            expect(result[0].aiCount).toBe(1);
            expect(result[0].humanCount).toBe(1);
            expect(result[0].schemaVersion).toBe('1.2');
        });

        it('should use display name fallback chain: displayName → team.name → filename', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Config with displayName (highest priority)
            const config1 = createValidTeamConfig({ displayName: 'Custom Display Name' });
            fs.writeFileSync(
                path.join(teamConfigDir, 'config1.json'),
                JSON.stringify(config1)
            );

            // Config without displayName (falls back to team.name)
            const config2 = createValidTeamConfig({ displayName: undefined });
            fs.writeFileSync(
                path.join(teamConfigDir, 'config2.json'),
                JSON.stringify(config2)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(2);

            const found1 = result.find(c => c.filename === 'config1.json');
            expect(found1?.displayName).toBe('Custom Display Name');

            const found2 = result.find(c => c.filename === 'config2.json');
            expect(found2?.displayName).toBe('test-team');
        });

        it('should handle empty displayName by falling back to team.name', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Config with empty displayName (falls back to team.name)
            const config = createValidTeamConfig({ displayName: '', name: 'my-team' });
            fs.writeFileSync(
                path.join(teamConfigDir, 'test.json'),
                JSON.stringify(config)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(1);
            expect(result[0].displayName).toBe('my-team');
        });

        it('should silently skip malformed JSON files', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Create a malformed JSON file
            fs.writeFileSync(
                path.join(teamConfigDir, 'malformed.json'),
                '{ invalid json content'
            );

            // Create a valid config
            const validConfig = createValidTeamConfig();
            fs.writeFileSync(
                path.join(teamConfigDir, 'valid.json'),
                JSON.stringify(validConfig)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(1);
            expect(result[0].filename).toBe('valid.json');
        });

        it('should silently skip files failing schema validation', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Create invalid config (missing required fields)
            const invalidConfig = {
                team: {
                    // Missing name
                    members: []  // Also less than 2 members
                }
            };
            fs.writeFileSync(
                path.join(teamConfigDir, 'invalid.json'),
                JSON.stringify(invalidConfig)
            );

            // Create valid config
            const validConfig = createValidTeamConfig();
            fs.writeFileSync(
                path.join(teamConfigDir, 'valid.json'),
                JSON.stringify(validConfig)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(1);
            expect(result[0].filename).toBe('valid.json');
        });

        it('should only process .json files', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Create non-JSON file
            fs.writeFileSync(
                path.join(teamConfigDir, 'readme.txt'),
                'This is not a JSON file'
            );

            // Create valid config
            const validConfig = createValidTeamConfig();
            fs.writeFileSync(
                path.join(teamConfigDir, 'valid.json'),
                JSON.stringify(validConfig)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(1);
            expect(result[0].filename).toBe('valid.json');
        });

        it('should discover multiple valid configs with correct metadata', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            // Create team with 3 AI members
            const team1 = createValidTeamConfig({
                name: 'ai-heavy',
                displayName: 'AI Heavy Team',
                members: [
                    { name: 'ai1', role: 'dev', type: 'ai', agentConfigId: 'config1', order: 0 },
                    { name: 'ai2', role: 'dev', type: 'ai', agentConfigId: 'config2', order: 1 },
                    { name: 'ai3', role: 'dev', type: 'ai', agentConfigId: 'config3', order: 2 }
                ]
            });
            fs.writeFileSync(
                path.join(teamConfigDir, 'ai-heavy.json'),
                JSON.stringify(team1)
            );

            // Create team with 3 human members
            const team2 = createValidTeamConfig({
                name: 'human-heavy',
                displayName: 'Human Heavy Team',
                members: [
                    { name: 'h1', role: 'dev', type: 'human', order: 0 },
                    { name: 'h2', role: 'dev', type: 'human', order: 1 },
                    { name: 'h3', role: 'dev', type: 'human', order: 2 }
                ]
            });
            fs.writeFileSync(
                path.join(teamConfigDir, 'human-heavy.json'),
                JSON.stringify(team2)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(2);

            const aiTeam = result.find(c => c.filename === 'ai-heavy.json');
            expect(aiTeam?.aiCount).toBe(3);
            expect(aiTeam?.humanCount).toBe(0);
            expect(aiTeam?.memberCount).toBe(3);

            const humanTeam = result.find(c => c.filename === 'human-heavy.json');
            expect(humanTeam?.aiCount).toBe(0);
            expect(humanTeam?.humanCount).toBe(3);
            expect(humanTeam?.memberCount).toBe(3);
        });

        it('should include filepath in result', () => {
            const teamConfigDir = getTeamConfigDir();
            fs.mkdirSync(teamConfigDir, { recursive: true });

            const config = createValidTeamConfig();
            const filename = 'test.json';
            fs.writeFileSync(
                path.join(teamConfigDir, filename),
                JSON.stringify(config)
            );

            const result = discoverTeamConfigs();
            expect(result).toHaveLength(1);
            expect(result[0].filepath).toBe(path.join(teamConfigDir, filename));
        });
    });
});
