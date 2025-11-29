/**
 * ReplModeInk - 基于 Ink + React 的交互式 REPL
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { render, Box, Text, useInput, useApp, Static, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import * as fs from 'fs';
import { watch } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { detectAllTools } from '../utils/ToolDetector.js';
import { ConversationCoordinator } from '../services/ConversationCoordinator.js';
import { initializeServices, type InitializeServicesOptions, type InitializeServicesResult } from '../services/ServiceInitializer.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { LocalExecutionEnvironment } from '../cli/LocalExecutionEnvironment.js';
import { AdapterFactory } from '../cli/adapters/AdapterFactory.js';
import type { VerificationResult } from '../registry/AgentRegistry.js';
import type { CLIConfig } from '../models/CLIConfig.js';
import { splitConfig, type UIPreferences, DEFAULT_UI_PREFERENCES } from '../cli/config/index.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { Team, RoleDefinition, Member } from '../models/Team.js';
import { processWizardStep1Input, type WizardStep1Event } from './wizard/wizardStep1Reducer.js';
import { AgentsMenu } from './components/AgentsMenu.js';
import { RegistryStorage } from '../registry/RegistryStorage.js';
import { ThinkingIndicator } from './components/ThinkingIndicator.js';
import type { AgentEvent, TodoItem, TodoStatus, TodoListEvent } from '../events/AgentEvent.js';
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
import { SessionStorageService } from '../infrastructure/SessionStorageService.js';
import type { SessionSummary } from '../models/SessionSnapshot.js';
import { RestorePrompt } from './components/RestorePrompt.js';
import { QueueDisplay } from './components/QueueDisplay.js';
import type { QueueUpdateEvent } from '../models/QueueEvent.js';

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
            <Box borderStyle="single" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column" alignItems="center">
                <Text bold color="cyan">AGENT CHATTER</Text>
                <Text dimColor>Multi-AI Conversation Orchestrator</Text>
            </Box>
            <Text dimColor>  Version {VERSION} • TestAny.io</Text>
            <Text dimColor>  Type <Text color="green">/help</Text> for available commands</Text>
            <Text dimColor>  Type <Text color="green">/exit</Text> to quit</Text>
        </Box>
    );
}

// 命令提示组件
// In alternateBuffer mode, we need a fixed height to prevent layout jumps
const MAX_VISIBLE_HINTS = 5;  // Max visible command hints (not counting scroll indicators)
const HINT_BOX_HEIGHT = MAX_VISIBLE_HINTS + 1;  // +1 for marginTop

function CommandHints({ input, selectedIndex }: { input: string; selectedIndex: number }) {
    if (!input.startsWith('/')) {
        // Return empty placeholder with fixed height to prevent layout shift
        return <Box height={HINT_BOX_HEIGHT} />;
    }

    const matches = commands.filter(cmd => cmd.name.startsWith(input));

    if (matches.length === 0) {
        // Return empty placeholder with fixed height to prevent layout shift
        return <Box height={HINT_BOX_HEIGHT} />;
    }

    // If all matches fit, show them all
    if (matches.length <= MAX_VISIBLE_HINTS) {
        return (
            <Box flexDirection="column" marginLeft={2} marginTop={1} height={HINT_BOX_HEIGHT}>
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

    // Need scrolling: reserve 1 line for scroll indicator, show MAX_VISIBLE_HINTS - 1 items
    const visibleItems = MAX_VISIBLE_HINTS - 1;

    // Calculate scroll window to keep selectedIndex visible
    let startIdx = 0;
    if (selectedIndex >= visibleItems) {
        startIdx = selectedIndex - visibleItems + 1;
    }
    startIdx = Math.max(0, Math.min(startIdx, matches.length - visibleItems));

    const displayMatches = matches.slice(startIdx, startIdx + visibleItems);
    const hasMoreAbove = startIdx > 0;
    const hasMoreBelow = startIdx + visibleItems < matches.length;

    // Build scroll indicator text
    let scrollIndicator = '';
    if (hasMoreAbove && hasMoreBelow) {
        scrollIndicator = `↑${startIdx} more above | ↓${matches.length - startIdx - visibleItems} more below`;
    } else if (hasMoreAbove) {
        scrollIndicator = `↑ ${startIdx} more above`;
    } else if (hasMoreBelow) {
        scrollIndicator = `↓ ${matches.length - startIdx - visibleItems} more below`;
    }

    return (
        <Box flexDirection="column" marginLeft={2} marginTop={1} height={HINT_BOX_HEIGHT}>
            {displayMatches.map((cmd, idx) => {
                const actualIdx = startIdx + idx;
                return (
                    <Box key={cmd.name}>
                        <Text color={actualIdx === selectedIndex ? 'green' : 'gray'} bold={actualIdx === selectedIndex}>
                            {actualIdx === selectedIndex ? '▶ ' : '  '}{cmd.name}
                        </Text>
                        <Text dimColor> - {cmd.desc}</Text>
                    </Box>
                );
            })}
            {scrollIndicator && (
                <Text dimColor>  {scrollIndicator}</Text>
            )}
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

// ===== Todo List Types and Component =====

interface ActiveTodoList {
    todoId: string;
    agentId: string;
    memberDisplayName: string;
    memberThemeColor: string;
    items: TodoItem[];
}

/**
 * Renders the active todo list with in-place updates.
 * Shows member name in their theme color.
 */
function TodoListView({ todoList }: { todoList: ActiveTodoList }) {
    const statusEmoji = (status: TodoStatus): string => {
        switch (status) {
            case 'completed': return '✅';
            case 'cancelled': return '❌';
            default: return '⭕';  // pending, in_progress
        }
    };

    return (
        <Box flexDirection="column" marginY={1}>
            <Text bold color={todoList.memberThemeColor}>
                📋 Plan ({todoList.memberDisplayName}):
            </Text>
            {todoList.items.map((item, idx) => (
                <Text
                    key={`${todoList.todoId}-${idx}`}
                    color={item.status === 'completed' ? 'green' : 'yellow'}
                >
                    {statusEmoji(item.status)} {item.text}
                </Text>
            ))}
        </Box>
    );
}

// ===== End Todo List Types and Component =====

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
            <Box borderStyle="single" borderColor="gray" padding={1}>
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
            <Box borderStyle="single" borderColor="gray" padding={1}>
                <Text bold color="cyan">Team Configuration Editor</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold>Team: {menuState.config.team?.name || 'Unknown'}</Text>
                <Text dimColor>File: {menuState.configPath}</Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
                <Text bold>Main Menu</Text>
                <Text dimColor>{'─'.repeat(40)}</Text>
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
            <Box borderStyle="single" borderColor="gray" padding={1}>
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
            <Box borderStyle="single" borderColor="gray" padding={1}>
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
type AppMode = 'normal' | 'conversation' | 'wizard' | 'menu' | 'form' | 'select' | 'agentsMenu' | 'restore-prompt';

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
    baseDir: string;
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
    const { stdout } = useStdout();
    const terminalWidth = stdout?.columns || 80;

    const [input, setInput] = useState('');
    // Initialize output with WelcomeScreen as first item - it will be rendered once via Static
    const [output, setOutput] = useState<React.ReactNode[]>([<WelcomeScreen key="welcome" />]);
    const [currentConfig, setCurrentConfig] = useState<CLIConfig | null>(null);
    const [currentConfigPath, setCurrentConfigPath] = useState<string | null>(null);
    const [uiPrefs, setUiPrefs] = useState<UIPreferences>(DEFAULT_UI_PREFERENCES);
    const [keyCounter, setKeyCounter] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mode, setMode] = useState<AppMode>('normal');
    const [activeCoordinator, setActiveCoordinator] = useState<ConversationCoordinator | null>(null);
    const [activeTeam, setActiveTeam] = useState<Team | null>(null);
    const [executingAgent, setExecutingAgent] = useState<Member | null>(null);
    const [activeTodoList, setActiveTodoList] = useState<ActiveTodoList | null>(null);
    const [isExiting, setIsExiting] = useState(false);
    const [queueState, setQueueState] = useState<QueueUpdateEvent | null>(null);

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

    // Session restore state
    const [sessionStorage] = useState(() => new SessionStorageService());
    const [pendingRestore, setPendingRestore] = useState<{
        team: Team;
        config: CLIConfig;
        session: SessionSummary;
        coordinator: ConversationCoordinator;
        eventEmitter: EventEmitter;
    } | null>(null);

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

    /**
     * Append node(s) to output, with optional sliding window to keep render fast.
     * Supports both single ReactNode and ReactNode[] - arrays are flattened into individual items.
     */
    const appendOutput = (nodeOrNodes: React.ReactNode | React.ReactNode[], maxItems = 500) => {
        setOutput(prev => {
            // Flatten arrays into individual items for correct sliding window counting
            const nodesToAdd = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
            const next = [...prev, ...nodesToAdd];
            if (next.length > maxItems) {
                // drop oldest
                return next.slice(next.length - maxItems);
            }
            return next;
        });
    };

    // Logger for Core services - bridges to REPL UI
    const uiLogger: ILogger = useMemo(() => ({
        debug: (message: string, _context?: Record<string, unknown>) => {
            // Debug messages are silent in UI unless verbose mode
            appendOutput(<Text key={`log-debug-${getNextKey()}`} dimColor>{message}</Text>);
        },
        info: (message: string, _context?: Record<string, unknown>) => {
            appendOutput(<Text key={`log-info-${getNextKey()}`} color="cyan">{message}</Text>);
        },
        warn: (message: string, _context?: Record<string, unknown>) => {
            appendOutput(<Text key={`log-warn-${getNextKey()}`} color="yellow">{message}</Text>);
        },
        error: (message: string, _context?: Record<string, unknown>) => {
            appendOutput(<Text key={`log-error-${getNextKey()}`} color="red">{message}</Text>);
        },
    }), [appendOutput]);

    // Helper to format verification results for UI display
    const formatVerificationResults = (results: Map<string, VerificationResult>) => {
        for (const [agentType, result] of results) {
            if (result.status === 'verified') {
                appendOutput(<Text key={`verify-${agentType}-${getNextKey()}`} color="green">✓ Agent {agentType} verified</Text>);
            } else if (result.status === 'verified_with_warnings') {
                appendOutput(<Text key={`verify-${agentType}-${getNextKey()}`} color="yellow">⚠ Agent {agentType} verified with warnings</Text>);
            }
            if (result.checks && result.checks.length > 0) {
                appendOutput(<Text key={`verify-checks-${agentType}-${getNextKey()}`} dimColor>  Verification checks:</Text>);
                for (const check of result.checks) {
                    const icon = check.passed ? '✓' : '✗';
                    appendOutput(<Text key={`check-${agentType}-${check.name}-${getNextKey()}`} dimColor>    {icon} {check.name}: {check.message}</Text>);
                    if (check.warning) {
                        appendOutput(<Text key={`check-warn-${agentType}-${check.name}-${getNextKey()}`} color="yellow">      ⚠ {check.warning}</Text>);
                    }
                }
            }
        }
    };

    const renderEvent = (ev: AgentEvent): React.ReactNode | null => {
        const key = `stream-${ev.eventId || `${ev.agentId}-${ev.timestamp}`}-${getNextKey()}`;
        switch (ev.type) {
            case 'session.started':
                return null; // too verbose for UI
            case 'text':
                // Skip 'result' category for Claude - it duplicates the streaming 'assistant-message' content
                // We display 'assistant-message' (streaming chunks) for real-time feedback
                // but skip 'result' (final complete response) to avoid showing the same text twice
                if (ev.category === 'result') {
                    return null;
                }
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
            case 'todo_list':
                // IMPORTANT: Do NOT render here - handled separately via activeTodoList state
                return null;
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
            appendOutput(nodes);
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
                appendOutput(nodes);
            }
        }, 16);
    };

    /**
     * Handle todo_list events - update activeTodoList state for in-place rendering.
     * Looks up member info from activeTeam to get display name and theme color.
     */
    const handleTodoListEvent = (ev: TodoListEvent) => {
        // Find the member info for display
        let memberDisplayName = ev.agentId;
        let memberThemeColor = 'cyan';

        if (activeTeam) {
            const member = activeTeam.members.find(m => m.id === ev.agentId);
            if (member) {
                memberDisplayName = member.displayName;
                memberThemeColor = member.themeColor || 'cyan';
            }
        }

        setActiveTodoList({
            todoId: ev.todoId,
            agentId: ev.agentId,
            memberDisplayName,
            memberThemeColor,
            items: ev.items
        });
    };

    /**
     * Clear todo list - call on agent switch, cancel, or error.
     */
    const clearTodoList = () => {
        setActiveTodoList(null);
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
            // Handle todo_list events separately - update state, don't add to output
            if (ev.type === 'todo_list') {
                handleTodoListEvent(ev as TodoListEvent);
                return;
            }
            pendingEventsRef.current.push(ev);
            scheduleStreamFlush();
        };
        eventListenerRef.current = listener;
        emitter.on('agent-event', listener);
    };

    // Handle input submission (Enter key)
    const handleInputSubmit = (value: string) => {
        if (mode === 'conversation') {
            const success = handleConversationInput(value.trim());
            // Only clear input if message was successfully processed
            // If validation failed, keep the input so user can edit and retry
            if (success) {
                setInput('');
            }
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

        // Handle restore-prompt mode (R/N key selection)
        if (mode === 'restore-prompt' && pendingRestore) {
            const choice = inputChar.toLowerCase();

            if (choice === 'r') {
                // Resume session
                handleRestoreChoice(true);
                return;
            }

            if (choice === 'n') {
                // Start new session
                handleRestoreChoice(false);
                return;
            }

            // ESC to cancel and return to normal mode
            if (key.escape) {
                setPendingRestore(null);
                setMode('normal');
                appendOutput(<Text key={`restore-cancel-${getNextKey()}`} color="yellow">Session restore cancelled</Text>);
                return;
            }

            // Invalid input - show hint
            if (inputChar && !key.ctrl) {
                appendOutput(<Text key={`restore-hint-${getNextKey()}`} dimColor>Press R to resume or N to start new</Text>);
            }
            return;
        }

        // ESC key - Cancel agent execution in conversation mode
        if (key.escape) {
            if (mode === 'conversation' && activeCoordinator && executingAgent) {
                // Check if ESC cancellation is allowed (LLD-05: use uiPrefs)
                if (uiPrefs.allowEscCancel) {
                    // handleUserCancellation is async, fire-and-forget for UI responsiveness
                    activeCoordinator.handleUserCancellation().catch(() => {
                        // Errors already logged in method
                    });
                    clearTodoList(); // Clear todo list on cancel
                    appendOutput(<Text key={`agent-cancelled-${getNextKey()}`} color="yellow">Agent execution cancelled by user (ESC)</Text>);
                    return;
                }
            }
        }

        // Ctrl+C 退出或取消
        if (key.ctrl && inputChar === 'c') {
            if (mode === 'conversation' && activeCoordinator) {
                // 退出对话模式
                // stop() is async, fire-and-forget for UI responsiveness
                activeCoordinator.stop().catch(() => {
                    // Errors already logged in method
                });
                clearTodoList(); // Clear todo list on exit
                setQueueState(null); // Clear queue display on exit
                setMode('normal');
                setActiveCoordinator(null);
                setActiveTeam(null);
                appendOutput(<Text key={`conv-stopped-${getNextKey()}`} color="yellow">Conversation stopped.</Text>);
                setInput('');
                return;
            } else if (mode === 'wizard') {
                // 取消向导
                setMode('normal');
                setWizardState(null);
                appendOutput(<Text key={`wizard-cancelled-${getNextKey()}`} color="yellow">Wizard cancelled.</Text>);
                setInput('');
                return;
            } else if (mode === 'menu') {
                // 退出菜单
                setMode('normal');
                setMenuState(null);
                setMenuItems([]);
                appendOutput(<Text key={`menu-cancelled-${getNextKey()}`} color="yellow">Menu editor closed.</Text>);
                setInput('');
                return;
            } else if (mode === 'form') {
                // 取消表单
                setMode('normal');
                setFormState(null);
                appendOutput(<Text key={`form-cancelled-${getNextKey()}`} color="yellow">Form cancelled.</Text>);
                setInput('');
                return;
            } else if (mode === 'select') {
                // 取消选择
                setMode('normal');
                setSelectState(null);
                appendOutput(<Text key={`select-cancelled-${getNextKey()}`} color="yellow">Selection cancelled.</Text>);
                setInput('');
                return;
            } else {
                appendOutput(<Text color="cyan" key="goodbye">Goodbye! 👋</Text>);
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
                appendOutput(
                    <Text key={`file-change-${Date.now()}`} color="cyan" dimColor>
                        Team config changed. Type /team list to refresh.
                    </Text>
                );
            }
        });

        // Cleanup watcher on component unmount
        return () => {
            watcher.close();
        };
    }, []); // Empty dependency array: setup once on mount

    /**
     * Handle conversation input. Returns true if message was processed successfully,
     * false if validation failed and the input should be preserved for user to edit.
     */
    const handleConversationInput = (message: string): boolean => {
        if (!message) return true; // Empty message is "successful" (nothing to do)

        // 检查是否是退出对话命令
        if (message === '/end' || message === '/exit' || message === '/quit') {
            if (activeCoordinator) {
                // stop() is async, fire-and-forget for UI responsiveness
                activeCoordinator.stop().catch(() => {
                    // Errors already logged in method
                });
            }
            setMode('normal');
            setActiveCoordinator(null);
            setActiveTeam(null);
            setQueueState(null); // Clear queue display on exit
            appendOutput(
                <Box key={`conv-end-${getNextKey()}`} flexDirection="column" marginTop={1}>
                    <Text color="green" dimColor>{'─'.repeat(40)}</Text>
                    <Text bold color="green">Conversation Ended</Text>
                    <Text dimColor>You are back in normal mode. Type /help for commands.</Text>
                    <Text color="green" dimColor>{'─'.repeat(40)}</Text>
                </Box>
            );
            return true;
        }

        // 通过coordinator继续对话
        // 检查是否有role在等待输入
        if (activeCoordinator && activeTeam) {
            // Validate [TEAM_TASK] format if present
            // Correct format: [TEAM_TASK:description] - must have colon and closing bracket
            // MECE: if message contains "TEAM_TASK", it must match the correct pattern exactly
            const hasTeamTaskKeyword = /\bTEAM_TASK\b/i.test(message);
            if (hasTeamTaskKeyword) {
                const correctFormat = /\[TEAM_TASK:\s*[^\]]+\]/i;
                if (!correctFormat.test(message)) {
                    appendOutput(
                        <Box key={`task-hint-${getNextKey()}`} flexDirection="column" marginY={1}>
                            <Text color="red">✗ Invalid [TEAM_TASK] format. Message not sent.</Text>
                            <Text dimColor>Correct format: <Text color="green">[TEAM_TASK:your task description]</Text></Text>
                            <Text dimColor>Example: [TEAM_TASK:Review the PRD document] [NEXT:max]</Text>
                        </Box>
                    );
                    return false; // Validation failed - preserve input for user to edit
                }
            }

            const waitingRoleId = activeCoordinator.getWaitingForMemberId();

            // Check if single human - allow sending without explicit waitingRoleId
            const humans = activeTeam.members.filter(m => m.type === 'human');
            const isSingleHuman = humans.length === 1;

            if (waitingRoleId || isSingleHuman) {
                const displayRole = waitingRoleId
                    ? activeTeam.members.find(r => r.id === waitingRoleId)
                    : humans[0];
                appendOutput(
                    <Box key={`user-msg-${getNextKey()}`} flexDirection="column" marginTop={1}>
                        <Text color="green">[{displayRole?.displayName || 'You'}]:</Text>
                        <Text>{message}</Text>
                        <Text dimColor>{'─'.repeat(40)}</Text>
                    </Box>
                );
                // Use new sendMessage API
                activeCoordinator.sendMessage(message).catch(err => {
                    appendOutput(<Text key={`send-err-${getNextKey()}`} color="red">{String(err)}</Text>);
                });
                return true;
            } else {
                // Check if message has [FROM:xxx] to allow buzzing in
                if (message.match(/\[FROM:/i)) {
                     // Allow buzzing in even if not waiting
                     activeCoordinator.sendMessage(message).catch(err => {
                        appendOutput(<Text key={`send-err-${getNextKey()}`} color="red">{String(err)}</Text>);
                    });
                    return true;
                } else {
                    appendOutput(
                        <Text key={`no-waiting-${getNextKey()}`} color="yellow">No team member is waiting for input right now. Wait for the coordinator to prompt you, or use [FROM:Name] to buzz in.</Text>
                    );
                    return false; // Keep input so user can add [FROM:xxx]
                }
            }
        }
        return true;
    };

    const handleCommand = async (cmd: string) => {
        if (!cmd) return;

        const parts = cmd.split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        // 添加用户输入到输出
        appendOutput(<Text key={`input-${getNextKey()}`} color="cyan">agent-chatter&gt; {cmd}</Text>);

        switch (command) {
            case '/help':
                appendOutput(<HelpMessage key={`help-${getNextKey()}`} />);
                break;

            case '/status':
                appendOutput(<Text key={`status-msg-${getNextKey()}`} dimColor>Detecting AI CLI tools...</Text>);
                const tools = await detectAllTools();
                appendOutput(<StatusDisplay key={`status-${getNextKey()}`} tools={tools} />);
                break;

            case '/list':
                appendOutput(<Text key={`list-msg-${getNextKey()}`} dimColor>Looking for configuration files...</Text>);
                appendOutput(<ConfigList key={`list-${getNextKey()}`} currentConfigPath={currentConfigPath} />);
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
                setIsExiting(true);
                appendOutput(<Text color="cyan" key="goodbye">Goodbye! 👋</Text>);
                setTimeout(() => exit(), 100);
                break;

            default:
                // Check if this looks like a conversation message (not starting with /)
                if (!command.startsWith('/')) {
                    appendOutput(
                        <Box key={`not-deployed-${getNextKey()}`} flexDirection="column" marginY={1}>
                            <Text color="yellow">⚠ You are not in conversation mode.</Text>
                            <Text dimColor>To start a conversation:</Text>
                            <Text dimColor>  1. Use <Text color="green">/team list</Text> to see available teams</Text>
                            <Text dimColor>  2. Use <Text color="green">/team deploy &lt;filename&gt;</Text> to deploy a team</Text>
                            <Text dimColor>  3. Then type your message to start talking</Text>
                        </Box>
                    );
                } else {
                    appendOutput(<Text key={`unknown-${getNextKey()}`} color="yellow">Unknown command: {command}</Text>);
                    appendOutput(<Text key={`help-hint-${getNextKey()}`} dimColor>Type /help for available commands.</Text>);
                }
        }
    };

    const handleTeamCommand = (args: string[]) => {
        if (args.length === 0) {
            appendOutput(<TeamMenuHelp key={`team-help-${getNextKey()}`} />);
            return;
        }

        const subcommand = args[0].toLowerCase();
        const subargs = args.slice(1);

        switch (subcommand) {
            case 'create':
                startTeamCreationWizard();
                break;

            case 'list':
                appendOutput(<TeamList key={`team-list-${getNextKey()}`} />);
                break;

            case 'deploy':
                if (subargs.length === 0) {
                    appendOutput(<Text key={`team-deploy-usage-${getNextKey()}`} color="yellow">Usage: /team deploy &lt;filename&gt;</Text>);
                    appendOutput(<Text key={`team-deploy-hint-${getNextKey()}`} dimColor>Use /team list to see available configurations</Text>);
                } else {
                    const config = loadConfig(subargs[0]);
                    if (config) {
                        // Check for existing session and prompt for restore
                        checkAndPromptRestore(config);
                    }
                }
                break;

            case 'edit':
                if (subargs.length === 0) {
                    appendOutput(<Text key={`team-edit-usage-${getNextKey()}`} color="yellow">Usage: /team edit &lt;filename&gt;</Text>);
                } else {
                    startTeamEditMenu(subargs[0]);
                }
                break;

            case 'delete':
                if (subargs.length === 0) {
                    appendOutput(<Text key={`team-delete-usage-${getNextKey()}`} color="yellow">Usage: /team delete &lt;filename&gt;</Text>);
                } else {
                    deleteTeamConfiguration(subargs[0]);
                }
                break;

            default:
                appendOutput(<Text key={`team-unknown-${getNextKey()}`} color="yellow">Unknown team subcommand: {subcommand}</Text>);
                appendOutput(<Text key={`team-hint-${getNextKey()}`} dimColor>Type /team for available commands.</Text>);
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
        appendOutput(
            <Box key={`agents-cli-hint-${getNextKey()}`} flexDirection="column" marginY={1}>
                <Text color="yellow">Tip: Type /agents to enter interactive menu</Text>
                <Text dimColor>Or use the CLI: agent-chatter agents {subcommand} {args.slice(1).join(' ')}</Text>
            </Box>
        );
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
            appendOutput(<Text key={`wizard-step2-${getNextKey()}`} color="yellow">Step 2 interaction not yet implemented</Text>);
        } else if (step === 3) {
            // Step 3: Configure Members (在 Phase 2 实现)
            appendOutput(<Text key={`wizard-step3-${getNextKey()}`} color="yellow">Step 3 interaction not yet implemented</Text>);
        } else if (step === 4) {
            // Step 4: Team Settings (在 Phase 2 实现)
            appendOutput(<Text key={`wizard-step4-${getNextKey()}`} color="yellow">Step 4 interaction not yet implemented</Text>);
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
                return <Text key={`wizard-divider-${key}`} color="green" dimColor>{(event.char || '─').repeat(40)}</Text>;
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
            nodes.forEach(node => appendOutput(node));
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
            appendOutput(<Text key={`form-complete-${getNextKey()}`} color="green">Form completed!</Text>);
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
                appendOutput(<Text key={`menu-save-${getNextKey()}`} color="green">Changes saved!</Text>);
                setMode('normal');
                setMenuState(null);
                setMenuItems([]);
                break;
                
            case 'cancel':
                // 取消并退出
                appendOutput(<Text key={`menu-cancel-${getNextKey()}`} color="yellow">Changes discarded</Text>);
                setMode('normal');
                setMenuState(null);
                setMenuItems([]);
                break;
                
            default:
                appendOutput(<Text key={`menu-todo-${getNextKey()}`} color="yellow">Menu item "{selected.label}" not yet implemented</Text>);
        }
    };

    const startTeamCreationWizard = () => {
        appendOutput(<Text key={`wizard-start-${getNextKey()}`} color="cyan" dimColor>{'═'.repeat(40)}</Text>);
        appendOutput(<Text key={`wizard-title-${getNextKey()}`} bold color="cyan">Team Creation Wizard</Text>);
        appendOutput(<Text key={`wizard-subtitle-${getNextKey()}`} dimColor>Step 1/4: Team Structure</Text>);
        appendOutput(<Text key={`wizard-divider-${getNextKey()}`} color="cyan" dimColor>{'─'.repeat(40)}</Text>);
        appendOutput(<Text key={`wizard-prompt-name-${getNextKey()}`} color="cyan">Enter team name:</Text>);
        
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
                appendOutput(<Text key={`edit-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filename, resolution)}</Text>);
                return;
            }
            if (resolution.warning) {
                appendOutput(<Text key={`edit-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>);
            }

            const content = fs.readFileSync(resolution.path, 'utf-8');
            const config = JSON.parse(content);

            appendOutput(<Text key={`edit-start-${getNextKey()}`} color="cyan">Opening team editor for: {filename}</Text>);

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
            appendOutput(<Text key={`edit-err-${getNextKey()}`} color="red">Error: Failed to load configuration: {String(error)}</Text>);
        }
    };

    const listTeamConfigurations = () => {
        const configDir = getTeamConfigDir();

        // Check if directory exists, if not create it
        if (!fs.existsSync(configDir)) {
            appendOutput(<Text key={`list-empty-${getNextKey()}`} color="yellow">No team configuration files found</Text>);
            return;
        }

        const files = fs.readdirSync(configDir).filter(f =>
            f.endsWith('-config.json') || f === 'agent-chatter-config.json'
        );

        if (files.length === 0) {
            appendOutput(<Text key={`list-empty-${getNextKey()}`} color="yellow">No team configuration files found</Text>);
            return;
        }

        appendOutput(
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
        );
    };

    const showTeamConfiguration = (filename: string) => {
        try {
            const resolution = resolveTeamConfigPath(filename);
            if (!resolution.exists) {
                appendOutput(<Text key={`show-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filename, resolution)}</Text>);
                return;
            }
            if (resolution.warning) {
                appendOutput(<Text key={`show-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>);
            }

            const content = fs.readFileSync(resolution.path, 'utf-8');
            const config = JSON.parse(content);

            appendOutput(
                <Box key={`show-${getNextKey()}`} flexDirection="column" marginY={1}>
                    <Text bold color="cyan">Team: {config.team?.displayName || config.team?.name || 'Unknown'}</Text>
                    <Text dimColor>File: {filename}</Text>
                    <Text dimColor>{'─'.repeat(40)}</Text>

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
                                    {member.baseDir && (
                                        <Box marginLeft={2}>
                                            <Text dimColor>Base Dir: {member.baseDir}</Text>
                                        </Box>
                                    )}
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
            );
        } catch (error) {
            appendOutput(<Text key={`show-err-${getNextKey()}`} color="red">Error: Failed to read configuration: {String(error)}</Text>);
        }
    };

    const deleteTeamConfiguration = (filename: string) => {
        // 安全检查
        if (currentConfigPath && filename === path.basename(currentConfigPath)) {
            appendOutput(<Text key={`delete-active-${getNextKey()}`} color="red">Error: Cannot delete currently loaded configuration</Text>);
            return;
        }

        if (mode === 'conversation') {
            appendOutput(<Text key={`delete-conv-${getNextKey()}`} color="red">Error: Cannot delete configuration with active conversation</Text>);
            return;
        }

        const resolution = resolveTeamConfigPath(filename);
        if (!resolution.exists) {
            appendOutput(<Text key={`delete-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filename, resolution)}</Text>);
            return;
        }
        if (resolution.warning) {
            appendOutput(<Text key={`delete-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>);
        }

        // 显示确认对话框
        appendOutput(
            <Box key={`delete-confirm-${getNextKey()}`} flexDirection="column" marginY={1}>
                <Text color="yellow">⚠  Delete Team Configuration</Text>
                <Text dimColor>{'─'.repeat(40)}</Text>
                <Text>File: {filename}</Text>
                <Text color="red">This will permanently delete this configuration file.</Text>
                <Text color="red">This action cannot be undone.</Text>
                <Text dimColor>{'─'.repeat(40)}</Text>
                <Text>Confirm deletion? [y/N]</Text>
            </Box>
        );

        setConfirmState({
            message: `Delete ${filename}?`,
            onConfirm: () => {
                try {
                    fs.unlinkSync(resolution.path);
                    appendOutput(<Text key={`delete-success-${getNextKey()}`} color="green">✓ Team configuration deleted: {filename}</Text>);
                } catch (error) {
                    appendOutput(<Text key={`delete-err-${getNextKey()}`} color="red">Error: Failed to delete configuration: {String(error)}</Text>);
                }
            },
            onCancel: () => {
                appendOutput(<Text key={`delete-cancel-${getNextKey()}`} color="yellow">Deletion cancelled</Text>);
            }
        });
    };

    const loadConfig = (filePath: string): CLIConfig | null => {
        try {
            const resolution = resolveTeamConfigPath(filePath);
            if (!resolution.exists) {
                appendOutput(<Text key={`config-notfound-${getNextKey()}`} color="red">{formatMissingConfigError(filePath, resolution)}</Text>);
                return null;
            }
            if (resolution.warning) {
                appendOutput(<Text key={`config-warning-${getNextKey()}`} color="yellow">{resolution.warning}</Text>);
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

            appendOutput(
                <Box key={`config-loaded-${getNextKey()}`} flexDirection="column">
                    <Text color="green">✓ Configuration loaded: <Text bold>{filePath}</Text></Text>
                    <Text dimColor>  Team: {config.team?.name || 'Unknown'}</Text>
                    <Text dimColor>  Agents: {config.agents?.length || 0}</Text>
                </Box>
            );
            return config;
        } catch (error) {
            appendOutput(<Text key={`config-err-${getNextKey()}`} color="red">Error: Failed to load configuration: {String(error)}</Text>);
            return null;
        }
    };

    const initializeAndDeployTeam = async (config: CLIConfig): Promise<ConversationCoordinator | null> => {
        try {
            appendOutput(<Text key={`init-${getNextKey()}`} dimColor>Initializing services...</Text>);

            // LLD-05: Split config into Core config and UI preferences
            const { coreConfig, uiPrefs: extractedUiPrefs } = splitConfig(config);
            setUiPrefs(extractedUiPrefs);

            // CLI layer provides concrete implementations
            const executionEnv = new LocalExecutionEnvironment();
            const adapterFactory = new AdapterFactory(executionEnv);

            const { coordinator, team, messageRouter, eventEmitter, verificationResults } = await initializeServices(coreConfig, {
                logger: uiLogger,
                executionEnv,
                adapterFactory,
                onMessage: (message: ConversationMessage) => {
                    // AI 文本已经通过流式事件显示，这里不再重复
                    // Human 消息已经在 handleConversationInput 中显示，这里也不再重复
                    // 只保留 system 消息（如果有的话）
                    if (message.speaker.type === 'ai' || message.speaker.type === 'human') {
                        return;
                    }
                    const timestamp = new Date(message.timestamp).toLocaleTimeString();
                    appendOutput(
                        <Box key={`msg-${getNextKey()}`} flexDirection="column" marginTop={1}>
                            <Text color="yellow">[{timestamp}] {message.speaker.displayName}:</Text>
                            <Text>{message.content}</Text>
                            <Text dimColor>{'─'.repeat(60)}</Text>
                        </Box>
                    );
                },
                onStatusChange: (status) => {
                    appendOutput(<Text key={`status-${getNextKey()}`} dimColor>[Status] {status}</Text>);
                },
                onAgentStarted: (member: Member) => {
                    flushPendingNow();
                    clearTodoList(); // Clear previous agent's todo list on agent switch
                    const color = member.themeColor ?? 'white';
                    const displayLabel = member.displayRole
                        ? `${member.displayName} (${member.displayRole})`
                        : member.displayName;
                    appendOutput(<Text key={`agent-start-${getNextKey()}`} backgroundColor={color} color="black">→ {displayLabel} started...</Text>);
                    setExecutingAgent(member);
                },
                onAgentCompleted: (member: Member) => {
                    flushPendingNow();
                    // NOTE: Do NOT clearTodoList here - per design, todo list stays visible
                    // after turn completes until next agent starts or new todo arrives
                    const color = member.themeColor ?? 'white';
                    const displayLabel = member.displayRole
                        ? `${member.displayName} (${member.displayRole})`
                        : member.displayName;
                    appendOutput(<Text key={`agent-done-${getNextKey()}`} backgroundColor={color} color="black">✓ {displayLabel} completed</Text>);
                    appendOutput(<Text key={`agent-done-spacer-${getNextKey()}`}>{' '}</Text>);
                    setExecutingAgent(null);
                },
                onQueueUpdate: (event: QueueUpdateEvent) => {
                    setQueueState(event);
                },
                onPartialResolveFailure: (skipped: string[], available: string[]) => {
                    appendOutput(
                        <Text key={`partial-fail-${getNextKey()}`} color="yellow">
                            ⚠️ Skipped unknown members: {skipped.join(', ')}
                            {'\n'}   Available: {available.join(', ')}
                        </Text>
                    );
                },
                onUnresolvedAddressees: (addressees: string[], _message: ConversationMessage) => {
                    const availableNames = team.members.map(m => m.name);
                    appendOutput(
                        <Text key={`unresolved-${getNextKey()}`} color="red">
                            ❌ Cannot resolve: {addressees.join(', ')}
                            {'\n'}   Available: {availableNames.join(', ')}
                        </Text>
                    );
                }
            });
            attachEventEmitter(eventEmitter);

            // Display verification results from Core
            formatVerificationResults(verificationResults);

            if (!team.members.length) {
                throw new Error('Team has no members configured. Please update the configuration file.');
            }

            setActiveCoordinator(coordinator);
            setActiveTeam(team);
            setMode('conversation');

            // Set team (async for potential session restore in the future)
            await coordinator.setTeam(team);

            // If only one human member, auto-set as waiting
            const humans = team.members.filter(m => m.type === 'human');
            if (humans.length === 1) {
                coordinator.setWaitingForMemberId(humans[0].id);
            }

            appendOutput(<Text key={`deploy-success-${getNextKey()}`} color="green">✓ Team "{team.name}" deployed successfully</Text>);
            appendOutput(
                <Box key={`team-info-${getNextKey()}`} flexDirection="column" marginLeft={2}>
                    <Text>Team Name: {team.displayName ?? team.name}</Text>
                    {team.description && <Text>Team Description: {team.description}</Text>}
                    <Text>Members:</Text>
                    {team.members.map((m, idx) => {
                        const bgColor = m.themeColor ?? 'white';
                        return (
                            <Text key={`member-${idx}`}>  <Text backgroundColor={bgColor} color="black">{m.displayName}{m.displayRole ? ` (${m.displayRole})` : ''}</Text></Text>
                        );
                    })}
                </Box>
            );
            appendOutput(<Text key={`deploy-hint-${getNextKey()}`} dimColor>Type your message below to continue. Use [NEXT:member_name] to assign the next speaker, use [TEAM_TASK: your task] to post your task to the team.</Text>);

            // Force a re-render after Static updates in alternateBuffer mode
            // This ensures the input prompt is visible after deploy
            setTimeout(() => setInput(prev => prev), 50);

            return coordinator;

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            appendOutput(<Text key={`deploy-err-${getNextKey()}`} color="red">✗ {errMsg}</Text>);
            return null;
        }
    };

    /**
     * Check for existing session and show restore prompt if found
     */
    const checkAndPromptRestore = async (config: CLIConfig): Promise<void> => {
        try {
            appendOutput(<Text key={`init-${getNextKey()}`} dimColor>Initializing services...</Text>);

            // LLD-05: Split config into Core config and UI preferences
            const { coreConfig, uiPrefs: extractedUiPrefs } = splitConfig(config);
            setUiPrefs(extractedUiPrefs);

            // CLI layer provides concrete implementations
            const executionEnv = new LocalExecutionEnvironment();
            const adapterFactory = new AdapterFactory(executionEnv);

            const { coordinator, team, messageRouter, eventEmitter, verificationResults } = await initializeServices(coreConfig, {
                logger: uiLogger,
                executionEnv,
                adapterFactory,
                onMessage: (message: ConversationMessage) => {
                    if (message.speaker.type === 'ai' || message.speaker.type === 'human') {
                        return;
                    }
                    const timestamp = new Date(message.timestamp).toLocaleTimeString();
                    appendOutput(
                        <Box key={`msg-${getNextKey()}`} flexDirection="column" marginTop={1}>
                            <Text color="yellow">[{timestamp}] {message.speaker.displayName}:</Text>
                            <Text>{message.content}</Text>
                            <Text dimColor>{'─'.repeat(60)}</Text>
                        </Box>
                    );
                },
                onStatusChange: (status) => {
                    appendOutput(<Text key={`status-${getNextKey()}`} dimColor>[Status] {status}</Text>);
                },
                onAgentStarted: (member: Member) => {
                    flushPendingNow();
                    clearTodoList();
                    const color = member.themeColor ?? 'white';
                    const displayLabel = member.displayRole
                        ? `${member.displayName} (${member.displayRole})`
                        : member.displayName;
                    appendOutput(<Text key={`agent-start-${getNextKey()}`} backgroundColor={color} color="black">→ {displayLabel} started...</Text>);
                    setExecutingAgent(member);
                },
                onAgentCompleted: (member: Member) => {
                    flushPendingNow();
                    const color = member.themeColor ?? 'white';
                    const displayLabel = member.displayRole
                        ? `${member.displayName} (${member.displayRole})`
                        : member.displayName;
                    appendOutput(<Text key={`agent-done-${getNextKey()}`} backgroundColor={color} color="black">✓ {displayLabel} completed</Text>);
                    appendOutput(<Text key={`agent-done-spacer-${getNextKey()}`}>{' '}</Text>);
                    setExecutingAgent(null);
                },
                onQueueUpdate: (event: QueueUpdateEvent) => {
                    setQueueState(event);
                },
                onPartialResolveFailure: (skipped: string[], available: string[]) => {
                    appendOutput(
                        <Text key={`partial-fail-${getNextKey()}`} color="yellow">
                            ⚠️ Skipped unknown members: {skipped.join(', ')}
                            {'\n'}   Available: {available.join(', ')}
                        </Text>
                    );
                },
                onUnresolvedAddressees: (addressees: string[], _message: ConversationMessage) => {
                    const availableNames = team.members.map(m => m.name);
                    appendOutput(
                        <Text key={`unresolved-${getNextKey()}`} color="red">
                            ❌ Cannot resolve: {addressees.join(', ')}
                            {'\n'}   Available: {availableNames.join(', ')}
                        </Text>
                    );
                }
            });

            // Display verification results from Core
            formatVerificationResults(verificationResults);

            if (!team.members.length) {
                throw new Error('Team has no members configured. Please update the configuration file.');
            }

            // Check for existing sessions
            const latestSession = await sessionStorage.getLatestSession(team.id);

            if (latestSession) {
                // Show restore prompt
                const summary: SessionSummary = {
                    sessionId: latestSession.sessionId,
                    createdAt: latestSession.createdAt,
                    updatedAt: latestSession.updatedAt,
                    messageCount: latestSession.metadata.messageCount,
                    summary: latestSession.metadata.summary,
                };

                setPendingRestore({
                    team,
                    config,
                    session: summary,
                    coordinator,
                    eventEmitter,
                });
                setMode('restore-prompt');
                setCurrentConfig(config);
            } else {
                // No existing session, start fresh
                attachEventEmitter(eventEmitter);
                setActiveCoordinator(coordinator);
                setActiveTeam(team);
                setCurrentConfig(config);
                setMode('conversation');

                await coordinator.setTeam(team);

                const humans = team.members.filter(m => m.type === 'human');
                if (humans.length === 1) {
                    coordinator.setWaitingForMemberId(humans[0].id);
                }

                appendOutput(<Text key={`deploy-success-${getNextKey()}`} color="green">✓ Team "{team.name}" deployed successfully</Text>);
                appendOutput(
                    <Box key={`team-info-${getNextKey()}`} flexDirection="column" marginLeft={2}>
                        <Text>Team Name: {team.displayName ?? team.name}</Text>
                        {team.description && <Text>Team Description: {team.description}</Text>}
                        <Text>Members:</Text>
                        {team.members.map((m, idx) => {
                            const bgColor = m.themeColor ?? 'white';
                            return (
                                <Text key={`member-${idx}`}>  <Text backgroundColor={bgColor} color="black">{m.displayName}{m.displayRole ? ` (${m.displayRole})` : ''}</Text></Text>
                            );
                        })}
                    </Box>
                );
                appendOutput(<Text key={`deploy-hint-${getNextKey()}`} dimColor>Type your message below to continue. Use [NEXT:member_name] to assign the next speaker, use [TEAM_TASK: your task] to post your task to the team.</Text>);
                setTimeout(() => setInput(prev => prev), 50);
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            appendOutput(<Text key={`deploy-err-${getNextKey()}`} color="red">✗ {errMsg}</Text>);
        }
    };

    /**
     * Handle user's restore choice (R or N)
     */
    const handleRestoreChoice = async (resume: boolean): Promise<void> => {
        if (!pendingRestore) return;

        const { team, config, session, coordinator, eventEmitter } = pendingRestore;

        try {
            attachEventEmitter(eventEmitter);
            setActiveCoordinator(coordinator);
            setActiveTeam(team);
            setMode('conversation');

            if (resume) {
                // Resume session
                await coordinator.setTeam(team, { resumeSessionId: session.sessionId });
                appendOutput(<Text key={`restore-success-${getNextKey()}`} color="green">✓ Restored session with {session.messageCount} messages</Text>);
            } else {
                // Start new session
                await coordinator.setTeam(team);
                appendOutput(<Text key={`deploy-success-${getNextKey()}`} color="green">✓ Team "{team.name}" deployed successfully</Text>);
            }

            // Always show team info (for both resume and new session)
            appendOutput(
                <Box key={`team-info-${getNextKey()}`} flexDirection="column" marginLeft={2}>
                    <Text>Team Name: {team.displayName ?? team.name}</Text>
                    {team.description && <Text>Team Description: {team.description}</Text>}
                    <Text>Members:</Text>
                    {team.members.map((m, idx) => {
                        const bgColor = m.themeColor ?? 'white';
                        return (
                            <Text key={`member-${idx}`}>  <Text backgroundColor={bgColor} color="black">{m.displayName}{m.displayRole ? ` (${m.displayRole})` : ''}</Text></Text>
                        );
                    })}
                </Box>
            );

            const humans = team.members.filter(m => m.type === 'human');
            if (humans.length === 1) {
                coordinator.setWaitingForMemberId(humans[0].id);
            }

            appendOutput(<Text key={`deploy-hint-${getNextKey()}`} dimColor>Type your message below to continue. Use [NEXT:member_name] to assign the next speaker, use [TEAM_TASK: your task] to post your task to the team.</Text>);
            setTimeout(() => setInput(prev => prev), 50);
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            appendOutput(<Text key={`restore-err-${getNextKey()}`} color="red">✗ {errMsg}</Text>);
            setMode('normal');
        } finally {
            setPendingRestore(null);
        }
    };

    return (
        <Box flexDirection="column">
            {/* 输出历史（使用 Static 确保内容只渲染一次，不会随状态变化重绘） */}
            {/* WelcomeScreen 作为 output 的第一个元素，也只渲染一次 */}
            <Static items={output}>
                {(item, idx) => <Box key={`output-${idx}`}>{item}</Box>}
            </Static>

            {/* QueueDisplay - Show routing queue status */}
            {mode === 'conversation' && queueState && !queueState.isEmpty && (
                <QueueDisplay
                    items={queueState.items}
                    executing={queueState.executing}
                    visible={true}
                />
            )}

            {/* TodoListView - Dynamic in-place todo list display */}
            {mode === 'conversation' && activeTodoList && (
                <TodoListView todoList={activeTodoList} />
            )}

            {/* ThinkingIndicator - Show when agent is executing (LLD-05: use uiPrefs) */}
            {mode === 'conversation' && executingAgent && uiPrefs.showThinkingTimer && (
                <ThinkingIndicator
                    member={executingAgent}
                    maxTimeoutMs={currentConfig?.conversation?.maxAgentResponseTime ?? 1800000}
                    allowEscCancel={uiPrefs.allowEscCancel}
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

            {/* Restore Prompt UI */}
            {mode === 'restore-prompt' && pendingRestore && (
                <RestorePrompt
                    session={pendingRestore.session}
                    teamName={pendingRestore.team.name}
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
                        appendOutput(
                            <Text key={`agents-msg-${keyCounter}`} color={color || 'white'}>
                                {message}
                            </Text>
                        );
                        setKeyCounter(prev => prev + 1);
                    }}
                />
            )}

            {/* 输入区域 - 使用上下横线确保在 alternateBuffer 模式下始终可见 */}
            {!isExiting && (mode === 'normal' || mode === 'conversation' || mode === 'wizard' || mode === 'form') && (
                <Box flexDirection="column" marginTop={1}>
                    {/* 上横线 - 使用 dimColor 降低饱和度 */}
                    <Text color={mode === 'conversation' ? 'green' : 'cyan'} dimColor>
                        {'─'.repeat(terminalWidth - 4)}
                    </Text>
                    {/* 输入行 */}
                    <Box>
                        {mode === 'conversation' ? (
                            <Text color="green" bold>
                                {(() => {
                                    // Get waiting member's display name for the prompt
                                    if (activeCoordinator && activeTeam) {
                                        const waitingRoleId = activeCoordinator.getWaitingForMemberId();
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
                            placeholder=" "
                        />
                    </Box>
                    {/* 下横线 - 使用 dimColor 降低饱和度 */}
                    <Text color={mode === 'conversation' ? 'green' : 'cyan'} dimColor>
                        {'─'.repeat(terminalWidth - 4)}
                    </Text>
                </Box>
            )}

            {/* 命令提示（只在normal模式下显示，退出时隐藏） */}
            {!isExiting && mode === 'normal' && <CommandHints input={input} selectedIndex={selectedIndex} />}
        </Box>
    );
}

export function startReplInk(registryPath?: string) {
    render(<App registryPath={registryPath} />, {
        // Don't use alternateBuffer - it prevents scrolling for long agent outputs
        // Trade-off: long input lines may cause duplicate prompts, but scrolling works
        incrementalRendering: true
    });
}
