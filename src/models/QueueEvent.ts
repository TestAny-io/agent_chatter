/**
 * 队列更新事件
 *
 * 用于 UI 显示路由队列状态
 */
import type { Member } from './Team.js';

/**
 * 队列更新事件
 *
 * 采用方案 C：items 为待处理队列，executing 为当前执行者
 * 这样 items 不含当前执行者，语义更清晰
 */
export interface QueueUpdateEvent {
  /** 待处理队列（不含当前执行者） */
  items: Member[];
  /** 当前正在执行的成员（可选，Human 暂停时为 undefined） */
  executing?: Member;
  /** 队列是否为空（items.length === 0 且无 executing） */
  isEmpty: boolean;
}
