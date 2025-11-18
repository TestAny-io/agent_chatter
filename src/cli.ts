#!/usr/bin/env node

/**
 * Agent Chatter - CLI 应用入口
 *
 * 让多个 CLI AI agents 自动对话的命令行工具
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { detectAllTools } from './utils/ToolDetector.js';
import type { ToolStatus } from './utils/ToolDetector.js';
import { startReplInk } from './repl/ReplModeInk.js';
import {
  initializeServices,
  startConversation,
  type CLIConfig,
} from './utils/ConversationStarter.js';
import { createAgentsCommand } from './commands/AgentsCommand.js';

const program = new Command();

// 颜色输出辅助函数（简单版本，不依赖 chalk 避免 ESM 问题）
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
};

function colorize(text: string, color: keyof typeof colors): string {
    return `${colors[color]}${text}${colors.reset}`;
}

/**
 * 显示工具状态
 */
function displayToolStatus(tools: ToolStatus[], showHeader: boolean = true): void {
    if (showHeader) {
        console.log(colorize('\n=== AI CLI 工具检测 ===\n', 'bright'));
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
        console.log(colorize('✓ 已安装的工具:', 'green'));
        installed.forEach(tool => {
            const version = tool.version ? colorize(` (v${tool.version})`, 'dim') : '';
            console.log(`  ${colorize('●', 'green')} ${tool.displayName}${version}`);
        });
        console.log();
    }

    if (notInstalled.length > 0) {
        console.log(colorize('✗ 未安装的工具:', 'yellow'));
        notInstalled.forEach(tool => {
            console.log(`  ${colorize('○', 'dim')} ${tool.displayName}`);
            if (tool.installHint) {
                console.log(colorize(`    安装方式: ${tool.installHint}`, 'dim'));
            }
        });
        console.log();
    }

    if (installed.length === 0) {
        console.log(colorize('⚠ 警告: 没有检测到任何 AI CLI 工具', 'yellow'));
        console.log(colorize('  请先安装至少一个 AI CLI 工具才能使用 Agent Chatter\n', 'yellow'));
    }
}

/**
 * 加载配置文件
 */
function loadConfig(configPath: string): CLIConfig {
    const fullPath = path.resolve(configPath);
    if (!fs.existsSync(fullPath)) {
        console.error(colorize(`Error: Config file not found: ${fullPath}`, 'red'));
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error(colorize(`Error: Failed to parse config file: ${error}`, 'red'));
        process.exit(1);
    }
}

/**
 * 主程序
 */
program
    .name('agent-chatter')
    .description('让多个 CLI AI agents 自动对话的命令行工具')
    .version('0.0.1')
    .action(async () => {
        // 当没有子命令时，启动REPL模式
        startReplInk();
    });

program
    .command('start')
    .description('启动一次对话')
    .requiredOption('-c, --config <path>', '配置文件路径')
    .option('-m, --message <text>', '初始消息', 'Hello!')
    .option('-s, --speaker <name>', '第一个发言者的名称')
    .action(async (options) => {
        try {
            // 检测已安装的工具
            console.log(colorize('正在检测系统中的 AI CLI 工具...', 'cyan'));
            const tools = await detectAllTools();
            displayToolStatus(tools, true);

            // 加载配置
            const config = loadConfig(options.config);

            // 初始化服务
            console.log(colorize('正在初始化服务...', 'cyan'));
            const { coordinator, team } = await initializeServices(config);

            // 启动对话
            await startConversation(coordinator, team, options.message, options.speaker);

        } catch (error) {
            console.error(colorize(`Error: ${error}`, 'red'));
            process.exit(1);
        }
    });

program
    .command('config-example')
    .description('生成示例配置文件')
    .option('-o, --output <path>', '输出文件路径', 'agent-chatter-config.json')
    .action((options) => {
        const exampleConfig: CLIConfig = {
            schemaVersion: '1.0',
            agents: [
                {
                    name: 'claude',
                    command: 'claude',
                    args: [
                        '--append-system-prompt',
                        'Always end your response with the exact text [DONE] on a new line. Keep responses concise.'
                    ],
                    endMarker: '[DONE]',
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
                        roleDir: './teams/claude-code-test/reviewer/claude-reviewer',
                        workDir: './teams/claude-code-test/reviewer/claude-reviewer/work',
                        instructionFile: './teams/claude-code-test/reviewer/claude-reviewer/AGENTS.md'
                    },
                    {
                        displayName: 'Human Observer',
                        displayRole: 'Observer',
                        name: 'observer-1',
                        type: 'human',
                        role: 'observer',
                        themeColor: 'green',
                        roleDir: './teams/claude-code-test/observer/human-observer',
                        workDir: './teams/claude-code-test/observer/human-observer/work',
                        instructionFile: './teams/claude-code-test/observer/human-observer/README.md'
                    }
                ]
            },
            maxRounds: 10
        };

        fs.writeFileSync(options.output, JSON.stringify(exampleConfig, null, 2));
        console.log(colorize(`示例配置文件已生成: ${options.output}`, 'green'));
    });

program
    .command('status')
    .description('检测系统中已安装的 AI CLI 工具')
    .action(async () => {
        try {
            console.log(colorize('正在检测系统中的 AI CLI 工具...', 'cyan'));
            const tools = await detectAllTools();
            displayToolStatus(tools, true);

            console.log(colorize('提示:', 'cyan'));
            console.log('  - 使用 ' + colorize('agent-chatter start', 'bright') + ' 启动对话');
            console.log('  - 使用 ' + colorize('agent-chatter config-example', 'bright') + ' 生成示例配置文件\n');
        } catch (error) {
            console.error(colorize(`Error: ${error}`, 'red'));
            process.exit(1);
        }
    });

// 添加 agents 命令
program.addCommand(createAgentsCommand());

// 解析命令行参数
program.parse();
