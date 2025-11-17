/**
 * ConversationStarter - 启动对话的共享工具
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { ConversationCoordinator, type ConversationStatus } from '../services/ConversationCoordinator.js';
import { AgentManager } from '../services/AgentManager.js';
import { ProcessManager } from '../infrastructure/ProcessManager.js';
import { MessageRouter } from '../services/MessageRouter.js';
import { AgentConfigManager } from '../services/AgentConfigManager.js';
import { TeamManager } from '../services/TeamManager.js';
import { MockStorageService } from '../infrastructure/StorageService.js';
import type { Team, Role } from '../models/Team.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';

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

export interface AgentDefinition {
  name: string;
  command: string;
  args?: string[];
  endMarker?: string;
  usePty?: boolean;
}

export interface RoleDefinitionConfig {
  name: string;
  displayName?: string;
  description?: string;
}

export interface TeamMemberConfig {
  displayName: string;
  name: string;
  displayRole?: string;
  role: string;
  type: 'ai' | 'human';
  agentType?: string;
  themeColor?: string;
  roleDir: string;
  workDir?: string;
  instructionFile?: string;
  env?: Record<string, string>;
}

export interface TeamConfig {
  name: string;
  displayName?: string;
  description: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinitionConfig[];
  members: TeamMemberConfig[];
}

export interface CLIConfig {
  schemaVersion?: string;
  agents: AgentDefinition[];
  team: TeamConfig;
  maxRounds?: number;
}

interface NormalizedAgent {
  name: string;
  command: string;
  args: string[];
  endMarker?: string;
  usePty?: boolean;
}

interface NormalizedPaths {
  roleDir: string;
  workDir: string;
  instructionFile?: string;
}

export interface InitializeServicesOptions {
  contextMessageCount?: number;
  onMessage?: (message: ConversationMessage) => void;
  onStatusChange?: (status: ConversationStatus) => void;
  onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;
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

function normalizeAgentDefinitions(agents: AgentDefinition[]): Map<string, NormalizedAgent> {
  const map = new Map<string, NormalizedAgent>();
  for (const agent of agents) {
    map.set(agent.name, {
      name: agent.name,
      command: agent.command,
      args: agent.args ?? [],
      endMarker: agent.endMarker,
      usePty: agent.usePty
    });
  }
  return map;
}

export function resolveInstructionFile(member: TeamMemberConfig, roleDir: string): string | undefined {
  const defaultFileName = member.agentType
    ? member.agentType.toLowerCase().includes('gemini')
      ? 'GEMINI.md'
      : member.agentType.toLowerCase().includes('claude')
        ? 'CLAUDE.md'
        : 'AGENTS.md'
    : 'README.md';

  const target = member.instructionFile ?? defaultFileName;
  if (!target) {
    return undefined;
  }

  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(roleDir, target);
}

function ensureDir(targetPath: string, label: string): void {
  try {
    fs.mkdirSync(targetPath, { recursive: true });
  } catch (error) {
    console.warn(colorize(`⚠ 无法创建 ${label}: ${targetPath} (${String(error)})`, 'yellow'));
  }
}

export function normalizeMemberPaths(member: TeamMemberConfig): NormalizedPaths {
  const roleDir = path.resolve(member.roleDir);
  const workDir = path.resolve(member.workDir ?? path.join(roleDir, 'work'));
  const instructionFile = resolveInstructionFile(member, roleDir);

  ensureDir(roleDir, 'roleDir');
  ensureDir(workDir, 'workDir');

  return { roleDir, workDir, instructionFile };
}

export function buildEnv(agentType: string | undefined, member: TeamMemberConfig): Record<string, string> {
  const env: Record<string, string> = {};

  // Only merge user-provided environment variables
  // All CLI agents (Claude, Codex, Gemini) use system HOME for credentials
  if (member.env) {
    Object.assign(env, member.env);
  }

  return env;
}

export function loadInstructionContent(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch (error) {
    console.warn(colorize(`⚠ 无法读取指令文件 ${filePath}: ${String(error)}`, 'yellow'));
  }
  return undefined;
}

/**
 * 初始化服务和团队
 */
export async function initializeServices(
  config: CLIConfig,
  options?: InitializeServicesOptions
): Promise<{
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

  const agentDefinitionMap = normalizeAgentDefinitions(config.agents);
  const teamMembers: Array<Omit<Role, 'id'>> = [];

  for (const [index, member] of config.team.members.entries()) {
    const normalizedPaths = normalizeMemberPaths(member);
    let agentConfigId: string | undefined;
    let env: Record<string, string> | undefined;

    if (member.type === 'ai') {
      if (!member.agentType) {
        throw new Error(`AI 成员 "${member.name}" 缺少 agentType`);
      }
      const agentDef = agentDefinitionMap.get(member.agentType);
      if (!agentDef) {
        throw new Error(`未找到 agentType "${member.agentType}" 的定义`);
      }

      env = buildEnv(member.agentType, member);

      const agentConfig = await agentConfigManager.createAgentConfig({
        name: `${member.name}-${member.agentType}-config`,
        type: 'cli',
        command: agentDef.command,
        args: agentDef.args,
        env,
        cwd: normalizedPaths.workDir,
        description: `CLI agent: ${member.agentType} (${member.displayName})`,
        endMarker: agentDef.endMarker,
        useEndOfMessageMarker: false,
        usePty: agentDef.usePty ?? false
      });
      agentConfigId = agentConfig.id;
    } else if (member.env) {
      env = { ...member.env };
    }

    teamMembers.push({
      displayName: member.displayName,
      name: member.name,
      displayRole: member.displayRole ?? member.role,
      role: member.role,
      type: member.type,
      agentType: member.agentType,
      agentConfigId,
      themeColor: member.themeColor,
      roleDir: normalizedPaths.roleDir,
      workDir: normalizedPaths.workDir,
      instructionFile: normalizedPaths.instructionFile,
      env,
      systemInstruction: loadInstructionContent(normalizedPaths.instructionFile),
      order: index
    });
  }

  const team = await teamManager.createTeam({
    name: config.team.name,
    description: config.team.description,
    displayName: config.team.displayName,
    instructionFile: config.team.instructionFile,
    roleDefinitions: config.team.roleDefinitions,
    members: teamMembers
  });

  const coordinator = new ConversationCoordinator(
    agentManager,
    messageRouter,
    {
      contextMessageCount: options?.contextMessageCount ?? 5,
      onMessage: options?.onMessage ?? ((message: ConversationMessage) => {
        displayMessage(message);
      }),
      onStatusChange: options?.onStatusChange ?? ((status: ConversationStatus) => {
        console.log(colorize(`[Status] ${status}`, 'dim'));
      }),
      onUnresolvedAddressees: options?.onUnresolvedAddressees
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
    ? team.members.find(r => r.name === firstSpeaker)?.id
    : team.members[0].id;

  if (!firstSpeakerId) {
    console.error(colorize('Error: Invalid first speaker', 'red'));
    return;
  }

  console.log(colorize('\n=== 对话开始 ===\n', 'bright'));
  console.log(colorize(`初始消息: ${initialMessage}`, 'blue'));
  console.log(colorize(`第一个发言者: ${team.members.find(r => r.id === firstSpeakerId)?.displayName}`, 'blue'));
  console.log(colorize('─'.repeat(60), 'dim'));

  await coordinator.startConversation(team, initialMessage, firstSpeakerId);

  let isWaitingForInput = false;
  const checkInterval = setInterval(async () => {
    const waitingRoleId = coordinator.getWaitingForRoleId();

    if (waitingRoleId && !isWaitingForInput) {
      const role = team.members.find(r => r.id === waitingRoleId);

      if (role && role.type === 'human') {
        isWaitingForInput = true;
        const userInput = await waitForUserInput(`\n${role.displayName}, 请输入你的消息: `);
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
}
