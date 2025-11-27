# 04 - 队列可见性 (UI)

## 概述

在 UI 中实时显示路由队列状态，让用户了解接下来会轮到谁。

## 当前状态

路由队列 `routingQueue` 是 `ConversationCoordinator` 的私有属性，UI 层无法访问。

**文件**: `src/services/ConversationCoordinator.ts:102`
```typescript
private routingQueue: Array<{ member: Member }> = [];
```

## 新设计

### 1. 队列状态事件类型（定稿：方案 C）

**新文件**: `src/models/QueueEvent.ts`

```typescript
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
```

**设计决策**：
- `items` 只包含待处理的成员，不含当前执行者
- `executing` 单独表示当前执行中的成员
- UI 显示时：`[executing ⏳] → items[0] → items[1] → ...`

### 2. 新增回调选项

**文件**: `src/services/ConversationCoordinator.ts`

```typescript
import type { QueueUpdateEvent } from '../models/QueueEvent.js';

export interface ConversationCoordinatorOptions {
  // ... 现有选项 ...

  /**
   * 队列状态更新时的回调
   * 用于 UI 显示队列可见性
   */
  onQueueUpdate?: (event: QueueUpdateEvent) => void;
}
```

### 3. 新增通知方法

```typescript
/**
 * 通知队列状态更新
 *
 * @param executing - 当前正在执行的成员（可选）
 */
private notifyQueueUpdate(executing?: Member): void {
  if (!this.options.onQueueUpdate) {
    return;
  }

  // items 是待处理队列（不含 executing）
  const items = this.routingQueue.map(item => item.member);

  this.options.onQueueUpdate({
    items,
    executing,
    isEmpty: items.length === 0 && !executing
  });
}
```

### 4. 调用时机

#### 4.1 入队时 (routeToNext)

**文件**: `src/services/ConversationCoordinator.ts:458-472`

```typescript
// 入队并串行处理
for (const member of resolvedMembers) {
  const lastInQueue = this.routingQueue[this.routingQueue.length - 1];
  if (lastInQueue && lastInQueue.member.id === member.id) {
    continue; // 去重
  }
  this.routingQueue.push({ member });
}

// 🆕 通知队列更新（入队完成）
this.notifyQueueUpdate();

await this.processRoutingQueue();
```

#### 4.2 开始执行时 (processRoutingQueue)

**文件**: `src/services/ConversationCoordinator.ts:490-504`

```typescript
while (this.routingQueue.length > 0) {
  const { member } = this.routingQueue.shift()!;

  // 🆕 通知队列更新（member 已从 routingQueue 移除，作为 executing 传入）
  this.notifyQueueUpdate(member);

  if (member.type === 'ai') {
    await this.sendToAgent(member, messageContent);
    continue;
  }
  // ...
}

// 🆕 通知队列清空（无 executing）
this.notifyQueueUpdate();
```

#### 4.3 Human 暂停时

```typescript
// human: 暂停并等待输入
this.waitingForMemberId = member.id;
this.status = 'paused';
this.notifyStatusChange();

// 🆕 通知队列更新（Human 等待中，队列暂停）
this.notifyQueueUpdate();

this.saveCurrentSession().catch(() => {});
break;
```

### 5. UI 组件设计

**新文件**: `src/repl/components/QueueDisplay.tsx`

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { Member } from '../../models/Team.js';

interface QueueDisplayProps {
  items: Member[];           // 待处理队列
  executing?: Member;        // 当前执行者
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
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
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
```

### 6. ReplModeInk 集成

**文件**: `src/repl/ReplModeInk.tsx`

```tsx
import type { QueueUpdateEvent } from '../models/QueueEvent.js';
import type { Member } from '../models/Team.js';

// State
const [queueItems, setQueueItems] = useState<Member[]>([]);
const [queueExecuting, setQueueExecuting] = useState<Member | undefined>();
const [queueVisible, setQueueVisible] = useState(false);

// Coordinator 初始化
const coordinator = new ConversationCoordinator(
  agentManager,
  messageRouter,
  {
    // ... 其他选项 ...
    onQueueUpdate: (event: QueueUpdateEvent) => {
      setQueueItems(event.items);
      setQueueExecuting(event.executing);
      setQueueVisible(!event.isEmpty);
    }
  }
);

// Render（在消息区域上方）
return (
  <Box flexDirection="column">
    <QueueDisplay
      items={queueItems}
      executing={queueExecuting}
      visible={queueVisible}
    />
    <MessageList messages={messages} />
    <InputArea />
  </Box>
);
```

## 显示效果

```
┌─────────────────────────────────────────────────────────────┐
│ 📋 Queue: [Claude ⏳] → Bob → Carol                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Claude: Let me analyze this code...                         │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘

> Your input here
```

## 测试用例

**文件**: `tests/unit/conversationCoordinator.test.ts`

```typescript
describe('queue visibility', () => {
  it('notifies on queue update when members are enqueued', async () => {
    const onQueueUpdate = vi.fn();
    const coordinator = createCoordinator({ onQueueUpdate });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:claude,bob,carol] test');

    // Should be called with queue containing claude, bob, carol
    expect(onQueueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isEmpty: false,
        items: expect.arrayContaining([
          expect.objectContaining({ member: expect.objectContaining({ name: 'claude' }) }),
          expect.objectContaining({ member: expect.objectContaining({ name: 'bob' }) }),
          expect.objectContaining({ member: expect.objectContaining({ name: 'carol' }) })
        ])
      })
    );
  });

  it('marks current member as executing', async () => {
    const onQueueUpdate = vi.fn();
    const coordinator = createCoordinator({ onQueueUpdate });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:claude,bob] test');

    // Find the call where claude is executing
    const executingCall = onQueueUpdate.mock.calls.find(call =>
      call[0].executing?.name === 'claude'
    );

    expect(executingCall).toBeDefined();
  });

  it('notifies isEmpty when queue is cleared', async () => {
    const onQueueUpdate = vi.fn();
    const coordinator = createCoordinator({ onQueueUpdate });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:human] test');

    // Last call should have isEmpty: true
    const lastCall = onQueueUpdate.mock.calls[onQueueUpdate.mock.calls.length - 1];
    expect(lastCall[0].isEmpty).toBe(true);
  });
});
```

## 工作量估算

- 新增 QueueEvent 类型：~20 行
- 新增回调和通知方法：~25 行
- 修改调用时机：~15 行
- QueueDisplay 组件：~40 行
- ReplModeInk 集成：~20 行
- 测试用例：~50 行
- 预估时间：1.5 小时
