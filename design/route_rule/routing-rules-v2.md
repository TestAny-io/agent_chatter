# Agent Chatter 路由规则设计 v2.0

> **Scope**: 团队必须包含至少 1 个 Human 成员（在 `team deploy` 时强制检查，已实现于 `TeamUtils.validateTeam()`）

## 零、前置条件

### 0.1 部署时校验（team deploy）✅ 已实现

在 `TeamUtils.validateTeam()` 中，强制校验团队配置满足以下条件：

```
✅ 团队成员数 ≥ 2
✅ 至少包含 1 个 Human 成员
```

**校验失败时**：
```
❌ 团队至少需要 1 个 Human 成员
```

**设计理由**：
- 首条消息必须来自 Human，无 Human 则无法启动对话
- Fallback 规则依赖 Human 存在，无 Human 会导致路由死锁
- 前置校验避免运行时出现不可恢复的状态

由于部署时已强制校验，运行时不再需要处理 "无 Human" 的情况。

---

## 一、设计原则

| 原则 | 说明 |
|------|------|
| **Human 主权** | Human 是对话的发起者和最终控制者 |
| **显式优先** | `[NEXT:]` 明确指定优先于任何自动推断 |
| **无 Round-Robin** | 不自动轮询 AI，AI 完成且无 `[NEXT:]` 时严格 fallback 到 Human |
| **可预测性** | 相同输入 → 相同路由结果，无歧义 |
| **永不僵死** | 任何路径最终都会到达 Human 或明确的错误提示 |
| **失败透明** | 部分解析失败时明确提示用户，不静默忽略 |

---

## 二、核心概念

### 2.1 成员类型

- **Human**: 人类用户，需要暂停等待输入
- **AI**: 代理程序，自动执行并返回结果

### 2.2 路由队列

- FIFO 队列，存储待处理的目标成员
- 一个 turn 内的多个 `[NEXT:]` 按顺序入队
- 串行处理，前一个完成后处理下一个

### 2.3 会话状态

```
active    - AI 正在执行或队列处理中
paused    - 等待 Human 输入
completed - 对话结束
```

---

## 三、路由规则

### 3.1 优先级（从高到低）

```
P1: 显式 [NEXT:xxx] 标记
P2: 路由队列中的待处理项
P3: Fallback 到首个 Human
```

### 3.2 场景矩阵

| # | 触发条件 | 动作 | 结果状态 |
|---|----------|------|----------|
| 1 | `[NEXT:ai-member]` 解析成功 | 入队，发送给该 AI | `active` |
| 2 | `[NEXT:human-member]` 解析成功 | 入队，暂停等待输入 | `paused` |
| 3 | `[NEXT:a,b,c]` 多个目标，全部解析成功 | 全部入队，FIFO 串行处理 | 取决于首个目标类型 |
| 4 | `[NEXT:a,unknown,b]` 部分解析失败 | 成功的入队，失败的跳过并提示用户 | 取决于首个成功目标类型 |
| 5 | `[NEXT:unknown]` 全部解析失败 | 暂停，提示可用成员 | `paused` |
| 6 | 无 `[NEXT:]` + 队列非空 | 继续处理队列 | 取决于队首目标类型 |
| 7 | 无 `[NEXT:]` + 队列空 | **Fallback**: 路由到首个 Human | `paused` |

### 3.3 部分解析失败处理

当 `[NEXT:a,unknown,b]` 中存在无法解析的成员时：

```
1. 解析所有目标
2. 分离：resolved = [a, b], unresolved = [unknown]
3. 如果 resolved 非空：
   - 入队 resolved 成员
   - 提示用户："⚠️ 'unknown' 不在当前团队中，已跳过"
   - 继续处理队列
4. 如果 resolved 为空（全部失败）：
   - 暂停
   - 提示用户："❌ 无法解析任何目标。可用成员：Alice, Bob, Carol"
   - 触发 notifyStatusChange()
   - 触发 saveCurrentSession()  ← 重要：暂停时必须保存
```

**设计理由**：
- 不因部分错误阻塞整个流程
- 用户得到明确反馈，知道哪些被跳过
- 保持对话流畅性
- 暂停时保存确保用户可以恢复对话

**实现要点**（与当前代码差异）：
- 当前实现：静默忽略未解析项，不提示用户
- 新设计要求：必须向用户提示被跳过的成员名称

### 3.4 Fallback 规则

当消息无 `[NEXT:]` 且队列为空时：

```
→ 找到团队中第一个 Human 成员（按 order 排序）
→ 设置 waitingForMemberId = firstHuman.id
→ 状态变为 paused
→ 触发 notifyStatusChange()
→ 触发 saveCurrentSession()
```

**设计理由**：
- 确保对话控制权始终回到 Human 手中
- Human 可以决定下一步：继续对话、指定路由、或结束

**注意**：由于 `TeamUtils.validateTeam()` 已强制校验至少 1 个 Human，Fallback 时必定能找到 Human。

---

## 四、处理流程

### 4.1 主流程

```
收到消息（Human 输入或 AI 完成）
    │
    ▼
解析 [NEXT:xxx] 标记
    │
    ├─ 有标记 ──► resolveAddressees()
    │                 │
    │          ┌──────┴──────┐
    │          │             │
    │       解析成功      解析失败
    │          │             │
    │          ▼             ▼
    │      入队成员      暂停 + 提示
    │          │         "无法解析 XXX"
    │          │
    │          ▼
    │      处理队列 ◄─────────────┐
    │                             │
    └─ 无标记 ──► 队列非空? ──是──┘
                     │
                    否
                     │
                     ▼
               Fallback 到首个 Human
                     │
                     ▼
                  暂停等待
```

### 4.2 队列处理流程

```
while (队列非空) {
    member = 队列.shift()

    if (member.type === 'ai') {
        发送给 AI
        等待完成
        // AI 完成后会触发新的 routeToNext()
        // 可能会有新的 [NEXT:] 入队
        continue
    }

    if (member.type === 'human') {
        设置 waitingForMemberId = member.id
        状态 = paused
        通知状态变更
        自动保存
        break  // 停止处理，等待输入
    }
}
```

---

## 五、边界情况

| 情况 | 处理 |
|------|------|
| `[NEXT:]` 空值 | 忽略，视为无标记 |
| `[NEXT:self]` 自引用 | 允许（某些场景需要自我迭代）|
| `[NEXT:a,a,a]` 相邻重复 | 去重，只入队一次 |
| `[NEXT:a][NEXT:b]` 多个标记 | 按出现顺序入队 |
| 循环 A→B→A→B... | 允许，由 Human 通过 `/end` 终止 |
| Human 空消息 | 拒绝，提示需要输入内容 |

---

## 六、状态管理

### 6.1 状态转换图

```
                    ┌──────────────────────────────┐
                    │                              │
                    ▼                              │
              ┌──────────┐    routeToAI()    ┌──────────┐
 首条消息 ──► │  active  │ ◄──────────────── │  paused  │
              └──────────┘                   └──────────┘
                    │                              ▲
                    │ routeToHuman()               │
                    └──────────────────────────────┘
                    │
                    │ stop() / [DONE] from Human
                    ▼
              ┌───────────┐
              │ completed │
              └───────────┘
```

### 6.2 状态变更规范

每次状态变更必须：

1. 更新 `this.status`
2. 调用 `notifyStatusChange()`
3. 如果变为 `paused`，调用 `saveCurrentSession()`

---

## 七、错误处理

| 错误类型 | 用户提示 | 系统行为 |
|----------|----------|----------|
| 无法解析地址 | `Cannot resolve [NEXT:xxx]. Available members: Alice, Bob` | 暂停，等待 Human 修正 |
| AI 执行超时 | `Agent XXX timed out after N minutes` | 暂停，等待 Human 决定 |
| AI 执行错误 | `Agent XXX encountered an error: ...` | 暂停，等待 Human 决定 |

---

## 八、API 设计

### 8.1 RoutingDecision 类型

```typescript
type RoutingAction =
  | { type: 'send_to_ai'; member: Member }
  | { type: 'wait_for_human'; member: Member }
  | { type: 'continue_queue' }
  | { type: 'error_unresolved'; addressees: string[]; availableMembers: string[] };

interface RoutingDecision {
  action: RoutingAction;
  queueUpdates: Member[];  // 需要入队的成员（可能为空）
}
```

### 8.2 核心方法签名

```typescript
class RoutingEngine {
  /**
   * 决定下一步路由动作
   */
  decide(context: {
    addressees: string[];      // 解析出的 [NEXT:] 列表
    queue: Member[];           // 当前队列
    team: Team;                // 团队配置
    currentSpeakerId: string;  // 当前发言者
  }): RoutingDecision;

  /**
   * 解析成员标识（支持 id/name/displayName 模糊匹配）
   */
  resolveAddressees(addressees: string[], team: Team): {
    resolved: Member[];
    unresolved: string[];
  };

  /**
   * 获取 Fallback 目标（首个 Human）
   */
  getFallbackTarget(team: Team): Member;
}
```

---

## 九、与 UI 的交互

### 9.1 状态通知

| 状态变更 | UI 行为 |
|----------|---------|
| `active` + AI 执行中 | 显示 thinking indicator |
| `paused` + 等待 Human | 显示输入框，提示等待的成员名 |
| `completed` | 显示结束信息，禁用输入 |

### 9.2 队列可见性 ⭐ 新增

用户应该能够看到当前的路由队列状态，了解接下来会轮到谁。

**显示位置**：状态栏或消息区域上方

**显示格式**：

```
当队列非空时：
┌────────────────────────────────────────┐
│ 📋 Queue: Claude → Bob → Carol → You   │
└────────────────────────────────────────┘

当前正在执行：
┌────────────────────────────────────────┐
│ 📋 Queue: [Claude ⏳] → Bob → Carol    │
└────────────────────────────────────────┘

队列为空时：
（不显示队列信息）
```

**UI 组件需求**：

```typescript
interface QueueDisplayProps {
  queue: Array<{
    member: Member;
    status: 'pending' | 'executing';
  }>;
  visible: boolean;  // 队列为空时隐藏
}
```

**触发更新时机**：
- 成员入队时
- 成员出队时（开始执行）
- 成员完成时
- 队列清空时

### 9.3 错误提示

| 场景 | 提示内容 |
|------|----------|
| 部分解析失败 | `⚠️ 'unknown' 不在当前团队中，已跳过` |
| 全部解析失败 | `❌ 无法解析任何目标。可用成员：Alice, Bob, Carol` |

### 9.4 队列相关命令（可选扩展）

未来可考虑支持：

```
/queue          - 显示当前队列详情
/queue clear    - 清空队列（需确认）
/queue skip     - 跳过队首成员
```

---

## 十、测试场景

### 10.1 必须覆盖的场景

1. **单一 NEXT**: `[NEXT:bob]` → 正确路由到 Bob
2. **多个 NEXT**: `[NEXT:bob,carol]` → 按顺序串行处理
3. **多标记**: `[NEXT:bob][NEXT:carol]` → 按顺序入队
4. **全部解析失败**: `[NEXT:unknown]` → 暂停 + 提示可用成员
5. **部分解析失败**: `[NEXT:bob,unknown,carol]` → bob 和 carol 入队，提示 unknown 已跳过
6. **无 NEXT + 队列空**: → Fallback 到首个 Human
7. **无 NEXT + 队列非空**: → 继续处理队列
8. **相邻去重**: `[NEXT:bob,bob,carol]` → 只有 bob, carol 入队
9. **链式路由**: A→B→C→Human → 正确串行处理
10. **Human 中断**: 队列 [AI1, AI2, Human, AI3] → Human 处暂停，AI3 保留在队列

### 10.2 队列可见性测试

- 入队时 UI 更新
- 出队时 UI 更新
- 队列清空时 UI 隐藏队列显示
- 当前执行成员正确标记

### 10.3 回归测试

- Bug#7 场景：后续 AI 应获取前一个 AI 的输出，而非原始消息
- 状态通知：每次暂停都触发 `notifyStatusChange()`
- 自动保存：每次暂停都触发 `saveCurrentSession()`

---

## 十一、与当前实现的差异

本节列出设计 v2.0 与当前代码实现的主要差异，作为重构参考。

### 11.1 需要修改的行为

| # | 当前实现 | 设计 v2.0 要求 | 影响文件 |
|---|----------|----------------|----------|
| 1 | 部分解析失败时静默忽略 | 必须提示用户被跳过的成员 | `ConversationCoordinator.ts` |
| 2 | `sendToAgent` 中有 round-robin fallback | 移除 round-robin，统一 fallback 到首个 Human | `ConversationCoordinator.ts` |
| 3 | 全部解析失败时仅暂停，无 auto-save | 暂停时必须 `notifyStatusChange()` + `saveCurrentSession()` | `ConversationCoordinator.ts` |
| 4 | 无队列可见性 | UI 显示当前队列状态 | `ReplModeInk.tsx` |

### 11.2 需要新增的功能

| # | 功能 | 说明 | 影响文件 | 状态 |
|---|------|------|----------|------|
| 1 | `team deploy` 校验 | 强制至少 1 个 Human | `Team.ts` (`TeamUtils.validateTeam`) | ✅ 已实现 |
| 2 | `resolveAddressees` 返回分离结果 | 返回 `{ resolved, unresolved }` | `ConversationCoordinator.ts` | 待实现 |
| 3 | `onPartialResolveFailure` 回调 | 通知 UI 显示跳过提示 | `ConversationCoordinator.ts` | 待实现 |
| 4 | 队列状态回调 | `onQueueUpdate` 通知 UI | `ConversationCoordinator.ts` | 待实现 |

### 11.3 可保持不变的行为

- 队列 FIFO 串行处理
- 相邻重复成员去重
- Human 处理时暂停队列
- `[NEXT:]` 标记解析逻辑
- 模糊匹配（id/name/displayName）
