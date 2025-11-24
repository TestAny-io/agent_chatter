/**
 * ReplMode - 交互式REPL模式
 *
 * 类似Gemini CLI的交互式界面
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { detectAllTools } from '../utils/ToolDetector.js';
import { initializeServices, startConversation } from '../utils/ConversationStarter.js';
import type { CLIConfig } from '../utils/ConversationStarter.js';
import { colorize as c } from '../utils/colors.js';
import { ConsoleOutput } from '../outputs/ConsoleOutput.js';

export class ReplMode {
    private rl: readline.Interface;
    private currentConfig: CLIConfig | null = null;
    private currentConfigPath: string | null = null;
    private isRunning: boolean = false;
    private exitMessageShown: boolean = false;

    // 所有可用的命令
    private commands = ['/help', '/status', '/config', '/start', '/list', '/clear', '/exit', '/quit'];

    constructor() {
        // 启用原始模式以捕获每个按键
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: c('agent-chatter> ', 'cyan'),
            completer: this.completer.bind(this),
        });

        this.setupKeyHandler();
    }

    /**
     * 自动补全函数
     */
    private completer(line: string): [string[], string] {
        const hits = this.commands.filter((cmd) => cmd.startsWith(line));
        return [hits.length ? hits : this.commands, line];
    }

    /**
     * 设置按键处理
     */
    private setupKeyHandler(): void {
        const stdin = process.stdin;
        let currentLine = '';

        stdin.on('keypress', (str, key) => {
            if (!key) return;

            // Ctrl+C 退出
            if (key.ctrl && key.name === 'c') {
                this.exitMessageShown = true;
                console.log();
                console.log(c('Goodbye! 👋', 'cyan'));
                console.log();
                this.rl.close();
                process.exitCode = 0;
            }

            // 处理退格
            if (key.name === 'backspace') {
                currentLine = currentLine.slice(0, -1);
            }
            // 处理回车
            else if (key.name === 'return') {
                currentLine = '';
                this.clearCommandHints();
                return;
            }
            // 处理普通字符
            else if (str && !key.ctrl && !key.meta) {
                currentLine += str;
            }

            // 如果当前行以 / 开头，显示命令提示
            if (currentLine.startsWith('/')) {
                this.showCommandHints(currentLine);
            } else {
                this.clearCommandHints();
            }
        });
    }

    /**
     * 显示命令提示
     */
    private showCommandHints(input: string): void {
        const matches = this.commands.filter(cmd => cmd.startsWith(input));

        if (matches.length === 0) return;

        // 保存光标位置
        process.stdout.write('\x1b[s');

        // 移动到下一行
        process.stdout.write('\n');

        // 显示匹配的命令
        matches.forEach((cmd, index) => {
            const hint = c(`  ${cmd}`, index === 0 ? 'green' : 'dim');
            process.stdout.write(hint + '\n');
        });

        // 恢复光标位置
        process.stdout.write('\x1b[u');
    }

    /**
     * 清除命令提示
     */
    private clearCommandHints(): void {
        // 清除下方的行（假设最多显示8个命令）
        for (let i = 0; i < 9; i++) {
            process.stdout.write('\x1b[1B');  // 向下移动
            process.stdout.write('\x1b[2K');  // 清除行
        }
        // 回到原位
        for (let i = 0; i < 9; i++) {
            process.stdout.write('\x1b[1A');  // 向上移动
        }
    }

    /**
     * 显示欢迎界面
     */
    private showWelcome(): void {
        console.clear();
        console.log(c('╔════════════════════════════════════════════════════════════╗', 'cyan'));
        console.log(c('║                                                            ║', 'cyan'));
        console.log(c('║                    ', 'cyan') + c('AGENT CHATTER', 'bright') + c('                       ║', 'cyan'));
        console.log(c('║                                                            ║', 'cyan'));
        console.log(c('║          ', 'cyan') + c('Multi-AI Conversation Orchestrator', 'dim') + c('             ║', 'cyan'));
        console.log(c('║                                                            ║', 'cyan'));
        console.log(c('╚════════════════════════════════════════════════════════════╝', 'cyan'));
        console.log();
        console.log(c('  Version 0.0.1', 'dim') + c(' • ', 'dim') + c('TestAny.io', 'dim'));
        console.log();
        console.log(c('  Type', 'dim') + ' ' + c('/help', 'green') + c(' for available commands', 'dim'));
        console.log(c('  Type', 'dim') + ' ' + c('/exit', 'green') + c(' to quit', 'dim'));
        console.log();
    }

    /**
     * 显示帮助信息
     */
    private showHelp(): void {
        console.log();
        console.log(c('Available Commands:', 'bright'));
        console.log();
        console.log(c('  /help', 'green') + '              ' + c('Show this help message', 'dim'));
        console.log(c('  /status', 'green') + '            ' + c('Check installed AI CLI tools', 'dim'));
        console.log(c('  /config <file>', 'green') + '    ' + c('Load a configuration file', 'dim'));
        console.log(c('  /start <message>', 'green') + '  ' + c('Start a conversation (config must be loaded)', 'dim'));
        console.log(c('  /list', 'green') + '              ' + c('List available configuration files', 'dim'));
        console.log(c('  /clear', 'green') + '             ' + c('Clear the screen', 'dim'));
        console.log(c('  /exit', 'green') + '              ' + c('Exit the application', 'dim'));
        console.log();
    }

    /**
     * 检测工具状态
     */
    private async showStatus(): Promise<void> {
        console.log();
        console.log(c('Detecting AI CLI tools...', 'cyan'));
        const tools = await detectAllTools();

        const installed = tools.filter(t => t.installed);
        const notInstalled = tools.filter(t => !t.installed);

        if (installed.length > 0) {
            console.log();
            console.log(c('✓ Installed:', 'green'));
            installed.forEach(tool => {
                const version = tool.version ? c(` (v${tool.version})`, 'dim') : '';
                console.log(`  ${c('●', 'green')} ${tool.displayName}${version}`);
            });
        }

        if (notInstalled.length > 0) {
            console.log();
            console.log(c('✗ Not Installed:', 'yellow'));
            notInstalled.forEach(tool => {
                console.log(`  ${c('○', 'dim')} ${tool.displayName}`);
                if (tool.installHint) {
                    console.log(c(`    ${tool.installHint}`, 'dim'));
                }
            });
        }
        console.log();
    }

    /**
     * 列出配置文件
     */
    private listConfigs(): void {
        console.log();
        console.log(c('Looking for configuration files...', 'cyan'));

        const cwd = process.cwd();
        const files = fs.readdirSync(cwd).filter(f =>
            f.endsWith('-config.json') || f === 'agent-chatter-config.json'
        );

        if (files.length === 0) {
            console.log(c('  No configuration files found in current directory', 'yellow'));
            console.log(c('  Use', 'dim') + ' ' + c('agent-chatter config-example', 'green') + c(' to create one', 'dim'));
        } else {
            console.log();
            files.forEach(file => {
                const indicator = this.currentConfigPath && file === path.basename(this.currentConfigPath)
                    ? c('●', 'green')
                    : c('○', 'dim');
                console.log(`  ${indicator} ${file}`);
            });
        }
        console.log();
    }

    /**
     * 加载配置文件
     */
    private loadConfig(filePath: string): boolean {
        try {
            const fullPath = path.resolve(filePath);
            if (!fs.existsSync(fullPath)) {
                console.log(c(`Error: Configuration file not found: ${filePath}`, 'red'));
                return false;
            }

            const content = fs.readFileSync(fullPath, 'utf-8');
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

            this.currentConfig = config;
            this.currentConfigPath = filePath;

            console.log();
            console.log(c('✓ Configuration loaded:', 'green') + ' ' + c(filePath, 'bright'));
            console.log(c(`  Team: ${this.currentConfig?.team?.name || 'Unknown'}`, 'dim'));
            console.log(c(`  Agents: ${this.currentConfig?.agents?.length || 0}`, 'dim'));
            console.log();

            return true;
        } catch (error) {
            console.log(c(`Error: Failed to load configuration: ${error}`, 'red'));
            return false;
        }
    }

    /**
     * 处理slash命令
     */
    private async handleCommand(line: string): Promise<boolean> {
        const trimmed = line.trim();

        if (!trimmed.startsWith('/')) {
            console.log(c('Unknown command. Type /help for available commands.', 'yellow'));
            return true;
        }

        const parts = trimmed.split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (command) {
            case '/help':
                this.showHelp();
                break;

            case '/status':
                await this.showStatus();
                break;

            case '/list':
                this.listConfigs();
                break;

            case '/config':
                if (args.length === 0) {
                    console.log(c('Usage: /config <file>', 'yellow'));
                } else {
                    this.loadConfig(args[0]);
                }
                break;

            case '/start':
                if (!this.currentConfig) {
                    console.log(c('Error: No configuration loaded. Use /config <file> first.', 'red'));
                } else if (args.length === 0) {
                    console.log(c('Usage: /start <initial message>', 'yellow'));
                } else {
                    const message = args.join(' ');
                    await this.startConversationInRepl(message);
                }
                break;

            case '/clear':
                console.clear();
                this.showWelcome();
                break;

            case '/exit':
            case '/quit':
                this.exitMessageShown = true;
                console.log();
                console.log(c('Goodbye! 👋', 'cyan'));
                console.log();
                return false;

            default:
                console.log(c(`Unknown command: ${command}`, 'yellow'));
                console.log(c('Type /help for available commands.', 'dim'));
        }

        return true;
    }

    /**
     * 启动对话
     */
    private async startConversationInRepl(initialMessage: string): Promise<void> {
        if (!this.currentConfig) {
            console.log(c('Error: No configuration loaded', 'red'));
            return;
        }

        try {
            const output = new ConsoleOutput();
            output.progress('Initializing services...');
            const { coordinator, team } = await initializeServices(this.currentConfig, {
                output
            });

            await startConversation(coordinator, team, initialMessage, undefined, output);

            output.info('Conversation ended. You can start another one with /start');
        } catch (error) {
            console.log(c(`Error: ${error}`, 'red'));
        }
    }

    /**
     * 启动REPL模式
     */
    public async start(): Promise<void> {
        this.showWelcome();
        this.isRunning = true;

        this.rl.on('line', async (line) => {
            const shouldContinue = await this.handleCommand(line);

            if (!shouldContinue) {
                this.rl.close();
            } else {
                this.rl.prompt();
            }
        });

        this.rl.on('close', () => {
            if (this.isRunning && !this.exitMessageShown) {
                console.log();
                console.log(c('Goodbye! 👋', 'cyan'));
                console.log();
            }
            this.isRunning = false;
            process.exitCode = 0;
        });

        // 显示初始提示符
        this.rl.prompt();
    }
}
