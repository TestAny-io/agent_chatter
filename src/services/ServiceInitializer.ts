/**
 * ServiceInitializer - 服务初始化器
 *
 * 负责初始化所有核心服务（从 ConversationStarter 迁移）
 * 提供 initializeServices 函数用于 CLI 和 REPL
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConversationCoordinator, type ConversationStatus } from './ConversationCoordinator.js';
import { AgentManager } from './AgentManager.js';
import { ProcessManager } from '../infrastructure/ProcessManager.js';
import { MessageRouter } from './MessageRouter.js';
import { AgentConfigManager } from './AgentConfigManager.js';
import { TeamManager } from './TeamManager.js';
import { MockStorageService } from '../infrastructure/StorageService.js';
import type { Team, Member } from '../models/Team.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import type { CLIConfig, AgentDefinition, TeamMemberConfig } from '../models/CLIConfig.js';
import { AgentRegistry, type VerificationResult } from '../registry/AgentRegistry.js';
import type { AgentDefinition as RegistryAgentDefinition } from '../registry/RegistryStorage.js';
import { EventEmitter } from 'events';
import type { IOutput } from '../outputs/IOutput.js';
import { SilentOutput } from '../outputs/IOutput.js';
import type { QueueUpdateEvent } from '../models/QueueEvent.js';
import type { CheckResult } from './validation/types.js';

interface NormalizedAgent {
  name: string;
  command: string;
  args: string[];
  usePty?: boolean;
}

interface NormalizedPaths {
  baseDir: string;
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
  onQueueUpdate?: (event: QueueUpdateEvent) => void;  // Callback for queue visibility updates
  onPartialResolveFailure?: (skipped: string[], availableMembers: string[]) => void;  // Callback for partial resolve failure
}

/**
 * Check if args array contains a flag
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.some(arg => arg === flag || arg.startsWith(`${flag}=`));
}

/**
 * 打印验证检查结果（用于 REPL 部署输出）
 */
function printVerificationChecks(output: IOutput, checks: CheckResult[], indent: number = 2): void {
  const prefix = ' '.repeat(indent);

  for (const check of checks) {
    const icon = check.passed ? '✓' : '✗';
    output.info(`${prefix}${icon} ${check.name}`);
    output.info(`${prefix}  ${check.message}`);

    if (check.warning) {
      output.warn(`${prefix}  ⚠ ${check.warning}`);
    }

    if (check.resolution) {
      output.info(`${prefix}  → ${check.resolution}`);
    }
  }
}

/**
 * Add bypass args for different agent types
 */
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

/**
 * Resolve instruction file path for a team member
 */
export function resolveInstructionFile(member: TeamMemberConfig, baseDir: string): string | undefined {
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
  return path.resolve(baseDir, target);
}

function ensureDir(targetPath: string, label: string): void {
  try {
    fs.mkdirSync(targetPath, { recursive: true });
  } catch (error) {
    throw new Error(`Cannot create ${label}: ${targetPath} (${String(error)})`);
  }
}

/**
 * Normalize member paths (baseDir and instructionFile)
 */
export function normalizeMemberPaths(member: TeamMemberConfig): NormalizedPaths {
  const baseDir = path.resolve(member.baseDir);
  const instructionFile = resolveInstructionFile(member, baseDir);

  ensureDir(baseDir, 'baseDir');

  return { baseDir, instructionFile };
}

/**
 * Build environment variables for agent
 */
export function buildEnv(agentType: string | undefined, member: TeamMemberConfig): Record<string, string> {
  const env: Record<string, string> = {};

  // Only merge user-provided environment variables
  // All CLI agents (Claude, Codex, Gemini) use system HOME for credentials
  if (member.env) {
    Object.assign(env, member.env);
  }

  return env;
}

/**
 * Load instruction file content
 */
export function loadInstructionContent(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // Ignore read errors
  }
  return undefined;
}

/**
 * Load and merge agents from global registry with team config
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
 * Initialize all services and create team
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
  contextCollector: import('./ContextEventCollector.js').ContextEventCollector;
}> {
  const output: IOutput = options?.output ?? new SilentOutput();

  // Enforce Schema 1.1+: Reject older versions
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
  const contextCollector = new (await import('./ContextEventCollector.js')).ContextEventCollector(eventEmitter, {
    projectRoot,
    persist: true
  });

  // Load and merge agents from global registry with team config
  const registryPath = options?.registryPath;
  const agentDefinitionMap = await loadAndMergeAgents(config.agents, registryPath);
  const teamMembers: Array<Omit<Member, 'id'> & { id?: string }> = [];

  // Shared registry instance and verification cache to avoid redundant verifications
  const registry = new AgentRegistry(registryPath);
  const verificationCache = new Map<string, VerificationResult>();

  for (const [index, member] of config.team.members.entries()) {
    const normalizedPaths = normalizeMemberPaths(member);
    let agentConfigId: string | undefined;
    let env: Record<string, string> | undefined;

    if (member.type === 'ai') {
      if (!member.agentType) {
        throw new Error(`AI member "${member.name}" is missing agentType`);
      }
      const agentDef = agentDefinitionMap.get(member.agentType);
      if (!agentDef) {
        throw new Error(`Agent type "${member.agentType}" definition not found`);
      }

      // Real-time verification: Validate agent before starting conversation
      let verification = verificationCache.get(member.agentType);
      const isFirstVerification = !verification;

      if (isFirstVerification) {
        output.progress(`Verifying agent: ${member.agentType}...`);
        verification = await registry.verifyAgent(member.agentType);
        verificationCache.set(member.agentType, verification);

        if (verification.status === 'failed') {
          let errorMsg = `Agent "${member.agentType}" verification failed: ${verification.error || 'Unknown error'}`;
          if (verification.checks) {
            errorMsg += '\nDetailed check results:';
            for (const check of verification.checks) {
              const icon = check.passed ? '✓' : '✗';
              errorMsg += `\n  ${icon} ${check.name}: ${check.message}`;
            }
          }
          throw new Error(errorMsg);
        }

        // Show appropriate message based on status
        if (verification.status === 'verified_with_warnings') {
          output.warn(`⚠ Agent ${member.agentType} verified with warnings`);
        } else {
          output.success(`✓ Agent ${member.agentType} verified`);
        }

        // 始终展示详细检查结果
        if (verification.checks && verification.checks.length > 0) {
          output.info('  Verification checks:');
          printVerificationChecks(output, verification.checks, 4);
        }
      } else {
        output.progress(`Agent ${member.agentType} (using cached verification)`);
      }

      env = buildEnv(member.agentType, member);
      output.keyValue('Working directory', projectRoot);

      // Map agent type name to adapter type
      const adapterType = member.agentType === 'claude' ? 'claude-code' :
                          member.agentType === 'codex' ? 'openai-codex' :
                          member.agentType === 'gemini' ? 'google-gemini' :
                          member.agentType;

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
      id: member.name, // stable member ID derived from config name
      displayName: member.displayName,
      name: member.name,
      displayRole: member.displayRole ?? member.role,
      role: member.role,
      type: member.type,
      agentType: member.agentType,
      agentConfigId,
      themeColor: member.themeColor,
      baseDir: normalizedPaths.baseDir,
      instructionFile: normalizedPaths.instructionFile,
      instructionFileText: loadInstructionContent(normalizedPaths.instructionFile),
      env,
      systemInstruction: member.systemInstruction,
      order: index
    });
  }

  const team = await teamManager.createTeam({
    id: config.team.name, // stable team ID derived from team name
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
        output.info(`[${timestamp}] ${speaker.displayName}: ${message.content}`);
        output.separator();
      }),
      onStatusChange: options?.onStatusChange ?? ((status: ConversationStatus) => {
        output.progress(`[Status] ${status}`);
      }),
      onUnresolvedAddressees: options?.onUnresolvedAddressees,
      conversationConfig: config.conversation,
      onAgentStarted: options?.onAgentStarted,
      onAgentCompleted: options?.onAgentCompleted,
      onQueueUpdate: options?.onQueueUpdate,
      onPartialResolveFailure: options?.onPartialResolveFailure
    }
  );

  return { coordinator, team, processManager, messageRouter, agentManager, eventEmitter, contextCollector };
}
