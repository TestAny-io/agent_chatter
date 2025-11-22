# Agent Adapter 架构（已落地版本，0.0.23）

**状态：** 已实施  
**最近更新：** 2025-11-20  
**维护人：** 架构 / Code Agent

## 执行摘要
- 三个内置 agent（Claude Code、OpenAI Codex、Gemini）全部统一为 JSONL 流输出，依赖各自的“完成事件”而非自定义 endMarker。
- 引入 Adapter 层封装 CLI 协议与默认参数：ProcessManager 只关心进程生命周期与 JSONL 完成事件（`result` / `turn.completed` / `turn.finished`）。
- 配置分层重申：Registry 只放技术调用参数；团队文件只放成员指令、工作目录和可选额外参数。旧的系统提示词/完成标记从 Registry 移除。

## 解决的问题
- **完成检测脆弱**：过去依赖 `[DONE]` 或 endMarker；Codex/Gemini/Claude 在不同模式下都不保证此标记，导致卡死或提前结束。  
  **现状：** 统一监听 JSONL 完成事件；空闲兜底仅在收到可展示输出后启动，避免 Claude `system/init` 抢跑。
- **配置混杂**：Registry 中曾硬编码系统提示词，导致成员共享指令。  
  **现状：** 系统指令仅来源于成员配置，Adapter 负责把指令注入 CLI（Claude 用 `--append-system-prompt`，Codex/Gemini 内联到消息）。
- **输出不可读**：不同 agent 的 JSON 结构未统一，界面直出原始 JSON。  
  **现状：** `JsonlMessageFormatter` 针对三种 agent 解析文本、完成信号，忽略 `system/init`，并在 debug 时输出 JSON 解析错误。

## 关键设计

### Adapter 责任
- **ClaudeCodeAdapter**（stateless）：默认参数 `--output-format=stream-json --verbose`，AgentManager 在执行时自动插入 `-p <prompt>` 以避免启动交互 TUI；完成事件 `type=result`。因为改为一次性执行，系统指令在消息里内联 `[SYSTEM]...` 并随 prompt 一起传入。
- **OpenAICodexAdapter**（stateless）：默认 args 为空，统一在 Registry/团队里提供 `exec --json --full-auto --skip-git-repo-check`；完成事件 `turn.completed`；消息前置 `[SYSTEM]` 片段。
- **GenericShellAdapter / Gemini**（stateless）：Gemini 默认 `--output-format stream-json`，完成事件 `type=result`；系统指令通过消息前置 `[SYSTEM]` 注入。

### ProcessManager 行为
- 完成事件集合：`result | turn.completed | turn.finished`，匹配即结束并清理超时。
- 空闲兜底：仅在收到可展示输出后才启动（避免只有 `system/init` 的场景提前返回）。
- Debug：开启 `DEBUG=1` 时打印 JSONL 解析错误，便于复现。

### JSONL 格式化（JsonlMessageFormatter）
- Claude：读取 `assistant.message.content[].text`；若没有 assistant 文本但 `result.result` 存在，回落到 result 文本。
- Codex：解析 `item.*` 事件中的 `item.text/command/changes.path`，完成事件 `turn.completed/turn.finished`。
- Gemini：解析 `message.content`；完成事件 `result`。
- 仅在已完成且没有任何文本时回落到原始（去 ANSI）文本，避免吞掉有效输出。

### 配置分层
- **Registry**（`~/.agent-chatter/agents/config.json`）：记录命令、默认 args、env，可安全被新版本覆盖。
- **团队文件**（`.agent-chatter/team-config/*.json`）：成员指令、workDir、additionalArgs、agentType/agentConfigId。已移除 `endMarker`、自定义完成标记等字段。

示例（简化）：
```json
// registry
{
  "claude": { "command": "claude", "args": ["--output-format=stream-json", "--verbose"] },
  "codex":  { "command": "codex",  "args": ["exec", "--json", "--full-auto", "--skip-git-repo-check"] },
  "gemini": { "command": "gemini", "args": ["--output-format", "stream-json"] }
}
```
```json
// team member
{
  "id": "max",
  "name": "max",
  "type": "ai",
  "agentConfigId": "claude",
  "agentType": "claude",
  "systemInstruction": "You are Max...",
  "additionalArgs": []
}
```

### 运行时流程（单轮）
1. ConversationCoordinator -> AgentManager.ensureAgentStarted(adapter 准备 CLI、system prompt 注入)。
2. AgentManager.sendAndReceive -> ProcessManager 发送消息，监听 JSONL。
3. ProcessManager 读流：缓存输出、检测完成事件、在 DEBUG 下记录解析异常；仅在见到可展示输出后启动空闲兜底。
4. 回传原始 JSONL -> JsonlMessageFormatter 提取文本/完成态 -> MessageRouter 解析 `[NEXT]` 继续路由。

## 迁移指南（<=0.0.18 → 0.0.23）
- 删除旧字段：`endMarker`、`completion`、自定义 DONE 标记相关实现。
- Registry/团队配置使用新的默认参数（见上表），不要再在 Registry 中写系统提示词。
- 如果团队成员曾依赖 shell wrapper，请将 wrapper 中的 CLI 参数迁移到 Registry args 或成员 additionalArgs。
- 界面/测试应按 JSONL 输出渲染，DONE 标记不再作为终止信号。

## 附：调试要点
- 设置 `DEBUG=1` 可查看 JSONL 解析错误与进程收尾行为。
- Claude 初始会输出 `type:system init`，属于噪声；等待 `assistant/result` 后才会启动空闲超时。
- 如果新 agent 需要接入：实现 IAgentAdapter，提供默认 args、完成事件和 prepareMessage 即可，无需改动 ProcessManager。
