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
import type { AgentType } from '../context/types.js';
import type { ISessionStorage } from '../infrastructure/ISessionStorage.js';
import { SessionStorageService } from '../infrastructure/SessionStorageService.js';
import { createSessionSnapshot, type SessionSnapshot, type PersistedMessage } from '../models/SessionSnapshot.js';
import type { IOutput } from '../outputs/IOutput.js';
import type { SpeakerInfo } from '../models/SpeakerInfo.js';
import { isNewSpeaker, getSpeakerId, type SpeakerInfoInput, migrateMessageSpeaker } from '../utils/speakerMigration.js';

export type ConversationStatus = 'active' | 'paused' | 'completed';

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
   * Output interface for user-visible warnings
   * Used for member consistency warnings
   */
  output?: IOutput;
  /**
   * Callback when member consistency issues detected
   * UI layer can use this to show friendly notifications
   */
  onMemberConsistencyWarning?: (missingMembers: MissingMember[]) => void;
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
  private routingQueue: Array<{ member: Member }> = [];
  private routingInProgress = false;
  private contextManager: ContextManager;
  private sessionStorage: ISessionStorage;
  /**
   * 获取下一个轮到的成员（循环轮询）
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

    // Initialize ContextManager with matching window size
    this.contextManager = new ContextManager({
      contextWindowSize: this.contextMessageCount,
    });

    // Initialize session storage (default: file-based)
    this.sessionStorage = options.sessionStorage ?? new SessionStorageService();
  }

  /**
   * Set team with optional session restore
   *
   * ⚠️ ASYNC - Callers must await
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
    const message: ConversationMessage = MessageUtils.createMessage(
      sender.id,
      sender.name,
      sender.displayName,
      sender.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: []
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
   */
  async onAgentResponse(memberId: string, rawResponse: string): Promise<void> {
    if (!this.session || !this.team) {
      throw new Error('No active conversation');
    }

    const member = this.team.members.find(m => m.id === memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found`);
    }

    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`[Debug][Conversation] Raw agent output from ${member.name} (${member.id}):\n${rawResponse}`);
    }

    // JSONL -> text formatting
    const formatted = formatJsonl(member.agentType as any, rawResponse);

    // 解析消息
    const parsed = this.messageRouter.parseMessage(formatted.text);

    // 创建 ConversationMessage
    const message: ConversationMessage = MessageUtils.createMessage(
      member.id,
      member.name,
      member.displayName,
      member.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: []
      }
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
    const message: ConversationMessage = MessageUtils.createMessage(
      member.id,
      member.name,
      member.displayName,
      member.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: []
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
   */
  private async routeToNext(message: ConversationMessage): Promise<void> {
    if (!this.session || !this.team) {
      return;
    }

    const addressees = message.routing?.rawNextMarkers || [];
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error(
        `[Debug][Routing] From ${message.speaker.name} addressees=${JSON.stringify(addressees)}`
      );
    }
    let resolvedMembers: Member[] = [];

    if (addressees.length === 0) {
      // 没有指定接收者，如果队列已有待处理路由则继续处理队列
      if (this.routingQueue.length > 0) {
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
      resolvedMembers = this.resolveAddressees(addressees);
    }

    // 检查是否有无法解析的地址
      if (resolvedMembers.length === 0) {
        // 所有地址都无法解析，暂停对话并通知
        this.status = 'paused';
        this.notifyStatusChange();
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.error('[Debug][Routing] Unable to resolve addressees; pausing conversation');
        }

        if (this.options.onUnresolvedAddressees) {
          this.options.onUnresolvedAddressees(addressees, message);
        }
        return;
    }

    // 更新消息的 resolvedAddressees
    if (message.routing) {
      message.routing.resolvedAddressees = resolvedMembers.map(member => ({
        identifier: member.name,
        memberId: member.id,
        memberName: member.name
      }));
    }

    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error(
        `[Debug][Routing] Resolved addressees: ${resolvedMembers.map(m => `${m.name}(${m.id})`).join(', ') || 'none'}`
      );
    }

    // 入队并串行处理（只存 member，处理时动态获取最新消息）
    // 去重相邻的重复成员（例如 [max, max, carol] -> [max, carol]）
    for (const member of resolvedMembers) {
      const lastInQueue = this.routingQueue[this.routingQueue.length - 1];
      // Only skip if the immediately previous entry is the same member
      if (lastInQueue && lastInQueue.member.id === member.id) {
        if (process.env.DEBUG) {
          // eslint-disable-next-line no-console
          console.error(`[Debug][Routing] Skipping duplicate adjacent member: ${member.name}(${member.id})`);
        }
        continue;
      }
      this.routingQueue.push({ member });
    }
    await this.processRoutingQueue();
  }

  private async processRoutingQueue(): Promise<void> {
    if (this.routingInProgress) {
      if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error('[Debug][ProcessQueue] Already in progress, skipping');
      }
      return;
    }
    this.routingInProgress = true;

    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`[Debug][ProcessQueue] Processing queue with ${this.routingQueue.length} items`);
    }

    while (this.routingQueue.length > 0) {
      const { member } = this.routingQueue.shift()!;

      // 动态获取最新消息作为 [MESSAGE]
      const latestMessage = this.session?.messages[this.session.messages.length - 1];
      const messageContent = latestMessage?.content ?? '';

      if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error(`[Debug][ProcessQueue] Processing ${member.name} (${member.type}), latest message from: ${latestMessage?.speaker.name}`);
      }

      if (member.type === 'ai') {
        await this.sendToAgent(member, messageContent);
        continue;
      }

      // human: 暂停并等待输入，保留队列顺序
      this.waitingForMemberId = member.id;
      this.status = 'paused';
      this.notifyStatusChange();

      // AUTO-SAVE on turn completion (fire-and-forget)
      this.saveCurrentSession().catch(() => {
        // Error already logged in saveCurrentSession
      });

      if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error(`[Debug][ProcessQueue] Paused for human ${member.name}`);
      }
      break;
    }

    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('[Debug][ProcessQueue] Finished processing queue');
    }
    this.routingInProgress = false;
  }

  /**
   * 发送消息给 Agent
   */
  private async sendToAgent(member: Member, message: string): Promise<void> {
    if (!member.agentConfigId) {
      throw new Error(`Member ${member.id} has no agent config`);
    }

    // Track currently executing member for cancellation
    this.currentExecutingMember = member;

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
      const contextInput = this.contextManager.getContextForAgent(
        member.id,
        agentType,
        {
          systemInstruction: member.systemInstruction,
          instructionFileText: member.instructionFileText,
        }
      );

      const prompt = this.contextManager.assemblePrompt(agentType, contextInput);

      // Get timeout from conversation config (default: 30 minutes)
      const maxTimeout = this.options.conversationConfig?.maxAgentResponseTime ?? 1800000;

      // 发送并等待响应
      if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error(`[Debug][Send] to ${member.name} (${member.id}):\n${prompt.prompt}`);
        // Note: systemFlag is not logged separately as it duplicates content already in prompt
      }

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
      if (!response.success && process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error(`[Debug][AgentResult] ${member.id} finished with ${response.finishReason}`);
      }

      // Store accumulated AI response to ContextManager for subsequent AI routing
      // This ensures the next AI in routingQueue receives the previous AI's response
      if (response.accumulatedText && response.accumulatedText.trim()) {
        await this.onAgentResponse(member.id, response.accumulatedText);
      }

      // 如果路由队列中已有待处理的 NEXT，优先继续处理队列
      if (this.routingQueue.length > 0) {
        await this.processRoutingQueue();
        return;
      }

      // fallback: round-robin
      const nextMember = this.getNextSpeaker(member.id);
      if (nextMember && nextMember.type === 'human') {
        this.status = 'paused';
        this.waitingForMemberId = nextMember.id;
        return;
      }
      if (nextMember && nextMember.type === 'ai') {
        await this.sendToAgent(nextMember, message);
        return;
      }
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
   */
  private resolveAddressees(addressees: string[]): Member[] {
    if (!this.team) {
      return [];
    }

    const members: Member[] = [];

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
        members.push(member);
      }
    }

    return members;
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
    this.routingQueue = [];
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

      // User-visible warning via output interface
      this.options.output?.warn(
        `⚠️  Some speakers in history are not in current team: ${names}\n` +
        `   Their messages will be displayed with original names.`
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
      // eslint-disable-next-line no-console
      console.error(`❌  Failed to save session: ${(err as Error).message}`);
    }
  }
}
