# Routing v2.0 详细设计

> 基于 `routing-rules-v2.md` 高阶设计，按模块拆分的详细设计文档

## 文档索引

| 文档 | 模块 | 改动范围 | 状态 |
|------|------|----------|------|
| [01-resolve-addressees.md](./01-resolve-addressees.md) | `ConversationCoordinator.resolveAddressees()` | 修改返回值，新增 unresolved 字段 | ✅ 已实现 |
| [02-partial-failure-notify.md](./02-partial-failure-notify.md) | `ConversationCoordinator` + UI | 部分解析失败时通知用户 | ✅ 已实现 |
| [03-remove-round-robin.md](./03-remove-round-robin.md) | `ConversationCoordinator.sendToAgent()` | 移除 round-robin fallback | ✅ 已实现 |
| [04-queue-visibility.md](./04-queue-visibility.md) | `ConversationCoordinator` + `ReplModeInk` | UI 显示队列状态 | ✅ 已实现 |

## 依赖关系

```
01-resolve-addressees
        │
        ▼
02-partial-failure-notify  (依赖 01 的新返回值)
        │
        ▼
03-remove-round-robin      (独立，可并行)
        │
        ▼
04-queue-visibility        (独立，可并行)
```

## 实现顺序建议

1. **Phase 1**: 01 + 02（核心路由逻辑改进）
2. **Phase 2**: 03（移除 round-robin）
3. **Phase 3**: 04（UI 增强）

## 全局约定

### Auto-save 一致性策略

**规则**：所有进入 `paused` 状态的路径都必须调用 `saveCurrentSession()`。

| 触发场景 | 相关文档 |
|----------|----------|
| 全部解析失败 `[NEXT:unknown]` | 02 |
| AI 完成无 NEXT，fallback 到 Human | 03 |
| 队列处理到 Human 成员 | 现有逻辑 |
| 用户取消 (ESC) | 现有逻辑 |
| 用户停止 (/end) | 现有逻辑 |

### getNextSpeaker() 处理

移除 round-robin 后，`getNextSpeaker()` 方法不再用于路由逻辑。实现时：
- 标记为 `@deprecated`
- 注释说明 "不用于路由，保留用于潜在的其他用途"
- 后续如确认无其他用途，可删除

### UI 提示实现方式

`onPartialResolveFailure` 和 `onUnresolvedAddressees` 回调的 UI 实现：
- 优先使用现有的 `appendOutput()` 或系统消息机制
- 保持与现有 UI 风格一致
- 实现时参考 `ReplModeInk.tsx` 中的 warning/error 显示方式

## 测试覆盖要求

### 单元测试 (`tests/unit/conversationCoordinator.test.ts`)

| 测试场景 | 相关文档 |
|----------|----------|
| `resolveAddressees` 返回 `{resolved, unresolved}` | 01 |
| 部分解析失败触发 `onPartialResolveFailure`，不触发 `onUnresolvedAddressees` | 02 |
| 全部解析失败触发 `onUnresolvedAddressees`、pause、save | 02 |
| AI 完成无 NEXT → fallback 首个 human（无 round-robin） | 03 |
| Queue 更新事件（入队、执行中、清空） | 04 |

### 集成测试 (`tests/integration/`)

新增 `routingPartialFailure.integration.test.ts`：

```typescript
describe('Routing partial failure e2e', () => {
  it('handles [NEXT:a,unknown,b] correctly', async () => {
    // 1. 发送 [NEXT:alice,typo,bob] 消息
    // 2. 验证 onPartialResolveFailure 被调用，参数为 ['typo']
    // 3. 验证 alice 和 bob 入队
    // 4. 验证后续路由正确执行
  });
});
```

## 相关文件

- 高阶设计：[../routing-rules-v2.md](../routing-rules-v2.md)
- 流程图：[../routing-logic.md](../routing-logic.md)
