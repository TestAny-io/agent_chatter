# Routing Queue Design (NEXT 指令)

**目的**：统一 [NEXT:\<agent\>] 解析与路由顺序，避免流式阶段过早路由，移除 round-robin。

## 规则概述
1) **指令形式**：仅允许独立的 `[NEXT:alice]`；逗号形式 `[NEXT:alice,bob]` 视为无效并忽略。  
2) **收集范围**：只收集当前 turn 的输出（摘要/最终文本），忽略历史 context 内的标记。  
3) **路由时机**：必须等待 agent 发出完成信号（各 CLI 的 turn/result 完成事件）后再路由。流式显示可展示 `[NEXT:]`，但不触发路由。  
4) **顺序**：同一个 turn 中的多条 `[NEXT:]` 按出现顺序入队，FIFO 串行执行。若队列中已有待处理路由（例如上个 `[NEXT:]` 还未完成），新指令追加到队尾，保持严格顺序。  
5) **嵌套情况**：a turn 内产生 `[NEXT:b][NEXT:c]` → 等 a 完成后依次路由到 b、c。若 b 期间再产生 `[NEXT:d]`，则在 c 完成后再路由到 d。  
6) **兜底**：若本轮未检测到合法 `[NEXT:]`，队列处理完后路由到 team 配置中的第一个 human 成员并暂停等待输入。  
7) **禁用轮询**：移除 round-robin 规则，不再自动轮询 AI 成员。

## 解析 (MessageRouter)
- 仅返回最后一次匹配内容中的单个收件人；逗号分隔的标记被忽略。  
- `[DONE]` 标记独立检测，不影响 `[NEXT:]` 收集。  
- `cleanContent` 去除所有标记，用于存储/展示。

## 路由队列 (ConversationCoordinator)
- 增加队列 `routingQueue: Array<{member, content}>` 与 `routingInProgress`。  
- `routeToNext`：解析并解析成员，若无 addressees 则兜底第一个 human；将结果按顺序入队并调用 `processRoutingQueue`。  
- `processRoutingQueue`：串行出队。AI 直接调用 `sendToAgent`；human 设置 `waitingForRoleId` 并暂停，保留剩余队列顺序。  
- 只有在 turn 完成（通过 AgentManager/ContextCollector 的完成事件）后才调用 `routeToNext`，确保不在流式阶段触发。

## CLI 完成信号参考
- Claude Code：`turn.completed` 事件。  
-$ Codex：`turn.completed`/`result`（agent 输出 JSONL）。  
- Gemini：`turn.completed` 或结果事件（由 GeminiParser 转换）。  
解析器负责将各 CLI 的完成事件统一映射到 `turn.completed` 供 Coordinator 使用。

## 待办 / 测试
- 单测：MessageRouter 忽略逗号形式，保留顺序；多 `[NEXT:]` 解析。  
- 集成：多 `[NEXT:]` 串行路由、无 `[NEXT:]` 兜底至首个人类、human 暂停后恢复队列。  
- UI：可继续显示流式 `[NEXT:]`，但不得触发路由。***
