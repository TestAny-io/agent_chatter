# Arch Decision Log

## 导航
- 产品定位与许可
- 架构沿革
- 关键技术决策
- 集成的 AI Agent
- 会话结束语义
- 平台兼容性
- 语言与文档
- 未来考虑

## 产品定位
- Agent Chatter 为闭源/商业化 CLI（类似 Claude Code）；文档/许可策略保持专有属性。

## 架构沿革
- 2025-11-16：由 VSCode 扩展迁移为纯 CLI，规避 Electron/node-pty 编译问题，使用 `child_process.spawn()`，便于测试与部署。

## 关键技术决策
1) 进程管理：`spawn`；每次发送后 `stdin.end()`，需按次启动并用 `stopAgent()` 清理。
2) 输出缓冲：`outputBuffer` 捕获启动初期输出。
3) 路由：未含 `[NEXT: ...]` 时按成员 `order` 轮询。
4) 工具检测：启动或 `status` 命令自动检测已安装 AI CLI，含版本与安装指引，`exec` + 3s 超时。
5) Wrapper 统一接口：bash/批处理脚本适配 stdin/stdout，自动附加 `[DONE]`。

## 集成的 AI Agent
- Claude Code（官方 CLI）、OpenAI Codex、Google Gemini，通过 wrapper 适配为统一接口。

## 会话结束语义
- ProcessManager 层：`[DONE]` 判定单条回复完成（保持原逻辑）。
- ConversationCoordinator 层：AI 输出 `[DONE]` 不终止会话；人工 `[DONE]` 或 `/end` 终止；确保多 Agent 可持续对话。

## 平台兼容性
- macOS/Linux：完整支持。
- Windows：需 `.bat` wrapper，或使用 WSL/Git Bash 运行 `.sh`。

## 语言与文档
- 面向用户的 UI 文本强制英语；设计/内部文档可中文，但 UI 示例仍用英语。
- 文档避免「Contributing/Open Source/Fork」等开源措辞。

## 未来考虑
- 商业许可证模式、授权/配额、付费/企业版功能、技术支持渠道。
