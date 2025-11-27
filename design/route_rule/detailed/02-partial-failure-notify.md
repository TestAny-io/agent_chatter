# 02 - 部分解析失败通知

## 概述

当 `[NEXT:a,unknown,b]` 中存在无法解析的成员时，必须通知用户哪些被跳过，而不是静默忽略。

## 依赖

- **01-resolve-addressees**: 需要 `ResolveResult` 类型和新的返回值格式

## 当前实现问题

**文件**: `src/services/ConversationCoordinator.ts:426-439`

```typescript
// 检查是否有无法解析的地址
if (resolvedMembers.length === 0) {
  // 所有地址都无法解析，暂停对话并通知
  this.status = 'paused';
  this.notifyStatusChange();
  // ...
  if (this.options.onUnresolvedAddressees) {
    this.options.onUnresolvedAddressees(addressees, message);
  }
  return;
}
```

**问题**：
- 只处理"全部失败"的情况
- 部分失败时，未解析的 addressee 被静默丢弃
- 用户无法知道 `[NEXT:alice,typo,bob]` 中的 `typo` 被跳过了

## 新设计

### 1. 新增回调选项

**文件**: `src/services/ConversationCoordinator.ts`

```typescript
export interface ConversationCoordinatorOptions {
  // ... 现有选项 ...

  /**
   * 部分地址解析失败时的回调
   * 用于通知 UI 显示跳过提示
   *
   * @param skipped - 被跳过的地址列表
   * @param availableMembers - 当前可用的成员名称列表
   */
  onPartialResolveFailure?: (
    skipped: string[],
    availableMembers: string[]
  ) => void;
}
```

### 2. 新增通知方法

```typescript
/**
 * 通知部分解析失败
 *
 * @param unresolved - 未能解析的地址列表
 * @param message - 触发路由的原始消息（用于日志）
 */
private notifyPartialResolveFailure(
  unresolved: string[],
  message: ConversationMessage
): void {
  if (!this.team || unresolved.length === 0) {
    return;
  }

  // 获取可用成员名称列表
  const availableMembers = this.team.members.map(m => m.name);

  // Debug 日志
  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.error(
      `[Debug][Routing] Partial resolve failure: ${unresolved.join(', ')} not found. ` +
      `Available: ${availableMembers.join(', ')}`
    );
  }

  // 通知 UI
  if (this.options.onPartialResolveFailure) {
    this.options.onPartialResolveFailure(unresolved, availableMembers);
  }
}
```

### 3. 修改 routeToNext() 方法

**文件**: `src/services/ConversationCoordinator.ts:409-440`

```typescript
if (addressees.length === 0) {
  // 没有指定接收者的处理（保持不变）
  // ...
} else {
  // 解析接收者
  const resolveResult = this.resolveAddressees(addressees);
  resolvedMembers = resolveResult.resolved;

  // 🆕 部分解析失败通知
  // ⚠️ 重要：仅在 resolved 非空 且 unresolved 非空时触发
  // resolved 为空时走 onUnresolvedAddressees，不要混用这两个回调
  if (resolveResult.unresolved.length > 0 && resolveResult.resolved.length > 0) {
    // 部分成功：通知用户跳过了哪些
    this.notifyPartialResolveFailure(resolveResult.unresolved, message);
  }
}

// 检查是否有无法解析的地址（全部失败）
if (resolvedMembers.length === 0 && addressees.length > 0) {
  // 全部失败：暂停对话并通知
  this.status = 'paused';
  this.notifyStatusChange();

  // 🆕 保存会话（暂停时必须保存）
  this.saveCurrentSession().catch(() => {});

  if (this.options.onUnresolvedAddressees) {
    this.options.onUnresolvedAddressees(addressees, message);
  }
  return;
}
```

## UI 层接入

### ReplModeInk.tsx

```typescript
// 在 ConversationCoordinator 初始化时传入回调
const coordinator = new ConversationCoordinator(
  agentManager,
  messageRouter,
  {
    // ... 其他选项 ...

    onPartialResolveFailure: (skipped, available) => {
      // 显示提示消息
      setSystemMessage({
        type: 'warning',
        text: `⚠️ Skipped unknown members: ${skipped.join(', ')}\n` +
              `   Available: ${available.join(', ')}`
      });
    },

    onUnresolvedAddressees: (addressees, message) => {
      // 显示错误消息
      setSystemMessage({
        type: 'error',
        text: `❌ Cannot resolve: ${addressees.join(', ')}\n` +
              `   Available members: ${team.members.map(m => m.name).join(', ')}`
      });
    }
  }
);
```

### 消息显示样式

```
┌────────────────────────────────────────────────────────────┐
│ ⚠️  Skipped unknown members: typo, wrongname               │
│    Available: alice, bob, carol                            │
└────────────────────────────────────────────────────────────┘
```

## 测试用例

**文件**: `tests/unit/conversationCoordinator.test.ts`

```typescript
describe('partial resolve failure notification', () => {
  it('calls onPartialResolveFailure when some addressees fail', async () => {
    const onPartialResolveFailure = vi.fn();
    const coordinator = createCoordinator({
      onPartialResolveFailure
    });

    // Setup team with alice, bob
    await coordinator.setTeam(team);

    // Send message with partial failure: alice exists, unknown doesn't
    await coordinator.sendMessage('[NEXT:alice,unknown] test message');

    expect(onPartialResolveFailure).toHaveBeenCalledWith(
      ['unknown'],
      ['alice', 'bob']
    );
  });

  it('does not call onPartialResolveFailure when all addressees resolve', async () => {
    const onPartialResolveFailure = vi.fn();
    const coordinator = createCoordinator({
      onPartialResolveFailure
    });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:alice,bob] test message');

    expect(onPartialResolveFailure).not.toHaveBeenCalled();
  });

  it('calls onUnresolvedAddressees when all addressees fail', async () => {
    const onUnresolvedAddressees = vi.fn();
    const coordinator = createCoordinator({
      onUnresolvedAddressees
    });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:unknown1,unknown2] test message');

    expect(onUnresolvedAddressees).toHaveBeenCalled();
    expect(coordinator.getStatus()).toBe('paused');
  });

  it('saves session when all addressees fail', async () => {
    const sessionStorage = createMockSessionStorage();
    const coordinator = createCoordinator({ sessionStorage });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:unknown] test message');

    expect(sessionStorage.saveSession).toHaveBeenCalled();
  });
});
```

## 回调触发规则总结

| 场景 | `onPartialResolveFailure` | `onUnresolvedAddressees` | 状态 |
|------|--------------------------|-------------------------|------|
| 全部成功 `[a,b]` → resolved=[a,b] | ❌ | ❌ | active |
| 部分成功 `[a,x,b]` → resolved=[a,b], unresolved=[x] | ✅ | ❌ | active |
| Human 发送全部失败 `[x,y]` → resolved=[], unresolved=[x,y] | ❌ | ✅ | paused + waitingFor=该Human + save |
| AI 发送全部失败 `[x,y]` → resolved=[], unresolved=[x,y] | ❌ | ✅ | paused + waitingFor=首个Human + save |

**关键**：
- 两个回调互斥，不会同时触发
- 全部解析失败时，根据消息来源决定 waitingForMemberId：
  - Human 发送 → 等待该 Human 重新输入正确的地址
  - AI 发送 → fallback 到首个 Human（按 order 排序）

## 工作量估算

- 新增回调选项：~10 行
- 新增通知方法：~25 行
- 修改 routeToNext：~15 行
- UI 接入：~20 行
- 测试用例：~60 行
- 预估时间：1 小时
