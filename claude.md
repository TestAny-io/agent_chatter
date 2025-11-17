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
5. **工具检测**：应用启动时自动检测系统中已安装的 AI CLI 工具，提升用户体验

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

### 工具检测机制

**实现时间：** 2025-11-16

用户体验优化：在应用启动时自动检测系统中已安装的 AI CLI 工具。

**功能：**
1. **`status` 命令**：独立命令检查所有支持的 AI 工具状态
2. **启动时自动检测**：`start` 命令执行前显示工具状态
3. **版本信息显示**：显示已安装工具的版本号
4. **安装提示**：为未安装的工具提供安装指引

**实现细节：**
- `src/utils/ToolDetector.ts`：工具检测模块
- 使用 `child_process.exec()` 调用 `--version` 检测工具
- 超时保护（3秒）避免长时间阻塞
- 彩色输出，清晰区分已安装/未安装状态

**用户反馈：**
用户不需要手动检查依赖，应用会主动告知系统状态。

## 平台兼容性

**实现时间：** 2025-11-16

### 跨平台支持状态

- ✅ **macOS**：完全支持，所有功能正常工作
- ✅ **Linux**：完全支持，bash脚本原生兼容
- ⚠️ **Windows**：部分支持，wrapper脚本需要特殊处理

### Windows平台的挑战

**问题：** Wrapper脚本最初只有bash版本（`.sh`），Windows不能直接运行

**解决方案：**
1. 创建了对应的Windows批处理脚本（`.bat`）
   - `wrappers/codex-wrapper.bat`
   - `wrappers/gemini-wrapper.bat`

2. Windows用户的三种选项：
   - 使用WSL (Windows Subsystem for Linux) - 推荐
   - 使用Git Bash
   - 直接使用`.bat`脚本

**技术细节：**
- Node.js代码（`spawn`, `exec`）是跨平台的
- Wrapper脚本需要平台特定的实现
- 批处理脚本使用`more`读取stdin，使用`enabledelayedexpansion`处理变量

### 用户需要安装的依赖

**必需：**
1. Node.js 18+
2. npm（随Node.js安装）
3. 至少一个AI CLI工具（Claude Code / Codex / Gemini）

**Windows额外要求（可选）：**
- WSL或Git Bash（如果使用.sh wrapper）

## 未来考虑

作为闭源软件，需要考虑：
- [ ] 商业许可证模式
- [ ] 用户授权机制
- [ ] 使用限制和配额
- [ ] 付费功能设计
- [ ] 企业版功能
- [ ] 技术支持渠道

## 语言使用规范

### UI文本语言
**决定时间：** 2025-11-16

**规则：**
- ✅ **所有用户界面文本使用英语**
  - 包括所有显示给用户的提示、错误信息、菜单、命令输出等
  - 包括设计文档中的UI示例和模拟对话
  - 包括代码注释中描述UI行为的部分

- ✅ **设计文档和内部文档可以使用中文**
  - 设计文档的章节标题、功能描述、技术说明等可以用中文
  - 内部讨论、需求说明、实现细节说明可以用中文
  - 但文档中的UI示例必须用英语

**示例：**
```markdown
# 正确示例
### 3.1 Wizard模式（向导模式）
用于创建新团队，采用分步引导方式。

UI示例：
```
Step 1/4: Team Structure
  Team Name: [input] My Team
```

# 错误示例（不要这样做）
UI示例：
```
第一步/共4步：团队结构
  团队名称：[输入] 我的团队
```
```

**理由：**
- 产品面向国际用户，UI使用英语是行业标准
- 内部文档用中文可以提高团队沟通效率
- 明确区分面向用户的内容和内部文档

## 重要提醒

⚠️ **不要在 README 或文档中包含"Contributing"、"Open Source"、"Fork"等开源相关内容**

⚠️ **代码许可证应该是专有许可证，不是 MIT/Apache 等开源许可证**
