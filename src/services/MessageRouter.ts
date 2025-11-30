/**
 * MessageRouter - 消息路由和解析
 *
 * 负责解析消息中的 [NEXT: ...] 标记
 * 提取目标接收者并清理消息内容
 */

/**
 * 消息解析结果
 */
export interface ParseResult {
  addressees: string[];     // 提取的接收者列表
  cleanContent: string;     // 移除路由标记（NEXT）后的内容
  fromMember?: string;      // [FROM:xxx] 标记指定的发送者
  teamTask?: string;        // [TEAM_TASK:xxx] 标记指定的团队任务
}

/**
 * MessageRouter 类
 */
export class MessageRouter {
  // 匹配 [FROM: name] 的正则表达式
  private readonly FROM_PATTERN = /\[FROM:\s*([^\]]*)\]/gi;
  // 匹配 [TEAM_TASK: description] 的正则表达式
  private readonly TEAM_TASK_PATTERN = /\[TEAM_TASK:\s*([^\]]*)\]/gi;
  // 匹配 [NEXT: addressee1, addressee2, ...] 的正则表达式（忽略大小写）
  private readonly NEXT_PATTERN = /\[NEXT:\s*([^\]]*)\]/gi;

  /**
   * 解析消息，提取标记和清理内容
   */
  parseMessage(message: string): ParseResult {
    let addressees: string[] = [];

    // 1. 提取 [FROM:xxx]
    this.FROM_PATTERN.lastIndex = 0;
    const fromMatch = this.FROM_PATTERN.exec(message);
    const fromMember = fromMatch?.[1]?.trim();

    // 2. 提取 [TEAM_TASK:xxx] - 使用最后一个出现的值
    this.TEAM_TASK_PATTERN.lastIndex = 0;
    let teamTask: string | undefined;
    let taskMatch;
    while ((taskMatch = this.TEAM_TASK_PATTERN.exec(message)) !== null) {
      teamTask = taskMatch[1]?.trim();
    }

    // 3. 总是提取 NEXT 标记中的接收者
    // 重置正则表达式的 lastIndex
    this.NEXT_PATTERN.lastIndex = 0;

    let match;
    while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
      const addresseeList = match[1];
      if (addresseeList && addresseeList.trim()) {
        const names = addresseeList
          .split(',')
          .map(name => name.trim())
          .filter(name => name.length > 0);
        
        // 支持多个收件人
        addressees.push(...names);
      }
    }

    // 清理内容（移除 NEXT 标记，保留 FROM 和 TEAM_TASK）
    const cleanContent = this.stripNextMarkers(message);

    return {
      addressees,
      cleanContent,
      fromMember,
      teamTask
    };
  }

  /**
   * 仅移除 [NEXT] 标记
   * 保留 [FROM] 和 [TEAM_TASK] 用于历史记录上下文
   */
  stripNextMarkers(message: string): string {
    let result = message;

    // 移除 [NEXT:xxx] 标记
    this.NEXT_PATTERN.lastIndex = 0;
    result = result.replace(this.NEXT_PATTERN, '');

    // 清理多余的空白字符，保留行结构
    return this.cleanupWhitespace(result);
  }

  /**
   * 移除所有标记（包括 FROM 和 TEAM_TASK）
   * 用于构建 prompt 上下文，避免重复
   */
  stripAllMarkersForContext(message: string): string {
    let result = message;

    this.FROM_PATTERN.lastIndex = 0;
    this.TEAM_TASK_PATTERN.lastIndex = 0;
    this.NEXT_PATTERN.lastIndex = 0;

    result = result.replace(this.FROM_PATTERN, '');
    result = result.replace(this.TEAM_TASK_PATTERN, '');
    result = result.replace(this.NEXT_PATTERN, '');

    return this.cleanupWhitespace(result);
  }

  /**
   * 清理空白字符，保留行结构
   */
  private cleanupWhitespace(text: string): string {
    return text
      .split('\n')
      .map(line => {
        // 合并多个空格为单个空格
        return line.replace(/\s{2,}/g, ' ').trim();
      })
      .filter(line => line.length > 0)  // 移除因标记删除产生的空行
      .join('\n')
      .trim();
  }
}
