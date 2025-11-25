/**
 * ReplModeInk - 基于 Ink + React 的交互式 REPL
 */

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import * as fs from 'fs';
import { watch } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { detectAllTools } from '../utils/ToolDetector.js';
import { ConversationCoordinator } from '../services/ConversationCoordinator.js';
import { initializeServices, type InitializeServicesOptions } from '../services/ServiceInitializer.js';
import type { CLIConfig } from '../models/CLIConfig.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { Team, RoleDefinition, Member } from '../models/Team.js';
import { processWizardStep1Input, type WizardStep1Event } from './wizard/wizardStep1Reducer.js';
import { AgentsMenu } from './components/AgentsMenu.js';
import { RegistryStorage } from '../registry/RegistryStorage.js';
import { ThinkingIndicator } from './components/ThinkingIndicator.js';
import type { AgentEvent } from '../events/AgentEvent.js';
import type { EventEmitter } from 'events';
import {
    getTeamConfigDir,
    ensureTeamConfigDir,
    resolveTeamConfigPath,
    formatMissingConfigError,
    discoverTeamConfigs,
    type ConfigResolution,
    type TeamConfigInfo
} from '../utils/TeamConfigPaths.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

const commands = [
    { name: '/help', desc: 'Show this help message' },
    { name: '/status', desc: 'Check installed AI CLI tools' },
    { name: '/agents', desc: 'Manage registered AI agents' },
    { name: '/team', desc: 'Manage team configurations' },
    { name: '/clear', desc: 'Clear the screen' },
    { name: '/exit', desc: 'Exit the application' },
];

const teamCommands = [
    { name: '/team create', desc: 'Create a new team configuration' },
    { name: '/team list', desc: 'List all team configurations' },
    { name: '/team deploy', desc: 'Deploy and load a team configuration' },
    { name: '/team edit', desc: 'Edit an existing team configuration' },
    { name: '/team delete', desc: 'Delete a team configuration' },
];

const agentsCommands = [
    { name: '/agents register', desc: 'Scan and register AI CLI tools' },
    { name: '/agents list', desc: 'List all registered agents' },
    { name: '/agents verify', desc: 'Verify agent availability' },
    { name: '/agents info', desc: 'Show agent detailed information' },
    { name: '/agents edit', desc: 'Edit agent configuration' },
    { name: '/agents delete', desc: 'Delete a registered agent' },
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
            <Text dimColor>  Version {VERSION} • TestAny.io</Text>
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
            
            <Box marginTop={1} flexDirection="column">
                <Text bold>Message Markers:</Text>
                <Box marginLeft={2}>
                    <Text color="green">{'[FROM:name]'.padEnd(18)}</Text>
                    <Text dimColor>Specify human sender (required for multi-human teams)</Text>
                </Box>
                <Box marginLeft={2}>
                    <Text color="green">{'[NEXT:name]'.padEnd(18)}</Text>
                    <Text dimColor>Route message to specific member</Text>
                </Box>
                <Box marginLeft={2}>
                    <Text color="green">{'[TEAM_TASK:desc]'.padEnd(18)}</Text>
                    <Text dimColor>Set persistent team-wide task context</Text>
                </Box>
            </Box>
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

// Team configuration list component (using discoverTeamConfigs)
function TeamList() {
    const configs = discoverTeamConfigs();

    if (configs.length === 0) {
        return (
            <Box flexDirection="column" marginY={1}>
                <Text color="yellow">No team configurations found</Text>
                <Text dimColor>Use /team create to create a team configuration</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginY={1}>
            <Text bold>Available Teams:</Text>
            <Box flexDirection="column" marginTop={1}>
                {configs.map((config, idx) => (
                    <Box key={config.filename} flexDirection="column" marginBottom={1}>
                        <Text>
                            <Text color="cyan" bold>[{idx + 1}]</Text>
                            <Text> </Text>
                            <Text color="green">{config.displayName}</Text>
                        </Text>
                        <Box marginLeft={4}>
                            <Text dimColor>File: {config.filename}</Text>
                        </Box>
                        <Box marginLeft={4}>
                            <Text dimColor>
                                Members: {config.memberCount} ({config.aiCount} AI, {config.humanCount} Human)
                            </Text>
                        </Box>
                    </Box>
                ))}
            </Box>
            <Box marginTop={1}>
                <Text dimColor>Type </Text>
                <Text color="green">/team deploy &lt;filename&gt;</Text>
                <Text dimColor> to deploy a team</Text>
            </Box>
        </Box>
    );
}

// Team menu help component
function TeamMenuHelp() {
    return (
        <Box flexDirection="column" marginY={1}>
            <Text bold>Team Management Commands:</Text>
            {teamCommands.map(cmd => (
                <Box key={cmd.name} marginLeft={2}>
                    <Text color="green">{cmd.name.padEnd(22)}</Text>
                    <Text dimColor>{cmd.desc}</Text>
                </Box>
            ))}
        </Box>
    );
}

// Legacy config list (kept for /list command backward compatibility)
// Now uses discoverTeamConfigs() for content-based discovery
function ConfigList({ currentConfigPath }: { currentConfigPath: string | null }) {
    const configs = discoverTeamConfigs();

    if (configs.length === 0) {
        return (
            <Box flexDirection="column" marginY={1}>
                <Text color="yellow">No configuration files found</Text>
                <Text dimColor>Use /team create to create a team configuration</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginY={1}>
            <Text color="yellow" dimColor>Note: /list is deprecated. Use /team list instead.</Text>
            <Box marginTop={1}>
                {configs.map((config) => {
                    const isActive = currentConfigPath && config.filename === path.basename(currentConfigPath);
                    return (
                        <Box key={config.filename} flexDirection="column" marginBottom={1}>
                            <Box>
                                <Text color={isActive ? 'green' : 'gray'}>{isActive ? '●' : '○'}</Text>
                                <Text> </Text>
                                <Text color={isActive ? 'green' : 'white'}>{config.displayName}</Text>
                            </Box>
                            <Box marginLeft={4}>
                                <Text dimColor>File: {config.filename}</Text>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

// ============================================================================
// Wizard UI Components
// ============================================================================

interface WizardViewProps {
    wizardState: WizardState;
}

function WizardView({ wizardState }: WizardViewProps) {
    const { step, totalSteps, data } = wizardState;

    return (
        <Box flexDirection="column" marginY={1}>
            <Box borderStyle="round" borderColor="cyan" padding={1}>
                <Box flexDirection="column">
                    <Text bold color="cyan">Team Creation Wizard</Text>
                    <Text dimColor>Step {step}/{totalSteps}</Text>
                </Box>
            </Box>

            {step === 1 && <WizardStep1TeamStructure data={data} />}
            {step === 2 && <WizardStep2DetectAgents data={data} />}
            {step === 3 && <WizardStep3ConfigureMembers data={data} />}
            {step === 4 && <WizardStep4TeamSettings data={data} />}

            <Box marginTop={1}>
                <Text dimColor>Press </Text>
                <Text color="yellow">Ctrl+C</Text>
                <Text dimColor> to cancel wizard</Text>
            </Box>
        </Box>
    );
}

function WizardStep1TeamStructure({ data }: { data: WizardState['data'] }) {
    const visibleRoles = (data.roleDefinitions || []).filter(role => role.name && role.name.trim().length > 0);

    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold>Step 1/4: Team Structure</Text>
            <Text dimColor>Define your team's basic structure</Text>
            <Box marginTop={1} flexDirection="column">
                <Text>Team Name: <Text color="cyan">{data.teamName || '(not set)'}</Text></Text>
                <Text>Description: <Text color="cyan">{data.teamDescription || '(not set)'}</Text></Text>
                <Text>Instruction File: <Text color="cyan">{data.teamInstructionFile || '(not set)'}</Text></Text>
                {visibleRoles.length > 0 && (
                    <Box flexDirection="column" marginTop={1}>
                        <Text>Roles Defined:</Text>
                        {visibleRoles.map((role, idx) => (
                            <Box key={`${role.name}-${idx}`} marginLeft={2}>
                                <Text>
                                    • {role.name}
                                    {role.description ? `: ${role.description}` : ''}
                                </Text>
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}

function WizardStep2DetectAgents({ data }: { data: WizardState['data'] }) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold>Step 2/4: Detect Available AI Agents</Text>
            <Text dimColor>Scanning installed AI CLI tools...</Text>
            <Box marginTop={1} flexDirection="column">
                {data.availableAgents && data.availableAgents.length > 0 ? (
                    <>
                        <Text color="green">✓ Found {data.availableAgents.length} AI agent(s)</Text>
                        {data.availableAgents.map((agent, idx) => (
                            <Box key={idx} marginLeft={2}>
                                <Text>{data.selectedAgents?.includes(agent) ? '☑' : '☐'} {agent}</Text>
                            </Box>
                        ))}
                    </>
                ) : (
                    <Text color="yellow">No AI agents detected</Text>
                )}
            </Box>
        </Box>
    );
}

function WizardStep3ConfigureMembers({ data }: { data: WizardState['data'] }) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold>Step 3/4: Configure Team Members</Text>
            <Text dimColor>Configure each team member</Text>
            <Box marginTop={1} flexDirection="column">
                {data.memberConfigs && data.memberConfigs.length > 0 ? (
                    data.memberConfigs.map((member, idx) => (
                        <Box key={idx} flexDirection="column" marginTop={1}>
                            <Text>Member {idx + 1}: <Text color="cyan">{member.displayName || '(not configured)'}</Text></Text>
                            <Box marginLeft={2}>
                                <Text dimColor>Type: {member.type}, Role: {member.assignedRole}</Text>
                            </Box>
                        </Box>
                    ))
                ) : (
                    <Text color="yellow">No members configured yet</Text>
                )}
            </Box>
        </Box>
    );
}

function WizardStep4TeamSettings({ data }: { data: WizardState['data'] }) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text bold>Step 4/4: Team Settings</Text>
            <Text dimColor>Configure final team settings</Text>
            <Box marginTop={1} flexDirection="column">
                <Text>Max Rounds: <Text color="cyan">{data.maxRounds ?? '(not set)'}</Text></Text>
            </Box>
        </Box>
    );
}

// ============================================================================
// Menu UI Components
// ============================================================================

interface MenuViewProps {
    menuState: MenuState;
    menuItems: { label: string; value: string }[];
    selectedIndex: number;
}

function MenuView({ menuState, menuItems, selectedIndex }: MenuViewProps) {
    return (
        <Box flexDirection="column" marginY={1}>
            <Box borderStyle="round" borderColor="cyan" padding={1}>
                <Text bold color="cyan">Team Configuration Editor</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold>Team: {menuState.config.team?.name || 'Unknown'}</Text>
                <Text dimColor>File: {menuState.configPath}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold>Main Menu</Text>
                <Text dimColor>{'─'.repeat(60)}</Text>
                {menuItems.map((item, idx) => (
                    <Box key={idx}>
                        <Text color={idx === selectedIndex ? 'green' : 'gray'} bold={idx === selectedIndex}>
                            {idx === selectedIndex ? '▶ ' : '  '}{item.label}
                        </Text>
                    </Box>
                ))}
            </Box>

            <Box marginTop={1}>
                <Text dimColor>Use </Text>
                <Text color="yellow">↑↓</Text>
                <Text dimColor> to navigate, </Text>
                <Text color="yellow">Enter</Text>
                <Text dimColor> to select, </Text>
                <Text color="yellow">Ctrl+C</Text>
                <Text dimColor> to cancel</Text>
            </Box>
        </Box>
    );
}

// ============================================================================
// Form UI Components
// ============================================================================

interface FormViewProps {
    formState: FormState;
}

function FormView({ formState }: FormViewProps) {
    const currentField = formState.fields[formState.currentFieldIndex];
    const error = formState.errors[currentField?.name];

    return (
        <Box flexDirection="column" marginY={1}>
            <Box borderStyle="round" borderColor="cyan" padding={1}>
                <Text bold color="cyan">Input Form</Text>
            </Box>

            {currentField && (
                <Box marginTop={1} flexDirection="column">
                    <Text bold>{currentField.label}</Text>
                    {currentField.required && <Text dimColor>(required)</Text>}
                    
                    <Box marginTop={1}>
                        <Text>{currentField.value}</Text>
                    </Box>

                    {error && (
                        <Box marginTop={1}>
                            <Text color="red">✗ {error}</Text>
                        </Box>
                    )}

                    <Box marginTop={1}>
                        <Text dimColor>Press </Text>
                        <Text color="yellow">Enter</Text>
                        <Text dimColor> to confirm, </Text>
                        <Text color="yellow">Ctrl+C</Text>
                        <Text dimColor> to cancel</Text>
                    </Box>
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Select UI Components
// ============================================================================

interface SelectViewProps {
    title: string;
    options: string[];
    selectedIndex: number;
    multiSelect?: boolean;
    selectedItems?: Set<string>;
}

function SelectView({ title, options, selectedIndex, multiSelect, selectedItems }: SelectViewProps) {
    return (
        <Box flexDirection="column" marginY={1}>
            <Box borderStyle="round" borderColor="cyan" padding={1}>
                <Text bold color="cyan">{title}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                {options.map((option, idx) => {
                    const isSelected = idx === selectedIndex;
                    const isChecked = multiSelect && selectedItems?.has(option);
                    
                    return (
                        <Box key={idx}>
                            <Text color={isSelected ? 'green' : 'gray'} bold={isSelected}>
                                {isSelected ? '▶ ' : '  '}
                                {multiSelect ? (isChecked ? '☑' : '☐') : ''}
                                {' '}{option}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            <Box marginTop={1}>
                <Text dimColor>Use </Text>
                <Text color="yellow">↑↓</Text>
                <Text dimColor> to navigate, </Text>
                {multiSelect && (
                    <>
                        <Text color="yellow">Space</Text>
                        <Text dimColor> to toggle, </Text>
                    </>
                )}
                <Text color="yellow">Enter</Text>
                <Text dimColor> to confirm</Text>
            </Box>
        </Box>
    );
}

// 应用模式
type AppMode = 'normal' | 'conversation' | 'wizard' | 'menu' | 'form' | 'select' | 'agentsMenu';

// ============================================================================
// Wizard State Types
// ============================================================================

interface MemberAssignment {
    memberIndex: number;
    assignedRole: string;
}

interface MemberConfig {
    memberIndex: number;
    type: 'ai' | 'human';
    assignedRole: string;
    displayName: string;
    themeColor: string;
    roleDir: string;
    instructionFile?: string;
    env?: Record<string, string>;
    agentType?: string;
}

interface WizardState {
    step: number;
    totalSteps: number;
    data: {
        // Step 1: Team Structure
        teamName?: string;
        teamDescription?: string;
        teamInstructionFile?: string;
        roleDefinitions?: RoleDefinition[];
        members?: MemberAssignment[];

        // Step 2: Detect Agents
        availableAgents?: string[];
        selectedAgents?: string[];

        // Step 3: Configure Members
        memberConfigs?: MemberConfig[];

        // Step 4: Team Settings
        maxRounds?: number;
        
        // Internal state (temporary fields used during wizard flow)
        _roleCount?: number;
        _currentRoleIndex?: number;
        _memberCount?: number;
        _currentMemberIndex?: number;
    };
}

// ============================================================================
// Menu State Types
// ============================================================================

interface MenuState {
    configPath: string;
    config: CLIConfig;
    selectedIndex: number;
    editing: boolean;
    editingMember?: number;
    changes: Partial<CLIConfig>;
}

// ============================================================================
// Form State Types
// ============================================================================

interface FormField {
    name: string;
    label: string;
    type: 'text' | 'number' | 'multiline' | 'select';
    value: string | number;
    required?: boolean;
    options?: string[];
    validation?: (value: any) => string | null;
}

interface FormState {
    fields: FormField[];
    currentFieldIndex: number;
    values: Record<string, any>;
    errors: Record<string, string | undefined>;
}

// 主应用组件
function App({ registryPath }: { registryPath?: string } = {}) {
    const [input, setInput] = useState('');
    const [output, setOutput] = useState<React.ReactNode[]>([]);
    const [currentConfig, setCurrentConfig] = useState<CLIConfig | null>(null);
    const [currentConfigPath, setCurrentConfigPath] = useState<string | null>(null);
    const [keyCounter, setKeyCounter] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mode, setMode] = useState<AppMode>('normal');
    const [activeCoordinator, setActiveCoordinator] = useState<ConversationCoordinator | null>(null);
    const [activeTeam, setActiveTeam] = useState<Team | null>(null);
    const [executingAgent, setExecutingAgent] = useState<Member | null>(null);

    // Streaming event handling
    const pendingEventsRef = useRef<AgentEvent[]>([]);
    const flushScheduledRef = useRef(false);
    const eventListenerRef = useRef<((ev: AgentEvent) => void) | null>(null);
    const eventEmitterRef = useRef<EventEmitter | null>(null);

    // Registry path management
    const [registry] = useState(() => {
        const defaultPath = new RegistryStorage().getPath();
        return registryPath || defaultPath;
    });

    // Wizard state
    const [wizardState, setWizardState] = useState<WizardState | null>(null);

    // Menu state
    const [menuState, setMenuState] = useState<MenuState | null>(null);
    const [menuItems, setMenuItems] = useState<{ label: string; value: string }[]>([]);

    // Form state
    const [formState, setFormState] = useState<FormState | null>(null);

    // Select state
    const [selectState, setSelectState] = useState<{
        title: string;
        options: string[];
        multiSelect: boolean;
        selectedItems: Set<string>;
        onComplete: (selected: string | string[]) => void;
    } | null>(null);
    
    // Confirmation state
    const [confirmState, setConfirmState] = useState<{
        message: string;
        onConfirm: () => void;
        onCancel: () => void;
    } | null>(null);
    
    const { exit } = useApp();

    const getNextKey = () => {
        const currentKey = keyCounter;
        setKeyCounter(prev => prev + 1);
        return currentKey;
    };

    useEffect(() => {
        return () => {
            attachEventEmitter(null);
        };
    }, []);

    // 获取当前匹配的命令
    const getMatches = () => {
        if (!input.startsWith('/')) return [];
        return commands.filter(cmd => cmd.name.startsWith(input));
    };

    const truncate = (val?: string, max = 100) => {
        if (!val) return '';
        return val.length > max ? `${val.slice(0, max)}…` : val;
    };

    const renderEvent = (ev: AgentEvent): React.ReactNode | null => {
        const key = `stream-${ev.eventId || `${ev.agentId}-${ev.timestamp}`}-${getNextKey()}`;
        switch (ev.type) {
            case 'session.started':
                return null; // too verbose for UI
            case 'text':
                return (
                    <Box key={key} flexDirection="column" marginTop={0}>
                        <Text color={ev.category === 'reasoning' ? 'gray' : undefined}>
                            {ev.text}
                        </Text>
                    </Box>
                );
            case 'tool.started':
                {
                    const formatTodos = (todos: any[]) => {
                        const names = todos
                            .map(t => t?.content)
                            .filter(Boolean)
                            .join(' | ');
                        return names ? `todos: ${names}` : '';
                    };

                    const displayParam =
                        ev.input?.command ||
                        ev.input?.pattern ||
                        ev.input?.file_path ||
                        ev.input?.path ||
                        (Array.isArray(ev.input?.todos) ? formatTodos(ev.input?.todos) : '') ||
                        ev.input?.notebook_path ||
                        ev.input?.prompt ||
                        '';
                    return (
                        <Text key={key} color="yellow">
                            {displayParam
                                ? `⏺ ${ev.toolName ?? 'tool'} (${displayParam})`
                                : `⏺ ${ev.toolName ?? 'tool'}`}
                        </Text>
                    );
                }
            case 'tool.completed':
                return (
                    <Box key={key} flexDirection="column">
                        <Text color="green">⎿  {truncate(ev.output)}</Text>
                        {ev.error && <Text color="red">    error: {ev.error}</Text>}
                    </Box>
                );
            case 'turn.completed':
                return null; // internal state, UI already shows ✓ agent 完成
            case 'error':
                return (
                    <Text key={key} color="red">
                        error: {ev.error}
                    </Text>
                );
            default:
                return null;
        }
    };

    const flushPendingNow = () => {
        if (pendingEventsRef.current.length === 0) return;
        const pending = [...pendingEventsRef.current];
        pendingEventsRef.current = [];
        const nodes = pending
            .map(renderEvent)
            .filter((n): n is React.ReactNode => Boolean(n));
        if (nodes.length > 0) {
            setOutput(prev => [...prev, ...nodes]);
        }
    };

    const scheduleStreamFlush = () => {
        if (flushScheduledRef.current) return;
        flushScheduledRef.current = true;
        setTimeout(() => {
            flushScheduledRef.current = false;
            if (pendingEventsRef.current.length === 0) return;
            const pending = [...pendingEventsRef.current];
            pendingEventsRef.current = [];
            const nodes = pending
                .map(renderEvent)
                .filter((n): n is React.ReactNode => Boolean(n));
            if (nodes.length > 0) {
                setOutput(prev => [...prev, ...nodes]);
            }
        }, 16);
    };

    const attachEventEmitter = (emitter: EventEmitter | null) => {
        // Cleanup previous listener
        if (eventListenerRef.current && eventEmitterRef.current) {
            eventEmitterRef.current.off?.('agent-event', eventListenerRef.current);
            eventEmitterRef.current.removeListener?.('agent-event', eventListenerRef.current);
        }
        eventEmitterRef.current = emitter;
        if (!emitter) return;

        const listener = (ev: AgentEvent) => {
            pendingEventsRef.current.push(ev);
            scheduleStreamFlush();
        };
        eventListenerRef.current = listener;
        emitter.on('agent-event', listener);
    };

    // Handle input submission (Enter key)
    const handleInputSubmit = (value: string) => {
        if (mode === 'conversation') {
            handleConversationInput(value.trim());
            setInput('');
        } else if (mode === 'wizard') {
            handleWizardInput(value.trim());
            setInput('');
        } else if (mode === 'form') {
            handleFormSubmit();
            setInput('');
        } else {
            // Normal mode - handle autocomplete
            const matches = getMatches();
            if (matches.length > 0 && value !== matches[selectedIndex].name) {
                // Autocomplete
                setInput(matches[selectedIndex].name + ' ');
                setSelectedIndex(0);
            } else {
                // Execute command
                handleCommand(value.trim());
                setInput('');
                setSelectedIndex(0);
            }
        }
    };

    useInput((inputChar: string, key: any) => {
        // CRITICAL: Prevent parent useInput from handling events in agentsMenu mode
        // AgentsMenu component handles all input in that mode
        if (mode === 'agentsMenu') {
            return;
        }

        // ESC key - Cancel agent execution in conversation mode
        if (key.escape) {
            if (mode === 'conversation' && activeCoordinator && executingAgent && currentConfig) {
                // Check if ESC cancellation is allowed
                const allowEscCancel = currentConfig.conversation?.allowEscCancel ?? true;
                if (allowEscCancel) {
                    activeCoordinator.handleUserCancellation();
                    setOutput(prev => [...prev, <Text key={`agent-cancelled-${getNextKey()}`} color="yellow">Agent execution cancelled by user (ESC)</Text>]);
                    return;
                }
            }
        }

        // Ctrl+C 退出或取消
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
            } else if (mode === 'wizard') {
                // 取消向导
                setMode('normal');
                setWizardState(null);
                setOutput(prev => [...prev, <Text key={`wizard-cancelled-${getNextKey()}`} color="yellow">Wizard cancelled.</Text>]);
                setInput('');
                return;
            } else if (mode === 'menu') {
                // 退出菜单
                setMode('normal');
                setMenuState(null);
                setMenuItems([]);
                setOutput(prev => [...prev, <Text key={`menu-cancelled-${getNextKey()}`} color="yellow">Menu editor closed.</Text>]);
                setInput('');
                return;
            } else if (mode === 'form') {
                // 取消表单
                setMode('normal');
                setFormState(null);
                setOutput(prev => [...prev, <Text key={`form-cancelled-${getNextKey()}`} color="yellow">Form cancelled.</Text>]);
                setInput('');
                return;
            } else if (mode === 'select') {
                // 取消选择
                setMode('normal');
                setSelectState(null);
                setOutput(prev => [...prev, <Text key={`select-cancelled-${getNextKey()}`} color="yellow">Selection cancelled.</Text>]);
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
            // CRITICAL: When in modes that use TextInput (normal, conversation, wizard, form),
            // we MUST NOT handle backspace here. ink-text-input handles it internally based on cursor position.
            // If we handle it here, we blindly slice the end of the string, which is wrong if the cursor is in the middle.
            if (mode === 'normal' || mode === 'conversation' || mode === 'wizard' || mode === 'form') {
                return;
            }

            setInput(prev => prev.slice(0, -1));
            // if (mode === 'normal') setSelectedIndex(0); // This logic is likely not needed for menu/select modes
            return;
        }

        // 回车 - 仅在 menu/select 模式处理（TextInput 模式由 onSubmit 处理）
        if (key.return) {
            if (mode === 'select') {
                // 选择模式：确认选择
                handleSelectConfirm();
            } else if (mode === 'menu') {
                // 菜单模式：选择菜单项
                handleMenuSelect();
            }
            // normal/conversation/wizard/form 由 TextInput 的 onSubmit 处理
            return;
        }

        // 处理不同模式下的上下键导航
        if (key.upArrow) {
            if (mode === 'normal') {
                const matches = getMatches();
                if (matches.length > 0) {
                    setSelectedIndex(prev => (prev > 0 ? prev - 1 : matches.length - 1));
                    return;
                }
            } else if (mode === 'menu' && menuItems.length > 0) {
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : menuItems.length - 1));
                return;
            } else if (mode === 'select' && selectState) {
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : selectState.options.length - 1));
                return;
            }
        }

        if (key.downArrow) {
            if (mode === 'normal') {
                const matches = getMatches();
                if (matches.length > 0) {
                    setSelectedIndex(prev => (prev < matches.length - 1 ? prev + 1 : 0));
                    return;
                }
            } else if (mode === 'menu' && menuItems.length > 0) {
                setSelectedIndex(prev => (prev < menuItems.length - 1 ? prev + 1 : 0));
                return;
            } else if (mode === 'select' && selectState) {
                setSelectedIndex(prev => (prev < selectState.options.length - 1 ? prev + 1 : 0));
                return;
            }
        }

        // 处理空格键 (用于多选模式)
        if (inputChar === ' ' && mode === 'select' && selectState && selectState.multiSelect) {
            const option = selectState.options[selectedIndex];
            setSelectState(prev => {
                if (!prev) return prev;
                const newSelected = new Set(prev.selectedItems);
                if (newSelected.has(option)) {
                    newSelected.delete(option);
                } else {
                    newSelected.add(option);
                }
                return { ...prev, selectedItems: newSelected };
            });
            return;
        }

        // Tab键自动补全 (只在normal模式)
        if (mode === 'normal' && key.tab) {
            const matches = getMatches();
            if (matches.length > 0) {
                setInput(matches[selectedIndex].name + ' ');
                setSelectedIndex(0);
                return;
            }
        }

        // 处理确认对话框
        if (confirmState) {
            if (inputChar === 'y' || inputChar === 'Y') {
                confirmState.onConfirm();
                setConfirmState(null);
                setInput('');
                return;
            } else if (inputChar === 'n' || inputChar === 'N' || key.return) {
                confirmState.onCancel();
                setConfirmState(null);
                setInput('');
                return;
            }
        }

        // 普通字符输入 - 仅在非 TextInput 模式（menu/select）中处理
        // TextInput 模式（normal/conversation/wizard/form）由 TextInput onChange 处理
        if (inputChar && (mode === 'menu' || mode === 'select')) {
            setInput(prev => prev + inputChar);
        }
    });

    // File watching for team config directory changes
    useEffect(() => {
        // Ensure directory exists before setting up watcher
        // This handles fresh installs where directory doesn't exist yet
        ensureTeamConfigDir();

        const configDir = getTeamConfigDir();

        // Watch for file changes in team-config directory
        const watcher = watch(configDir, { recursive: false }, (eventType, filename) => {
            if (filename && filename.endsWith('.json')) {
                // Show notification when config files change
                setOutput(prev => [...prev,
                    <Text key={`file-change-${Date.now()}`} color="cyan" dimColor>
                        Team config changed. Type /team list to refresh.
                    </Text>
                ]);
            }
        });

        // Cleanup watcher on component unmount
        return () => {
            watcher.close();
        };
    }, []); // Empty dependency array: setup once on mount

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
                // Use new sendMessage API
                activeCoordinator.sendMessage(message).catch(err => {
                    setOutput(prev => [...prev, <Text key={`send-err-${getNextKey()}`} color="red">{String(err)}</Text>]);
                });
            } else {
                // Check if message has [FROM:xxx] to allow buzzing in
                if (message.match(/\[FROM:/i)) {
                     // Allow buzzing in even if not waiting
                     activeCoordinator.sendMessage(message).catch(err => {
                        setOutput(prev => [...prev, <Text key={`send-err-${getNextKey()}`} color="red">{String(err)}</Text>]);
                    });
                } else {
                    setOutput(prev => [...prev,
                        <Text key={`no-waiting-${getNextKey()}`} color="yellow">No team member is waiting for input right now. Wait for the coordinator to prompt you, or use [FROM:Name] to buzz in.</Text>
                    ]);
                }
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

            case '/team':
                handleTeamCommand(args);
                break;

            case '/agents':
                handleAgentsCommand(args);
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

    const handleTeamCommand = (args: string[]) => {
        if (args.length === 0) {
            setOutput(prev => [...prev, <TeamMenuHelp key={`team-help-${getNextKey()}`} />]);
            return;
        }

        const subcommand = args[0].toLowerCase();
        const subargs = args.slice(1);

        switch (subcommand) {
            case 'create':
                startTeamCreationWizard();
                break;

            case 'list':
                setOutput(prev => [...prev, <TeamList key={`team-list-${getNextKey()}`} />]);
                break;

            case 'deploy':
                if (subargs.length === 0) {
                    setOutput(prev => [...prev, <Text key={`team-deploy-usage-${getNextKey()}`} color="yellow">Usage: /team deploy &lt;filename&gt;</Text>]);
                    setOutput(prev => [...prev, <Text key={`team-deploy-hint-${getNextKey()}`} dimColor>Use /team list to see available configurations</Text>]);
                } else {
                    const config = loadConfig(subargs[0]);
                    if (config) {
                        initializeAndDeployTeam(config);
                    }
                }
                break;

            case 'edit':
                if (subargs.length === 0) {
                    setOutput(prev => [...prev, <Text key={`team-edit-usage-${getNextKey()}`} color="yellow">Usage: /team edit &lt;filename&gt;</Text>]);
                } else {
                    startTeamEditMenu(subargs[0]);
                }
                break;

            case 'delete':
                if (subargs.length === 0) {
                    setOutput(prev => [...prev, <Text key={`team-delete-usage-${getNextKey()}`} color="yellow">Usage: /team delete &lt;filename&gt;</Text>]);
                } else {
                    deleteTeamConfiguration(subargs[0]);
                }
                break;

            default:
                setOutput(prev => [...prev,
                    <Text key={`team-unknown-${getNextKey()}`} color="yellow">Unknown team subcommand: {subcommand}</Text>,
                    <Text key={`team-hint-${getNextKey()}`} dimColor>Type /team for available commands.</Text>
                ]);
        }
    };

    const handleAgentsCommand = (args: string[]) => {
        // If no arguments, enter interactive agents menu
        if (args.length === 0) {
            setMode('agentsMenu');
            setInput('');
            setSelectedIndex(0);
            return;
        }

        const subcommand = args[0].toLowerCase();

        // If user provides a subcommand, suggest using CLI
        setOutput(prev => [...prev,
            <Box key={`agents-cli-hint-${getNextKey()}`} flexDirection="column" marginY={1}>
                <Text color="yellow">Tip: Type /agents to enter interactive menu</Text>
                <Text dimColor>Or use the CLI: agent-chatter agents {subcommand} {args.slice(1).join(' ')}</Text>
            </Box>
        ]);
    };

    // ============================================================================
    // Wizard Input Handlers
    // ============================================================================

    const handleWizardInput = (value: string) => {
        if (!wizardState) return;

        const { step, data } = wizardState;

        if (step === 1) {
            handleWizardStep1Input(value);
        } else if (step === 2) {
            // Step 2: Detect Agents (在 Phase 2 实现)
            setOutput(prev => [...prev, <Text key={`wizard-step2-${getNextKey()}`} color="yellow">Step 2 interaction not yet implemented</Text>]);
        } else if (step === 3) {
            // Step 3: Configure Members (在 Phase 2 实现)
            setOutput(prev => [...prev, <Text key={`wizard-step3-${getNextKey()}`} color="yellow">Step 3 interaction not yet implemented</Text>]);
        } else if (step === 4) {
            // Step 4: Team Settings (在 Phase 2 实现)
            setOutput(prev => [...prev, <Text key={`wizard-step4-${getNextKey()}`} color="yellow">Step 4 interaction not yet implemented</Text>]);
        }
    };

    const renderWizardEvent = (event: WizardStep1Event, key: number) => {
        switch (event.type) {
            case 'info':
                return <Text key={`wizard-info-${key}`} color="green">{event.message}</Text>;
            case 'prompt':
                return <Text key={`wizard-prompt-${key}`} color="cyan">{event.message}</Text>;
            case 'error':
                return <Text key={`wizard-error-${key}`} color="red">{event.message}</Text>;
            case 'divider':
                return <Text key={`wizard-divider-${key}`} color="green">{(event.char || '─').repeat(60)}</Text>;
            default:
                return null;
        }
    };

    const handleWizardStep1Input = (value: string) => {
        if (!wizardState) {
            return;
        }

        const result = processWizardStep1Input(wizardState.data, value);

        setWizardState(prev => prev ? {
            ...prev,
            data: result.data,
            step: result.stepCompleted ? 2 : prev.step
        } : null);

        const nodes = result.events
            .map(event => renderWizardEvent(event, getNextKey()))
            .filter(Boolean) as React.ReactNode[];

        if (nodes.length > 0) {
            setOutput(prev => [...prev, ...nodes]);
        }
    };

    const handleFormSubmit = () => {
        if (!formState) return;
        
        const currentField = formState.fields[formState.currentFieldIndex];
        if (!currentField) return;
        
        // 验证
        if (currentField.validation) {
            const error = currentField.validation(input);
            if (error) {
                setFormState(prev => prev ? {
                    ...prev,
                    errors: { ...prev.errors, [currentField.name]: error }
                } : null);
                return;
            }
        }
        
        // 保存值并移动到下一个字段
        const newValues = { ...formState.values, [currentField.name]: input };
        const nextIndex = formState.currentFieldIndex + 1;
        
        if (nextIndex < formState.fields.length) {
            // 还有更多字段
            setFormState(prev => prev ? {
                ...prev,
                currentFieldIndex: nextIndex,
                values: newValues,
                errors: { ...prev.errors, [currentField.name]: undefined }
            } : null);
        } else {
            // 表单完成
            setOutput(prev => [...prev, <Text key={`form-complete-${getNextKey()}`} color="green">Form completed!</Text>]);
            setMode('normal');
            setFormState(null);
        }
    };

    const handleSelectConfirm = () => {
        if (!selectState) return;
        
        if (selectState.multiSelect) {
            // 多选：返回所有选中项
            const selected = Array.from(selectState.selectedItems);
            selectState.onComplete(selected);
        } else {
            // 单选：返回当前选中项
            const selected = selectState.options[selectedIndex];
            selectState.onComplete(selected);
        }
        
        setSelectState(null);
        setMode('normal');
    };

    const handleMenuSelect = () => {
        if (!menuState || !menuItems[selectedIndex]) return;
        
        const selected = menuItems[selectedIndex];
        
        switch (selected.value) {
            case 'save':
                // 保存并退出
                setOutput(prev => [...prev, <Text key={`menu-save-${getNextKey()}`} color="green">Changes saved!</Text>]);
                setMode('normal');
                setMenuState(null);
                setMenuItems([]);
                break;
                
            case 'cancel':
                // 取消并退出
                setOutput(prev => [...prev, <Text key={`menu-cancel-${getNextKey()}`} color="yellow">Changes discarded</Text>]);
                setMode('normal');
                setMenuState(null);
                setMenuItems([]);
                break;
                
            default:
                setOutput(prev => [...prev, <Text key={`menu-todo-${getNextKey()}`} color="yellow">Menu item "{selected.label}" not yet implemented</Text>]);
        }
    };

    const startTeamCreationWizard = () => {
        setOutput(prev => [...prev, 
            <Text key={`wizard-start-${getNextKey()}`} color="cyan">{'═'.repeat(60)}</Text>,
            <Text key={`wizard-title-${getNextKey()}`} bold color="cyan">Team Creation Wizard</Text>,
            <Text key={`wizard-subtitle-${getNextKey()}`} dimColor>Step 1/4: Team Structure</Text>,
            <Text key={`wizard-divider-${getNextKey()}`} color="cyan">{'─'.repeat(60)}</Text>,
            <Text key={`wizard-prompt-name-${getNextKey()}`} color="cyan">Enter team name:</Text>
        ]);
        
        // 初始化向导状态 - 从第一个字段开始
        setWizardState({
            step: 1,
            totalSteps: 4,
            data: {}
        });
        setMode('wizard');
        setInput('');
        setSelectedIndex(0);
    };

    const startTeamEditMenu = (filename: string) => {
        try {
            const resolution = resolveTeamConfigPath(filename);
            if (!resolution.exists) {
                setOutput(prev => [...prev, <Text key={`edit-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filename, resolution)}</Text>]);
                return;
            }
            if (resolution.warning) {
                setOutput(prev => [...prev, <Text key={`edit-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>]);
            }

            const content = fs.readFileSync(resolution.path, 'utf-8');
            const config = JSON.parse(content);

            setOutput(prev => [...prev, <Text key={`edit-start-${getNextKey()}`} color="cyan">Opening team editor for: {filename}</Text>]);

            // 初始化菜单状态
            setMenuState({
                configPath: filename,
                config,
                selectedIndex: 0,
                editing: false,
                changes: {}
            });

            setMenuItems([
                { label: 'Edit team information', value: 'edit_info' },
                { label: 'Add new member', value: 'add_member' },
                ...(config.team?.members || []).map((member: any, idx: number) => ({
                    label: `Edit member: ${member.displayName || member.name}`,
                    value: `edit_member_${idx}`
                })),
                { label: 'Remove member', value: 'remove_member' },
                { label: 'Change member order', value: 'change_order' },
                { label: 'Save and exit', value: 'save' },
                { label: 'Exit without saving', value: 'cancel' }
            ]);

            setMode('menu');
            setInput('');
            setSelectedIndex(0);
        } catch (error) {
            setOutput(prev => [...prev, <Text key={`edit-err-${getNextKey()}`} color="red">Error: Failed to load configuration: {String(error)}</Text>]);
        }
    };

    const listTeamConfigurations = () => {
        const configDir = getTeamConfigDir();

        // Check if directory exists, if not create it
        if (!fs.existsSync(configDir)) {
            setOutput(prev => [...prev, <Text key={`list-empty-${getNextKey()}`} color="yellow">No team configuration files found</Text>]);
            return;
        }

        const files = fs.readdirSync(configDir).filter(f =>
            f.endsWith('-config.json') || f === 'agent-chatter-config.json'
        );

        if (files.length === 0) {
            setOutput(prev => [...prev, <Text key={`list-empty-${getNextKey()}`} color="yellow">No team configuration files found</Text>]);
            return;
        }

        setOutput(prev => [...prev,
            <Box key={`list-${getNextKey()}`} flexDirection="column" marginY={1}>
                <Text bold>Available Team Configurations:</Text>
                {files.map(file => {
                    try {
                        const fullPath = path.join(configDir, file);
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const config = JSON.parse(content);
                        const isActive = currentConfigPath && file === path.basename(currentConfigPath);

                        return (
                            <Box key={file} flexDirection="column" marginLeft={2} marginTop={1}>
                                <Box>
                                    <Text color={isActive ? 'green' : 'gray'}>{isActive ? '●' : '○'} </Text>
                                    <Text bold>{file}</Text>
                                </Box>
                                <Box marginLeft={2}>
                                    <Text dimColor>Team: {config.team?.name || 'Unknown'}</Text>
                                </Box>
                                <Box marginLeft={2}>
                                    <Text dimColor>Members: {config.team?.members?.length || 0}</Text>
                                </Box>
                            </Box>
                        );
                    } catch {
                        return (
                            <Box key={file} marginLeft={2}>
                                <Text dimColor>○ {file} (invalid)</Text>
                            </Box>
                        );
                    }
                })}
            </Box>
        ]);
    };

    const showTeamConfiguration = (filename: string) => {
        try {
            const resolution = resolveTeamConfigPath(filename);
            if (!resolution.exists) {
                setOutput(prev => [...prev, <Text key={`show-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filename, resolution)}</Text>]);
                return;
            }
            if (resolution.warning) {
                setOutput(prev => [...prev, <Text key={`show-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>]);
            }

            const content = fs.readFileSync(resolution.path, 'utf-8');
            const config = JSON.parse(content);

            setOutput(prev => [...prev,
                <Box key={`show-${getNextKey()}`} flexDirection="column" marginY={1}>
                    <Text bold color="cyan">Team: {config.team?.displayName || config.team?.name || 'Unknown'}</Text>
                    <Text dimColor>File: {filename}</Text>
                    <Text dimColor>{'─'.repeat(60)}</Text>
                    
                    <Box marginTop={1} flexDirection="column">
                        <Text>Description: {config.team?.description || 'N/A'}</Text>
                        {config.team?.instructionFile && (
                            <Text>Instruction File: {config.team.instructionFile}</Text>
                        )}
                        <Text>Max Rounds: {config.maxRounds || 'Unlimited'}</Text>
                    </Box>

                    {config.team?.roleDefinitions && config.team.roleDefinitions.length > 0 && (
                        <Box marginTop={1} flexDirection="column">
                            <Text bold>Role Definitions:</Text>
                            {config.team.roleDefinitions.map((role: any, idx: number) => (
                                <Box key={idx} marginLeft={2}>
                                    <Text>• {role.name}: {role.description || 'N/A'}</Text>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {config.team?.members && config.team.members.length > 0 && (
                        <Box marginTop={1} flexDirection="column">
                            <Text bold>Members ({config.team.members.length}):</Text>
                            {config.team.members.map((member: any, idx: number) => (
                                <Box key={idx} flexDirection="column" marginLeft={2} marginTop={1}>
                                    <Text>{idx + 1}. <Text bold>{member.displayName}</Text> ({member.type}) - Role: {member.role}</Text>
                                    {member.roleDir && (
                                        <Box marginLeft={2}>
                                            <Text dimColor>Role Dir: {member.roleDir}</Text>
                                        </Box>
                                    )}
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            ]);
        } catch (error) {
            setOutput(prev => [...prev, <Text key={`show-err-${getNextKey()}`} color="red">Error: Failed to read configuration: {String(error)}</Text>]);
        }
    };

    const deleteTeamConfiguration = (filename: string) => {
        // 安全检查
        if (currentConfigPath && filename === path.basename(currentConfigPath)) {
            setOutput(prev => [...prev, <Text key={`delete-active-${getNextKey()}`} color="red">Error: Cannot delete currently loaded configuration</Text>]);
            return;
        }

        if (mode === 'conversation') {
            setOutput(prev => [...prev, <Text key={`delete-conv-${getNextKey()}`} color="red">Error: Cannot delete configuration with active conversation</Text>]);
            return;
        }

        const resolution = resolveTeamConfigPath(filename);
        if (!resolution.exists) {
            setOutput(prev => [...prev, <Text key={`delete-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filename, resolution)}</Text>]);
            return;
        }
        if (resolution.warning) {
            setOutput(prev => [...prev, <Text key={`delete-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>]);
        }

        // 显示确认对话框
        setOutput(prev => [...prev,
            <Box key={`delete-confirm-${getNextKey()}`} flexDirection="column" marginY={1}>
                <Text color="yellow">⚠  Delete Team Configuration</Text>
                <Text dimColor>{'─'.repeat(60)}</Text>
                <Text>File: {filename}</Text>
                <Text color="red">This will permanently delete this configuration file.</Text>
                <Text color="red">This action cannot be undone.</Text>
                <Text dimColor>{'─'.repeat(60)}</Text>
                <Text>Confirm deletion? [y/N]</Text>
            </Box>
        ]);

        setConfirmState({
            message: `Delete ${filename}?`,
            onConfirm: () => {
                try {
                    fs.unlinkSync(resolution.path);
                    setOutput(prev => [...prev, <Text key={`delete-success-${getNextKey()}`} color="green">✓ Team configuration deleted: {filename}</Text>]);
                } catch (error) {
                    setOutput(prev => [...prev, <Text key={`delete-err-${getNextKey()}`} color="red">Error: Failed to delete configuration: {String(error)}</Text>]);
                }
            },
            onCancel: () => {
                setOutput(prev => [...prev, <Text key={`delete-cancel-${getNextKey()}`} color="yellow">Deletion cancelled</Text>]);
            }
        });
    };

    const loadConfig = (filePath: string): CLIConfig | null => {
        try {
            const resolution = resolveTeamConfigPath(filePath);
            if (!resolution.exists) {
                setOutput(prev => [...prev, <Text key={`config-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filePath, resolution)}</Text>]);
                return null;
            }
            if (resolution.warning) {
                setOutput(prev => [...prev, <Text key={`config-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>]);
            }

            const content = fs.readFileSync(resolution.path, 'utf-8');
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

            setCurrentConfig(config);
            setCurrentConfigPath(filePath);

            setOutput(prev => [...prev,
                <Box key={`config-loaded-${getNextKey()}`} flexDirection="column">
                    <Text color="green">✓ Configuration loaded: <Text bold>{filePath}</Text></Text>
                    <Text dimColor>  Team: {config.team?.name || 'Unknown'}</Text>
                    <Text dimColor>  Agents: {config.agents?.length || 0}</Text>
                </Box>
            ]);
            return config;
        } catch (error) {
            setOutput(prev => [...prev, <Text key={`config-err-${getNextKey()}`} color="red">Error: Failed to load configuration: {String(error)}</Text>]);
            return null;
        }
    };

    const initializeAndDeployTeam = async (config: CLIConfig): Promise<ConversationCoordinator | null> => {
        try {
            setOutput(prev => [...prev, <Text key={`init-${getNextKey()}`} dimColor>Initializing services...</Text>]);

            const { coordinator, team, messageRouter, eventEmitter } = await initializeServices(config, {
                onMessage: (message: ConversationMessage) => {
                    // AI 文本已经通过流式事件显示，这里不再重复；人类/系统消息仍保留
                    if (message.speaker.type === 'ai' || message.speaker.type === 'system') {
                        return;
                    }
                    const timestamp = new Date(message.timestamp).toLocaleTimeString();
                    const nameColor = message.speaker.type === 'human' ? 'green' : 'yellow';
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
                },
                onAgentStarted: (member: Member) => {
                    flushPendingNow();
                    const color = member.themeColor ?? 'white';
                    setOutput(prev => [...prev, <Text key={`agent-start-${getNextKey()}`} backgroundColor={color} color="black">→ {member.displayName} 开始执行...</Text>]);
                    setExecutingAgent(member);
                },
                onAgentCompleted: (member: Member) => {
                    flushPendingNow();
                    const color = member.themeColor ?? 'cyan';
                    setOutput(prev => [...prev, <Text key={`agent-done-${getNextKey()}`} color={color}>✓ {member.displayName} 完成</Text>]);
                    setExecutingAgent(null);
                }
            });
            attachEventEmitter(eventEmitter);

            if (!team.members.length) {
                throw new Error('Team has no members configured. Please update the configuration file.');
            }

            setActiveCoordinator(coordinator);
            setActiveTeam(team);
            setMode('conversation');

            // NEW: Set team without starting session
            coordinator.setTeam(team);

            // If only one human member, auto-set as waiting
            const humans = team.members.filter(m => m.type === 'human');
            if (humans.length === 1) {
                coordinator.setWaitingForRoleId(humans[0].id);
            }

            setOutput(prev => [...prev,
                <Text key={`deploy-success-${getNextKey()}`} color="green">✓ Team "{team.name}" deployed successfully</Text>,
                <Text key={`deploy-hint-${getNextKey()}`} dimColor>Type your first message to begin conversation...</Text>
            ]);

            return coordinator;

        } catch (error) {
            setOutput(prev => [...prev, <Text key={`deploy-err-${getNextKey()}`} color="red">Error: {String(error)}</Text>]);
            return null;
        }
    };

    return (
        <Box flexDirection="column">
            {/* 欢迎屏幕（只在normal和conversation模式下显示） */}
            {(mode === 'normal' || mode === 'conversation') && <WelcomeScreen />}

            {/* 输出历史 */}
            {output.map((item, idx) => (
                <Box key={idx}>{item}</Box>
            ))}

            {/* ThinkingIndicator - Show when agent is executing */}
            {mode === 'conversation' && executingAgent && currentConfig &&
             currentConfig.conversation?.showThinkingTimer !== false && (
                <ThinkingIndicator
                    member={executingAgent}
                    maxTimeoutMs={currentConfig.conversation?.maxAgentResponseTime ?? 1800000}
                    allowEscCancel={currentConfig.conversation?.allowEscCancel ?? true}
                />
            )}

            {/* Wizard UI */}
            {mode === 'wizard' && wizardState && (
                <WizardView wizardState={wizardState} />
            )}

            {/* Menu UI */}
            {mode === 'menu' && menuState && (
                <MenuView 
                    menuState={menuState} 
                    menuItems={menuItems}
                    selectedIndex={selectedIndex}
                />
            )}

            {/* Form UI */}
            {mode === 'form' && formState && (
                <FormView formState={formState} />
            )}

            {/* Select UI */}
            {mode === 'select' && selectState && (
                <SelectView
                    title={selectState.title}
                    options={selectState.options}
                    selectedIndex={selectedIndex}
                    multiSelect={selectState.multiSelect}
                    selectedItems={selectState.selectedItems}
                />
            )}

            {/* Agents Menu */}
            {mode === 'agentsMenu' && (
                <AgentsMenu
                    registryPath={registry}
                    onClose={() => {
                        setMode('normal');
                        setInput('');
                    }}
                    onShowMessage={(message, color) => {
                        setOutput(prev => [
                            ...prev,
                            <Text key={`agents-msg-${keyCounter}`} color={color || 'white'}>
                                {message}
                            </Text>
                        ]);
                        setKeyCounter(prev => prev + 1);
                    }}
                />
            )}

            {/* 当前输入行 */}
            {(mode === 'normal' || mode === 'conversation' || mode === 'wizard' || mode === 'form') && (
                <Box marginTop={1}>
                    {mode === 'conversation' ? (
                        <Text color="green" bold>
                            {(() => {
                                // Get waiting member's display name for the prompt
                                if (activeCoordinator && activeTeam) {
                                    const waitingRoleId = activeCoordinator.getWaitingForRoleId();
                                    if (waitingRoleId) {
                                        const waitingMember = activeTeam.members.find(m => m.id === waitingRoleId);
                                        if (waitingMember) {
                                            return `${waitingMember.displayName}> `;
                                        }
                                    }
                                    // Fallback: if only one human, show their name
                                    const humans = activeTeam.members.filter(m => m.type === 'human');
                                    if (humans.length === 1) {
                                        return `${humans[0].displayName}> `;
                                    }
                                }
                                // Fallback to generic prompt if multiple humans or no team
                                return 'you> ';
                            })()}
                        </Text>
                    ) : mode === 'wizard' ? (
                        <Text color="cyan" bold>wizard&gt; </Text>
                    ) : mode === 'form' ? (
                        <Text color="cyan" bold>input&gt; </Text>
                    ) : (
                        <Text color="cyan">agent-chatter&gt; </Text>
                    )}
                    <TextInput
                        value={input}
                        onChange={setInput}
                        onSubmit={handleInputSubmit}
                    />
                </Box>
            )}

            {/* 命令提示（只在normal模式下显示） */}
            {mode === 'normal' && <CommandHints input={input} selectedIndex={selectedIndex} />}
        </Box>
    );
}

export function startReplInk(registryPath?: string) {
    render(<App registryPath={registryPath} />);
}
