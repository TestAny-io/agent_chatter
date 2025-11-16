/**
 * ConversationCoordinator - 对话协调器
 *
 * 负责协调整个对话流程：
 * 1. 管理对话历史
 * 2. 路由消息到正确的接收者
 * 3. 处理 [NEXT] 和 [DONE] 标记
 * 4. 协调 Agent 之间的交互
 */

import { Team, Role } from '../models/Team';
import { ConversationMessage, MessageUtils, MessageDelivery } from '../models/ConversationMessage';
import { ConversationSession, SessionUtils } from '../models/ConversationSession';
import { AgentManager } from './AgentManager';
import { MessageRouter } from './MessageRouter';

export type ConversationStatus = 'active' | 'paused' | 'completed';

export interface ConversationCoordinatorOptions {
  contextMessageCount?: number;  // 包含在上下文中的最近消息数量
  onMessage?: (message: ConversationMessage) => void;  // 消息回调
  onStatusChange?: (status: ConversationStatus) => void;  // 状态变化回调
  onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;  // 无法解析地址时的回调
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

  constructor(
    private agentManager: AgentManager,
    private messageRouter: MessageRouter,
    private options: ConversationCoordinatorOptions = {}
  ) {
    this.contextMessageCount = options.contextMessageCount || 5;
  }

  /**
   * 获取正在等待输入的角色 ID
   */
  getWaitingForRoleId(): string | null {
    return this.waitingForRoleId;
  }

  /**
   * 开始新对话
   */
  async startConversation(
    team: Team,
    initialMessage: string,
    firstSpeakerId: string
  ): Promise<void> {
    this.team = team;
    this.session = SessionUtils.createSession(
      team.id,
      team.name,
      initialMessage,
      firstSpeakerId
    );

    this.waitingForRoleId = null;  // 清除之前的等待状态
    this.status = 'active';
    this.notifyStatusChange();

    // 创建初始消息记录（作为 system 消息）
    // 这样后续 agent 可以在 context 中看到初始任务
    const initialSystemMessage: ConversationMessage = MessageUtils.createSystemMessage(
      `Initial task: ${initialMessage}`
    );
    this.session = SessionUtils.addMessageToSession(this.session, initialSystemMessage);
    this.notifyMessage(initialSystemMessage);

    // 发送初始消息给第一个发言者
    const firstRole = team.roles.find(r => r.id === firstSpeakerId);
    if (!firstRole) {
      throw new Error(`Role ${firstSpeakerId} not found in team`);
    }

    if (firstRole.type === 'ai') {
      await this.sendToAgent(firstRole, initialMessage);
    } else {
      // 如果第一个发言者是人类，暂停并等待输入
      this.waitingForRoleId = firstRole.id;
      this.status = 'paused';
      this.notifyStatusChange();
    }
  }

  /**
   * 处理 Agent 响应
   */
  async onAgentResponse(roleId: string, rawResponse: string): Promise<void> {
    if (!this.session || !this.team) {
      throw new Error('No active conversation');
    }

    const role = this.team.roles.find(r => r.id === roleId);
    if (!role) {
      throw new Error(`Role ${roleId} not found`);
    }

    // 解析消息
    const parsed = this.messageRouter.parseMessage(rawResponse);

    // 创建 ConversationMessage
    const message: ConversationMessage = MessageUtils.createMessage(
      role.id,
      role.name,
      role.title,
      role.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: [],
        isDone: parsed.isDone
      }
    );

    // 添加到历史
    this.session = SessionUtils.addMessageToSession(this.session, message);
    this.notifyMessage(message);

    // 检查是否完成
    if (parsed.isDone) {
      this.handleConversationComplete();
      return;
    }

    // 路由到下一个接收者
    await this.routeToNext(message);
  }

  /**
   * 注入人类消息
   */
  async injectMessage(roleId: string, content: string): Promise<void> {
    if (!this.session || !this.team) {
      throw new Error('No active conversation');
    }

    const role = this.team.roles.find(r => r.id === roleId);
    if (!role) {
      throw new Error(`Role ${roleId} not found`);
    }

    // 清除等待状态
    this.waitingForRoleId = null;

    // 解析消息
    const parsed = this.messageRouter.parseMessage(content);

    // 创建消息
    const message: ConversationMessage = MessageUtils.createMessage(
      role.id,
      role.name,
      role.title,
      role.type,
      parsed.cleanContent,
      {
        rawNextMarkers: parsed.addressees,
        resolvedAddressees: [],
        isDone: parsed.isDone
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

    // 检查是否完成
    if (parsed.isDone) {
      this.handleConversationComplete();
      return;
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
    let resolvedRoles: Role[] = [];

    if (addressees.length === 0) {
      // 没有指定接收者，使用轮询机制选择下一个角色
      const currentRole = this.team.roles.find(r => r.id === message.speaker.roleId);
      if (currentRole) {
        // 根据 order 字段找到下一个角色
        const sortedRoles = [...this.team.roles].sort((a, b) => a.order - b.order);
        const currentIndex = sortedRoles.findIndex(r => r.id === currentRole.id);
        const nextIndex = (currentIndex + 1) % sortedRoles.length;
        resolvedRoles = [sortedRoles[nextIndex]];
      } else {
        // 找不到当前角色，暂停对话
        this.status = 'paused';
        this.notifyStatusChange();
        return;
      }
    } else {
      // 解析接收者
      resolvedRoles = this.resolveAddressees(addressees);
    }

    // 检查是否有无法解析的地址
    if (resolvedRoles.length === 0) {
      // 所有地址都无法解析，暂停对话并通知
      this.status = 'paused';
      this.notifyStatusChange();

      if (this.options.onUnresolvedAddressees) {
        this.options.onUnresolvedAddressees(addressees, message);
      }
      return;
    }

    // 更新消息的 resolvedAddressees
    if (message.routing) {
      message.routing.resolvedAddressees = resolvedRoles.map(role => ({
        identifier: role.name,
        roleId: role.id,
        roleName: role.name
      }));
    }

    // 发送给所有接收者
    for (const role of resolvedRoles) {
      const delivery = this.prepareDelivery(role, message.content);

      if (role.type === 'ai') {
        await this.sendToAgent(role, delivery.content);
      } else {
        // 人类接收者，暂停对话
        this.waitingForRoleId = role.id;
        this.status = 'paused';
        this.notifyStatusChange();
      }
    }
  }

  /**
   * 准备消息交付（添加上下文）
   */
  private prepareDelivery(recipient: Role, content: string): MessageDelivery {
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
  private async sendToAgent(role: Role, message: string): Promise<void> {
    if (!role.agentConfigId) {
      throw new Error(`Role ${role.id} has no agent config`);
    }

    // 确保 Agent 已启动
    await this.agentManager.ensureAgentStarted(role.id, role.agentConfigId);

    // 准备完整消息（包含 system instruction 和上下文）
    const fullMessage = this.buildAgentMessage(role, message);

    // 发送并等待响应
    const response = await this.agentManager.sendAndReceive(role.id, fullMessage);

    // 停止 Agent（因为我们关闭了 stdin，进程会退出，下次需要重新启动）
    await this.agentManager.stopAgent(role.id);

    // 处理响应
    await this.onAgentResponse(role.id, response);
  }

  /**
   * 构建发送给 Agent 的完整消息
   */
  private buildAgentMessage(role: Role, message: string): string {
    const parts: string[] = [];

    // 添加 system instruction
    if (role.systemInstruction) {
      parts.push(`[SYSTEM]\n${role.systemInstruction}\n`);
    }

    // 添加最近的对话上下文（排除当前消息，避免重复）
    // 获取最近 N 条消息，但不包括最后一条（即当前消息）
    const allMessages = this.session?.messages || [];
    const contextMessages = allMessages.slice(-this.contextMessageCount - 1, -1);

    if (contextMessages.length > 0) {
      parts.push('[CONTEXT]');
      for (const msg of contextMessages) {
        parts.push(`${msg.speaker.roleName}: ${msg.content}`);
      }
      parts.push('');
    }

    // 添加当前消息
    parts.push('[MESSAGE]');
    parts.push(message);

    return parts.join('\n');
  }

  /**
   * 解析接收者标识为 Role 对象
   *
   * 实现模糊匹配：
   * - 支持 role.id 精确匹配
   * - 支持 role.name 和 role.title 模糊匹配
   * - 大小写不敏感
   * - 忽略空格和连字符
   */
  private resolveAddressees(addressees: string[]): Role[] {
    if (!this.team) {
      return [];
    }

    const roles: Role[] = [];

    for (const addressee of addressees) {
      // 规范化：转小写，移除空格和连字符
      const normalizedAddressee = this.normalizeIdentifier(addressee);

      // 尝试按 ID、名称或标题匹配
      const role = this.team.roles.find(r => {
        // 1. 先尝试精确匹配 role.id（规范化后）
        const normalizedId = this.normalizeIdentifier(r.id);
        if (normalizedId === normalizedAddressee) {
          return true;
        }

        // 2. 再尝试匹配 name 和 title（模糊匹配）
        const normalizedName = this.normalizeIdentifier(r.name);
        const normalizedTitle = this.normalizeIdentifier(r.title);
        return normalizedName === normalizedAddressee || normalizedTitle === normalizedAddressee;
      });

      if (role) {
        roles.push(role);
      }
    }

    return roles;
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
}
