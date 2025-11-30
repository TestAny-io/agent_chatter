# 诚邀测试：Agent 可用性验证 (Agent Availability Verification) 新功能

大家好，

我们很高兴为 Agent Chatter 引入了全新的**Agent 可用性验证**系统！这个新功能旨在为您提供更流畅的使用体验，它能够在您开始对话之前，主动检测潜在的配置问题。

## 为什么这很重要？

在以前，如果在 Agent 未正确配置或认证过期的状态下开始会话，用户经常会在中途遇到 "verify auth fail" 错误或难以理解的崩溃信息。这不仅令人沮丧，还浪费了大家的时间。

通过新的验证系统，我们会主动检查以下关键点：
1.  **运行环境**：是否已安装所需的运行时环境（例如 Node.js）？
2.  **CLI 安装**：Agent 的命令行工具（如 `claude`, `codex`, `gemini`）是否已正确安装并可被系统识别？
3.  **认证状态**：Agent 是否已完成认证并准备好接收指令？

## 如何参与测试

我们需要您的帮助来测试这个功能，以确保它能覆盖各种边缘情况。

### 1. 验证所有已注册的 Agent

要检查您当前所有已注册 Agent 的状态，请运行：

```bash
agent-chatter agents verify --all
```

您将看到一份详细的报告，显示每个 Agent 是通过了检查，还是存在警告或错误。

### 2. 验证特定的 Agent

如果您需要排查某个特定 Agent（例如 `claude`）的问题，请运行：

```bash
agent-chatter agents verify claude
```

### 3. 注册时的自动验证

验证逻辑也已经集成到了注册流程中。当您使用 `agent-chatter agents register` 注册新 Agent 时，系统会在注册完成后立即自动进行验证。

## 我们期待您的反馈

请在您现有的环境中尝试这些命令。我们需要您特别留意以下情况：
*   **误报 (False Negatives)**：系统提示某个 Agent 有问题，但实际上您使用起来一切正常。
*   **漏报 (False Positives)**：系统提示 Agent 状态显示为 Ready，但在实际 Team 对话中却无法使用。
*   **清晰度**：错误提示是否易于理解？它是否明确告诉了您该如何修复问题？

如果您遇到任何问题或有任何建议，请在我们的仓库中提交 Issue 或直接回复本贴。

祝您聊天愉快！

Agent Chatter 团队
