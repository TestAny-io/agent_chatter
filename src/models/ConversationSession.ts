import type { ConversationMessage } from './ConversationMessage.js';

/**
 * ConversationSession - 对话会话
 *
 * 用于持久化和管理对话历史
 */
export interface ConversationSession {
  id: string;
  teamId: string;
  teamName: string;

  // 会话元数据
  title: string;  // 用户可编辑
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'paused' | 'completed';

  // 初始参数
  initialMessage: string;
  firstSpeakerId: string;

  // 消息历史
  messages: ConversationMessage[];

  // 统计信息
  stats: {
    totalMessages: number;
    messagesByRole: Record<string, number>;
    duration: number;  // 毫秒
  };
}

/**
 * ConversationSession 工具函数
 */
export class SessionUtils {
  static generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static createSession(
    teamId: string,
    teamName: string,
    initialMessage: string,
    firstSpeakerId: string
  ): ConversationSession {
    const now = new Date();
    return {
      id: this.generateId(),
      teamId,
      teamName,
      title: `对话 - ${new Date().toLocaleString('zh-CN')}`,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      initialMessage,
      firstSpeakerId,
      messages: [],
      stats: {
        totalMessages: 0,
        messagesByRole: {},
        duration: 0
      }
    };
  }

  static addMessageToSession(
    session: ConversationSession,
    message: ConversationMessage
  ): ConversationSession {
    const updated = { ...session };
    updated.messages = [...session.messages, message];
    updated.stats.totalMessages++;

    const roleId = message.speaker.roleId;
    updated.stats.messagesByRole[roleId] = (updated.stats.messagesByRole[roleId] || 0) + 1;

    updated.stats.duration = Date.now() - session.createdAt.getTime();
    updated.updatedAt = new Date();

    return updated;
  }

  static updateSessionStatus(
    session: ConversationSession,
    status: ConversationSession['status']
  ): ConversationSession {
    return {
      ...session,
      status,
      updatedAt: new Date()
    };
  }
}
