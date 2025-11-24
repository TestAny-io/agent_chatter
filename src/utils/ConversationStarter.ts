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
import { EventEmitter } from 'events';
import { colorize } from './colors.js';
import type { IOutput } from '../outputs/IOutput.js';
import { SilentOutput } from '../outputs/IOutput.js';

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
  instructionFile?: string;
  env?: Record<string, string>;
  systemInstruction?: string; // Schema 1.2+
}

export interface TeamConfig {
  name: string;
  displayName?: string;
  description: string;
  instructionFile?: string;
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
  output?: IOutput;
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
    // warning handled by caller via output
    throw new Error(`⚠ 无法创建 ${label}: ${targetPath} (${String(error)})`);
  }
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.some(arg => arg === flag || arg.startsWith(`${flag}=`));
}

export function withBypassArgs(agentType: string, baseArgs: string[]): string[] {
  const args = [...baseArgs];

  if (agentType === 'claude') {
    // Claude: enforce bypass + JSON stream output
    if (!hasFlag(args, '--permission-mode')) {
      args.push('--permission-mode', 'bypassPermissions');
    }
    if (!hasFlag(args, '--output-format')) {
      args.push('--output-format', 'stream-json');
    }
    return args;
  }

  if (agentType === 'gemini') {
    // Gemini: enforce bypass + JSON stream output
    if (!hasFlag(args, '--yolo') && !hasFlag(args, '--approval-mode')) {
      args.push('--yolo');
    }
    if (!hasFlag(args, '--output-format')) {
      args.push('--output-format', 'stream-json');
    }
    return args;
  }

  if (agentType === 'codex') {
    // Codex: enforce bypass; no output-format flag available; strip conflicting --full-auto
    const filtered = args.filter(arg => arg !== '--full-auto');
    if (!hasFlag(filtered, '--dangerously-bypass-approvals-and-sandbox') && !hasFlag(filtered, '--yolo')) {
      filtered.push('--dangerously-bypass-approvals-and-sandbox');
    }
    return filtered;
  }

  return args;
}

export function normalizeMemberPaths(
  member: TeamMemberConfig
): NormalizedPaths {
  const roleDir = path.resolve(member.roleDir);
  const instructionFile = resolveInstructionFile(member, roleDir);

  ensureDir(roleDir, 'roleDir');

  return { roleDir, instructionFile };
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
    // Ignore read errors in Phase 1; caller can decide to surface warnings if needed
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
  agentManager: AgentManager;
  eventEmitter: EventEmitter;
  contextCollector: import('../services/ContextEventCollector.js').ContextEventCollector;
}> {
  const output: IOutput = options?.output ?? new SilentOutput();
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
  const projectRoot = process.cwd();
  const eventEmitter = agentManager.getEventEmitter();
  const contextCollector = new (await import('../services/ContextEventCollector.js')).ContextEventCollector(eventEmitter, {
    projectRoot,
    persist: true
  });

  // Schema 1.1+: Load and merge agents from global registry with team config
  // Schema 1.0: Team config provides complete definitions (backward compatibility)
  const registryPath = options?.registryPath;
  const agentDefinitionMap = await loadAndMergeAgents(config.agents, registryPath);
  const teamMembers: Array<Omit<Member, 'id'>> = [];

  // Shared registry instance and verification cache to avoid redundant verifications
  const registry = new AgentRegistry(registryPath);
  const verificationCache = new Map<string, VerificationResult>();

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

      // Real-time verification: Validate agent before starting conversation
      // Use cached verification result if agent was already verified
      let verification = verificationCache.get(member.agentType);
      const isFirstVerification = !verification;

      if (isFirstVerification) {
        output.progress(`正在验证 agent: ${member.agentType}...`);
        verification = await registry.verifyAgent(member.agentType);
        verificationCache.set(member.agentType, verification);

        if (verification.status !== 'verified') {
          let errorMsg = `Agent "${member.agentType}" 验证失败: ${verification.error || 'Unknown error'}`;
          if (verification.checks) {
            errorMsg += '\n详细检查结果:';
            for (const check of verification.checks) {
              const status = check.passed ? '✓' : '✗';
              errorMsg += `\n  ${status} ${check.name}: ${check.message}`;
            }
          }
          throw new Error(errorMsg);
        }
        output.success(`✓ Agent ${member.agentType} 验证成功`);
      } else {
        output.progress(`✓ Agent ${member.agentType} (使用缓存的验证结果)`);
      }

      env = buildEnv(member.agentType, member);

      output.keyValue('工作目录', `${projectRoot} (来源: 启动目录)`);

      // Map agent type name to adapter type
      const adapterType = member.agentType === 'claude' ? 'claude-code' :
                          member.agentType === 'codex' ? 'openai-codex' :
                          member.agentType === 'gemini' ? 'google-gemini' :
                          member.agentType; // fallback to member.agentType for custom agents

      const agentArgs = withBypassArgs(member.agentType, agentDef.args);

      const agentConfig = await agentConfigManager.createAgentConfig({
        name: `${member.name}-${member.agentType}-config`,
        type: adapterType,
        command: agentDef.command,
        args: agentArgs,
        env,
        cwd: projectRoot,
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
        const speaker = message.speaker;
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        output.info(`[${timestamp}] ${speaker.roleTitle}: ${message.content}`);
        output.separator();
      }),
      onStatusChange: options?.onStatusChange ?? ((status: ConversationStatus) => {
        output.progress(`[Status] ${status}`);
      }),
      onUnresolvedAddressees: options?.onUnresolvedAddressees,
      conversationConfig: config.conversation,  // Pass conversation config
      onAgentStarted: options?.onAgentStarted,  // Pass agent started callback
      onAgentCompleted: options?.onAgentCompleted  // Pass agent completed callback
    },
    contextCollector
  );

  return { coordinator, team, processManager, messageRouter, agentManager, eventEmitter, contextCollector };
}

/**
 * 启动对话
 */
export async function startConversation(
  coordinator: ConversationCoordinator,
  team: Team,
  initialMessage: string,
  firstSpeaker?: string,
  output: IOutput = new SilentOutput()
): Promise<void> {
  const firstSpeakerId = firstSpeaker
    ? team.members.find(r => r.name === firstSpeaker)?.id
    : team.members[0].id;

  if (!firstSpeakerId) {
    output.error('Error: Invalid first speaker');
    return;
  }

  output.separator();
  output.info(`初始消息: ${initialMessage}`);
  output.info(`第一个发言者: ${team.members.find(r => r.id === firstSpeakerId)?.displayName}`);
  output.separator('─', 60);

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
          output.warn('用户终止对话');
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
      output.separator();
    }
  }, 500);
}
