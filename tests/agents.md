# Tests Agents Instruction

## 目标
- 明确 agent-chatter 项目在 tests/ 目录下的组织原则、约定与执行要求
- 帮助 Codex/Gemini 等 coding agent 在编写/维护测试时保持一致性

## 目录结构
```
tests/
  agents.md              # 本说明文件
  unit/                  # 单元测试，关注模块级逻辑
    *.test.ts
  integration/           # 集成和端到端测试
    *.test.ts
```
- 单元测试仅依赖轻量 mock/fixture，不进行真实 CLI 进程管理
- 集成测试允许 mock ProcessManager 等外部依赖，但应覆盖从配置加载到 ConversationCoordinator 的关键路径

## 测试指令
1. 新增模块时，优先在 `tests/unit/` 下创建对应测试文件
2. 涉及配置加载、目录创建、消息循环等跨模块行为，放在 `tests/integration/`
3. 所有测试需可通过 `npm test` 在 Node 环境下运行，不依赖系统 CLI 工具
4. 如需 mock CLI 交互，优先 mock `ProcessManager`、`AgentManager`，避免引入真实子进程

## 实践约定
- 严格使用 TypeScript + Vitest：`import { describe, it, expect } from 'vitest'`
- 任何 mock 均需明确 `vi.mock` 或手写 stub，避免泄漏到其他测试
- 若测试需要文件系统，请使用 `fs.mkdtempSync` + `os.tmpdir()` 创建临时目录并在 `afterEach` 清理
- 增加新测试时更新 README/设计文档以反映覆盖范围

## TODO
- [ ] 为 AgentManager/ProcessManager 添加更细粒度的单元测试
- [ ] 增加配置示例（如 `agent-chatter-config.json`）的 smoke test
- [ ] 将 `npm test` 纳入 CI/CD，持续保障质量（等待 PM 批准）
