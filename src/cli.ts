#!/usr/bin/env node

/**
 * Agent Chatter - CLI 应用入口
 *
 * 让多个 CLI AI agents 自动对话的命令行工具
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ConversationCoordinator } from './services/ConversationCoordinator';
import { AgentManager } from './services/AgentManager';
import { ProcessManager } from './infrastructure/ProcessManager';
import { MessageRouter } from './services/MessageRouter';
import { AgentConfigManager } from './services/AgentConfigManager';
import { TeamManager } from './services/TeamManager';
import { MockStorageService } from './infrastructure/StorageService';
import { Team } from './models/Team';
import { ConversationMessage } from './models/ConversationMessage';
import * as readline from 'readline';

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

// CLI 配置接口
interface CLIConfig {
    agents: Array<{
        name: string;
        command: string;
        args: string[];
        endMarker?: string;
        usePty?: boolean;
    }>;
    team: {
        name: string;
        description: string;
        roles: Array<{
            title: string;
            name: string;
            type: 'ai' | 'human';
            agentName?: string;  // 对应 agents 数组中的 name
            systemInstruction?: string;
        }>;
    };
    maxRounds?: number;
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
 * 初始化服务和团队
 */
async function initializeServices(config: CLIConfig): Promise<{
    coordinator: ConversationCoordinator;
    team: Team;
    processManager: ProcessManager;
}> {
    // 初始化核心服务
    const storage = new MockStorageService();
    const processManager = new ProcessManager();
    const messageRouter = new MessageRouter();
    const agentConfigManager = new AgentConfigManager(storage);
    const teamManager = new TeamManager(storage);
    const agentManager = new AgentManager(processManager, agentConfigManager);

    // 创建 agent 配置
    const agentConfigMap = new Map<string, string>();  // name -> configId

    for (const agentDef of config.agents) {
        const agentConfig = await agentConfigManager.createAgentConfig({
            name: `${agentDef.name}-config`,
            type: 'cli',
            command: agentDef.command,
            args: agentDef.args,
            endMarker: agentDef.endMarker,
            description: `CLI agent: ${agentDef.name}`,
            useEndOfMessageMarker: false,
            usePty: agentDef.usePty ?? false,
        });
        agentConfigMap.set(agentDef.name, agentConfig.id);
    }

    // 创建团队角色
    const roles = config.team.roles.map((roleDef, index) => ({
        title: roleDef.title,
        name: roleDef.name,
        type: roleDef.type,
        agentConfigId: roleDef.type === 'ai' && roleDef.agentName
            ? agentConfigMap.get(roleDef.agentName)
            : undefined,
        systemInstruction: roleDef.systemInstruction || '',
        order: index,
    }));

    // 创建团队
    const team = await teamManager.createTeam({
        name: config.team.name,
        description: config.team.description,
        roles,
    });

    // 创建对话协调器
    const coordinator = new ConversationCoordinator(
        agentManager,
        messageRouter,
        {
            contextMessageCount: 5,
            onMessage: (message: ConversationMessage) => {
                // 显示消息
                displayMessage(message);
            },
            onStatusChange: (status: string) => {
                console.log(colorize(`[Status] ${status}`, 'dim'));
            },
        }
    );

    return { coordinator, team, processManager };
}

/**
 * 显示消息
 */
function displayMessage(message: ConversationMessage): void {
    const speaker = message.speaker;
    const timestamp = new Date(message.timestamp).toLocaleTimeString();

    // 根据角色类型选择颜色
    const nameColor = speaker.type === 'ai' ? 'cyan' : 'green';

    console.log('');
    console.log(colorize(`[${timestamp}] ${speaker.roleTitle}:`, nameColor));
    console.log(message.content);
    console.log(colorize('─'.repeat(60), 'dim'));
}

/**
 * 等待用户输入
 */
function waitForUserInput(prompt: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(colorize(prompt, 'yellow'), (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * 启动对话
 */
async function startConversation(
    coordinator: ConversationCoordinator,
    team: Team,
    initialMessage: string,
    firstSpeaker?: string
): Promise<void> {
    // 确定第一个发言者
    const firstSpeakerId = firstSpeaker
        ? team.roles.find(r => r.name === firstSpeaker)?.id
        : team.roles[0].id;

    if (!firstSpeakerId) {
        console.error(colorize('Error: Invalid first speaker', 'red'));
        return;
    }

    console.log(colorize('\n=== 对话开始 ===\n', 'bright'));
    console.log(colorize(`初始消息: ${initialMessage}`, 'blue'));
    console.log(colorize(`第一个发言者: ${team.roles.find(r => r.id === firstSpeakerId)?.title}`, 'blue'));
    console.log(colorize('─'.repeat(60), 'dim'));

    // 启动对话
    await coordinator.startConversation(team, initialMessage, firstSpeakerId);

    // 监听需要人工输入的情况
    let isWaitingForInput = false;  // 防止多次触发输入提示
    const checkInterval = setInterval(async () => {
        const waitingRoleId = coordinator.getWaitingForRoleId();

        if (waitingRoleId && !isWaitingForInput) {
            const role = team.roles.find(r => r.id === waitingRoleId);

            if (role && role.type === 'human') {
                isWaitingForInput = true;
                // 需要人工输入
                const userInput = await waitForUserInput(`\n${role.title}, 请输入你的消息: `);
                isWaitingForInput = false;

                if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
                    console.log(colorize('\n用户终止对话', 'yellow'));
                    coordinator.stop();
                    clearInterval(checkInterval);
                } else {
                    coordinator.injectMessage(waitingRoleId, userInput);
                }
            }
        }

        // 检查对话是否完成
        const session = (coordinator as any).session;
        if (session && session.status === 'completed') {
            clearInterval(checkInterval);
            console.log(colorize('\n=== 对话结束 ===\n', 'bright'));
            process.exit(0);
        }
    }, 500);

    // 处理 Ctrl+C
    process.on('SIGINT', () => {
        console.log(colorize('\n\n用户中断对话', 'yellow'));
        coordinator.stop();
        clearInterval(checkInterval);
        process.exit(0);
    });
}

/**
 * 主程序
 */
program
    .name('agent-chatter')
    .description('让多个 CLI AI agents 自动对话的命令行工具')
    .version('0.0.1');

program
    .command('start')
    .description('启动一次对话')
    .requiredOption('-c, --config <path>', '配置文件路径')
    .option('-m, --message <text>', '初始消息', 'Hello!')
    .option('-s, --speaker <name>', '第一个发言者的名称')
    .action(async (options) => {
        try {
            // 加载配置
            const config = loadConfig(options.config);

            // 初始化服务
            console.log(colorize('正在初始化服务...', 'cyan'));
            const { coordinator, team, processManager } = await initializeServices(config);

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
                name: 'Claude Code Test Team',
                description: 'A team with Claude Code CLI agent and human observer',
                roles: [
                    {
                        title: 'Claude',
                        name: 'claude',
                        type: 'ai',
                        agentName: 'claude',
                        systemInstruction: 'You are a helpful AI assistant.'
                    },
                    {
                        title: 'Observer',
                        name: 'observer',
                        type: 'human'
                    }
                ]
            },
            maxRounds: 10
        };

        fs.writeFileSync(options.output, JSON.stringify(exampleConfig, null, 2));
        console.log(colorize(`示例配置文件已生成: ${options.output}`, 'green'));
    });

// 解析命令行参数
program.parse();
