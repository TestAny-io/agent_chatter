/**
 * MessageRouter - 消息路由和解析
 *
 * 负责解析消息中的 [NEXT: ...] 标记
 * 提取目标接收者并清理消息内容
 *
 * v3 extension: Added intent parsing support
 * @see docs/design/route_rule/V3/detail/02-parsing.md
 */

import type { ILogger } from '../interfaces/ILogger.js';
import { SilentLogger } from '../interfaces/ILogger.js';

/**
 * Parsed addressee with intent
 *
 * @see docs/design/route_rule/V3/detail/01-data-model.md
 */
export interface ParsedAddressee {
  /** Addressee name (trimmed) */
  name: string;

  /**
   * Intent marker (optional)
   * Parsed from !P1 / !P2 / !P3, defaults to P2
   */
  intent: 'P1' | 'P2' | 'P3';
}

/**
 * 消息解析结果
 *
 * v3 extension: Added parsedAddressees with intent information
 */
export interface ParseResult {
  /** Parsed addressee identifiers (legacy, for backward compatibility) */
  addressees: string[];

  /**
   * Parsed addressees with intent information (v3)
   *
   * Corresponds 1:1 with addressees, but includes intent info.
   * Use addressees for names only; use this for intent.
   */
  parsedAddressees: ParsedAddressee[];

  /** Clean content with markers stripped */
  cleanContent: string;

  /** Sender identifier from [FROM: xxx] marker */
  fromMember?: string;

  /** Team task from [TEAM_TASK: xxx] marker */
  teamTask?: string;
}

/**
 * MessageRouter 类
 *
 * v3 extension: Added logger injection and intent parsing
 */
export class MessageRouter {
  // 匹配 [FROM: name] 的正则表达式
  private readonly FROM_PATTERN = /\[FROM:\s*([^\]]*)\]/gi;
  // 匹配 [TEAM_TASK: description] 的正则表达式
  private readonly TEAM_TASK_PATTERN = /\[TEAM_TASK:\s*([^\]]*)\]/gi;
  // 匹配 [NEXT: addressee1, addressee2, ...] 的正则表达式（忽略大小写）
  private readonly NEXT_PATTERN = /\[NEXT:\s*([^\]]*)\]/gi;

  /**
   * v3: Single addressee segment parsing regex
   *
   * Pattern breakdown:
   * ^           - Start of string
   * \s*         - Optional leading whitespace
   * (.+?)       - Capture group 1: name (non-greedy, at least 1 char)
   * (?:         - Non-capture group start
   *   \s*       - Optional whitespace before intent
   *   !         - Intent marker
   *   ([pP][123]) - Capture group 2: P1/P2/P3 (case insensitive)
   * )?          - Non-capture group end, entire intent section optional
   * \s*         - Optional trailing whitespace
   * $           - End of string
   */
  private readonly ADDRESSEE_PATTERN = /^\s*(.+?)(?:\s*!([pP][123]))?\s*$/;

  /** Logger for warning about invalid addressees */
  private readonly logger: ILogger;

  constructor(options?: { logger?: ILogger }) {
    this.logger = options?.logger ?? new SilentLogger();
  }

  /**
   * 解析消息，提取标记和清理内容
   *
   * v3 extension: Now returns parsedAddressees with intent information
   */
  parseMessage(message: string): ParseResult {
    const addressees: string[] = [];           // Legacy, backward compatible
    const parsedAddressees: ParsedAddressee[] = [];  // v3 new

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

    // 3. 提取 NEXT 标记中的接收者（含意图解析）
    this.NEXT_PATTERN.lastIndex = 0;

    let match;
    while ((match = this.NEXT_PATTERN.exec(message)) !== null) {
      const addresseeList = match[1];
      if (!addresseeList || !addresseeList.trim()) {
        continue;
      }

      // v3: Use new intent-aware parsing
      const parsed = this.parseAddresseeList(addresseeList);
      for (const addr of parsed) {
        addressees.push(addr.name);        // Backward compatible
        parsedAddressees.push(addr);       // v3 new
      }
    }

    // 清理内容（移除 NEXT 标记，保留 FROM 和 TEAM_TASK）
    const cleanContent = this.stripNextMarkers(message);

    return {
      addressees,
      parsedAddressees,
      cleanContent,
      fromMember,
      teamTask
    };
  }

  /**
   * v3: Parse addressee list with intent information
   *
   * Parses content from [NEXT: ...] marker, extracting addressee names
   * and their optional intent markers (!P1, !P2, !P3).
   *
   * @param content - Content inside [NEXT: ...] marker
   * @returns Array of parsed addressees with intent
   */
  private parseAddresseeList(content: string): ParsedAddressee[] {
    const result: ParsedAddressee[] = [];
    const segments = content.split(',');

    for (const segment of segments) {
      const match = this.ADDRESSEE_PATTERN.exec(segment);

      if (!match) {
        // Cannot match, skip and log warning
        this.logger.warn(`[MessageRouter] Invalid addressee segment: "${segment}"`);
        continue;
      }

      const [, name, intentRaw] = match;

      // Validate name is not empty
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        this.logger.warn(`[MessageRouter] Empty addressee name in segment: "${segment}"`);
        continue;
      }

      // Parse intent (default P2)
      let intent: 'P1' | 'P2' | 'P3' = 'P2';
      if (intentRaw) {
        intent = intentRaw.toUpperCase() as 'P1' | 'P2' | 'P3';
      }

      result.push({ name: trimmedName, intent });
    }

    return result;
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
