# Agent Chatter - 项目记录

## 产品定位

**Agent Chatter 是一个闭源软件**（类似 Claude Code）

这是一个关键的产品决策，会影响到：
- 代码许可证选择
- 文档编写风格
- 功能设计和商业化策略
- 用户支持方式
- 发布渠道

## 技术架构

### 从 VSCode 插件到 CLI 应用的转型

项目最初设计为 VSCode 插件，但在开发过程中遇到了 node-pty 在 Electron 环境中的原生模块编译问题。经过评估，决定将项目重构为 CLI 应用：

**重构原因：**
1. node-pty 在 VSCode 的 Electron 环境中存在兼容性问题
2. CLI 应用更简单、更直接，不依赖原生模块
3. 使用标准的 child_process.spawn() 即可管理 AI agent 进程
4. 更容易测试和部署

**重构时间：** 2025-11-16

### 关键技术决策

1. **进程管理**：使用 `child_process.spawn()` 代替 `node-pty`
2. **stdin 生命周期**：每次发送消息后调用 `stdin.end()`，导致进程退出，下次需要重新启动
3. **输出缓冲**：添加 `outputBuffer` 捕获进程启动早期的输出
4. **自动轮询**：当消息没有 `[NEXT: ...]` 标记时，自动轮询到下一个角色

### 主要 Bug 修复历史

1. **Bug: Claude Code 无响应**
   - 原因：stdin 未关闭，Claude Code 一直等待输入
   - 修复：sendAndReceive 后调用 `stdin.end()`

2. **Bug: 第二次消息失败 "Process not running"**
   - 原因：stdin 关闭导致进程退出，但未清理
   - 修复：显式调用 `stopAgent()` 清理进程，下次自动重启

3. **Bug: 等待人类输入时无提示**
   - 原因：`waitingForRoleId` 未设置
   - 修复：实现自动轮询机制设置下一个角色

## 集成的 AI Agent

目前支持：
1. **Claude Code** - Anthropic 官方 CLI
2. **OpenAI Codex** - 通过 wrapper 脚本适配
3. **Google Gemini CLI** - 通过 wrapper 脚本适配

### Wrapper 机制

不同的 AI CLI 工具有不同的接口，通过 bash wrapper 脚本统一为 stdin/stdout 接口：
- 读取 stdin 作为 prompt
- 调用对应的 CLI 工具
- 输出结果到 stdout
- 添加 `[DONE]` 标记

## 未来考虑

作为闭源软件，需要考虑：
- [ ] 商业许可证模式
- [ ] 用户授权机制
- [ ] 使用限制和配额
- [ ] 付费功能设计
- [ ] 企业版功能
- [ ] 技术支持渠道

## 重要提醒

⚠️ **不要在 README 或文档中包含"Contributing"、"Open Source"、"Fork"等开源相关内容**

⚠️ **代码许可证应该是专有许可证，不是 MIT/Apache 等开源许可证**
