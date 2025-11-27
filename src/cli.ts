#!/usr/bin/env node

/**
 * Agent Chatter - CLI 应用入口
 *
 * 让多个 CLI AI agents 自动对话的命令行工具
 */

import { Command, CommanderError } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { detectAllTools } from './utils/ToolDetector.js';
import type { ToolStatus } from './utils/ToolDetector.js';
import { startReplInk } from './repl/ReplModeInk.js';
import type { CLIConfig } from './models/CLIConfig.js';
import { createAgentsCommand } from './commands/AgentsCommand.js';
import { ConsoleOutput } from './outputs/ConsoleOutput.js';
import type { IOutput } from './outputs/IOutput.js';
import {
  getTeamConfigDir,
  ensureTeamConfigDir,
  resolveTeamConfigPath,
  formatMissingConfigError
} from './utils/TeamConfigPaths.js';
import { colorize } from './utils/colors.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

const program = new Command();

/**
 * 显示工具状态
 */
function displayToolStatus(tools: ToolStatus[], output: IOutput, showHeader: boolean = true): void {
    if (showHeader) {
        output.separator();
        output.info('=== AI CLI 工具检测 ===');
    }

    const installed: ToolStatus[] = [];
    const notInstalled: ToolStatus[] = [];

    tools.forEach(tool => {
        if (tool.installed) {
            installed.push(tool);
        } else {
            notInstalled.push(tool);
        }
    });

    if (installed.length > 0) {
        output.success('✓ 已安装的工具:');
        installed.forEach(tool => {
            const version = tool.version ? ` (v${tool.version})` : '';
            output.info(`  ● ${tool.displayName}${version}`);
        });
        output.separator();
    }

    if (notInstalled.length > 0) {
        output.warn('✗ 未安装的工具:');
        notInstalled.forEach(tool => {
            output.info(`  ○ ${tool.displayName}`);
            if (tool.installHint) {
                output.info(`    安装方式: ${tool.installHint}`);
            }
        });
        output.separator();
    }

    if (installed.length === 0) {
        output.warn('⚠ 警告: 没有检测到任何 AI CLI 工具');
        output.warn('  请先安装至少一个 AI CLI 工具才能使用 Agent Chatter');
    }
}

/**
 * 加载配置文件
 */
function loadConfig(configPath: string): CLIConfig {
    const readConfig = (file: string): CLIConfig => {
        const content = fs.readFileSync(file, 'utf-8');
        const config = JSON.parse(content);

        // Apply conversation config defaults
        if (!config.conversation) {
            config.conversation = {};
        }
        if (config.conversation.maxAgentResponseTime === undefined) {
            config.conversation.maxAgentResponseTime = 1800000;  // 30 minutes
        }
        if (config.conversation.showThinkingTimer === undefined) {
            config.conversation.showThinkingTimer = true;
        }
        if (config.conversation.allowEscCancel === undefined) {
            config.conversation.allowEscCancel = true;
        }

        return config;
    };

    const resolution = resolveTeamConfigPath(configPath);

    if (!resolution.exists) {
        throw new Error(formatMissingConfigError(configPath, resolution));
    }

    if (resolution.warning) {
        console.warn(colorize(`Warning: ${resolution.warning}`, 'yellow'));
    }

    return readConfig(resolution.path);
}

/**
 * 主程序
 */
program
    .name('agent-chatter')
    .description('让多个 CLI AI agents 自动对话的命令行工具')
    .version(VERSION)
    .option('--registry <path>', 'Custom agent registry path (default: ~/.agent-chatter/agents/config.json)')
    .action(async (options) => {
        // 当没有子命令时，启动REPL模式
        startReplInk(options.registry);
    });

// Note: 'start' subcommand removed per design decision.
// Use REPL mode with /team deploy to start conversations.

program
    .command('config-example')
    .description('生成示例配置文件')
    .option('-o, --output <path>', '输出文件路径', 'agent-chatter-config.json')
    .action((options) => {
        const exampleConfig: CLIConfig = {
            schemaVersion: '1.1',
            agents: [
                {
                    name: 'claude',
                    // Schema 1.1: No 'command' field - agent must be registered in global registry
                    // Run: agent-chatter agents register claude
                    args: ['--output-format=stream-json', '--verbose'],
                    usePty: false
                }
            ],
            team: {
                name: 'claude-code-test-team',
                displayName: 'Claude Code Test Team',
                description: 'A team with Claude Code CLI agent and human observer',
                instructionFile: './teams/claude-code-test/team_instruction.md',
                roleDefinitions: [
                    {
                        name: 'reviewer',
                        displayName: 'Reviewer',
                        description: 'AI reviewer that inspects the code'
                    },
                    {
                        name: 'observer',
                        displayName: 'Observer',
                        description: 'Human observer who can join the conversation when needed'
                    }
                ],
                members: [
                    {
                        displayName: 'Claude Reviewer',
                        displayRole: 'AI Reviewer',
                        name: 'claude-reviewer',
                        type: 'ai',
                        role: 'reviewer',
                        agentType: 'claude',
                        themeColor: 'cyan',
                        baseDir: './teams/claude-code-test/reviewer/claude-reviewer',
                        instructionFile: './teams/claude-code-test/reviewer/claude-reviewer/AGENTS.md'
                    },
                    {
                        displayName: 'Human Observer',
                        displayRole: 'Observer',
                        name: 'observer-1',
                        type: 'human',
                        role: 'observer',
                        themeColor: 'green',
                        baseDir: './teams/claude-code-test/observer/human-observer',
                        instructionFile: './teams/claude-code-test/observer/human-observer/README.md'
                    }
                ]
            },
            maxRounds: 10
        };

        // Ensure team config directory exists
        ensureTeamConfigDir();

        // Resolve output path relative to team config directory
        const outputPath = path.isAbsolute(options.output)
            ? options.output
            : path.join(getTeamConfigDir(), options.output);

        fs.writeFileSync(outputPath, JSON.stringify(exampleConfig, null, 2));
        console.log(colorize(`示例配置文件已生成: ${outputPath}`, 'green'));
    });

program
    .command('status')
    .description('检测系统中已安装的 AI CLI 工具')
    .action(async () => {
        const output = new ConsoleOutput({ colors: true, verbose: true });
        output.progress('正在检测系统中的 AI CLI 工具...');
        const tools = await detectAllTools();
        displayToolStatus(tools, output, true);

        output.info('提示:');
        output.info('  - 直接运行 agent-chatter 启动 REPL 模式');
        output.info('  - 在 REPL 中使用 /team deploy <name> 部署团队后直接输入消息');
        output.info('  - 使用 agent-chatter config-example 生成示例配置文件');
    });

// 添加 agents 命令
program.addCommand(createAgentsCommand());

program.exitOverride();

export async function run(argv: string[]): Promise<void> {
    const fallbackOutput = new ConsoleOutput({ colors: true, verbose: true });
    try {
        await program.parseAsync(argv);
    } catch (err: unknown) {
        if (err instanceof CommanderError) {
            if (err.code === 'commander.helpDisplayed') {
                process.exitCode = 0;
                return;
            }
            if (err.code === 'commander.version') {
                process.exitCode = 0;
                return;
            }
            process.exitCode = err.exitCode ?? 1;
            fallbackOutput.error(err.message);
            return;
        }
        fallbackOutput.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}

const invokedAsEntry = (() => {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    try {
        const resolvedArgv = fs.realpathSync(path.resolve(argvPath));
        const resolvedFile = fs.realpathSync(__filename);
        return resolvedArgv === resolvedFile;
    } catch {
        return false;
    }
})();

if (invokedAsEntry) {
    void run(process.argv);
}
