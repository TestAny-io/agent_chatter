# Routing Logic v2.0 (Mermaid)

> 配合 `routing-rules-v2.md` 阅读

## 主流程图

```mermaid
flowchart TD
    A["消息完成<br/>Human输入 或 AI完成"] --> B["解析 [NEXT:] 标记"]

    B --> C{"有 NEXT 标记?"}

    C -- 是 --> D["resolveAddressees"]
    D --> E{"解析结果?"}

    E -- 全部成功 --> F["入队成员<br/>去重相邻重复"]
    E -- 部分成功 --> F2["入队成功的成员<br/>提示: XXX 不在团队中已跳过"]
    E -- 全部失败 --> G["暂停<br/>提示: 无法解析 可用成员..."]

    C -- 否 --> H{"队列非空?"}
    H -- 是 --> I["继续处理队列"]
    H -- 否 --> J["Fallback: 首个 Human"]

    F --> I
    F2 --> I
    J --> K["暂停等待输入"]
    G --> K

    I --> UPDATE["更新队列显示"]
    UPDATE --> L{"队首成员类型?"}

    L -- AI --> M["sendToAgent"]
    M --> N["等待 AI 完成"]
    N --> A

    L -- Human --> K

    K --> O["设置 waitingForMemberId"]
    O --> P["status = paused"]
    P --> Q["notifyStatusChange"]
    Q --> R["saveCurrentSession"]
    R --> END["等待 Human 输入"]
```

## 解析失败处理流程

```mermaid
flowchart TD
    A["resolveAddressees<br/>输入: [a, unknown, b]"] --> B["逐个解析"]

    B --> C["分类结果"]
    C --> D["resolved: [a, b]"]
    C --> E["unresolved: [unknown]"]

    D --> F{"resolved 非空?"}

    F -- 是 --> G["入队 resolved 成员"]
    G --> H["提示用户:<br/>⚠️ unknown 不在团队中已跳过"]
    H --> I["继续处理队列"]

    F -- 否 --> J["暂停"]
    J --> K["提示用户:<br/>❌ 无法解析 可用成员: Alice Bob"]
```

## 队列处理详细流程

```mermaid
flowchart TD
    START["processRoutingQueue"] --> CHECK{"队列非空?"}

    CHECK -- 否 --> DONE["处理完成<br/>隐藏队列显示"]
    CHECK -- 是 --> DEQUEUE["取出队首成员"]

    DEQUEUE --> UPDATE["更新队列显示<br/>标记当前执行者"]
    UPDATE --> TYPE{"成员类型?"}

    TYPE -- AI --> SEND["发送给 AI"]
    SEND --> WAIT["等待完成"]
    WAIT --> RESPONSE["AI 响应触发 routeToNext"]
    RESPONSE --> CHECK

    TYPE -- Human --> PAUSE["暂停"]
    PAUSE --> SET_WAIT["waitingForMemberId = member.id"]
    SET_WAIT --> SET_STATUS["status = paused"]
    SET_STATUS --> NOTIFY["notifyStatusChange"]
    NOTIFY --> SAVE["saveCurrentSession"]
    SAVE --> BREAK["停止处理队列<br/>保留剩余成员"]
```

## 队列可见性

```mermaid
flowchart LR
    subgraph UI["UI 显示"]
        Q1["📋 Queue: Claude → Bob → Carol"]
        Q2["📋 Queue: [Claude ⏳] → Bob → Carol"]
        Q3["（队列为空时隐藏）"]
    end

    subgraph Events["触发事件"]
        E1["入队"] --> Q1
        E2["开始执行"] --> Q2
        E3["队列清空"] --> Q3
    end
```

## Fallback 规则

```mermaid
flowchart TD
    A["无 NEXT + 队列空"] --> B["查找首个 Human<br/>按 order 排序"]
    B --> D["设为路由目标"]
    D --> E["暂停等待输入"]
    E --> F["notifyStatusChange"]
    F --> G["saveCurrentSession"]
```

> **注**：由于 `TeamUtils.validateTeam()` 已强制校验至少 1 个 Human，Fallback 时必定能找到 Human，无需处理 "找不到 Human" 的分支。

## 状态转换图

```mermaid
stateDiagram-v2
    [*] --> paused: 初始化

    paused --> active: Human 输入 / routeToAI
    active --> paused: routeToHuman / Fallback
    active --> active: AI 链式路由

    paused --> completed: /end 或 Human [DONE]
    active --> completed: stop()

    completed --> [*]
```

## Notes

1. **触发时机**: 路由决策仅在 AI `turn.completed` 后触发，不在流式输出阶段
2. **队列串行**: 同一时刻只有一个成员在处理，全部串行执行，**无 round-robin**
3. **Human 优先**: Fallback 总是到首个 Human，确保用户控制权
4. **部分失败容忍**: 部分解析失败时继续处理成功的，**必须提示用户**跳过了哪些
5. **队列可见**: UI 实时显示队列状态，用户知道接下来轮到谁
6. **状态一致性**: 每次 `paused` 必须同时触发 `notifyStatusChange()` 和 `saveCurrentSession()`
7. **前置条件**: 团队必须包含至少 1 个 Human（`TeamUtils.validateTeam()` 强制校验，✅ 已实现）
