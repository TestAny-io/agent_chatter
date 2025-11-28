# Codebase Guide

开发者快速上手指南，包含常用命令和架构概览。

## 常用命令

```bash
# 构建
npm run build          # TypeScript 编译到 out/

# 测试
npm test               # 运行所有测试
npm run test:unit      # 仅单元测试
npm run test:integration  # 仅集成测试
npm run test:watch     # 监视模式

# 本地开发
npm run link:dev       # 构建并 npm link
npm run unlink:dev     # 取消 link

# 运行 CLI
agent-chatter          # 启动 REPL 模式
agent-chatter status   # 检测已安装的 AI CLI 工具
agent-chatter agents list  # 列出注册的 agents
```

## 架构概览

```
src/
├── cli.ts                    # 入口，Commander.js 命令定义
├── repl/                     # REPL 模式 (Ink/React)
├── commands/                 # 子命令实现（agents 等）
├── services/
│   ├── ConversationCoordinator.ts  # 核心：对话流程、路由、会话管理
│   ├── AgentManager.ts             # Agent 生命周期管理
│   ├── MessageRouter.ts            # [NEXT:] [FROM:] 标记解析
│   ├── TeamManager.ts              # Team 配置加载和验证
│   └── validation/                 # Agent 可用性验证（命令存在性、认证状态）
├── registry/                 # Agent 注册表（全局 ~/.agent-chatter/）
├── adapters/                 # AI CLI 适配器（Claude/Codex/Gemini）
├── context/                  # 上下文组装，按 agent 类型格式化 prompt
├── events/                   # 流式输出解析（JSONL/文本）
├── infrastructure/           # 进程管理、会话存储
├── models/                   # 数据模型（Team, Member, Message 等）
├── outputs/                  # 输出接口（ConsoleOutput）
├── schemas/                  # JSON Schema 验证
└── utils/                    # 工具函数（颜色、路径、检测等）
```

## 关键流程

### 对话流程

```
用户输入
    ↓
ConversationCoordinator.sendMessage()
    ↓
解析 sender（[FROM:] 标记或自动识别）
    ↓
存储消息到 session + ContextManager
    ↓
路由到下一成员（[NEXT:] 标记或 fallback 到首个 Human）
    ↓
若为 AI 成员 → AgentManager.sendAndReceive()
    ↓
AI 响应后继续处理路由队列
    ↓
遇到 Human 成员 → 暂停等待输入
```

### Agent 生命周期

```
ensureAgentStarted() → spawn 进程
    ↓
sendAndReceive() → stdin 发送 prompt
    ↓
等待 endMarker 或超时
    ↓
stopAgent() → 清理进程
```

## 会话控制语义

- `[DONE]`：AI 输出时仅表示该 Agent 回复完成，对话继续
- `[DONE]` / `/end`：Human 输入时终止整个会话
- 未指定 `[NEXT:]` 时：fallback 到首个 Human（按 order 排序）

## 测试结构

```
tests/
├── unit/           # 单元测试，mock 外部依赖
└── integration/    # 集成测试，可能需要真实 CLI 工具
```
