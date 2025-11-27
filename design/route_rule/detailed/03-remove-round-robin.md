# 03 - 移除 Round-Robin Fallback

## 概述

移除 `sendToAgent()` 方法中的 round-robin fallback 逻辑，统一使用"首个 Human"作为 fallback 目标。

## 当前实现问题

**文件**: `src/services/ConversationCoordinator.ts:621-633`

```typescript
// fallback: round-robin
const nextMember = this.getNextSpeaker(member.id);
if (nextMember && nextMember.type === 'human') {
  this.status = 'paused';
  this.waitingForMemberId = nextMember.id;
  return;
}
if (nextMember && nextMember.type === 'ai') {
  await this.sendToAgent(nextMember, message);
  return;
}
```

**问题**：
- 与高阶设计不一致：设计要求"无 NEXT 时 fallback 到首个 Human"
- Round-robin 会导致 AI 自动链式调用，用户失去控制权
- `getNextSpeaker()` 按 order 循环，可能跳过 Human 直接到下一个 AI

## 关联代码

### getNextSpeaker() 方法

**文件**: `src/services/ConversationCoordinator.ts:109-120`

```typescript
private getNextSpeaker(currentId: string): Member | null {
  if (!this.team || !this.team.members || this.team.members.length === 0) {
    return null;
  }
  const members = [...this.team.members].sort((a, b) => a.order - b.order);
  const idx = members.findIndex(m => m.id === currentId);
  if (idx === -1) {
    return null;
  }
  const nextIdx = (idx + 1) % members.length;
  return members[nextIdx];
}
```

此方法在移除 round-robin 后可能不再需要，但保留以防其他功能使用。

## 新设计

### 修改 sendToAgent() 方法

**删除 round-robin 逻辑，改为 fallback 到首个 Human**：

```typescript
private async sendToAgent(member: Member, message: string): Promise<void> {
  // ... 前面的代码保持不变 ...

  try {
    // ... Agent 执行逻辑保持不变 ...

    // 如果路由队列中已有待处理的 NEXT，优先继续处理队列
    if (this.routingQueue.length > 0) {
      await this.processRoutingQueue();
      return;
    }

    // 🆕 Fallback: 路由到首个 Human（替换 round-robin）
    const firstHuman = this.team!.members
      .slice()
      .sort((a, b) => a.order - b.order)
      .find(m => m.type === 'human');

    if (firstHuman) {
      this.status = 'paused';
      this.waitingForMemberId = firstHuman.id;
      this.notifyStatusChange();

      // AUTO-SAVE on turn completion
      this.saveCurrentSession().catch(() => {});
    }
    // 注意：由于 TeamUtils.validateTeam() 已强制校验至少 1 个 Human，
    // firstHuman 必定存在，无需 else 分支
  } catch (error) {
    // ... 错误处理保持不变 ...
  } finally {
    this.currentExecutingMember = null;
  }
}
```

### 删除的代码

```typescript
// 删除以下代码块（line 623-633）
// fallback: round-robin
const nextMember = this.getNextSpeaker(member.id);
if (nextMember && nextMember.type === 'human') {
  this.status = 'paused';
  this.waitingForMemberId = nextMember.id;
  return;
}
if (nextMember && nextMember.type === 'ai') {
  await this.sendToAgent(nextMember, message);
  return;
}
```

## 行为变化对比

| 场景 | 旧行为 (Round-Robin) | 新行为 (首个 Human) |
|------|---------------------|-------------------|
| AI 完成，无 NEXT，队列空 | 按 order 找下一个成员 | 路由到首个 Human |
| Team: [AI1, AI2, Human] | AI1→AI2→Human 循环 | AI1→Human, AI2→Human |
| Team: [Human, AI1, AI2] | Human→AI1→AI2 循环 | AI1→Human, AI2→Human |

## 测试用例

**文件**: `tests/unit/conversationCoordinator.test.ts`

```typescript
describe('fallback routing (no round-robin)', () => {
  it('routes to first human when AI completes without NEXT', async () => {
    // Team: [AI-claude, AI-codex, Human-alice]
    const team = createTeam([
      { name: 'claude', type: 'ai', order: 0 },
      { name: 'codex', type: 'ai', order: 1 },
      { name: 'alice', type: 'human', order: 2 }
    ]);

    await coordinator.setTeam(team);
    await coordinator.sendMessage('Hello [NEXT:claude]');

    // After AI completes (mocked), should route to alice, not codex
    expect(coordinator.getWaitingForMemberId()).toBe('alice-id');
    expect(coordinator.getStatus()).toBe('paused');
  });

  it('routes to first human by order when multiple humans exist', async () => {
    // Team: [Human-bob (order:1), AI-claude, Human-alice (order:0)]
    const team = createTeam([
      { name: 'bob', type: 'human', order: 1 },
      { name: 'claude', type: 'ai', order: 2 },
      { name: 'alice', type: 'human', order: 0 }
    ]);

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:claude] test');

    // After AI completes, should route to alice (order:0), not bob
    expect(coordinator.getWaitingForMemberId()).toBe('alice-id');
  });

  it('does NOT chain to next AI (regression test for round-robin removal)', async () => {
    const sendToAgentSpy = vi.spyOn(coordinator as any, 'sendToAgent');

    // Team: [AI1, AI2, Human]
    const team = createTeam([
      { name: 'ai1', type: 'ai', order: 0 },
      { name: 'ai2', type: 'ai', order: 1 },
      { name: 'human', type: 'human', order: 2 }
    ]);

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:ai1] test');

    // sendToAgent should only be called once (for ai1), not twice (ai1 + ai2)
    expect(sendToAgentSpy).toHaveBeenCalledTimes(1);
    expect(sendToAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ai1' }),
      expect.any(String)
    );
  });

  it('saves session when falling back to human', async () => {
    const sessionStorage = createMockSessionStorage();
    const coordinator = createCoordinator({ sessionStorage });

    await coordinator.setTeam(team);
    await coordinator.sendMessage('[NEXT:claude] test');

    // After AI completes and falls back to human
    expect(sessionStorage.saveSession).toHaveBeenCalled();
  });
});
```

## 回归风险

| 风险点 | 影响 | 缓解措施 |
|--------|------|----------|
| 依赖 round-robin 的用户场景 | 行为变更 | 文档说明，用户需显式使用 `[NEXT:]` 控制流程 |
| AI 链式调用中断 | 需要手动触发 | 这是设计意图：Human 保持控制权 |

## getNextSpeaker() 方法处理

**定稿**：标记为 `@deprecated`

```typescript
/**
 * 获取下一个轮到的成员（循环轮询）
 *
 * @deprecated 不再用于路由逻辑。Routing v2.0 移除了 round-robin，
 *             统一使用"首个 Human"作为 fallback。保留此方法以防其他功能使用。
 */
private getNextSpeaker(currentId: string): Member | null {
  // 实现保持不变
}
```

**后续**：如确认无其他用途，可在后续版本中删除。

## 工作量估算

- 删除 round-robin 代码：~10 行
- 新增 fallback 逻辑：~15 行
- 测试用例：~60 行
- 预估时间：0.5 小时
