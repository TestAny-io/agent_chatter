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
    formatMissingConfigError
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

        it('should fall back to legacy path if file not in team config directory', () => {
            const filename = 'legacy-config.json';
            const legacyPath = path.join(process.cwd(), filename);

            // 只在当前目录创建文件（遗留位置）
            fs.writeFileSync(legacyPath, '{}');

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(legacyPath);
            expect(result.exists).toBe(true);
            expect(result.warning).toContain('was not found');
            expect(result.warning).toContain('legacy-config.json');
            expect(result.searchedPaths).toHaveLength(2);
        });

        it('should return non-existing path with proper search paths when file not found', () => {
            const filename = 'non-existent.json';
            const teamConfigPath = path.join(getTeamConfigDir(), filename);
            const legacyPath = path.join(process.cwd(), filename);

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(teamConfigPath);
            expect(result.exists).toBe(false);
            expect(result.searchedPaths).toEqual([teamConfigPath, legacyPath]);
        });

        it('should prefer team config directory over legacy path', () => {
            const filename = 'both-locations.json';
            const teamConfigDir = getTeamConfigDir();
            const teamConfigPath = path.join(teamConfigDir, filename);
            const legacyPath = path.join(process.cwd(), filename);

            // 在两个位置都创建文件
            fs.mkdirSync(teamConfigDir, { recursive: true });
            fs.writeFileSync(teamConfigPath, JSON.stringify({ location: 'new' }));
            fs.writeFileSync(legacyPath, JSON.stringify({ location: 'legacy' }));

            const result = resolveTeamConfigPath(filename);
            expect(result.path).toBe(teamConfigPath);
            expect(result.exists).toBe(true);
            expect(result.warning).toBeUndefined();
            expect(result.searchedPaths).toEqual([teamConfigPath]);

            // Verify it actually reads from the new location
            const content = fs.readFileSync(result.path, 'utf-8');
            const config = JSON.parse(content);
            expect(config.location).toBe('new');
        });
    });

    describe('formatMissingConfigError', () => {
        it('should format error for single search path', () => {
            const filename = 'test.json';
            const resolution = {
                path: '/path/to/test.json',
                exists: false,
                searchedPaths: ['/path/to/test.json']
            };

            const result = formatMissingConfigError(filename, resolution);
            expect(result).toBe('Error: Configuration file not found: /path/to/test.json');
        });

        it('should format error for multiple search paths', () => {
            const filename = 'test.json';
            const resolution = {
                path: '/new/path/test.json',
                exists: false,
                searchedPaths: ['/new/path/test.json', '/legacy/path/test.json']
            };

            const result = formatMissingConfigError(filename, resolution);
            expect(result).toContain('Error: Configuration "test.json" was not found.');
            expect(result).toContain('Checked:');
            expect(result).toContain('  - /new/path/test.json');
            expect(result).toContain('  - /legacy/path/test.json');
        });
    });
});
