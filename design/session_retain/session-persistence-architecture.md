# 对话连续性 (Session Persistence & Restoration) 架构设计

**状态:** 草稿 / 待团队评审
**日期:** 2025-11-25

## 1. 概述 (Overview)

本文档概述了在 `agent-chatter` 中实现 **对话连续性 (Conversation Continuity)** 的架构设计。目标是允许用户从上次中断的地方“恢复”与团队的对话，并在应用程序重启后保留完整的上下文（历史记录、团队任务、待办事项）。

## 2. 核心原则 (Core Principles)

1.  **以 Context 为中心的恢复**: 我们不仅仅是保存消息列表。我们是对 `ContextManager` 的状态（messages, `teamTask`, `todos`）进行快照。`PromptBuilder` 依赖这些状态来为 Agent 生成正确的 Prompt。
2.  **状态一致性 (Ready-Idle)**: 恢复后的会话必须处于干净、可预测的状态。
    *   **执行状态**: 正在运行的 Agent 和路由队列 (`routingQueue`) 必须**清空**。我们不尝试“冻结/解冻”活跃的进程。
    *   **状态**: 系统启动时处于 `paused`（暂停）状态，等待人类输入。
3.  **显式控制**: 恢复会话必须是用户的显式选择（通过 CLI 参数或交互式提示），绝不能是可能导致 CI/CD 流程混乱的隐式默认行为。

## 3. 架构变更 (Architecture Changes)

### 3.1 基础设施层: 真实 StorageService

将 `MockStorageService` 替换为基于文件系统的真实实现。

*   **存储路径**: `~/.agent-chatter/sessions/<teamId>/`
*   **文件命名**: `<timestamp>-<sessionId>.json`
*   **数据结构 (`SessionSnapshot`)**:
    ```typescript
    interface SessionSnapshot {
      schemaVersion: string; // 例如 "1.0"
      teamId: string;
      sessionId: string;
      createdAt: string;
      updatedAt: string;
      context: {
        teamTask: string | null;
        todos: TodoItem[];
        messages: ConversationMessage[];
      };
      metadata: {
        lastSpeakerId?: string;
        // 未来扩展字段
      };
    }
    ```

### 3.2 核心层: ContextManager & Coordinator

#### ContextManager 增强
*   `exportSnapshot(): SessionSnapshot['context']`
*   `importSnapshot(data: SessionSnapshot['context']): void`
    *   重新填充内部消息历史。
    *   恢复 `teamTask` 和 `todo` 列表。

#### Coordinator 重构
*   **新 API**: `setTeam(team: Team, options?: { resumeSessionId?: string })`
*   **恢复逻辑**:
    1.  通过 `StorageService` 加载快照。
    2.  **校验**: 检查 `snapshot.teamId` 是否与当前 Team 匹配。
    3.  **成员一致性检查**: 如果历史消息中的发言者在当前 Team 配置中不存在（配置漂移），发出警告。
    4.  通过 `importSnapshot` 恢复 `ContextManager`。
    5.  重建 `ConversationSession` 对象。
    6.  **重置执行状态**:
        *   `routingQueue` = `[]` (清空)
        *   `waitingForRoleId` = 第一个人类成员 (等待用户)
        *   `status` = `'paused'`

### 3.3 表现层: UX

#### 交互式 REPL (`/team deploy`)
*   检测该 Team 是否存在历史会话。
*   提示用户:
    ```text
    发现历史会话 (昨天 14:00, 45 条消息)。
    [R] 恢复 (Resume)
    [N] 开始新会话 (Start New)
    ```

#### CLI (非交互式)
*   增加参数: `--resume [sessionId]`
*   **行为**:
    *   `--resume` (无参数): 恢复最近的一次会话。
    *   `--resume <id>`: 恢复指定 ID 的会话。
    *   (默认): 开启全新会话（对脚本/CI 安全）。

## 4. 持久化策略 (Persistence Strategy)

*   **自动保存触发时机**:
    *   在 `Coordinator.pause()` 时 (自然的断点，等待用户)。
    *   在 `Coordinator.stop()` 时 (对话结束)。
    *   (可选) 每隔 N 条消息自动保存。

## 5. 安全与数据隐私

*   **仅本地**: 会话存储在用户主目录的本地文件中。
*   **敏感性**: 快照包含完整的对话历史，可能包含 Agent 输出的敏感代码或密钥。
*   **未来工作**: 实现会话文件的可选加密。

## 6. 实施路线图 (Implementation Roadmap)

1.  **Infra**: 实现 `FileSystemStorageService`。
2.  **Core**: 为 `ContextManager` 添加导入/导出功能，并更新 `Coordinator`。
3.  **CLI/REPL**: 更新命令接口以支持恢复流程。
4.  **Testing**: 添加端到端测试：保存 -> 重启 -> 恢复 -> 验证 Prompt 中是否包含历史上下文。

## 7. Open Questions

### Q1: `todos` 字段是否纳入 Snapshot？

文档中 `SessionSnapshot.context` 包含 `todos: TodoItem[]`，但：
- 当前 `ContextManager` 只管理 `messages` 和 `teamTask`
- Todo handling 设计（`design/todo_handling/high-level-design.md`）将 todos 定位为 UI 层状态（`ReplModeInk.activeTodoList`）

**待讨论**:
- Todos 是否应该持久化？如果是，由谁管理（扩展 ContextManager vs 单独存储）？
- 恢复后 todos 的语义是什么？（显示上次的进度？还是清空重新开始？）

**决定**： todo 不持久化，不纳入snapshot
---

### Q2: 成员一致性检查的具体行为

场景：历史消息中的发言者（如 `Max`）在当前 Team 配置中已被删除。

**选项**:
1. **警告并继续** - 显示警告，保留历史消息，该成员显示为 "Unknown Member" 或原名
2. **阻止恢复** - 要求用户先修复 Team 配置或放弃恢复
3. **过滤历史** - 自动移除不存在成员的消息（可能破坏上下文连贯性）

**待讨论**: 哪种行为对用户最友好？对 AI 理解上下文影响最小？

**决定**： 显示警告，保留历史消息，该成员显示为原名
---

### Q3: 自动保存的触发时机

文档提到在 `Coordinator.pause()` 和 `stop()` 时保存，但当前实现中：
- 没有显式的 `pause()` 方法
- 会话暂停是隐式的（`waitingForRoleId` 被设置时）

**选项**:
1. **抽象显式生命周期** - 添加 `pause()` / `resume()` 方法，在 `pause()` 中触发保存
2. **基于事件触发** - 监听 `waitingForRoleId` 变化，当从 AI 切换到 Human 时自动保存
3. **定时 + 事件混合** - 每 N 条消息自动保存 + 切换到人类时保存

**待讨论**: 哪种方式实现复杂度最低且覆盖最全面？

**决定**：在以下两种场景时保存：
      - 在 turn.completed（AI→human等待）时保存；
      - 在 /end/stop/退出时保存；


### Q4: Team 变更提示与安全开关：

**决定**：   - 部署团队时若发现历史会话：显示摘要（时间、消息数），提示 [R] 恢复 / [N] 新建，无用户确认不恢复。
  - CLI 非交互场景：需要显式 --resume 才恢复；若检测到历史但未指定，直接新建（或给出提示并继续），避免阻塞。
  - 恢复选择后，再按照成员一致性策略处理不匹配情况（警告/拒绝等）。