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
import type { ConversationMessage, MessageDelivery } from '../models/ConversationMessage.js';
import { MessageUtils } from '../models/ConversationMessage.js';
import type { ConversationSession } from '../models/ConversationSession.js';
import { SessionUtils } from '../models/ConversationSession.js';
import { AgentManager } from './AgentManager.js';
import { MessageRouter } from './MessageRouter.js';
import type { ConversationConfig } from '../models/CLIConfig.js';
import { buildPrompt, type PromptContextMessage } from '../utils/PromptBuilder.js';
import { formatJsonl } from '../utils/JsonlMessageFormatter.js';
import type { ContextEventCollector, ContextSummary } from './ContextEventCollector.js';
import type { AgentEvent } from '../events/AgentEvent.js';

export type ConversationStatus = 'active' | 'paused' | 'completed';

export interface ConversationCoordinatorOptions {
  contextMessageCount?: number;  // 包含在上下文中的最近消息数量
  onMessage?: (message: ConversationMessage) => void;  // 消息回调
  onStatusChange?: (status: ConversationStatus) => void;  // 状态变化回调
  onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;  // 无法解析地址时的回调
  conversationConfig?: ConversationConfig;  // Conversation configuration (timeout, UI behavior)
  onAgentStarted?: (member: Member) => void;  // Called when an agent starts executing
  onAgentCompleted?: (member: Member) => void;  // Called when an agent completes execution
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
  private waitingForRoleId: string | null = null;  // 等待哪个角色的输入
  private currentExecutingMember: Member | null = null;  // Currently executing agent (for cancellation)
  private routingQueue: Array<{ member: Member; content: string }> = [];
  private routingInProgress = false;
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
    private options: ConversationCoordinatorOptions = {},
    private contextCollector?: ContextEventCollector
  ) {
    this.contextMessageCount = options.contextMessageCount || 5;
  }

  /**
   * Set team without starting conversation
   */
  setTeam(team: Team): void {
    this.team = team;
    this.session = null;
    this.waitingForRoleId = null;
    this.routingQueue = [];
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

    this.session = SessionUtils.addMessageToSession(this.session, message);
    this.notifyMessage(message);

    // Clear waitingForRoleId (if user buzzed in or responded)
    this.waitingForRoleId = null;

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

    // PRIORITY 3: waitingForRoleId (system set from previous routing)
    if (this.waitingForRoleId) {
      const member = this.team.members.find(m => m.id === this.waitingForRoleId);
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
    if (!this.session) return;

    const MAX_TEAM_TASK_BYTES = 5 * 1024; // 5KB limit
    const taskBytes = Buffer.byteLength(newTask, 'utf-8');

    if (taskBytes > MAX_TEAM_TASK_BYTES) {
      // Truncate and warn
      this.session.teamTask = this.truncateToBytes(newTask, MAX_TEAM_TASK_BYTES - 3) + '...';
      // eslint-disable-next-line no-console
      console.warn(
        `Warning: Team task truncated from ${taskBytes} bytes to ${MAX_TEAM_TASK_BYTES} bytes (5KB limit).`
      );
    } else {
      this.session.teamTask = newTask;
    }
  }

  private truncateToBytes(str: string, maxBytes: number): string {
    let bytes = 0;
    let truncated = '';

    for (const char of str) {
      const charBytes = Buffer.byteLength(char, 'utf-8');
      if (bytes + charBytes > maxBytes) break;
      truncated += char;
      bytes += charBytes;
    }

    return truncated;
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
    this.session = SessionUtils.addMessageToSession(this.session, message);
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
    this.waitingForRoleId = null;

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
    this.session = SessionUtils.addMessageToSession(this.session, message);
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
        `[Debug][Routing] From ${message.speaker.roleName} addressees=${JSON.stringify(addressees)}`
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
        roleId: member.id,
        roleName: member.name
      }));
    }

    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error(
        `[Debug][Routing] Resolved addressees: ${resolvedMembers.map(m => `${m.name}(${m.id})`).join(', ') || 'none'}`
      );
    }

    // 入队并串行处理
    for (const member of resolvedMembers) {
      const delivery = this.prepareDelivery(member, message.content);
      this.routingQueue.push({ member, content: delivery.content });
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
      const { member, content } = this.routingQueue.shift()!;
      if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error(`[Debug][ProcessQueue] Processing ${member.name} (${member.type})`);
      }

      if (member.type === 'ai') {
        await this.sendToAgent(member, content);
        continue;
      }

      // human: 暂停并等待输入，保留队列顺序
      this.waitingForRoleId = member.id;
      this.status = 'paused';
      this.notifyStatusChange();
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
   * 准备消息交付（添加上下文）
   */
  private prepareDelivery(recipient: Member, content: string): MessageDelivery {
    const contextMessages = this.getRecentMessages(this.contextMessageCount);

    return {
      recipient: {
        roleId: recipient.id,
        roleName: recipient.name
      },
      content,
      context: contextMessages
    };
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

      // 准备上下文消息
      let contextMessages: PromptContextMessage[] = this.getRecentMessages(this.contextMessageCount).map(msg => ({
        from: msg.speaker.roleName,
        to: msg.routing?.resolvedAddressees?.map(r => r.roleName).join(', '),
        content: msg.content,
        timestamp: new Date(msg.timestamp)
      }));

      // 如果最新一条与当前 message 内容相同（典型 AI->AI 路由场景），去掉它避免重复
      const lastCtx = contextMessages[contextMessages.length - 1];
      if (lastCtx && lastCtx.content === message) {
        contextMessages = contextMessages.slice(0, -1);
      }

      const prompt = buildPrompt({
        agentType: normalizeAgentType(member.agentType),
        systemInstructionText: member.systemInstruction,
        instructionFileText: member.instructionFileText,
        contextMessages,
        message
      });

      // Get timeout from conversation config (default: 30 minutes)
      const maxTimeout = this.options.conversationConfig?.maxAgentResponseTime ?? 1800000;

      // 发送并等待响应
      if (process.env.DEBUG) {
        // eslint-disable-next-line no-console
        console.error(`[Debug][Send] to ${member.name} (${member.id}):\n${prompt.prompt}`);
        if (prompt.systemFlag) {
          console.error(`[Debug][Send] systemFlag (for ${member.name}):\n${prompt.systemFlag}`);
        }
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

      // 如果路由队列中已有待处理的 NEXT，优先继续处理队列
      if (this.routingQueue.length > 0) {
        await this.processRoutingQueue();
        return;
      }

      // 将本轮 agent 输出记录到会话并路由下一位（使用完整摘要文本做路由，不截断）
      const summary = this.contextCollector?.getRecentSummaries(1).find(s => s.agentId === member.id);
      if (summary) {
        const parsed = this.messageRouter.parseMessage(summary.text);
        const messageEntry: ConversationMessage = MessageUtils.createMessage(
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
        this.session = SessionUtils.addMessageToSession(this.session!, messageEntry);
        this.notifyMessage(messageEntry);
        await this.routeToNext(messageEntry);
        return;
      }

      // fallback: round-robin
      const nextMember = this.getNextSpeaker(member.id);
      if (nextMember && nextMember.type === 'human') {
        this.status = 'paused';
        this.waitingForRoleId = nextMember.id;
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
        // which set status to paused and waitingForRoleId
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
   * 获取最近的 N 条消息
   */
  private getRecentMessages(count: number): ConversationMessage[] {
    if (!this.session) {
      return [];
    }

    const messages = this.session.messages;
    return messages.slice(-count);
  }

  /**
   * 获取最近的 N 条上下文，优先使用事件汇总，回退到消息历史
   */
  private getRecentContext(count: number): PromptContextMessage[] {
    const summaries: ContextSummary[] = this.contextCollector
      ? this.contextCollector.getRecentSummaries(count)
      : [];

    if (summaries.length > 0) {
      return summaries.slice(-count).map(s => ({
        from: s.agentName ?? s.agentId,
        to: undefined,
        content: s.text,
        timestamp: new Date(s.timestamp)
      }));
    }

    // Fallback: original message history
    return this.getRecentMessages(count).map(msg => ({
      from: msg.speaker.roleName,
      to: msg.routing?.resolvedAddressees?.map(r => r.roleName).join(', '),
      content: msg.content,
      timestamp: new Date(msg.timestamp)
    }));
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
    this.waitingForRoleId = null;  // 清除等待状态，防止接受完成后的输入
    this.notifyStatusChange();

    // 停止所有 Agent
    this.agentManager.cleanup();
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
   * 获取等待输入的角色 ID
   */
  getWaitingForRoleId(): string | null {
    return this.waitingForRoleId;
  }

  /**
   * 设置等待输入的角色 ID
   */
  setWaitingForRoleId(roleId: string | null): void {
    this.waitingForRoleId = roleId;
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
  stop(): void {
    this.handleConversationComplete();
  }

  /**
   * Handle user cancellation (ESC key)
   * Cancels the currently executing agent and pauses the conversation
   */
  handleUserCancellation(): void {
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
        this.waitingForRoleId = humanMember.id;
      }
    }

    // Pause the conversation
    this.status = 'paused';
    this.notifyStatusChange();
  }
}
