/**
 * ConversationMessage - 对话消息（已修正）
 *
 * 重要：此模型已修复"消息归属错误"问题
 * - speaker 是结构化对象
 * - content 已剥离 [NEXT:] 标记
 * - routing 包含解析后的路由信息
 */
export interface ConversationMessage {
  id: string;
  timestamp: Date;

  // 发言者信息（结构化）
  speaker: {
    roleId: string;
    roleName: string;
    roleTitle: string;
    type: 'ai' | 'human' | 'system';
  };

  // 消息内容（已剥离 [NEXT:] 标记）
  content: string;

  // 路由信息（从内容中解析出来）
  routing?: {
    rawNextMarkers: string[];  // 原始 [NEXT: ...] 内容
    resolvedAddressees: Array<{
      identifier: string;      // 用户指定的标识
      roleId: string | null;   // 解析到的角色 ID
      roleName: string | null;
    }>;
  };
}

/**
 * MessageDelivery - 内部消息传递对象
 *
 * 用于在 sendMessageToRole 中传递消息
 * 不是历史记录！
 */
export interface MessageDelivery {
  // 这条消息要发给谁
  recipient: {
    roleId: string;
    roleName: string;
  };

  // 消息内容（已剥离标记 + 添加了上下文）
  content: string;

  // 上下文（最近 N 条历史消息）
  context?: ConversationMessage[];
}

/**
 * ParseResult - 消息解析结果
 *
 * MessageRouter.parseMessage() 的返回值
 */
export interface ParseResult {
  // 解析出的接收者标识
  addressees: string[];

  // 剥离标记后的干净内容
  cleanContent: string;
}

/**
 * ConversationMessage 工具函数
 */
export class MessageUtils {
  static generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static createMessage(
    speakerRoleId: string,
    speakerRoleName: string,
    speakerRoleTitle: string,
    speakerType: 'ai' | 'human' | 'system',
    content: string,
    routing?: ConversationMessage['routing']
  ): ConversationMessage {
    return {
      id: this.generateId(),
      timestamp: new Date(),
      speaker: {
        roleId: speakerRoleId,
        roleName: speakerRoleName,
        roleTitle: speakerRoleTitle,
        type: speakerType
      },
      content,
      routing
    };
  }

  static createSystemMessage(content: string): ConversationMessage {
    return this.createMessage(
      'system',
      'System',
      'System',
      'system',
      content
    );
  }
}
