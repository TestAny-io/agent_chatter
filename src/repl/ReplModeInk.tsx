/**
 * ReplModeInk - 基于 Ink + React 的交互式 REPL
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import { detectAllTools } from '../utils/ToolDetector.js';
import { ConversationCoordinator } from '../services/ConversationCoordinator.js';
import { initializeServices, type CLIConfig } from '../utils/ConversationStarter.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { Team } from '../models/Team.js';

const commands = [
    { name: '/help', desc: 'Show this help message' },
    { name: '/status', desc: 'Check installed AI CLI tools' },
    { name: '/config', desc: 'Load a configuration file' },
    { name: '/start', desc: 'Start a conversation' },
    { name: '/list', desc: 'List available configuration files' },
    { name: '/clear', desc: 'Clear the screen' },
    { name: '/exit', desc: 'Exit the application' },
];

// 欢迎界面组件
function WelcomeScreen() {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box borderStyle="round" borderColor="cyan" padding={1}>
                <Box flexDirection="column">
                    <Text bold color="cyan">                    AGENT CHATTER</Text>
                    <Text dimColor>          Multi-AI Conversation Orchestrator</Text>
                </Box>
            </Box>
            <Text dimColor>  Version 0.0.1 • TestAny.io</Text>
            <Text dimColor>  Type <Text color="green">/help</Text> for available commands</Text>
            <Text dimColor>  Type <Text color="green">/exit</Text> to quit</Text>
        </Box>
    );
}

// 命令提示组件
function CommandHints({ input, selectedIndex }: { input: string; selectedIndex: number }) {
    if (!input.startsWith('/')) {
        return null;
    }

    const matches = commands.filter(cmd => cmd.name.startsWith(input));

    if (matches.length === 0) {
        return null;
    }

    return (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
            {matches.map((cmd, idx) => (
                <Box key={cmd.name}>
                    <Text color={idx === selectedIndex ? 'green' : 'gray'} bold={idx === selectedIndex}>
                        {idx === selectedIndex ? '▶ ' : '  '}{cmd.name}
                    </Text>
                    <Text dimColor> - {cmd.desc}</Text>
                </Box>
            ))}
        </Box>
    );
}

// 帮助信息
function HelpMessage() {
    return (
        <Box flexDirection="column" marginY={1}>
            <Text bold>Available Commands:</Text>
            {commands.map(cmd => (
                <Box key={cmd.name} marginLeft={2}>
                    <Text color="green">{cmd.name.padEnd(18)}</Text>
                    <Text dimColor>{cmd.desc}</Text>
                </Box>
            ))}
        </Box>
    );
}

// 工具状态显示
function StatusDisplay({ tools }: { tools: any[] }) {
    const installed = tools.filter(t => t.installed);
    const notInstalled = tools.filter(t => !t.installed);

    return (
        <Box flexDirection="column" marginY={1}>
            {installed.length > 0 && (
                <Box flexDirection="column">
                    <Text color="green">✓ Installed:</Text>
                    {installed.map(tool => (
                        <Box key={tool.name} marginLeft={2}>
                            <Text color="green">●</Text>
                            <Text> {tool.displayName}</Text>
                            {tool.version && <Text dimColor> (v{tool.version})</Text>}
                        </Box>
                    ))}
                </Box>
            )}
            {notInstalled.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    <Text color="yellow">✗ Not Installed:</Text>
                    {notInstalled.map(tool => (
                        <Box key={tool.name} marginLeft={2} flexDirection="column">
                            <Box>
                                <Text dimColor>○</Text>
                                <Text> {tool.displayName}</Text>
                            </Box>
                            {tool.installHint && (
                                <Box marginLeft={2}>
                                    <Text dimColor>  {tool.installHint}</Text>
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}

// 配置文件列表
function ConfigList({ currentConfigPath }: { currentConfigPath: string | null }) {
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd).filter(f =>
        f.endsWith('-config.json') || f === 'agent-chatter-config.json'
    );

    if (files.length === 0) {
        return (
            <Box flexDirection="column" marginY={1}>
                <Text color="yellow">No configuration files found in current directory</Text>
                <Text dimColor>Use agent-chatter config-example to create one</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginY={1}>
            {files.map(file => {
                const isActive = currentConfigPath && file === path.basename(currentConfigPath);
                return (
                    <Box key={file} marginLeft={2}>
                        <Text color={isActive ? 'green' : 'gray'}>{isActive ? '●' : '○'}</Text>
                        <Text> {file}</Text>
                    </Box>
                );
            })}
        </Box>
    );
}

// 应用模式
type AppMode = 'normal' | 'conversation';

// 主应用组件
function App() {
    const [input, setInput] = useState('');
    const [output, setOutput] = useState<React.ReactNode[]>([]);
    const [currentConfig, setCurrentConfig] = useState<CLIConfig | null>(null);
    const [currentConfigPath, setCurrentConfigPath] = useState<string | null>(null);
    const [keyCounter, setKeyCounter] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mode, setMode] = useState<AppMode>('normal');
    const [activeCoordinator, setActiveCoordinator] = useState<ConversationCoordinator | null>(null);
    const [activeTeam, setActiveTeam] = useState<Team | null>(null);
    const { exit } = useApp();

    const getNextKey = () => {
        setKeyCounter(prev => prev + 1);
        return keyCounter;
    };

    // 获取当前匹配的命令
    const getMatches = () => {
        if (!input.startsWith('/')) return [];
        return commands.filter(cmd => cmd.name.startsWith(input));
    };

    useInput((inputChar: string, key: any) => {
        // Ctrl+C 退出
        if (key.ctrl && inputChar === 'c') {
            if (mode === 'conversation' && activeCoordinator) {
                // 退出对话模式
                activeCoordinator.stop();
                setMode('normal');
                setActiveCoordinator(null);
                setActiveTeam(null);
                setOutput(prev => [...prev, <Text key={`conv-stopped-${getNextKey()}`} color="yellow">Conversation stopped.</Text>]);
                setInput('');
                return;
            } else {
                setOutput(prev => [...prev, <Text color="cyan" key="goodbye">Goodbye! 👋</Text>]);
                setTimeout(() => exit(), 100);
                return;
            }
        }

        // 退格
        if (key.backspace || key.delete) {
            setInput(prev => prev.slice(0, -1));
            if (mode === 'normal') setSelectedIndex(0);
            return;
        }

        // 回车 - 根据模式处理
        if (key.return) {
            if (mode === 'conversation') {
                // 对话模式：处理用户消息
                handleConversationInput(input.trim());
                setInput('');
            } else {
                // Normal模式：处理命令
                const matches = getMatches();
                if (matches.length > 0 && input !== matches[selectedIndex].name) {
                    // 自动补全
                    setInput(matches[selectedIndex].name + ' ');
                    setSelectedIndex(0);
                } else {
                    // 执行命令
                    handleCommand(input.trim());
                    setInput('');
                    setSelectedIndex(0);
                }
            }
            return;
        }

        // 只在normal模式下处理命令提示的上下键
        if (mode === 'normal') {
            const matches = getMatches();

            // 上方向键 - 向上选择命令
            if (key.upArrow && matches.length > 0) {
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : matches.length - 1));
                return;
            }

            // 下方向键 - 向下选择命令
            if (key.downArrow && matches.length > 0) {
                setSelectedIndex(prev => (prev < matches.length - 1 ? prev + 1 : 0));
                return;
            }

            // Tab键 - 自动补全选中的命令
            if (key.tab && matches.length > 0) {
                setInput(matches[selectedIndex].name + ' ');
                setSelectedIndex(0);
                return;
            }
        }

        // 普通字符输入
        if (inputChar) {
            setInput(prev => prev + inputChar);
            if (mode === 'normal') setSelectedIndex(0);
        }
    });

    const handleConversationInput = (message: string) => {
        if (!message) return;

        // 检查是否是退出对话命令
        if (message === '/end' || message === '/exit' || message === '/quit') {
            if (activeCoordinator) {
                activeCoordinator.stop();
            }
            setMode('normal');
            setActiveCoordinator(null);
            setActiveTeam(null);
            setOutput(prev => [...prev,
                <Box key={`conv-end-${getNextKey()}`} flexDirection="column" marginTop={1}>
                    <Text color="green">{'─'.repeat(60)}</Text>
                    <Text bold color="green">Conversation Ended</Text>
                    <Text dimColor>You are back in normal mode. Type /help for commands.</Text>
                    <Text color="green">{'─'.repeat(60)}</Text>
                </Box>
            ]);
            return;
        }

        // 通过coordinator继续对话
        // 检查是否有role在等待输入
        if (activeCoordinator && activeTeam) {
            const waitingRoleId = activeCoordinator.getWaitingForRoleId();

            if (waitingRoleId) {
                const waitingRole = activeTeam.members.find(r => r.id === waitingRoleId);
                setOutput(prev => [...prev,
                    <Box key={`user-msg-${getNextKey()}`} flexDirection="column" marginTop={1}>
                        <Text color="green">[{waitingRole?.displayName || 'You'}]:</Text>
                        <Text>{message}</Text>
                        <Text dimColor>{'─'.repeat(60)}</Text>
                    </Box>
                ]);
                activeCoordinator.injectMessage(waitingRoleId, message);
            } else {
                setOutput(prev => [...prev,
                    <Text key={`no-waiting-${getNextKey()}`} color="yellow">No team member is waiting for input right now. Wait for the coordinator to prompt you.</Text>
                ]);
            }
        }
    };

    const handleCommand = async (cmd: string) => {
        if (!cmd) return;

        const parts = cmd.split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        // 添加用户输入到输出
        setOutput(prev => [...prev, <Text key={`input-${getNextKey()}`} color="cyan">agent-chatter&gt; {cmd}</Text>]);

        switch (command) {
            case '/help':
                setOutput(prev => [...prev, <HelpMessage key={`help-${getNextKey()}`} />]);
                break;

            case '/status':
                setOutput(prev => [...prev, <Text key={`status-msg-${getNextKey()}`} dimColor>Detecting AI CLI tools...</Text>]);
                const tools = await detectAllTools();
                setOutput(prev => [...prev, <StatusDisplay key={`status-${getNextKey()}`} tools={tools} />]);
                break;

            case '/list':
                setOutput(prev => [...prev, <Text key={`list-msg-${getNextKey()}`} dimColor>Looking for configuration files...</Text>]);
                setOutput(prev => [...prev, <ConfigList key={`list-${getNextKey()}`} currentConfigPath={currentConfigPath} />]);
                break;

            case '/config':
                if (args.length === 0) {
                    setOutput(prev => [...prev, <Text key={`config-msg-${getNextKey()}`} dimColor>Available configuration files:</Text>]);
                    setOutput(prev => [...prev, <ConfigList key={`config-list-${getNextKey()}`} currentConfigPath={currentConfigPath} />]);
                    setOutput(prev => [...prev, <Text key={`config-usage-${getNextKey()}`} color="yellow">Usage: /config &lt;filename&gt;</Text>]);
                } else {
                    loadConfig(args[0]);
                }
                break;

            case '/start':
                if (!currentConfig) {
                    setOutput(prev => [...prev, <Text key={`start-err-${getNextKey()}`} color="red">Error: No configuration loaded. Use /config &lt;file&gt; first.</Text>]);
                } else if (args.length === 0) {
                    setOutput(prev => [...prev, <Text key={`start-usage-${getNextKey()}`} color="yellow">Usage: /start &lt;initial message&gt;</Text>]);
                } else {
                    const message = args.join(' ');
                    await startConversationInRepl(message);
                }
                break;

            case '/clear':
                setOutput([]);
                break;

            case '/exit':
            case '/quit':
                setOutput(prev => [...prev, <Text color="cyan" key="goodbye">Goodbye! 👋</Text>]);
                setTimeout(() => exit(), 100);
                break;

            default:
                setOutput(prev => [...prev, <Text key={`unknown-${getNextKey()}`} color="yellow">Unknown command: {command}</Text>]);
                setOutput(prev => [...prev, <Text key={`help-hint-${getNextKey()}`} dimColor>Type /help for available commands.</Text>]);
        }
    };

    const loadConfig = (filePath: string) => {
        try {
            const fullPath = path.resolve(filePath);
            if (!fs.existsSync(fullPath)) {
                setOutput(prev => [...prev, <Text key={`config-notfound-${getNextKey()}`} color="red">Error: Configuration file not found: {filePath}</Text>]);
                return;
            }

            const content = fs.readFileSync(fullPath, 'utf-8');
            const config = JSON.parse(content);
            setCurrentConfig(config);
            setCurrentConfigPath(filePath);

            setOutput(prev => [...prev,
                <Box key={`config-loaded-${getNextKey()}`} flexDirection="column">
                    <Text color="green">✓ Configuration loaded: <Text bold>{filePath}</Text></Text>
                    <Text dimColor>  Team: {config.team?.name || 'Unknown'}</Text>
                    <Text dimColor>  Agents: {config.agents?.length || 0}</Text>
                </Box>
            ]);
        } catch (error) {
            setOutput(prev => [...prev, <Text key={`config-err-${getNextKey()}`} color="red">Error: Failed to load configuration: {String(error)}</Text>]);
        }
    };

    const startConversationInRepl = async (initialMessage: string) => {
        if (!currentConfig) return;

        try {
            setOutput(prev => [...prev, <Text key={`init-${getNextKey()}`} dimColor>Initializing services...</Text>]);

            const { coordinator, team } = await initializeServices(currentConfig, {
                onMessage: (message: ConversationMessage) => {
                    const timestamp = new Date(message.timestamp).toLocaleTimeString();
                    const nameColor = message.speaker.type === 'ai' ? 'cyan' : 'green';
                    setOutput(prev => [...prev,
                        <Box key={`msg-${getNextKey()}`} flexDirection="column" marginTop={1}>
                            <Text color={nameColor}>[{timestamp}] {message.speaker.roleTitle}:</Text>
                            <Text>{message.content}</Text>
                            <Text dimColor>{'─'.repeat(60)}</Text>
                        </Box>
                    ]);
                },
                onStatusChange: (status) => {
                    setOutput(prev => [...prev, <Text key={`status-${getNextKey()}`} dimColor>[Status] {status}</Text>]);
                }
            });

            if (!team.members.length) {
                throw new Error('Team has no members configured. Please update the configuration file.');
            }

            const firstSpeakerId = team.members[0].id;

            setOutput(prev => [...prev,
                <Text key={`conv-start-${getNextKey()}`} color="green">{'─'.repeat(60)}</Text>,
                <Text key={`conv-msg-${getNextKey()}`} bold>Conversation Started</Text>,
                <Text key={`conv-init-${getNextKey()}`} dimColor>Initial message: {initialMessage}</Text>,
                <Text key={`conv-tip-${getNextKey()}`} color="yellow">Type your messages below. Type /end to exit conversation mode.</Text>,
                <Text key={`conv-line-${getNextKey()}`} color="green">{'─'.repeat(60)}</Text>
            ]);

            setActiveCoordinator(coordinator);
            setActiveTeam(team);
            setMode('conversation');

            coordinator.startConversation(team, initialMessage, firstSpeakerId);

        } catch (error) {
            setOutput(prev => [...prev, <Text key={`start-err2-${getNextKey()}`} color="red">Error: {String(error)}</Text>]);
        }
    };

    return (
        <Box flexDirection="column">
            <WelcomeScreen />

            {/* 输出历史 */}
            {output.map((item, idx) => (
                <Box key={idx}>{item}</Box>
            ))}

            {/* 当前输入行 */}
            <Box>
                {mode === 'conversation' ? (
                    <Text color="green" bold>you&gt; </Text>
                ) : (
                    <Text color="cyan">agent-chatter&gt; </Text>
                )}
                <Text>{input}</Text>
            </Box>

            {/* 命令提示（只在normal模式下显示） */}
            {mode === 'normal' && <CommandHints input={input} selectedIndex={selectedIndex} />}
        </Box>
    );
}

export function startReplInk() {
    render(<App />);
}
