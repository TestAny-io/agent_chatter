/**
 * MessageRouter - 消息路由和解析
 *
 * 负责解析消息中的 [NEXT: ...] 和 [DONE] 标记
 * 提取目标接收者并清理消息内容
 */

/**
 * 消息解析结果
 */
export interface ParseResult {
  addressees: string[];     // 提取的接收者列表
  cleanContent: string;     // 移除标记后的内容
  isDone: boolean;          // 是否包含 [DONE] 标记
}

/**
 * MessageRouter 类
 */
export class MessageRouter {
  // 匹配 [NEXT: addressee1, addressee2, ...] 的正则表达式（忽略大小写）
  private readonly NEXT_PATTERN = /\[NEXT:\s*([^\]]*)\]/gi;

  // 匹配 [DONE] 的正则表达式（忽略大小写）
  private readonly DONE_PATTERN = /\[DONE\]/gi;

  /**
   * 解析消息，提取标记和清理内容
   */
  parseMessage(message: string): ParseResult {
    let addressees: string[] = [];
    let isDone = false;

    // 检查是否包含 [DONE] 标记（忽略大小写）
    const doneRegex = /\[DONE\]/i;
    if (doneRegex.test(message)) {
      isDone = true;
    }

    // 总是提取 NEXT 标记中的接收者（与 [DONE] 独立解析）
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

        // 只接受单个收件人；逗号形式视为无效并跳过
        if (names.length === 1) {
          addressees.push(names[0]);
        }
      }
    }

    // 清理内容（移除所有标记）
    const cleanContent = this.stripMarkers(message);

    return {
      addressees,
      cleanContent,
      isDone
    };
  }

  /**
   * 从消息中移除所有标记
   */
  stripMarkers(message: string): string {
    let cleaned = message;

    // 移除标记，保留适当的换行符
    // 如果标记在行中间（前后都有换行），则用单个换行替换
    cleaned = cleaned.replace(/\n\[NEXT:\s*[^\]]*\]\n/gi, '\n');
    cleaned = cleaned.replace(/\n\[DONE\]\n/gi, '\n');

    // 如果标记在开头或结尾，只移除标记和紧邻的换行
    cleaned = cleaned.replace(/^\[NEXT:\s*[^\]]*\]\n?/gi, '');
    cleaned = cleaned.replace(/^\[DONE\]\n?/gi, '');
    cleaned = cleaned.replace(/\n?\[NEXT:\s*[^\]]*\]$/gi, '');
    cleaned = cleaned.replace(/\n?\[DONE\]$/gi, '');

    // 移除任何剩余的标记（包括在文本中间的）
    // 这会移除标记本身以及前后的空格
    cleaned = cleaned.replace(/\s*\[NEXT:\s*[^\]]*\]\s*/gi, ' ');
    cleaned = cleaned.replace(/\s*\[DONE\]\s*/gi, ' ');

    return cleaned.trim();
  }
}
