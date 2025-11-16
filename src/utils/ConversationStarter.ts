/**
 * ConversationStarter - 启动对话的共享工具
 */

import * as readline from 'readline';
import { ConversationCoordinator } from '../services/ConversationCoordinator';
import { AgentManager } from '../services/AgentManager';
import { ProcessManager } from '../infrastructure/ProcessManager';
import { MessageRouter } from '../services/MessageRouter';
import { AgentConfigManager } from '../services/AgentConfigManager';
import { TeamManager } from '../services/TeamManager';
import { MockStorageService } from '../infrastructure/StorageService';
import { Team } from '../models/Team';
import { ConversationMessage } from '../models/ConversationMessage';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
};

function colorize(text: string, color: keyof typeof colors): string {
    return `${colors[color]}${text}${colors.reset}`;
}

export interface CLIConfig {
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
            agentName?: string;
            systemInstruction?: string;
        }>;
    };
    maxRounds?: number;
}

/**
 * 显示消息
 */
function displayMessage(message: ConversationMessage): void {
    const speaker = message.speaker;
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
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
            resolve(answer);
        });
    });
}

/**
 * 初始化服务和团队
 */
export async function initializeServices(config: CLIConfig): Promise<{
    coordinator: ConversationCoordinator;
    team: Team;
    processManager: ProcessManager;
}> {
    const storage = new MockStorageService();
    const processManager = new ProcessManager();
    const messageRouter = new MessageRouter();
    const agentConfigManager = new AgentConfigManager(storage);
    const teamManager = new TeamManager(storage);
    const agentManager = new AgentManager(processManager, agentConfigManager);

    const agentConfigMap = new Map<string, string>();

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

    const team = await teamManager.createTeam({
        name: config.team.name,
        description: config.team.description,
        roles,
    });

    const coordinator = new ConversationCoordinator(
        agentManager,
        messageRouter,
        {
            contextMessageCount: 5,
            onMessage: (message: ConversationMessage) => {
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
 * 启动对话
 */
export async function startConversation(
    coordinator: ConversationCoordinator,
    team: Team,
    initialMessage: string,
    firstSpeaker?: string
): Promise<void> {
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

    await coordinator.startConversation(team, initialMessage, firstSpeakerId);

    let isWaitingForInput = false;
    const checkInterval = setInterval(async () => {
        const waitingRoleId = coordinator.getWaitingForRoleId();

        if (waitingRoleId && !isWaitingForInput) {
            const role = team.roles.find(r => r.id === waitingRoleId);

            if (role && role.type === 'human') {
                isWaitingForInput = true;
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

        const session = (coordinator as any).session;
        if (session && session.status === 'completed') {
            clearInterval(checkInterval);
            console.log(colorize('\n=== 对话结束 ===\n', 'bright'));
        }
    }, 500);

    process.on('SIGINT', () => {
        console.log(colorize('\n\n用户中断对话', 'yellow'));
        coordinator.stop();
        clearInterval(checkInterval);
        process.exit(0);
    });
}
