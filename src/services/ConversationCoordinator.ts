/**
 * ConversationCoordinator - 对话协调器
 *
 * 负责协调整个对话流程：
 * 1. 管理对话历史和会话状态
 * 2. 路由消息到正确的接收者（基于 [NEXT] 标记或轮询）
 * 3. 协调 Agent 之间的交互
 *
 * 入口 API：
 * - setTeam(team): 设置当前团队
 * - sendMessage(content): 发送消息并触发路由
 *
 * 会话控制：
 * - 人类用户通过输入 /end 或带特定指令终止会话
 * - AI 完成回复后自动路由到下一位成员
 */

import type { Team, Member } from '../models/Team.js';
import type { ConversationMessage } from '../models/ConversationMessage.js';
import { MessageUtils } from '../models/ConversationMessage.js';
import type { ConversationSession } from '../models/ConversationSession.js';
import { SessionUtils } from '../models/ConversationSession.js';
import { AgentManager } from './AgentManager.js';
import { MessageRouter } from './MessageRouter.js';
import type { ConversationConfig } from '../models/CLIConfig.js';
import { formatJsonl } from '../utils/JsonlMessageFormatter.js';
import { ContextManager } from '../context/ContextManager.js';
import type { AgentType, RouteContextResult } from '../context/types.js';
import type { ISessionStorage } from '../infrastructure/ISessionStorage.js';
import { SessionStorageService } from '../infrastructure/SessionStorageService.js';
import { createSessionSnapshot, type SessionSnapshot, type PersistedMessage } from '../models/SessionSnapshot.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { SilentLogger } from '../interfaces/ILogger.js';
import type { SpeakerInfo } from '../models/SpeakerInfo.js';
import { isNewSpeaker, getSpeakerId, type SpeakerInfoInput, migrateMessageSpeaker } from '../utils/speakerMigration.js';
import type { QueueUpdateEvent } from '../models/QueueEvent.js';
// v3: RoutingQueue and related types
import { RoutingQueue, type RoutingQueueConfig, type EnqueueInput } from './RoutingQueue.js';
import type { RoutingItem, RoutingIntent } from '../models/RoutingItem.js';
import { intentToEnum } from '../models/RoutingItem.js';

export type ConversationStatus = 'active' | 'paused' | 'completed';

/**
 * 地址解析结果
 */
export interface ResolveResult {
  /** 成功解析的成员 */
  resolved: Member[];
  /** 未能解析的原始地址字符串 */
  unresolved: string[];
}

/**
 * Options for setTeam method
 */
export interface SetTeamOptions {
  /**
   * Session ID to restore
   * If provided, will attempt to restore from saved snapshot
   */
  resumeSessionId?: string;
}

/**
 * Missing member info for consistency warnings
 */
export interface MissingMember {
  id: string;
  name: string;
}

export interface ConversationCoordinatorOptions {
  contextMessageCount?: number;  // 包含在上下文中的最近消息数量
  onMessage?: (message: ConversationMessage) => void;  // 消息回调
  onStatusChange?: (status: ConversationStatus) => void;  // 状态变化回调
  onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;  // 无法解析地址时的回调
  conversationConfig?: ConversationConfig;  // Conversation configuration (timeout, UI behavior)
  onAgentStarted?: (member: Member) => void;  // Called when an agent starts executing
  onAgentCompleted?: (member: Member) => void;  // Called when an agent completes execution
  /**
   * Session storage implementation
   * Default: SessionStorageService (file-based)
   */
  sessionStorage?: ISessionStorage;
  /**
   * Logger for Core diagnostic messages
   * Used for member consistency warnings
   */
  logger?: ILogger;
  /**
   * Callback when member consistency issues detected
   * UI layer can use this to show friendly notifications
   */
  onMemberConsistencyWarning?: (missingMembers: MissingMember[]) => void;
  /**
   * 部分地址解析失败时的回调
   * 用于通知 UI 显示跳过提示
   *
   * 仅在 resolved 非空 且 unresolved 非空时触发
   * resolved 为空时走 onUnresolvedAddressees
   *
   * @param skipped - 被跳过的地址列表
   * @param availableMembers - 当前可用的成员名称列表
   */
  onPartialResolveFailure?: (
    skipped: string[],
    availableMembers: string[]
  ) => void;
  /**
   * 队列状态更新时的回调
   * 用于 UI 显示队列可见性
   */
  onQueueUpdate?: (event: QueueUpdateEvent) => void;

  /**
   * v3: Routing queue configuration
   */
  routingQueueConfig?: Partial<RoutingQueueConfig>;
}

function normalizeAgentType(type?: string): string {
  if (!type) return '';
  const mapping: Record<string, string> = {
    claude: 'claude-code',
    codex: 'openai-codex',
    gemini: 'google-gemini'
  };
  return mapping[type] ?? type;
}

/**
 * ConversationCoordinator 类
 */
export class ConversationCoordinator {
  private session: ConversationSession | null = null;
  private team: Team | null = null;
  private status: ConversationStatus = 'active';
  private contextMessageCount: number;
  private waitingForMemberId: string | null = null;  // 等待哪个成员的输入
  private currentExecutingMember: Member | null = null;  // Currently executing agent (for cancellation)
  /** @deprecated v3: Use routingQueueV3 instead */
  private routingQueue: Array<{ member: Member }> = [];
  /** v3: New priority-based routing queue */
  private routingQueueV3: RoutingQueue;
  /** v3: Currently executing routing item (for v3 context) */
  private currentRoutingItem: RoutingItem | null = null;
  private routingInProgress = false;
  private contextManager: ContextManager;
  private sessionStorage: ISessionStorage;
  private logger: ILogger;
  /**
   * 获取下一个轮到的成员（循环轮询）
   *
   * @deprecated 不再用于路由逻辑。Routing v2.0 移除了 round-robin，
   *             统一使用"首个 Human"作为 fallback。保留此方法以防其他功能使用。
   */
  private getNextSpeaker(currentId: string): Member | null {
    if (!this.team || !this.team.members || this.team.members.length === 0) {
      return null;
    }
    const members = [...this.team.members].sort((a, b) => a.order - b.order);
    const idx = members.findIndex(m => m.id === currentId);
    if (idx === -1) {
      return null;
    }
    const nextIdx = (idx + 1) % members.length;
    return members[nextIdx];
  }

  constructor(
    private agentManager: AgentManager,
    private messageRouter: MessageRouter,
    private options: ConversationCoordinatorOptions = {}
  ) {
    this.contextMessageCount = options.contextMessageCount || 5;
    this.logger = options.logger ?? new SilentLogger();

    // Initialize ContextManager with matching window size and logger
    this.contextManager = new ContextManager({
      contextWindowSize: this.contextMessageCount,
      logger: this.logger,
    });

    // Initialize session storage (default: file-based, with logger injection)
    this.sessionStorage = options.sessionStorage ?? new SessionStorageService(undefined, this.logger);

    // v3: Initialize RoutingQueue with config and callbacks
    this.routingQueueV3 = new RoutingQueue({
      config: options.routingQueueConfig,
      logger: this.logger,
      callbacks: {
        onQueueUpdate: options.onQueueUpdate,
      },
      memberLookup: (memberId) => this.team?.members.find(m => m.id === memberId),
    });
  }

  /**
   * Set team with optional session restore
   *
   * NOTE: ASYNC - Callers must await
   *
   * @param team - Team configuration
   * @param options - Optional settings including resumeSessionId
   */
  async setTeam(team: Team, options?: SetTeamOptions): Promise<void> {
    // 1. Reset state
    this.team = team;
    this.session = null;
    this.waitingForMemberId = null;
    this.routingQueue = [];
    this.routingQueueV3.clear(); // v3: Clear the new queue
    this.currentRoutingItem = null;
    this.status = 'active';
    this.contextManager.clear();

    // 2. Attempt restore if requested
    if (options?.resumeSessionId) {
      await this.restoreSession(options.resumeSessionId);
    }
  }

  hasActiveSession(): boolean {
    return this.session !== null;
  }

  /**
   * Send a message to the conversation
   * Replaces startConversation and injectMessage
   */
  async sendMessage(content: string, explicitSenderId?: string): Promise<void> {
    // AUTO-INITIALIZE SESSION ON FIRST MESSAGE
    if (!this.session) {
      if (!this.team) {
        throw new Error('No team loaded. Use /team deploy <config> first');
      }
      this.session = SessionUtils.createSession(this.team.id, this.team.name);
    }

    // Parse message markers
    const parsed = this.messageRouter.parseMessage(content);

    // Resolve sender
    const sender = this.resolveSender(explicitSenderId, parsed.fromMember);

    // FIRST MESSAGE VALIDATION
    if (this.session.messages.length === 0) {
      if (sender.type !== 'human') {
        throw new Error('First message must be from a human member');
      }
    }

    // Update team task if marker present
    if (parsed.teamTask) {
      this.updateTeamTask(parsed.teamTask);
    }

    // Create and store message
    // v3: Save parsedAddressees to preserve intent markers (!P1/!P2/!P3)
    const message: ConversationMessage = MessageUtils.createMessage(
      sender.id,
      sender.name,
      sender.displayName,
      sender.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: [],
        parsedAddressees: parsed.parsedAddressees,
      }
    );

    this.storeMessage(message);
    this.notifyMessage(message);

    // Clear waitingForMemberId (if user buzzed in or responded)
    this.waitingForMemberId = null;

    // Route to next member(s)
    await this.routeToNext(message);
  }

  private resolveSender(
    explicitSenderId?: string,
    fromMarker?: string
  ): Member {
    if (!this.team) {
      throw new Error('Team not loaded');
    }

    // PRIORITY 1: Explicit sender ID (programmatic calls)
    if (explicitSenderId) {
      const member = this.team.members.find(m => m.id === explicitSenderId);
      if (!member) throw new Error(`Internal error: Member ID ${explicitSenderId} not found`);
      return member;
    }

    // PRIORITY 2: [FROM:xxx] marker (user-specified, allows buzzing in)
    if (fromMarker) {
      const member = this.resolveMemberFromIdentifier(fromMarker);

      if (!member) {
        const humans = this.team.members.filter(m => m.type === 'human');
        throw new Error(
          `Error: Member '${fromMarker}' not found.\n` +
          `Available human members: ${humans.map(h => h.name).join(', ')}`
        );
      }

      if (member.type !== 'human') {
        const humans = this.team.members.filter(m => m.type === 'human');
        throw new Error(
          `Error: Cannot use [FROM:${fromMarker}]. ${member.displayName} is an AI agent.\n` +
          `[FROM:xxx] is only for human members: ${humans.map(h => h.name).join(', ')}`
        );
      }

      return member;
    }

    // PRIORITY 3: waitingForMemberId (system set from previous routing)
    if (this.waitingForMemberId) {
      const member = this.team.members.find(m => m.id === this.waitingForMemberId);
      if (member && member.type === 'human') {
        return member;
      }
    }

    // PRIORITY 4: Single human auto-select
    const humans = this.team.members.filter(m => m.type === 'human');
    if (humans.length === 1) {
      return humans[0];
    }

    // PRIORITY 5: Multi-human without [FROM] → ERROR
    throw new Error(
      `Error: Multiple human members detected. Please specify sender with [FROM:xxx]\n` +
      `Available members: ${humans.map(h => h.name).join(', ')}\n\n` +
      `Example: [FROM:${humans[0].name}] Your message here`
    );
  }

  private resolveMemberFromIdentifier(identifier: string): Member | undefined {
    if (!this.team) return undefined;
    const normalizedIdentifier = this.normalizeIdentifier(identifier);
    return this.team.members.find(m => {
      const normalizedId = this.normalizeIdentifier(m.id);
      if (normalizedId === normalizedIdentifier) return true;
      const normalizedName = this.normalizeIdentifier(m.name);
      const normalizedDisplayName = this.normalizeIdentifier(m.displayName);
      return normalizedName === normalizedIdentifier || normalizedDisplayName === normalizedIdentifier;
    });
  }

  private updateTeamTask(newTask: string): void {
    // Update ContextManager (handles truncation internally)
    this.contextManager.setTeamTask(newTask);

    // Sync to session for backward compatibility
    if (this.session) {
      this.session.teamTask = this.contextManager.getTeamTask();
    }
  }

  /**
   * 处理 Agent 响应
   *
   * v3: Includes parentMessageId and intent from currentRoutingItem when available
   */
  async onAgentResponse(memberId: string, rawResponse: string): Promise<void> {
    if (!this.session || !this.team) {
      throw new Error('No active conversation');
    }

    const member = this.team.members.find(m => m.id === memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found`);
    }

    this.logger.debug(`[Conversation] Raw agent output from ${member.name} (${member.id}):\n${rawResponse}`);

    // JSONL -> text formatting
    const formatted = formatJsonl(member.agentType as any, rawResponse);

    // 解析消息
    const parsed = this.messageRouter.parseMessage(formatted.text);

    // v3: Build routing with parentMessageId, intent, and parsedAddressees
    const routing = {
      rawNextMarkers: parsed.addressees,
      resolvedAddressees: [],
      // v3 fields
      parsedAddressees: parsed.parsedAddressees,
      parentMessageId: this.currentRoutingItem?.parentMessageId,
      intent: this.currentRoutingItem?.intent,
    };

    // 创建 ConversationMessage
    const message: ConversationMessage = MessageUtils.createMessage(
      member.id,
      member.name,
      member.displayName,
      member.type,
      parsed.cleanContent,
      routing
    );

    // 添加到历史
    this.storeMessage(message);
    this.notifyMessage(message);

    // 路由到下一个接收者
    await this.routeToNext(message);
  }

  /**
   * 注入人类消息
   */
  async injectMessage(memberId: string, content: string): Promise<void> {
    if (!this.session || !this.team) {
      throw new Error('No active conversation');
    }

    const member = this.team.members.find(m => m.id === memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found`);
    }

    // 清除等待状态
    this.waitingForMemberId = null;

    // 解析消息
    const parsed = this.messageRouter.parseMessage(content);

    // 创建消息
    // v3: Save parsedAddressees to preserve intent markers
    const message: ConversationMessage = MessageUtils.createMessage(
      member.id,
      member.name,
      member.displayName,
      member.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: [],
        parsedAddressees: parsed.parsedAddressees,
      }
    );

    // 添加到历史
    this.storeMessage(message);
    this.notifyMessage(message);

    // 恢复对话
    if (this.status === 'paused') {
      this.status = 'active';
      this.notifyStatusChange();
    }

    // 路由到下一个接收者
    await this.routeToNext(message);
  }

  /**
   * 路由消息到下一个接收者
   *
   * v3: Also enqueues items into routingQueueV3 with intent parsing
   */
  private async routeToNext(message: ConversationMessage): Promise<void> {
    if (!this.session || !this.team) {
      return;
    }

    const addressees = message.routing?.rawNextMarkers || [];
    this.logger.debug(`[Routing] From ${message.speaker.name} addressees=${JSON.stringify(addressees)}`);

    // v3: Use saved parsedAddressees from message.routing (preserved from original parse)
    // Do NOT re-parse message.content as it's already cleaned (NEXT markers stripped)
    const parsedAddressees = message.routing?.parsedAddressees || [];
    this.logger.debug(
      `[v3 Routing] Using saved parsedAddressees: ${JSON.stringify(parsedAddressees)}`
    );

    let resolvedMembers: Member[] = [];

    if (addressees.length === 0) {
      // 没有指定接收者，如果队列已有待处理路由则继续处理队列
      // v3: Only check routingQueueV3 (single source of truth)
      if (!this.routingQueueV3.isEmpty()) {
        await this.processRoutingQueue();
        return;
      }

      // 队列为空，兜底路由到第一个 human 成员
      const firstHuman = this.team.members.find(m => m.type === 'human');
      if (firstHuman) {
        resolvedMembers = [firstHuman];
      }
    } else {
      // 解析接收者
      const resolveResult = this.resolveAddressees(addressees);
      resolvedMembers = resolveResult.resolved;

      // 部分解析失败通知（resolved 非空 且 unresolved 非空）
      // 注意：resolved 为空时走 onUnresolvedAddressees，不要混用这两个回调
      if (resolveResult.unresolved.length > 0 && resolveResult.resolved.length > 0) {
        this.notifyPartialResolveFailure(resolveResult.unresolved);
      }
    }

    // 检查是否有无法解析的地址（全部失败）
    if (resolvedMembers.length === 0 && addressees.length > 0) {
      // 所有地址都无法解析
      this.logger.debug('[Routing] Unable to resolve addressees; determining fallback');

      // 通知 UI
      if (this.options.onUnresolvedAddressees) {
        this.options.onUnresolvedAddressees(addressees, message);
      }

      // 根据消息来源决定 fallback 行为
      const speakerType = message.speaker.type;
      if (speakerType === 'human') {
        // Human 发送的消息全部解析失败 → 等待该 Human 重新输入
        this.status = 'paused';
        this.waitingForMemberId = message.speaker.id;
        this.notifyStatusChange();
      } else {
        // AI 发送的消息全部解析失败 → fallback 到首个 Human（按 order）
        const firstHuman = this.team!.members
          .slice()
          .sort((a, b) => a.order - b.order)
          .find(m => m.type === 'human');

        if (firstHuman) {
          this.status = 'paused';
          this.waitingForMemberId = firstHuman.id;
          this.notifyStatusChange();
        }
      }

      // AUTO-SAVE on pause（暂停时必须保存）
      this.saveCurrentSession().catch(() => {});

      return;
    }

    // 去重（全局）防止重复路由同一成员导致 UI key 冲突和重复执行
    // 保持原始顺序
    const uniqueMembers: Member[] = [];
    const seen = new Set<string>();
    for (const member of resolvedMembers) {
      if (seen.has(member.id)) continue;
      seen.add(member.id);
      uniqueMembers.push(member);
    }
    resolvedMembers = uniqueMembers;

    // 更新消息的 resolvedAddressees
    if (message.routing) {
      message.routing.resolvedAddressees = resolvedMembers.map(member => ({
        identifier: member.name,
        memberId: member.id,
        memberName: member.name
      }));
    }

    this.logger.debug(
      `[Routing] Resolved addressees: ${resolvedMembers.map(m => `${m.name}(${m.id})`).join(', ') || 'none'}`
    );

    // v3: Enqueue ONLY into v3 queue (legacy queue removed for single-source scheduling)
    if (resolvedMembers.length > 0) {
      // Build enqueue inputs with intent from parsedAddressees
      const enqueueInputs: EnqueueInput[] = [];
      for (const member of resolvedMembers) {
        // Find matching parsed addressee by id, name, or displayName
        // (aligns with resolveAddressees normalization rules)
        const normalizedMemberId = this.normalizeIdentifier(member.id);
        const normalizedMemberName = this.normalizeIdentifier(member.name);
        const normalizedMemberDisplayName = this.normalizeIdentifier(member.displayName);

        const matchingParsed = parsedAddressees.find(pa => {
          const normalizedPa = this.normalizeIdentifier(pa.name);
          return normalizedPa === normalizedMemberId ||
                 normalizedPa === normalizedMemberName ||
                 normalizedPa === normalizedMemberDisplayName;
        });
        const shortIntent = matchingParsed?.intent ?? 'P2';
        const intent = intentToEnum(shortIntent);

        enqueueInputs.push({
          targetMemberId: member.id,
          intent,
        });
      }

      // Enqueue with message ID as parentMessageId
      const enqueueResult = this.routingQueueV3.enqueue(enqueueInputs, message.id);
      this.logger.debug(
        `[v3 Routing] Enqueued ${enqueueResult.enqueued.length} items, ` +
        `skipped ${enqueueResult.skipped.length}`
      );
    }

    // 通知队列更新（入队完成）
    this.notifyQueueUpdate();

    await this.processRoutingQueue();
  }

  /**
   * Process routing queue using v3 queue as single source of truth
   *
   * v3 Architecture:
   * - Uses routingQueueV3.selectNext() as the sole driver
   * - Gets member via memberLookup from route.targetMemberId
   * - Ensures member and route are always in sync
   */
  private async processRoutingQueue(): Promise<void> {
    if (this.routingInProgress) {
      this.logger.debug('[ProcessQueue] Already in progress, skipping');
      return;
    }
    this.routingInProgress = true;

    this.logger.debug(`[ProcessQueue] Processing v3 queue with ${this.routingQueueV3.size()} items`);

    // v3: Use routingQueueV3 as single source of truth
    while (!this.routingQueueV3.isEmpty()) {
      const route = this.routingQueueV3.selectNext();
      if (!route) {
        this.logger.debug('[ProcessQueue] selectNext returned null, queue empty');
        break;
      }

      // Get member from route's targetMemberId
      const member = this.team?.members.find(m => m.id === route.targetMemberId);
      if (!member) {
        this.logger.warn(`[ProcessQueue] Member ${route.targetMemberId} not found, skipping route`);
        continue;
      }

      this.currentRoutingItem = route;
      this.logger.debug(
        `[v3 ProcessQueue] Selected route: ${route.id} -> ${member.name}(${member.id}), ` +
        `intent=${route.intent}, parent=${route.parentMessageId}`
      );

      // 通知队列更新（member 作为 executing 传入）
      this.notifyQueueUpdate(member);

      // 动态获取最新消息作为 [MESSAGE] (fallback for legacy context)
      const latestMessage = this.session?.messages[this.session.messages.length - 1];
      const messageContent = latestMessage?.content ?? '';

      this.logger.debug(`[ProcessQueue] Processing ${member.name} (${member.type}), latest message from: ${latestMessage?.speaker.name}`);

      if (member.type === 'ai') {
        await this.sendToAgent(member, messageContent, route);
        // Clear current routing item after completion
        this.currentRoutingItem = null;
        continue;
      }

      // human: 暂停并等待输入，保留队列顺序
      this.waitingForMemberId = member.id;
      this.status = 'paused';
      this.notifyStatusChange();

      // Clear current routing item when pausing for human
      this.currentRoutingItem = null;

      // 通知队列更新（Human 暂停，无 executing）
      this.notifyQueueUpdate();

      // AUTO-SAVE on turn completion (fire-and-forget)
      this.saveCurrentSession().catch(() => {
        // Error already logged in saveCurrentSession
      });

      this.logger.debug(`[ProcessQueue] Paused for human ${member.name}`);
      break;
    }

    this.logger.debug('[ProcessQueue] Finished processing queue');

    // Clear current routing item
    this.currentRoutingItem = null;

    // 通知队列清空（无 executing）
    this.notifyQueueUpdate();

    this.routingInProgress = false;
  }

  /**
   * 发送消息给 Agent
   *
   * v3: When route parameter is provided, uses getContextForRoute for
   * causal-aware context retrieval with parent message and sibling context.
   *
   * @param member - Target member
   * @param message - Message content (legacy, ignored when route is provided)
   * @param route - v3 routing item (optional, enables v3 context features)
   */
  private async sendToAgent(member: Member, message: string, route?: RoutingItem): Promise<void> {
    if (!member.agentConfigId) {
      throw new Error(`Member ${member.id} has no agent config`);
    }

    // Track currently executing member for cancellation
    this.currentExecutingMember = member;
    this.currentRoutingItem = route ?? null; // v3: Track current routing item

    // Notify that agent has started
    if (this.options.onAgentStarted) {
      this.options.onAgentStarted(member);
    }

    try {
      // 准备 member-specific spawn configuration
      const memberConfig = {
        env: member.env,
        additionalArgs: member.additionalArgs,
        systemInstruction: member.systemInstruction
      };

      // 确保 Agent 已启动
      await this.agentManager.ensureAgentStarted(member.id, member.agentConfigId, memberConfig);

      // Use ContextManager to prepare context and assemble prompt
      const agentType = normalizeAgentType(member.agentType) as AgentType;

      // v3: Use getContextForRoute when RoutingItem is available
      let contextInput;
      if (route) {
        contextInput = this.contextManager.getContextForRoute(
          member.id,
          agentType,
          route,
          {
            systemInstruction: member.systemInstruction,
            instructionFileText: member.instructionFileText,
          }
        );
        this.logger.debug(
          `[v3] Using getContextForRoute for ${member.name}, ` +
          `parent=${route.parentMessageId}, intent=${route.intent}`
        );
      } else {
        // Legacy: use getContextForAgent
        contextInput = this.contextManager.getContextForAgent(
          member.id,
          agentType,
          {
            systemInstruction: member.systemInstruction,
            instructionFileText: member.instructionFileText,
          }
        );
      }

      const prompt = this.contextManager.assemblePrompt(agentType, contextInput);

      // Get timeout from conversation config (default: 30 minutes)
      const maxTimeout = this.options.conversationConfig?.maxAgentResponseTime ?? 1800000;

      // 发送并等待响应
      this.logger.debug(`[Send] to ${member.name} (${member.id}):\n${prompt.prompt}`);

      const teamContext = {
        teamName: this.team!.name,
        teamDisplayName: this.team!.displayName,
        memberName: member.name,
        memberDisplayName: member.displayName,
        memberRole: member.role,
        memberDisplayRole: member.displayRole,
        themeColor: member.themeColor
      };

      const response = await this.agentManager.sendAndReceive(
        member.id,
        prompt.prompt,
        { maxTimeout, systemFlag: prompt.systemFlag, teamContext }
      );

      // 停止 Agent（因为我们关闭了 stdin，进程会退出，下次需要重新启动）
      await this.agentManager.stopAgent(member.id);

      // Notify that agent has completed
      if (this.options.onAgentCompleted) {
        this.options.onAgentCompleted(member);
      }

      // 响应内容改为流式事件，result 仅指示完成状态
      if (!response.success) {
        this.logger.debug(`[AgentResult] ${member.id} finished with ${response.finishReason}`);
      }

      // Store accumulated AI response to ContextManager for subsequent AI routing
      // This ensures the next AI in routingQueue receives the previous AI's response
      if (response.accumulatedText && response.accumulatedText.trim()) {
        await this.onAgentResponse(member.id, response.accumulatedText);
      }

      // 如果路由队列中已有待处理的 NEXT，优先继续处理队列
      // v3: Only check routingQueueV3 (single source of truth)
      if (!this.routingQueueV3.isEmpty()) {
        await this.processRoutingQueue();
        return;
      }

      // Fallback: 路由到首个 Human（替换 round-robin）
      // 按 order 排序找到第一个 human
      const firstHuman = this.team!.members
        .slice()
        .sort((a, b) => a.order - b.order)
        .find(m => m.type === 'human');

      if (firstHuman) {
        this.status = 'paused';
        this.waitingForMemberId = firstHuman.id;
        this.notifyStatusChange();

        // AUTO-SAVE on turn completion
        this.saveCurrentSession().catch(() => {});
      }
      // 注意：由于 TeamUtils.validateTeam() 已强制校验至少 1 个 Human，
      // firstHuman 必定存在，无需 else 分支
    } catch (error) {
      // Notify that agent has completed (even on error)
      if (this.options.onAgentCompleted) {
        this.options.onAgentCompleted(member);
      }

      // Check if this is a user cancellation
      if (error instanceof Error && error.message === '[CANCELLED_BY_USER]') {
        // User cancelled via ESC - don't rethrow
        // The cancellation flow is already handled by handleUserCancellation()
        // which set status to paused and waitingForMemberId
        return;
      }

      // For other errors, rethrow
      throw error;
    } finally {
      // Clear currently executing member
      this.currentExecutingMember = null;
    }
  }

  /**
   * 解析接收者标识为 Member 对象
   *
   * 实现模糊匹配：
   * - 支持 member.id 精确匹配
   * - 支持 member.name 和 member.displayName 模糊匹配
   * - 大小写不敏感
   * - 忽略空格和连字符
   *
   * @returns ResolveResult 包含 resolved 和 unresolved 两个数组
   */
  private resolveAddressees(addressees: string[]): ResolveResult {
    const result: ResolveResult = {
      resolved: [],
      unresolved: []
    };

    if (!this.team) {
      // 无团队时，所有地址都无法解析
      result.unresolved = [...addressees];
      return result;
    }

    for (const addressee of addressees) {
      // 规范化：转小写，移除空格和连字符
      const normalizedAddressee = this.normalizeIdentifier(addressee);

      // 尝试按 ID、名称或显示名称匹配
      const member = this.team.members.find(m => {
        // 1. 先尝试精确匹配 member.id（规范化后）
        const normalizedId = this.normalizeIdentifier(m.id);
        if (normalizedId === normalizedAddressee) {
          return true;
        }

        // 2. 再尝试匹配 name 和 displayName（模糊匹配）
        const normalizedName = this.normalizeIdentifier(m.name);
        const normalizedDisplayName = this.normalizeIdentifier(m.displayName);
        return normalizedName === normalizedAddressee || normalizedDisplayName === normalizedAddressee;
      });

      if (member) {
        result.resolved.push(member);
      } else {
        result.unresolved.push(addressee);
      }
    }

    return result;
  }

  /**
   * 规范化标识符（用于模糊匹配）
   */
  private normalizeIdentifier(identifier: string): string {
    return identifier
      .toLowerCase()
      .replace(/[\s\-_]/g, '');  // 移除空格、连字符、下划线
  }

  /**
   * 处理对话完成
   */
  private handleConversationComplete(): void {
    if (!this.session) {
      return;
    }

    this.session = SessionUtils.updateSessionStatus(this.session, 'completed');
    this.status = 'completed';
    this.waitingForMemberId = null;  // 清除等待状态，防止接受完成后的输入
    this.notifyStatusChange();

    // 停止所有 Agent
    this.agentManager.cleanup();
  }

  /**
   * Store message in both session and ContextManager
   * This keeps both data stores in sync
   *
   * v3: Also marks the message as completed in RoutingQueue
   */
  private storeMessage(message: ConversationMessage): void {
    // Add to session (for backward compatibility)
    if (this.session) {
      this.session = SessionUtils.addMessageToSession(this.session, message);
    }

    // Add to ContextManager (new system)
    // ContextManager expects message without ID, but will ignore if one exists
    this.contextManager.addMessage({
      timestamp: message.timestamp,
      speaker: message.speaker,
      content: message.content,
      routing: message.routing,
    });

    // v3: Mark message as completed for local queue scheduling
    this.routingQueueV3.markCompleted(message.id);
  }

  /**
   * 通知消息回调
   */
  private notifyMessage(message: ConversationMessage): void {
    if (this.options.onMessage) {
      this.options.onMessage(message);
    }
  }

  /**
   * 通知状态变化回调
   */
  private notifyStatusChange(): void {
    if (this.options.onStatusChange) {
      this.options.onStatusChange(this.status);
    }
  }

  /**
   * 通知部分解析失败
   *
   * @param unresolved - 未能解析的地址列表
   */
  private notifyPartialResolveFailure(unresolved: string[]): void {
    if (!this.team || unresolved.length === 0) {
      return;
    }

    // 获取可用成员名称列表
    const availableMembers = this.team.members.map(m => m.name);

    // Debug 日志
    this.logger.debug(
      `[Routing] Partial resolve failure: ${unresolved.join(', ')} not found. ` +
      `Available: ${availableMembers.join(', ')}`
    );

    // 通知 UI
    if (this.options.onPartialResolveFailure) {
      this.options.onPartialResolveFailure(unresolved, availableMembers);
    }
  }

  /**
   * 通知队列状态更新
   *
   * v3: Uses RoutingQueueV3 for v3-aware event emission with stats and itemsDetail
   *
   * @param executing - 当前正在执行的成员（可选）
   */
  private notifyQueueUpdate(executing?: Member): void {
    if (!this.options.onQueueUpdate) {
      return;
    }

    // v3: Delegate to RoutingQueue for full v3 event with itemsDetail and stats
    // routingQueueV3 is the single source of truth (legacy queue removed)
    this.routingQueueV3.notifyQueueUpdate(executing, this.currentRoutingItem ?? undefined);
  }

  /**
   * 获取当前会话
   */
  getSession(): ConversationSession | null {
    return this.session;
  }

  /**
   * 获取当前状态
   */
  getStatus(): ConversationStatus {
    return this.status;
  }

  /**
   * 获取等待输入的成员 ID
   */
  getWaitingForMemberId(): string | null {
    return this.waitingForMemberId;
  }

  /**
   * 设置等待输入的角色 ID
   */
  setWaitingForMemberId(memberId: string | null): void {
    this.waitingForMemberId = memberId;
  }

  /**
   * 暂停对话
   */
  pause(): void {
    this.status = 'paused';
    this.notifyStatusChange();
  }

  /**
   * 恢复对话
   */
  resume(): void {
    if (this.status === 'paused') {
      this.status = 'active';
      this.notifyStatusChange();
    }
  }

  /**
   * 停止对话
   */
  async stop(): Promise<void> {
    // AUTO-SAVE before cleanup
    await this.saveCurrentSession();

    this.handleConversationComplete();
  }

  /**
   * Handle user cancellation (ESC key)
   * Cancels the currently executing agent and pauses the conversation
   */
  async handleUserCancellation(): Promise<void> {
    if (this.currentExecutingMember) {
      // Notify that agent has completed (even though it was cancelled)
      if (this.options.onAgentCompleted) {
        this.options.onAgentCompleted(this.currentExecutingMember);
      }

      // Cancel the agent execution
      this.agentManager.cancelAgent(this.currentExecutingMember.id);
      this.currentExecutingMember = null;
    }

    // Find the first human member to resume conversation
    if (this.team) {
      const humanMember = this.team.members.find(m => m.type === 'human');
      if (humanMember) {
        this.waitingForMemberId = humanMember.id;
      }
    }

    // Pause the conversation
    this.status = 'paused';
    this.notifyStatusChange();

    // AUTO-SAVE on cancellation
    await this.saveCurrentSession();
  }

  // --------------------------------------------------------------------------
  // Session Persistence Methods
  // --------------------------------------------------------------------------

  /**
   * Restore a previous session from storage
   *
   * @param sessionId - Session ID to restore
   * @throws Error if session not found or teamId mismatch
   */
  private async restoreSession(sessionId: string): Promise<void> {
    // 1. Validate team exists
    if (!this.team) {
      throw new Error('Team must be set before restoring session');
    }

    // 2. Load snapshot
    const snapshot = await this.sessionStorage.loadSession(this.team.id, sessionId);
    if (!snapshot) {
      throw new Error(
        `Session '${sessionId}' not found for team '${this.team.id}'.\n` +
        `Use --resume without ID to restore the latest session, or start a new session.`
      );
    }

    // 3. Validate teamId match
    if (snapshot.teamId !== this.team.id) {
      throw new Error(
        `Session teamId mismatch: snapshot is for team '${snapshot.teamId}', ` +
        `but current team is '${this.team.id}'.\n` +
        `Please use the correct team configuration.`
      );
    }

    // 4. Check member consistency (warn, don't block)
    this.checkMemberConsistency(snapshot);

    // 5. Migrate speaker fields if legacy format
    const migratedMessages = this.migrateMessagesIfNeeded(snapshot.context.messages);

    // 6. Import context
    this.contextManager.importSnapshot({
      messages: migratedMessages,
      teamTask: snapshot.context.teamTask,
      timestamp: Date.now(),
      version: 1,
    });

    // 7. Rebuild ConversationSession
    this.session = this.rebuildSession(snapshot, migratedMessages);

    // 8. Reset execution state (Ready-Idle principle)
    this.routingQueue = []; // Legacy (deprecated)
    this.routingQueueV3.clear(); // v3: Clear the routing queue
    this.currentRoutingItem = null;
    this.currentExecutingMember = null;
    this.status = 'paused';
    this.waitingForMemberId = this.getFirstHumanMemberId();

    // 9. Notify
    this.notifyStatusChange();
  }

  /**
   * Check if historical speakers still exist in current team
   * Warns if mismatch, but does not block restore
   *
   * @param snapshot - Session snapshot to check
   */
  private checkMemberConsistency(snapshot: SessionSnapshot): void {
    const currentMemberIds = new Set(this.team!.members.map(m => m.id));

    // Collect unique speakers from history
    const speakerMap = new Map<string, string>(); // id -> name
    for (const msg of snapshot.context.messages) {
      const speaker = msg.speaker as SpeakerInfoInput;
      // Use getSpeakerId to handle both new and legacy formats
      const speakerId = getSpeakerId(speaker);
      // Get display name from either format
      const speakerName = isNewSpeaker(speaker)
        ? speaker.displayName
        : speakerId;

      if (speakerId && speakerId !== 'system') {
        speakerMap.set(speakerId, speakerName ?? speakerId);
      }
    }

    // Find missing members
    const missingMembers: MissingMember[] = [];
    for (const [id, name] of speakerMap) {
      if (!currentMemberIds.has(id)) {
        missingMembers.push({ id, name });
      }
    }

    if (missingMembers.length > 0) {
      const names = missingMembers.map(m => m.name).join(', ');

      // User-visible warning via logger interface
      this.logger.warn(
        `Some speakers in history are not in current team: ${names}. ` +
        `Their messages will be displayed with original names.`
      );

      // Callback for UI layer
      this.options.onMemberConsistencyWarning?.(missingMembers);
    }
  }

  /**
   * Migrate messages from persisted format to ConversationMessage format
   *
   * Persisted format uses new speaker fields (id/name/displayName).
   * ConversationMessage also uses new format (id/name/displayName).
   * This method ensures consistent format regardless of persisted format version.
   *
   * @param messages - Persisted messages (may have either speaker format for backward compat)
   * @returns ConversationMessage array with new speaker format
   */
  private migrateMessagesIfNeeded(messages: PersistedMessage[]): ConversationMessage[] {
    return messages.map(msg => {
      // Use migrateMessageSpeaker utility for consistent speaker migration
      const migratedSpeaker = migrateMessageSpeaker(msg.speaker as SpeakerInfoInput);

      // Convert routing resolvedAddressees if present (legacy may have roleId/roleName)
      let routing = msg.routing;
      if (routing) {
        routing = {
          rawNextMarkers: routing.rawNextMarkers,
          resolvedAddressees: routing.resolvedAddressees.map(addr => ({
            identifier: addr.identifier,
            memberId: (addr as any).memberId ?? (addr as any).roleId ?? null,
            memberName: (addr as any).memberName ?? (addr as any).roleName ?? null,
          })),
        };
      }

      return {
        id: msg.id,
        timestamp: new Date(msg.timestamp),
        speaker: migratedSpeaker,
        content: msg.content,
        routing,
      };
    });
  }

  /**
   * Rebuild ConversationSession from snapshot
   *
   * @param snapshot - Source snapshot
   * @param messages - Migrated messages
   * @returns Rebuilt session object
   */
  private rebuildSession(
    snapshot: SessionSnapshot,
    messages: ConversationMessage[]
  ): ConversationSession {
    return {
      id: snapshot.sessionId,
      teamId: snapshot.teamId,
      teamName: this.team!.name,
      title: this.generateRestoredTitle(snapshot),
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      status: 'paused', // Always start paused
      teamTask: snapshot.context.teamTask,
      messages: [...messages],
      stats: {
        totalMessages: messages.length,
        messagesByRole: this.calculateMessagesByRole(messages),
        duration: Date.now() - new Date(snapshot.createdAt).getTime(),
      },
    };
  }

  /**
   * Generate title for restored session
   */
  private generateRestoredTitle(snapshot: SessionSnapshot): string {
    const date = new Date(snapshot.updatedAt);
    const formatted = date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `Restored - ${formatted}`;
  }

  /**
   * Calculate message count by member
   */
  private calculateMessagesByRole(messages: ConversationMessage[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const msg of messages) {
      const memberId = msg.speaker.id;
      result[memberId] = (result[memberId] ?? 0) + 1;
    }
    return result;
  }

  /**
   * Get first human member's ID
   * Used to set waitingForMemberId after restore
   *
   * @returns Human member ID, or null if no human members
   */
  private getFirstHumanMemberId(): string | null {
    const human = this.team?.members.find(m => m.type === 'human');
    return human?.id ?? null;
  }

  /**
   * Save current session to storage
   * Called automatically at save trigger points
   *
   * Non-blocking: errors are logged but don't interrupt flow
   */
  async saveCurrentSession(): Promise<void> {
    if (!this.session || !this.team) {
      return; // Nothing to save
    }

    try {
      const contextSnapshot = this.contextManager.exportSnapshot();

      const snapshot = createSessionSnapshot(this.session, contextSnapshot);

      await this.sessionStorage.saveSession(this.team.id, snapshot);
    } catch (err) {
      // Log error but don't throw - save failure shouldn't crash the app
      this.logger.error(`Failed to save session: ${(err as Error).message}`);
    }
  }
}
