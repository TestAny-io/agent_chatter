/**
 * QueueDisplay - 队列可见性组件
 *
 * 显示当前路由队列状态，让用户了解接下来会轮到谁
 */
import React from 'react';
import { Box, Text } from 'ink';
import type { Member } from '@testany/agent-chatter-core';

interface QueueDisplayProps {
  /** 待处理队列（不含当前执行者） */
  items: Member[];
  /** 当前正在执行的成员（可选，Human 暂停时为 undefined） */
  executing?: Member;
  /** 是否可见 */
  visible: boolean;
}

export const QueueDisplay: React.FC<QueueDisplayProps> = ({
  items,
  executing,
  visible
}) => {
  // 无内容时隐藏
  if (!visible || (!executing && items.length === 0)) {
    return null;
  }

  return (
    <Box paddingX={1} marginBottom={1}>
      <Text color="cyan">📋 Queue: </Text>

      {/* 当前执行者（如果有） */}
      {executing && (
        <Text color="yellow">[{executing.displayName} ⏳]</Text>
      )}

      {/* 待处理队列 */}
      {items.map((member, index) => (
        <React.Fragment key={member.id}>
          {(executing || index > 0) && <Text color="gray"> → </Text>}
          <Text>{member.displayName}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
};
