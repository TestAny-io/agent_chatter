# 架构决策：多角色Agent实现方案

## 决策摘要

**决策**：Agent Chatter中，每个AI角色必须使用独立的进程实例。同一个agent（如Claude Code）不能在同一进程中扮演多个角色。

**状态**：已确认（基于文献研究和技术约束分析）

**日期**：2025-11-16

---

## 背景

### 核心问题

Agent Chatter需要支持多个AI agent在同一团队中协作对话。存在两个潜在架构方案：

1. **方案A**：同一agent进程，通过动态修改system prompt切换角色
2. **方案B**：每个角色使用独立的agent进程

需要验证：同一个AI agent（如Claude Code）能否在同一对话中扮演多个不同角色？

### 技术约束

#### Claude Code CLI的system prompt机制

**关键约束**：
- `--append-system-prompt`是**命令行参数**，只在进程启动时生效
- 无法在运行时动态修改system prompt
- Claude Code CLI是交互式REPL，维护持久的会话状态

**官方文档引用**：
> "The `--append-system-prompt` flag allows you to add specific instructions while keeping Claude Code's default capabilities intact."

**结论**：System prompt是启动时配置，非运行时API。

#### 对话上下文管理

**Claude Code的上下文机制**：
- 维护完整的对话历史（所有user和assistant消息）
- `/clear`命令清除对话历史但保留项目指令
- 重启进程才完全重置上下文
- 存在session persistence机制（保留background processes、file contexts等）

**上下文污染风险**：
- 之前角色的回复会保留在对话历史中
- 新的user message无法完全覆盖之前的角色设定
- Claude API要求user/assistant交替，所有历史都会被context window看到

#### 官方subagent设计

**Anthropic官方文档**：
> "You can use subagents for task isolation—each subagent gets its own context window and tool permissions, which keeps the main session from being polluted."

**关键启示**：
- Anthropic官方意识到上下文隔离的重要性
- 推荐为不同任务使用独立的subagent
- 每个subagent有独立的context window

---

## 决策分析

### 方案A：同一进程多角色

#### 技术可行性分析

**尝试方法1：通过user message切换角色**
```
User: "You are now a security reviewer. Review this code..."
```

**失败原因**：
- ❌ System prompt优先级高于user message
- ❌ 之前角色的对话历史仍在context中
- ❌ Agent会困惑于相互矛盾的指令

**尝试方法2：重启进程并修改system prompt**
```bash
# Round 1-3: Security Reviewer
claude --append-system-prompt "You are a security reviewer"

# 重启
# Round 4-6: Performance Optimizer
claude --append-system-prompt "You are a performance optimizer"
```

**失败原因**：
- ⚠️ 虽然技术上可行，但每次都需要重启进程
- ⚠️ 重启意味着失去之前的对话上下文
- ⚠️ 这实际上就是"独立进程"方案，只是时间上串行

#### 风险评估

| 风险 | 严重性 | 说明 |
|------|--------|------|
| 角色混淆 | 高 | Agent可能混合多个角色的行为模式 |
| 上下文污染 | 高 | 之前角色的回复影响当前角色的判断 |
| 用户体验差 | 中 | 角色切换不稳定，回复不可预测 |
| 违背设计意图 | 中 | System prompt设计用于持久角色，非动态切换 |

**结论**：方案A在技术上不可行，或需要频繁重启（等同于方案B）。

---

### 方案B：独立进程per角色

#### 实现方式

**核心机制**：每个AI角色启动独立的Claude Code进程

```typescript
// 示例：3个Claude Code扮演不同角色
Process 1: claude --append-system-prompt "You are Alice, a security reviewer..."
Process 2: claude --append-system-prompt "You are Bob, a performance optimizer..."
Process 3: claude --append-system-prompt "You are Carol, a readability expert..."
```

**进程生命周期**：
- 启动：Agent首次需要发言时启动
- 运行：保持运行直到对话结束
- 复用：同一角色的多次发言复用同一进程
- 终止：对话结束或显式停止

#### 优势

| 优势 | 说明 |
|------|------|
| ✅ 完全隔离上下文 | 每个进程有独立的对话历史和context window |
| ✅ 角色稳定 | System prompt在进程生命周期内不变 |
| ✅ 符合官方设计 | 遵循Anthropic的subagent隔离理念 |
| ✅ 可预测性高 | 每个角色行为一致，不会混淆 |
| ✅ 业界标准 | Thread-based隔离、独立进程是主流做法 |

#### 劣势与缓解

| 劣势 | 严重性 | 缓解措施 |
|------|--------|----------|
| 资源消耗 | 低 | Agent Chatter场景下通常<10个agent，可接受 |
| 进程管理复杂 | 低 | Node.js的child_process.spawn()成熟可靠 |
| 启动延迟 | 低 | 首次启动有1-2秒延迟，可接受 |

**结论**：方案B技术可行，优势明显，劣势可接受。

---

## 最终决策

### 采用方案B：独立进程per角色

**理由总结**：
1. **技术必然性**：Claude Code的system prompt机制决定了无法在单一进程中动态切换角色
2. **架构正确性**：符合Anthropic官方的subagent隔离设计理念
3. **可靠性优先**：完全隔离上下文，避免角色混淆和不可预测行为
4. **业界最佳实践**：多agent系统普遍采用独立进程或thread隔离

### 实现规范

#### 进程启动策略

**唯一键设计**：
```typescript
const processKey = `${agentConfigId}-${roleId}`;
```

**进程复用规则**：
- ✅ 同一agent + 同一role → 复用进程
- ❌ 同一agent + 不同role → 启动新进程（因为system prompt不同）
- ❌ 不同agent + 任意role → 启动新进程

**示例**：
```typescript
// Team配置
roles: [
  { name: "alice", agentName: "claude", role: "SecurityReviewer" },
  { name: "bob", agentName: "claude", role: "PerformanceOptimizer" },
  { name: "carol", agentName: "claude", role: "ReadabilityExpert" }
]

// 进程实例
processes = {
  "claude-alice-SecurityReviewer": Process<Claude>,    // 独立进程1
  "claude-bob-PerformanceOptimizer": Process<Claude>,  // 独立进程2
  "claude-carol-ReadabilityExpert": Process<Claude>    // 独立进程3
}
```

#### AgentManager实现

```typescript
class AgentManager {
  private processes: Map<string, {
    process: ChildProcess;
    agentConfigId: string;
    roleId: string;
    systemInstruction: string;
  }> = new Map();

  /**
   * 启动或复用agent进程
   * @param agentConfigId - agent配置ID
   * @param roleId - 角色ID
   * @param systemInstruction - system prompt内容
   * @returns 进程唯一键
   */
  async startAgent(
    agentConfigId: string,
    roleId: string,
    systemInstruction: string
  ): Promise<string> {
    const key = this.getProcessKey(agentConfigId, roleId);

    // 检查是否已存在
    if (this.processes.has(key)) {
      console.log(`Reusing existing process: ${key}`);
      return key;
    }

    // 启动新进程
    const agentConfig = await this.agentConfigManager.getAgentConfig(agentConfigId);

    const args = [
      ...agentConfig.args,
      '--append-system-prompt',
      systemInstruction
    ];

    const process = spawn(agentConfig.command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.processes.set(key, {
      process,
      agentConfigId,
      roleId,
      systemInstruction
    });

    console.log(`Started new process: ${key}`);
    return key;
  }

  /**
   * 停止agent进程
   */
  async stopAgent(agentConfigId: string, roleId: string): Promise<void> {
    const key = this.getProcessKey(agentConfigId, roleId);
    const entry = this.processes.get(key);

    if (entry) {
      entry.process.kill();
      this.processes.delete(key);
      console.log(`Stopped process: ${key}`);
    }
  }

  /**
   * 停止所有进程
   */
  async stopAllAgents(): Promise<void> {
    for (const [key, entry] of this.processes.entries()) {
      entry.process.kill();
      console.log(`Stopped process: ${key}`);
    }
    this.processes.clear();
  }

  /**
   * 生成进程唯一键
   */
  private getProcessKey(agentConfigId: string, roleId: string): string {
    return `${agentConfigId}-${roleId}`;
  }
}
```

#### ConversationCoordinator调用

```typescript
class ConversationCoordinator {
  async sendMessage(roleId: string, message: string): Promise<string> {
    const role = this.team.roles.find(r => r.id === roleId);

    if (role.type === 'ai') {
      // 启动或复用进程
      const processKey = await this.agentManager.startAgent(
        role.agentConfigId,
        role.id,
        role.systemInstruction
      );

      // 发送消息到该进程
      const response = await this.agentManager.sendAndReceive(
        processKey,
        message
      );

      return response;
    } else {
      // Human input
      return await this.waitForHumanInput(roleId);
    }
  }
}
```

---

## 对Team Configuration的影响

### Schema不需要修改

**好消息**：现有的team-configuration.md中的schema已经支持这个架构！

**关键字段**：
```json
{
  "roles": [
    {
      "name": "alice",
      "agentName": "claude",  // 指向agent配置
      "role": "SecurityReviewer",  // 角色类型
      "systemInstruction": "You are Alice..."  // 每个member的独立指令
    }
  ]
}
```

**为什么已经支持**：
- `agentName`：指向基础agent配置（如"claude"）
- `role` + `systemInstruction`：定义该member的独立角色
- 组合`agentName + role`作为进程唯一键，天然支持独立进程

### 设计决策更新

**添加到team-configuration.md第10节**：

```markdown
### 10.3 多角色Agent架构决策

**问题**：同一个agent（如Claude Code）能否在同一团队中扮演多个不同角色？

**决策**：每个AI角色必须使用独立的进程实例。

**理由**：
1. **技术约束**：Claude Code的`--append-system-prompt`只在启动时生效，无法运行时修改
2. **上下文隔离**：独立进程确保每个角色有独立的对话历史，避免角色混淆
3. **官方设计**：符合Anthropic的subagent隔离理念
4. **可靠性**：避免"人格分裂"和不可预测行为

**实现**：
- 进程唯一键：`${agentConfigId}-${roleId}`
- 同一agent不同role → 启动独立进程
- 同一agent同一role → 复用进程
- AgentManager维护进程map，负责生命周期管理

**示例**：
```json
// 3个Claude Code扮演不同角色 = 3个独立进程
{
  "roles": [
    { "agentName": "claude", "role": "SecurityReviewer" },   // Process 1
    { "agentName": "claude", "role": "PerformanceOptimizer" }, // Process 2
    { "agentName": "claude", "role": "ReadabilityExpert" }   // Process 3
  ]
}
```
```

---

## 验证计划

虽然文献研究已经足够确定结论，但仍建议进行实际验证：

### 简化验证实验

**目标**：确认独立进程方案在实际使用中有效

**步骤**：
1. 使用`examples/multi-role-demo-config.json`配置
2. 启动3个独立的Claude Code进程（Alice, Bob, Carol）
3. 发送相同的代码审查请求给所有3个角色
4. 验证每个角色保持各自的专业视角

**成功标准**：
- ✅ Alice只谈论安全
- ✅ Bob只谈论性能
- ✅ Carol只谈论可读性
- ✅ 没有角色混淆

---

## 相关文档

- **team-configuration.md**：团队配置设计，第10.3节需要添加此决策
- **multi-role-agent-validation.md**：详细的验证实验方案
- **examples/multi-role-demo-config.json**：多角色演示配置

---

## 开发需求与设计约束总结（供验证实施）

> 背景：经过与产品/业务讨论，我们需要一种对用户直观、对开发可落地的方式，让“同一种 CLI agent（Codex、Gemini 等）在同一团队里扮演多个角色，甚至同一角色下有多个不同成员”。考虑到 CLI 本身的 system prompt/对话上下文机制，唯一可靠的方式仍是“每个角色独立进程”，但需要明确约束、目录策略和具体实现步骤，以便开发验证。

### 1. 目标

1. 允许一个团队配置中多个成员引用同一种 CLI（Codex 或 Gemini）。
2. 每个成员/角色拥有完全隔离的 system prompt、记忆和工作上下文，避免“人格/记忆串线”。
3. 对用户说明直观：进入“Team/Role 专用入口”即可启动对应 agent，不要求用户掌握 Git。
4. 方案要兼容非工程团队（市场、PMO、财务等）——也就是不能依赖 git repo、工程化目录。

### 2. 全局约束

1. **每个角色=独立进程**：延续本文既有结论。无法在同一进程里动态切换 system prompt，也无法避免上下文污染。
2. **角色目录不可随意变更**：一旦创建，角色的 system instruction（`AGENTS.md`/`GEMINI.md`）固定，编辑模式下不允许修改角色结构（详见 team-configuration.md 的 v1.7 修订）。
3. **真实工作资料可在役**：即使指令文件和真实资料不在同一目录，也要保证 agent 能访问真实资料（通过符号链接、快捷方式或配置指向）。
4. **日志/缓存分区**：每个角色需要自己的 HOME/配置目录，避免历史/日志相互覆盖。

### 3. 推荐目录策略（适用于所有 CLI）

```
/Team_A
  /_shared_assets        # 可选：团队公用资料，不含系统指令
  /Bob                   # Bob 角色入口
     AGENTS.md / GEMINI.md / ...
     work -> /真实业务路径   # 符号链接或快捷方式
  /John
     AGENTS.md / GEMINI.md / ...
     work -> /另一个业务路径
```

* Team 根目录可放团队级规范（`team_instruction.md`），角色子目录内放角色特有指令。CLI 在加载每个不同成员的system instruction （e.g. GEMINI.md, agents.md, claude.md）时，由于在system instruction中明确引用了团队的team_instruction.md，所以agent也会去读取。
* `work` 子目录指向真实工作资料，这样角色入口既承载人格文件，又能访问真实内容；对非 Git 团队，只需告诉成员进入相应入口目录即可。

### 4. Codex 专用约束与操作

1. Codex 把全局配置、日志、历史保存在 `CODEX_HOME`（默认 `~/.codex`，docs/config.md:26、811）。**要求**：为每个角色设定独立的 `CODEX_HOME`，其中包含：
   - `config.toml`（角色专有配置，可引用团队模板）。
   - `AGENTS.md`/`AGENTS.override.md`（角色人格）。
   - 历史文件、日志、auth 等。
2. 启动方式示例：
   ```bash
   CODEX_HOME=/Team_A/Bob/home codex --cwd /Team_A/Bob/work
   CODEX_HOME=/Team_A/John/home codex --cwd /Team_A/John/work
   ```
   这样日志、提示词、缓存完全分离，`--cwd` 指向实际工作目录（可为符号链接）。
3. Codex CLI 本身已支持同时运行多个进程，只要 `CODEX_HOME` 不同或会话 ID 不同，就不会混淆（docs/config.md:811、agents_md.md:5-29）。需要开发验证：
   - 在两个独立 `CODEX_HOME` 启动 codex，看历史文件、日志是否互不干扰。
   - 在 team-config 中引用同一个 agent 名称但不同 role/member ID，确保 AgentManager 生成 `${agentConfigId}-${roleId}` 的唯一 key 启动多个进程。

### 5. Gemini CLI 专用约束与操作

1. Gemini CLI 的“记忆/系统指令”通过 `GEMINI.md`/`contextFileName` 配置层级加载（docs/cli/configuration.md:60、654-689）。**要求**：
   - 在每个角色入口目录放 `GEMINI.md`（或配置 `contextFileName` 指向其它名），内容写角色专属指令。
   - 如果需要共享团队规范，可在 Team_A 根目录放 `GEMINI.md`，角色目录再覆盖。
2. Gemini CLI 的设置、历史记录默认在 `~/.gemini`。为了完全隔离，建议：
   - 通过不同的项目 `.gemini/settings.json`（位于角色目录内）控制上下文和其他设置；
   - 或在启动脚本中切换 `HOME`/`XDG_*`，让每个角色有自己的 `.gemini` 目录。
3. 启动示例：
   ```bash
   (cd /Team_A/Bob && HOME=/Team_A/Bob/home gemini)
   (cd /Team_A/John && HOME=/Team_A/John/home gemini)
   ```
   其中 `home` 目录里可放 `.gemini/settings.json`、`GEMINI.md` 等。
4. 需要开发验证：
   - `contextFileName` 多层加载是否如预期（Team 根 + 角色目录 + 工作目录）。
   - 在多个 `HOME`/`.gemini` 并存时，日志、历史互不影响。

### 6. 调度层要求

1. Team Configuration 中的每个 member/role 都要记录：
   - `agentName`（如 `codex`, `gemini`）。
   - `workingDir`（角色入口目录，例如 `/Team_A/Bob`）。
   - `executionDir`（真实工作目录，缺省为 `workingDir`/`work`）。
   - `homeDir` 或 `env`（可选，指向角色专属 `CODEX_HOME`/`HOME`）。
2. AgentManager 启动进程前，要根据 member 配置：
   - 设置 `cwd` 为 `executionDir`。
   - 对 Codex：`env.CODEX_HOME = homeDir`（若提供）。
   - 对 Gemini：`env.HOME` 或 `env.GEMINI_*` 指向角色目录。
3. 日志/错误输出要附带角色 ID/目录，方便排查。

### 7. 待验证任务清单

| 编号 | 项目 | 验证要点 |
| ---- | ---- | -------- |
| V1 | Codex 多角色 | 不同 `CODEX_HOME` + 不同 `cwd` 下并发运行，确保历史/日志文件分离、system prompt 正确 |
| V2 | Codex Team 目录 | Team 根 `team_instruction.md` + 子目录 `AGENTS.md` 组合效果符合预期(在子目录的agents.md中引用Team根目录下的 `team_instruction.md` 作为团队相关背景内容) |
| V3 | Gemini 多角色 | 不同 `.gemini`/`GEMINI.md` 目录下并发运行，`/memory show` 显示个性化指令 |
| V4 | Gemini Team 目录 | Team 根 `team_instruction.md` + 子目录 `GEMINI.md` 组合效果符合预期(在子目录的gemini.md中引用Team根目录下的 `team_instruction.md` 作为团队相关背景内容)|
| V5 | 调度层 | AgentManager 按 `${agentConfigId}-${roleId}` 复用/启动进程，`cwd`、环境变量传递正确 |
| V6 | UX | 编写用户指南：如何创建 Team 目录、角色入口、符号链接；如何启动各角色 CLI |

### 8. 对产品/用户的说明要点

1. “每位 AI 成员都有自己的入口文件夹，打开即代表与 TA 对话”。文件夹里已有角色指令，且包含指向真实资料的快捷方式。
2. 如果需要新角色，需创建新的入口目录并在 team-config 中添加成员；既有角色不支持在编辑模式下横向调整。
3. 如果团队完全不懂 Git，也可以把 Team_A 放在普通共享盘里，利用链接方式引用真实文件。

### 9. 下一步

1. 开发按 V1~V6 验证；记录任何 CLI 无法满足的边界情况。
2. 在 team-configuration.md 的实现计划 Phase 3 中加入“角色入口目录/ENV 支持”的开发任务。
3. 输出用户文档：一步步教用户创建 Team/Role 目录、配置 `AGENTS.md`/`GEMINI.md`、如何启动 CLI。

> 以上需求用作开发验证 checklist。若在实现过程中发现 CLI 层还有额外限制（例如 Gemini CLI 无法指定 `HOME`），请及时反馈并更新此决策文档。

---

**文档版本**: v1.0
**作者**: Claude Code
**状态**: 已确认
**下一步**：
1. 更新team-configuration.md添加10.3节
2. 实现AgentManager的独立进程机制
3. 可选：执行简化验证实验确认效果
