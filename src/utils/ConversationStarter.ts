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
import type { Team, Member } from '../models/Team.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import { AgentRegistry, type VerificationResult } from '../registry/AgentRegistry.js';
import type { AgentDefinition as RegistryAgentDefinition } from '../registry/RegistryStorage.js';

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
  command?: string; // Optional in schema 1.1 when referencing registry agent
  args?: string[];
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
  systemInstruction?: string; // Schema 1.2+
}

export interface TeamConfig {
  name: string;
  displayName?: string;
  description: string;
  instructionFile?: string;
  workDir?: string; // Schema 1.1+: Team-level work directory, members inherit unless overridden
  roleDefinitions?: RoleDefinitionConfig[];
  members: TeamMemberConfig[];
}

export interface ConversationConfig {
  maxAgentResponseTime?: number;  // Maximum timeout for agent response in ms (default: 1800000 = 30 minutes)
  showThinkingTimer?: boolean;     // Show timer when agent is thinking in REPL (default: true)
  allowEscCancel?: boolean;         // Allow ESC key to cancel agent execution in REPL (default: true)
}

export interface CLIConfig {
  schemaVersion?: string;
  agents?: AgentDefinition[]; // Optional in schema 1.1+, agents loaded from global registry
  team: TeamConfig;
  maxRounds?: number;
  conversation?: ConversationConfig;  // Conversation-level configuration
}

interface NormalizedAgent {
  name: string;
  command: string;
  args: string[];
  usePty?: boolean;
}

interface NormalizedPaths {
  roleDir: string;
  workDir: string;
  workDirSource: 'member' | 'team' | 'default';  // Tracks where workDir came from
  instructionFile?: string;
}

export interface InitializeServicesOptions {
  contextMessageCount?: number;
  onMessage?: (message: ConversationMessage) => void;
  onStatusChange?: (status: ConversationStatus) => void;
  onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;
  registryPath?: string;  // Optional registry path for testing
  onAgentStarted?: (member: Member) => void;  // Callback when agent starts thinking (REPL UI)
  onAgentCompleted?: (member: Member) => void;  // Callback when agent completes (REPL UI)
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
    if (!agent.command) {
      throw new Error(`Agent "${agent.name}" is missing command field. This function requires complete agent definitions.`);
    }
    map.set(agent.name, {
      name: agent.name,
      command: agent.command,
      args: agent.args ?? [],
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

export function normalizeMemberPaths(
  member: TeamMemberConfig,
  teamWorkDir?: string
): NormalizedPaths {
  const roleDir = path.resolve(member.roleDir);

  // Priority: member.workDir > team.workDir > roleDir/work (fallback)
  let workDir: string;
  let workDirSource: 'member' | 'team' | 'default';

  if (member.workDir) {
    workDir = path.resolve(member.workDir);
    workDirSource = 'member';
  } else if (teamWorkDir) {
    workDir = path.resolve(teamWorkDir);
    workDirSource = 'team';
  } else {
    workDir = path.join(roleDir, 'work');
    workDirSource = 'default';
  }

  const instructionFile = resolveInstructionFile(member, roleDir);

  ensureDir(roleDir, 'roleDir');
  ensureDir(workDir, 'workDir');

  return { roleDir, workDir, workDirSource, instructionFile };
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
 * 从全局 registry 加载 agents 并与 team 配置合并
 * Schema 1.1: Team config 可以引用 registry agent 并覆盖 args/usePty
 */
async function loadAndMergeAgents(
  teamAgents: AgentDefinition[] | undefined,
  registryPath?: string
): Promise<Map<string, NormalizedAgent>> {
  const registry = new AgentRegistry(registryPath);
  const registryAgents = await registry.listAgents();

  // Build registry map
  const registryMap = new Map<string, RegistryAgentDefinition>();
  for (const agent of registryAgents) {
    registryMap.set(agent.name, agent);
  }

  const result = new Map<string, NormalizedAgent>();

  if (!teamAgents || teamAgents.length === 0) {
    // No team config: Use all registry agents as-is
    for (const agent of registryAgents) {
      result.set(agent.name, {
        name: agent.name,
        command: agent.command,
        args: agent.args || [],
        usePty: agent.usePty
      });
    }
  } else {
    // Team config present: Merge with registry
    for (const teamAgent of teamAgents) {
      const registryAgent = registryMap.get(teamAgent.name);

      // Schema 1.1 reference mode: Agent must exist in registry, command cannot be overridden
      if (registryAgent) {
        if (teamAgent.command && teamAgent.command !== registryAgent.command) {
          throw new Error(
            `Security violation: Team config cannot override 'command' for agent "${teamAgent.name}". ` +
            `The command path is controlled by the global registry only. ` +
            `You can only override args or usePty.`
          );
        }
        // Merge: team config can override args/usePty, but NOT command
        result.set(teamAgent.name, {
          name: teamAgent.name,
          command: registryAgent.command,  // Always use registry command
          args: teamAgent.args !== undefined ? teamAgent.args : (registryAgent.args || []),
          usePty: teamAgent.usePty !== undefined ? teamAgent.usePty : registryAgent.usePty
        });
      } else {
        // Schema 1.0 complete definition mode: Agent not in registry, must provide full definition
        if (!teamAgent.command) {
          throw new Error(
            `Agent "${teamAgent.name}" referenced in team config but not found in global registry. ` +
            `Run 'agent-chatter agents register' first, or provide a complete agent definition with 'command'.`
          );
        }
        result.set(teamAgent.name, {
          name: teamAgent.name,
          command: teamAgent.command,
          args: teamAgent.args || [],
          usePty: teamAgent.usePty
        });
      }
    }
  }

  return result;
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
  messageRouter: MessageRouter;
}> {
  // Enforce Schema 1.1: Reject all other versions
  // Support Schema 1.1 and 1.2
  if (config.schemaVersion !== '1.1' && config.schemaVersion !== '1.2') {
    const foundVersion = config.schemaVersion || 'missing';
    throw new Error(
      `Unsupported configuration schema version.\n\n` +
      `  Found: schemaVersion = "${foundVersion}"\n` +
      `  Required: schemaVersion = "1.1" or "1.2"\n\n` +
      `Schema 1.0 is no longer supported. Please migrate your configuration to Schema 1.1 or 1.2.\n` +
      `Migration guide: design/team-configuration.md\n\n` +
      `Key changes in Schema 1.1/1.2:\n` +
      `  - Agents must be registered in global registry (~/.agent-chatter/agents/config.json)\n` +
      `  - Team config only references agent names, not full definitions\n` +
      `  - Team config can override args/usePty, but NOT command path\n` +
      `  - Schema 1.2: Members can have systemInstruction field (overrides agent args)\n\n` +
      `Quick migration steps:\n` +
      `  1. Run: agent-chatter agents register <agent-name>\n` +
      `  2. Update config: Remove 'command' field from config.agents[]\n` +
      `  3. Set: "schemaVersion": "1.1" or "1.2"`
    );
  }

  const storage = new MockStorageService();
  const processManager = new ProcessManager();
  const messageRouter = new MessageRouter();
  const agentConfigManager = new AgentConfigManager(storage);
  const teamManager = new TeamManager(storage);
  const agentManager = new AgentManager(processManager, agentConfigManager);

  // Schema 1.1+: Load and merge agents from global registry with team config
  // Schema 1.0: Team config provides complete definitions (backward compatibility)
  const registryPath = options?.registryPath;
  const agentDefinitionMap = await loadAndMergeAgents(config.agents, registryPath);
  const teamMembers: Array<Omit<Member, 'id'>> = [];

  // Schema 1.1+: Team-level workDir for all members (unless member overrides)
  const teamWorkDir = config.team.workDir;

  // Shared registry instance and verification cache to avoid redundant verifications
  const registry = new AgentRegistry(registryPath);
  const verificationCache = new Map<string, VerificationResult>();

  for (const [index, member] of config.team.members.entries()) {
    const normalizedPaths = normalizeMemberPaths(member, teamWorkDir);
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

      // Real-time verification: Validate agent before starting conversation
      // Use cached verification result if agent was already verified
      let verification = verificationCache.get(member.agentType);
      const isFirstVerification = !verification;

      if (isFirstVerification) {
        console.log(colorize(`正在验证 agent: ${member.agentType}...`, 'dim'));
        verification = await registry.verifyAgent(member.agentType);
        verificationCache.set(member.agentType, verification);

        if (verification.status !== 'verified') {
          let errorMsg = `Agent "${member.agentType}" 验证失败: ${verification.error || 'Unknown error'}`;
          if (verification.checks) {
            errorMsg += '\n详细检查结果:';
            for (const check of verification.checks) {
              const status = check.passed ? colorize('✓', 'green') : colorize('✗', 'red');
              errorMsg += `\n  ${status} ${check.name}: ${check.message}`;
            }
          }
          throw new Error(errorMsg);
        }
        console.log(colorize(`✓ Agent ${member.agentType} 验证成功`, 'green'));
      } else {
        console.log(colorize(`✓ Agent ${member.agentType} (使用缓存的验证结果)`, 'dim'));
      }

      env = buildEnv(member.agentType, member);

      // Log workDir source for debugging and troubleshooting
      const workDirSourceLabel =
        normalizedPaths.workDirSource === 'member' ? '成员配置' :
        normalizedPaths.workDirSource === 'team' ? '团队配置' :
        '默认值 (roleDir/work)';
      console.log(colorize(`  工作目录: ${normalizedPaths.workDir} (来源: ${workDirSourceLabel})`, 'dim'));

      // Map agent type name to adapter type
      const adapterType = member.agentType === 'claude' ? 'claude-code' :
                          member.agentType === 'codex' ? 'openai-codex' :
                          member.agentType === 'gemini' ? 'google-gemini' :
                          member.agentType; // fallback to member.agentType for custom agents

      const agentConfig = await agentConfigManager.createAgentConfig({
        name: `${member.name}-${member.agentType}-config`,
        type: adapterType,
        command: agentDef.command,
        args: agentDef.args,
        env,
        cwd: normalizedPaths.workDir,
        description: `CLI agent: ${member.agentType} (${member.displayName})`,
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
      instructionFileText: loadInstructionContent(normalizedPaths.instructionFile),
      env,
      systemInstruction: member.systemInstruction,
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
      onUnresolvedAddressees: options?.onUnresolvedAddressees,
      conversationConfig: config.conversation,  // Pass conversation config
      onAgentStarted: options?.onAgentStarted,  // Pass agent started callback
      onAgentCompleted: options?.onAgentCompleted  // Pass agent completed callback
    }
  );

  return { coordinator, team, processManager, messageRouter };
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
