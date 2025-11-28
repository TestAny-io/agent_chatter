# Agent 验证模块 - 详细设计 (LLD)

## 实现状态

> **已完成并集成到 Runtime** (2025-11-28)
>
> 新的验证模块已实现并通过 `src/registry/AgentValidator.ts` 适配器接入到现有 Runtime：
> - `AgentRegistry.verifyAgent()` 现在使用新验证逻辑
> - `/team deploy` 等命令走新的验证链路
> - 旧实现已被替换为适配器模式，确保向后兼容

## 文档索引

| 文档 | 描述 | 状态 |
|------|------|------|
| [01-types.md](./01-types.md) | 类型定义 (ErrorType, CheckResult, VerificationResult) | ✅ 已实现 |
| [02-connectivity-checker.md](./02-connectivity-checker.md) | 网络连通性检查器 | ✅ 已实现 |
| [03-auth-checker-interface.md](./03-auth-checker-interface.md) | 认证检查器接口定义 | ✅ 已实现 |
| [04-claude-auth-checker.md](./04-claude-auth-checker.md) | Claude 认证检查器实现 | ✅ 已实现 |
| [05-codex-auth-checker.md](./05-codex-auth-checker.md) | Codex 认证检查器实现 | ✅ 已实现 |
| [06-gemini-auth-checker.md](./06-gemini-auth-checker.md) | Gemini 认证检查器实现 | ✅ 已实现 |
| [07-agent-validator.md](./07-agent-validator.md) | Agent 验证器主类 | ✅ 已实现 |

## 对应 HLD

本 LLD 基于以下 HLD 文档：
- [05-improvement-proposal-cn.md](../05-improvement-proposal-cn.md)

## 架构概览

```
src/services/validation/                 # Core 层 - 新验证模块
├── types.ts                             # 类型定义
├── index.ts                             # 公共 API 导出
├── ConnectivityChecker.ts               # 网络连通性检查
├── AgentValidator.ts                    # 验证器主类
└── auth/
    ├── AuthChecker.ts                   # 接口定义 + 工厂函数
    ├── ClaudeAuthChecker.ts             # Claude 实现
    ├── CodexAuthChecker.ts              # Codex 实现
    └── GeminiAuthChecker.ts             # Gemini 实现

src/registry/AgentValidator.ts           # 适配器 - Runtime 接入点
                                         # 将新模块适配到旧 AgentRegistry 接口
```

## 依赖关系

```
src/registry/AgentRegistry
    └── src/registry/AgentValidator (适配器)
            └── src/services/validation/AgentValidator (新实现)
                    ├── ConnectivityChecker
                    └── AuthChecker (interface)
                            ├── ClaudeAuthChecker
                            ├── CodexAuthChecker
                            └── GeminiAuthChecker
```

## 设计约束

1. **Core 层无 UI 依赖**：所有模块不能依赖 `IOutput`、Ink、Inquirer 等
2. **纯数据返回**：所有方法返回结构化数据，不直接输出到控制台
3. **可测试性**：所有外部依赖（fs、exec、dns、net）可被 mock

## 版本信息

- 创建日期：2025-11-28
- 基线版本：以 2025-11-27 各 Agent CLI 版本为基准
