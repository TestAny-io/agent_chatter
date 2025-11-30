/**
 * ToolDetector - AI CLI 工具检测器
 *
 * 检测系统中是否安装了常用的 AI CLI 工具
 *
 * @architecture LLD-04 Exception
 * Uses child_process (exec) for tool detection to verify CLI availability.
 * See AgentValidator.ts for rationale on why this is an acceptable exception.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolStatus {
    name: string;
    displayName: string;
    installed: boolean;
    version?: string;
    command: string;
    installHint?: string;
}

/**
 * 检测单个工具是否已安装
 */
async function checkTool(command: string, versionFlag: string = '--version'): Promise<{
    installed: boolean;
    version?: string;
}> {
    try {
        const { stdout, stderr } = await execAsync(`${command} ${versionFlag}`, {
            timeout: 3000,
            env: process.env
        });

        const output = stdout || stderr;
        // 提取版本号（简单匹配）
        const versionMatch = output.match(/\d+\.\d+\.\d+/) || output.match(/\d+\.\d+/);

        return {
            installed: true,
            version: versionMatch ? versionMatch[0] : 'unknown'
        };
    } catch (error) {
        return {
            installed: false
        };
    }
}

/**
 * 检测所有支持的 AI CLI 工具
 */
export async function detectAllTools(): Promise<ToolStatus[]> {
    const tools: Array<{
        name: string;
        displayName: string;
        command: string;
        versionFlag?: string;
        installHint?: string;
    }> = [
        {
            name: 'claude',
            displayName: 'Claude Code',
            command: 'claude',
            versionFlag: '--version',
            installHint: 'Download from https://claude.ai/download'
        },
        {
            name: 'codex',
            displayName: 'OpenAI Codex',
            command: 'codex',
            versionFlag: '--version',
            installHint: 'npm install -g @openai/codex  OR  brew install --cask codex'
        },
        {
            name: 'gemini',
            displayName: 'Google Gemini CLI',
            command: 'gemini',
            versionFlag: '--version',
            installHint: 'npm install -g @google/gemini-cli  OR  brew install gemini-cli'
        }
    ];

    const results: ToolStatus[] = [];

    for (const tool of tools) {
        const status = await checkTool(tool.command, tool.versionFlag);
        results.push({
            name: tool.name,
            displayName: tool.displayName,
            command: tool.command,
            installed: status.installed,
            version: status.version,
            installHint: tool.installHint
        });
    }

    return results;
}

/**
 * 检测配置文件中使用的工具
 */
export async function detectConfigTools(agentCommands: string[]): Promise<Map<string, ToolStatus>> {
    const results = new Map<string, ToolStatus>();

    for (const command of agentCommands) {
        // 提取命令名（去掉路径和参数）
        const commandName = command.split('/').pop()?.split('.')[0] || command;

        // 如果是 wrapper 脚本，跳过
        if (command.includes('wrapper')) {
            continue;
        }

        const status = await checkTool(command);
        results.set(commandName, {
            name: commandName,
            displayName: commandName,
            command,
            installed: status.installed,
            version: status.version
        });
    }

    return results;
}
