/**
 * CLI Config Loading 集成测试
 * 测试CLI通过实际命令执行来加载配置文件的行为
 *
 * This test uses the real CLI to verify config loading behavior
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe.sequential('CLI Config Loading Integration Tests', () => {
    let testDir: string;
    let originalCwd: string;
    const CLI_PATH = path.join(__dirname, '..', '..', '..', 'out', 'cli.js');

    beforeEach(() => {
        originalCwd = process.cwd();
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-config-test-'));
        process.chdir(testDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    // Helper to create a valid test config
    const createTestConfig = (name: string, location: 'team-config' | 'legacy') => {
        const config = {
            schemaVersion: '1.1',
            agents: [],
            team: { name, members: [] },
            maxRounds: 10
        };

        let configPath: string;
        if (location === 'team-config') {
            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            fs.mkdirSync(teamConfigDir, { recursive: true });
            configPath = path.join(teamConfigDir, 'test-config.json');
        } else {
            configPath = path.join(testDir, 'test-config.json');
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return configPath;
    };

    describe('Config file resolution', () => {
        it('should load config from team config directory', () => {
            createTestConfig('new-location-team', 'team-config');

            // The config-example command should create files in the team config directory
            const result = execSync(`node "${CLI_PATH}" config-example`, {
                cwd: testDir,
                encoding: 'utf-8'
            });

            expect(result).toContain('.agent-chatter/team-config');

            // Verify the file was created in the right place
            const configPath = path.join(testDir, '.agent-chatter', 'team-config', 'agent-chatter-config.json');
            expect(fs.existsSync(configPath)).toBe(true);
        });

        it('should support custom filename in team config directory', () => {
            const result = execSync(`node "${CLI_PATH}" config-example -o my-custom-config.json`, {
                cwd: testDir,
                encoding: 'utf-8'
            });

            expect(result).toContain('my-custom-config.json');

            const configPath = path.join(testDir, '.agent-chatter', 'team-config', 'my-custom-config.json');
            expect(fs.existsSync(configPath)).toBe(true);

            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);
            expect(config.schemaVersion).toBe('1.1');
        });

        it('should create nested directories automatically', () => {
            const agentChatterDir = path.join(testDir, '.agent-chatter');
            const teamConfigDir = path.join(agentChatterDir, 'team-config');

            expect(fs.existsSync(agentChatterDir)).toBe(false);
            expect(fs.existsSync(teamConfigDir)).toBe(false);

            execSync(`node "${CLI_PATH}" config-example`, { cwd: testDir });

            expect(fs.existsSync(agentChatterDir)).toBe(true);
            expect(fs.existsSync(teamConfigDir)).toBe(true);
        });
    });

    describe('Config validation', () => {
        it('should create valid config structure', () => {
            execSync(`node "${CLI_PATH}" config-example`, { cwd: testDir });

            const configPath = path.join(testDir, '.agent-chatter', 'team-config', 'agent-chatter-config.json');
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config).toHaveProperty('schemaVersion');
            expect(config).toHaveProperty('agents');
            expect(config).toHaveProperty('team');
            expect(config).toHaveProperty('maxRounds');
            expect(config.schemaVersion).toBe('1.1');
            expect(Array.isArray(config.agents)).toBe(true);
            expect(config.team).toHaveProperty('name');
            expect(config.team).toHaveProperty('members');
        });
    });

    describe('Multiple configs', () => {
        it('should support multiple config files', () => {
            execSync(`node "${CLI_PATH}" config-example -o config1.json`, { cwd: testDir });
            execSync(`node "${CLI_PATH}" config-example -o config2.json`, { cwd: testDir });
            execSync(`node "${CLI_PATH}" config-example -o config3.json`, { cwd: testDir });

            const teamConfigDir = path.join(testDir, '.agent-chatter', 'team-config');
            const files = fs.readdirSync(teamConfigDir);

            expect(files).toContain('config1.json');
            expect(files).toContain('config2.json');
            expect(files).toContain('config3.json');
        });
    });
});
