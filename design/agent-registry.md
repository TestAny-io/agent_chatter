# Agent Registry 设计文档

> 更新（2025-11-21）：系统已切换为 JSONL 完成事件（Claude/Codex/Gemini），不再依赖 `endMarker`。文档中出现的 endMarker 字段为历史描述，后续将逐步清理；当前实现以 JSONL 参数与完成事件为准。
> 更新（2025-02）：成员级/团队级 `workDir` 配置已删除，运行时工作目录取自启动时的 `cwd`（未来可结合沙箱）。

## 1. 背景和问题

### 1.1 当前架构的问题

当前 Agent Chatter 的架构存在以下问题：

1. **缺乏全局 Agent 配置**：每个 team 配置文件都需要重复定义相同的 agents
2. **配置繁琐**：用户需要手动编辑 JSON 文件，填写 command、args、endMarker 等参数
3. **无注册机制**：`/status` 命令只检测系统中的 CLI 工具，但不会将其"注册"到程序中
4. **用户体验差**：用户安装了 agent 后，不知道如何让程序"识别"它

### 1.2 用户期望的流程

1. **首次启动**：程序检测到没有注册任何 agent，提示用户注册
2. **自动扫描**：程序扫描系统常见路径，列出已安装的 agents
3. **确认注册**：用户选择要注册的 agents，程序保存到全局配置
4. **创建 Team**：用户创建 team 时，从已注册的 agents 中选择，无需重复配置
5. **管理 Agents**：提供 register、list、edit、delete 等管理功能

## 2. 架构设计

### 2.1 全局 Agent Registry

引入全局 agent registry，存储路径：

```
~/.agent-chatter/
├── /agents/config.json          # 已注册的 agents 配置
└── config.json          # 程序全局配置（预留）
```

### 2.2 配置文件层次

```
全局配置 (~/.agent-chatter/)
├── agents/config.json           # 全局 agent 定义（可跨 team 复用）
├── teams/
│   └── {team-name}/
│       ├── config.json          # Team 配置
│       └── {role}/
│           └── {member-name}/
│               └── AGENTS.md    # Member instructions
└── config.json                  # 程序配置（预留）
```

### 2.3 Team 配置引用和覆盖机制

Team 配置文件使用**对象数组**引用全局 agents，并支持可选字段覆盖：

**新格式（schema 1.1）：对象数组 + 可选覆盖**
```json
{
  "schemaVersion": "1.1",
  "agents": [
    {
      "name": "claude",           // 必填：引用全局 registry 中的 agent
      "args": ["..."],            // 可选：覆盖全局配置的 args
      "endMarker": "[CUSTOM]"     // 可选：覆盖全局配置的 endMarker
    },
    {
      "name": "codex"             // 仅指定 name，其他字段使用全局配置
    }
  ],
  "team": {
    "name": "my-team",
    // workDir 字段已删除，cwd 由启动目录决定
    "roleDefinitions": [...],
    "members": [
      {
        "displayName": "Claude Reviewer",
        "displayRole": "Reviewer",
        "name": "claude-reviewer",
        "type": "ai",
        "role": "reviewer",
        "agentType": "claude",
        "themeColor": "cyan",
        "roleDir": "~/.agent-chatter/teams/my-team/reviewer/claude-reviewer",
        "instructionFile": "~/.agent-chatter/teams/my-team/reviewer/claude-reviewer/AGENTS.md"
        // ❌ 移除 workDir 字段（统一使用 team.workDir）
      }
    ]
  }
}
```

**废弃：内联定义 agents（旧模式）**
```json
{
  "schemaVersion": "1.0",
  "agents": [
    {
      "name": "claude",
      "command": "claude",        // 旧格式包含完整定义
      "args": [...],
      "endMarker": "[DONE]"
    }
  ],
  "team": { ... }
}
```

### 2.4 WorkDir 设计理念和 Team-Project 解耦

#### 2.4.1 业务需求：Team 和 Project 解耦

**核心设计原则**：
- ⚠️ **Team 不等于软件开发团队**：Team 可以是任何协作团队（业务分析、内容创作、客服支持等）
- ⚠️ **Team 工作环境不保证有 Git**：Team 配置不应依赖版本控制系统
- ⚠️ **Team 配置独立于项目**：Team 是稳定的组织单元，Project 是临时的工作对象

**为什么 Team 配置在全局目录？**

| 需求 | 传统方式（repo内） | 全局配置（本设计） |
|------|-------------------|-------------------|
| 非Git环境 | ❌ 无法工作 | ✅ 完全支持 |
| Team复用 | ❌ 每个项目重复配置 | ✅ 配置一次，多项目复用 |
| 安全隔离 | ❌ Team指令暴露在repo中 | ✅ Team配置在用户HOME下 |
| 跨项目切换 | ❌ 需要重新配置Team | ✅ 修改工作目录即可 | → 现行做法：直接在目标目录运行 `agent-chatter` |

#### 2.4.2 WorkDir 机制

**问题**：Team 配置存储在全局路径，如何支持多项目使用？

**解决方案**：
- 工作目录由启动 cwd 决定（team/member 配置不再支持 workDir）
- 若要切换项目，直接在目标项目目录下运行 `agent-chatter`

**使用场景：**

```
场景2：同一个项目用不同 team
- 今天：agent-chatter start --team code-review-team
- 明天：agent-chatter start --team qa-team

场景3：非软件开发场景
- Team: content-writing-team
- Project: marketing-campaign-q4
- 启动目录: ~/Documents/marketing-q4 (无 Git)
```

#### 2.4.3 运行时行为

程序启动对话时：
1. 加载全局 `~/.agent-chatter/agents/config.json`
2. 加载 `~/.agent-chatter/teams/{team-name}/config.json`
3. 对于 team 配置中的每个 agent：
   - 从全局 registry 获取基础配置
   - 应用 team 级别的覆盖（如果有）
   - 生成最终的 agent 配置
4. **为每个 member 设置 cwd**：使用启动时的 `process.cwd()`。
5. 加载各 member 的 `instructionFile`（从 roleDir 下）

## 3. 数据结构

### 3.1 全局 Agent Registry (`~/.agent-chatter/agents/config.json`)

```typescript
interface AgentRegistry {
  schemaVersion: string;  // Registry schema version: "1.1"
  agents: {
    [agentName: string]: AgentDefinition;
  };
}

interface AgentDefinition {
  name: string;           // "claude", "codex", "gemini"
  displayName: string;    // "Claude Code", "OpenAI Codex"
  command: string;        // CLI 命令路径或名称
  args: string[];         // 默认参数
  endMarker: string;      // 响应结束标记
  usePty: boolean;        // 是否使用 PTY
  version?: string;       // 检测到的版本
  installedAt: string;    // 注册时间 (ISO 8601)
  lastVerified?: string;  // 最后验证时间 (ISO 8601)
}
```

**示例：**
```json
{
  "schemaVersion": "1.1",
  "agents": {
    "claude": {
      "name": "claude",
      "displayName": "Claude Code",
      "command": "claude",
      "args": [
        "--append-system-prompt",
        "Always end your response with [DONE] on a new line. Keep responses concise."
      ],
      "endMarker": "[DONE]",
      "usePty": false,
      "version": "0.8.0",
      "installedAt": "2024-11-18T10:30:00Z"
    },
    "codex": {
      "name": "codex",
      "displayName": "OpenAI Codex",
      "command": "codex",
      "args": ["exec", "--json", "--full-auto"],
      "endMarker": "[DONE]",
      "usePty": false,
      "version": "0.58.0",
      "installedAt": "2024-11-18T10:35:00Z"
    }
  }
}
```

**注意**：
- Registry 有自己独立的 schemaVersion（当前为 1.1）
- Team 配置文件也有自己的 schemaVersion（当前为 1.1）
- 两者独立演进，互不影响

### 3.2 Team 配置完整结构

#### 3.2.1 TeamWorkDir

```typescript
interface TeamWorkDir {
  name: string;         // 项目标识符，如 "my-project"
  displayName: string;  // 项目显示名称，如 "My Awesome Project"
  directory: string;    // 项目工作目录的绝对路径
}
```

#### 3.2.2 RoleDefinition

```typescript
interface RoleDefinition {
  name: string;         // 角色标识符，如 "reviewer"
  displayName: string;  // 角色显示名称，如 "Code Reviewer"
  description: string;  // 角色描述
}
```

#### 3.2.3 TeamMember

```typescript
interface TeamMember {
  displayName: string;       // 成员显示名称
  displayRole: string;       // 成员显示的角色
  name: string;              // 成员唯一标识符
  type: 'ai' | 'human';      // 成员类型
  role: string;              // 角色标识符（对应 roleDefinitions 中的 name）
  agentType?: string;        // AI agent 类型（type=ai 时必填）
  themeColor?: string;       // UI 主题色
  roleDir: string;           // 角色目录（存放该成员的配置和指令）
  instructionFile: string;   // 指令文件路径
}
```

#### 3.2.4 完整示例

```json
{
  "schemaVersion": "1.1",
  "agents": [
    { "name": "claude" }
  ],
  "team": {
    "name": "code-review-team",
    "displayName": "Code Review Team",
    "description": "A team for code review with AI and human members",
    "instructionFile": "~/.agent-chatter/teams/code-review-team/team_instruction.md",
    "roleDefinitions": [
      {
        "name": "reviewer",
        "displayName": "Code Reviewer",
        "description": "Reviews code for quality, security, and best practices"
      },
      {
        "name": "observer",
        "displayName": "Observer",
        "description": "Observes the conversation and provides feedback when needed"
      }
    ],
    "members": [
      {
        "displayName": "Claude Reviewer",
        "displayRole": "AI Code Reviewer",
        "name": "claude-reviewer",
        "type": "ai",
        "role": "reviewer",
        "agentType": "claude",
        "themeColor": "cyan",
        "roleDir": "~/.agent-chatter/teams/code-review-team/reviewer/claude-reviewer",
        "instructionFile": "~/.agent-chatter/teams/code-review-team/reviewer/claude-reviewer/AGENTS.md"
      },
      {
        "displayName": "Human Observer",
        "displayRole": "Human Observer",
        "name": "observer-1",
        "type": "human",
        "role": "observer",
        "themeColor": "green",
        "roleDir": "~/.agent-chatter/teams/code-review-team/observer/human-observer",
        "instructionFile": "~/.agent-chatter/teams/code-review-team/observer/human-observer/README.md"
      }
    ]
  },
  "maxRounds": 10
}
```

#### 3.2.5 文件系统布局

当 `/team create` 生成上述配置时，会创建以下文件结构：

```
~/.agent-chatter/teams/code-review-team/
├── config.json                           # Team 配置文件
├── team_instruction.md                   # Team 级别指令
├── reviewer/
│   └── claude-reviewer/
│       ├── AGENTS.md                     # Claude reviewer 的角色指令
│       └── context.json                  # 可选：上下文配置
└── observer/
    └── human-observer/
        └── README.md                     # Human observer 的说明文档
```

**说明：**
- 不再支持配置 workDir，统一使用启动 cwd（成员/团队层面均已移除该字段）

### 3.3 Agent 配置覆盖规则 ⭐

#### 3.3.1 可覆盖字段

Team 配置可以覆盖以下字段：

| 字段 | 类型 | 可覆盖 | 说明 |
|------|------|--------|------|
| `name` | string | ❌ 必填 | 必须引用 registry 中存在的 agent |
| `command` | string | ❌ 不可覆盖 | 安全考虑，不允许覆盖命令路径 |
| `args` | string[] | ✅ 可覆盖 | 可为特定 team 定制参数 |
| `endMarker` | string | ✅ 可覆盖 | 可使用自定义结束标记 |
| `usePty` | boolean | ✅ 可覆盖 | 可调整 PTY 模式 |

#### 3.3.2 覆盖优先级

```
Team 配置 > 全局 Registry
```

#### 3.3.3 合并策略

```typescript
function mergeAgentConfig(
  registryConfig: AgentDefinition,
  teamOverride: Partial<TeamAgentReference>
): AgentDefinition {
  return {
    ...registryConfig,              // 全局配置作为基础
    ...(teamOverride.args && { args: teamOverride.args }),
    ...(teamOverride.endMarker && { endMarker: teamOverride.endMarker }),
    ...(teamOverride.usePty !== undefined && { usePty: teamOverride.usePty })
  };
}
```

#### 3.3.4 验证规则

加载 team 配置时：

1. **必须存在验证**：`agents[].name` 必须在全局 registry 中存在
2. **字段类型验证**：覆盖字段必须与原类型匹配
3. **command 禁止覆盖**：如果提供 `command` 字段，报错
4. **空覆盖处理**：如果只提供 `name`，使用全局配置

**错误示例：**
```json
{
  "agents": [
    {
      "name": "nonexistent"  // ❌ Error: Agent 'nonexistent' not found in registry
    },
    {
      "name": "claude",
      "command": "/custom/path"  // ❌ Error: command override not allowed
    }
  ]
}
```

#### 3.3.5 完整示例

**全局 Registry (`~/.agent-chatter/agents/config.json`):**
```json
{
  "schemaVersion": "1.1",
  "agents": {
    "claude": {
      "name": "claude",
      "command": "claude",
      "args": ["--append-system-prompt", "End with [DONE]"],
      "endMarker": "[DONE]",
      "usePty": false
    }
  }
}
```

**Team 配置（无覆盖 - `~/.agent-chatter/teams/my-team/config.json`）:**
```json
{
  "schemaVersion": "1.1",
  "agents": [
    { "name": "claude" }  // 使用全局配置的所有字段
  ]
}
```

**Team 配置（有覆盖）:**
```json
{
  "schemaVersion": "1.1",
  "agents": [
    {
      "name": "claude",
      "args": ["--append-system-prompt", "Be verbose. End with [CUSTOM]"],
      "endMarker": "[CUSTOM]"
    }
  ]
}
```

**最终生效配置：**
```json
{
  "name": "claude",
  "command": "claude",           // 从全局继承（不可覆盖）
  "args": ["--append-system-prompt", "Be verbose. End with [CUSTOM]"],  // 被覆盖
  "endMarker": "[CUSTOM]",       // 被覆盖
  "usePty": false                // 从全局继承（未覆盖）
}
```

## 4. 用户流程

### 4.1 首次启动流程

```
用户首次运行 agent-chatter
    ↓
检查 ~/.agent-chatter/agents/config.json
    ↓
    不存在或 agents 为空
    ↓
显示欢迎消息：
"Welcome to Agent Chatter!
 No agents registered yet.
 Available commands:
 - /agents register  : Register AI CLI agents
 - /help            : Show help
 - /exit            : Exit program"
    ↓
用户输入 /agents register
    ↓
自动扫描系统
    ↓
显示扫描结果（交互式选择）：
"Found the following AI CLI tools:

 Which agents would you like to register?
 Use ↑↓ to navigate, Space to toggle, Enter to confirm

 [x] Claude Code (v0.8.0) - found at /usr/local/bin/claude
 [x] OpenAI Codex (v0.58.0) - found at /Users/xxx/.nvm/.../codex
 [ ] Google Gemini (not found - will prompt for custom path)
 [ ] Custom agent (manual configuration)
"
    ↓
用户选择并确认
    ↓
如果选择了 "not found" 或 "Custom agent"
    ↓
进入手动配置流程：
"Configure Gemini:
 > Command path: /opt/gemini/bin/gemini
 > Display name (default: Google Gemini CLI): [Enter]
 > Default args (comma-separated): -p
 > End marker (default: [DONE]): [Enter]
 > Use PTY? (y/n): n

 Verifying...
 ✓ Command found and executable
 ✓ Version detected: 1.0.0
"
    ↓
用户完成所有配置
    ↓
写入 ~/.agent-chatter/agents/config.json
    ↓
显示成功消息：
"✓ Successfully registered 2 agents:
 - Claude Code
 - OpenAI Codex

 You can now create teams using /team create"
```

### 4.2 Agent 扫描策略详解

#### 4.2.1 扫描算法

对于每个 agent 类型，按以下优先级顺序扫描：

**优先级规则：**
1. **PATH 环境变量** - 最高优先级，尊重用户系统配置
2. **标准安装路径** - 按平台约定的路径查找
3. **常见开发路径** - 如 nvm、brew 等包管理器路径

**扫描流程：**
```typescript
async function scanAgent(agentType: 'claude' | 'codex' | 'gemini'): Promise<ScannedAgent | null> {
  const paths = getSearchPaths(agentType);

  for (const searchPath of paths) {
    try {
      const resolved = await resolveCommand(searchPath);
      if (resolved && await isExecutable(resolved)) {
        const version = await detectVersion(resolved);
        return {
          name: agentType,
          command: resolved,
          version,
          found: true
        };
      }
    } catch (error) {
      continue;  // 尝试下一个路径
    }
  }

  return { name: agentType, found: false };
}
```

#### 4.2.2 各 Agent 的扫描路径

**Claude Code:**
```typescript
const claudePaths = [
  'claude',  // PATH 中
  '/Applications/Claude.app/Contents/MacOS/claude',  // macOS
  '~/.local/bin/claude',  // Linux
  '%LOCALAPPDATA%\\Programs\\Claude\\claude.exe'  // Windows
];
```

**Codex:**
```typescript
const codexPaths = [
  'codex',  // PATH 中
  '~/.nvm/versions/node/*/bin/codex',  // nvm
  '/usr/local/bin/codex',  // Homebrew/标准
  '/opt/homebrew/bin/codex',  // Apple Silicon Homebrew
  '%APPDATA%\\npm\\codex.cmd'  // Windows npm
];
```

**Gemini:**
```typescript
const geminiPaths = [
  'gemini',  // PATH 中
  '~/.nvm/versions/node/*/bin/gemini',  // nvm
  '/usr/local/bin/gemini',  // Homebrew/标准
  '/opt/homebrew/bin/gemini'  // Apple Silicon Homebrew
];
```

#### 4.2.3 版本探测

对每个找到的命令执行版本探测：

```typescript
async function detectVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execAsync(`${command} --version`, {
      timeout: 3000
    });

    const output = stdout || stderr;

    // 尝试多种正则模式
    const patterns = [
      /(\d+\.\d+\.\d+)/,           // 标准 x.y.z
      /version[:\s]+(\d+\.\d+\.\d+)/i,  // "version: x.y.z"
      /v(\d+\.\d+\.\d+)/,          // "vx.y.z"
      /(\d+\.\d+)/                 // 回退到 x.y
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'unknown';
  } catch (error) {
    return undefined;
  }
}
```

#### 4.2.4 容错处理

**场景1：命令存在但返回非零退出码**
- 某些 CLI 的 `--version` 可能返回非零，但仍可用
- 策略：只要能获取到输出，就认为命令可用

**场景2：多个版本同时存在**
- 只使用找到的第一个（优先级最高的）
- 在验证阶段记录实际使用的路径

**场景3：符号链接**
- 自动解析符号链接到实际路径
- 记录实际路径供后续使用

### 4.3 手动配置说明

手动配置已整合到 `/agents register` 的主流程中（参见 4.1 节）。当用户选择未找到的 agent 或"Custom agent"选项时，程序会引导用户输入必要的配置信息。

这种设计的优点：
- ✅ 统一的用户体验，无需记忆额外的命令参数
- ✅ 自动扫描和手动配置无缝衔接
- ✅ 减少用户的决策负担

### 4.4 Agent 验证流程 ⭐ **关键功能**

#### 4.4.1 验证目标

验证 agent 的两个关键状态：
1. **命令可执行性** - CLI 工具是否可正常运行
2. **登录状态** ⚠️ **最重要** - 防止 UAT 时出现的未登录问题

#### 4.4.2 验证流程

```typescript
async function verifyAgent(agent: AgentDefinition): Promise<VerificationResult> {
  const result: VerificationResult = {
    name: agent.name,
    status: 'pending',
    checks: []
  };

  // 1. 检查命令可执行性
  result.checks.push(await checkExecutable(agent.command));

  // 2. 检查版本信息
  result.checks.push(await checkVersion(agent.command));

  // 3. 检查登录状态 ⭐
  result.checks.push(await checkAuthenticationStatus(agent));

  // 4. 执行测试命令（可选）
  if (shouldRunTestExecution(agent)) {
    result.checks.push(await testExecution(agent));
  }

  result.status = result.checks.every(c => c.passed) ? 'verified' : 'failed';
  return result;
}
```

#### 4.4.3 登录状态检查策略

为避免 UAT 问题（agent 未登录导致超时），必须验证登录状态：

**Claude Code:**
```typescript
async function checkClaudeAuth(command: string): Promise<CheckResult> {
  try {
    // 方法1：检查配置文件
    const configPath = path.join(os.homedir(), '.claude', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.apiKey || config.sessionToken) {
        return { passed: true, message: 'Authenticated (config file found)' };
      }
    }

    // 方法2：执行测试命令
    const testPrompt = "Say 'OK' and nothing else";
    const { stdout } = await execAsync(
      `echo "${testPrompt}" | ${command} --append-system-prompt "Reply only: OK"`,
      { timeout: 10000 }
    );

    if (stdout.includes('Please run /login') || stdout.includes('Invalid API key')) {
      return { passed: false, message: 'Not authenticated. Please run: claude --login' };
    }

    return { passed: true, message: 'Authenticated' };
  } catch (error) {
    return { passed: false, message: `Auth check failed: ${error.message}` };
  }
}
```

**Codex:**
```typescript
async function checkCodexAuth(command: string): Promise<CheckResult> {
  try {
    // 检查认证文件
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) {
      return { passed: false, message: 'Not authenticated. Please run: codex login' };
    }

    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    if (!auth.token || isTokenExpired(auth.expiresAt)) {
      return { passed: false, message: 'Token expired. Please run: codex login' };
    }

    return { passed: true, message: 'Authenticated' };
  } catch (error) {
    return { passed: false, message: `Auth check failed: ${error.message}` };
  }
}
```

**Gemini:**
```typescript
async function checkGeminiAuth(command: string): Promise<CheckResult> {
  try {
    // Gemini 使用 OAuth，检查凭证文件
    const credPath = path.join(os.homedir(), '.gemini', 'credentials.json');
    if (!fs.existsSync(credPath)) {
      return { passed: false, message: 'Not authenticated. Please run: gemini auth login' };
    }

    return { passed: true, message: 'Authenticated' };
  } catch (error) {
    return { passed: false, message: `Auth check failed: ${error.message}` };
  }
}
```

#### 4.4.4 验证输出示例

**成功验证：**
```
Verifying claude...
✓ Command found: /usr/local/bin/claude
✓ Version: 0.8.0
✓ Authentication: Logged in
✓ Test execution: Success

Agent 'claude' is ready to use.
```

**验证失败 - 未登录：**
```
Verifying codex...
✓ Command found: /Users/xxx/.nvm/.../codex
✓ Version: 0.58.0
✗ Authentication: Not authenticated

Error: Codex is not authenticated
Please run: codex login

Agent 'codex' cannot be used until authenticated.
```

#### 4.4.5 验证时机 ⭐

**验证执行时机：**
1. **注册时** - `/agents register` 完成后自动验证
   - 执行真实 CLI 命令
   - 验证失败则注册失败
   - 更新 `lastVerified` 时间戳
2. **手动验证** - `/agents verify` 命令
   - 用户主动触发，执行真实验证
   - 更新 `lastVerified` 时间戳
3. **启动对话前** - 加载 team 配置时
   - **执行真实验证**
   - 确保所有 agent 都处于可用状态
   - 验证失败则拒绝启动对话

**为什么每次都真实验证？**
1. ✅ **可靠性优先**：确保 agent 始终处于可工作状态
2. ✅ **避免运行时错误**：提前发现认证过期、CLI 升级等问题
3. ✅ **成本可接受**：
   - Codex/Gemini: 只检查本地文件，无网络调用
   - Claude: 执行短 prompt，成本极低（~1次请求）
4. ✅ **简化实现**：不需要维护复杂的缓存失效逻辑

#### 4.4.6 为什么必须执行真实CLI命令验证？⚠️ 产品决策

**架构委员会的疑问**：
> "验证时会执行真实 CLI 命令（甚至发送 prompt），这会消耗 API 额度并可能触发速率限制。用户是否可以跳过或降级验证？"

**产品经理决策**：
❌ **用户不可跳过真实CLI命令验证**

**理由**：
1. **程序依赖的先决条件**
   - 如果 agent CLI 不能正常工作，整个 Agent Chatter 就完全无法使用
   - 验证失败 = 程序无法运行，没有"降级使用"的可能性

2. **避免更严重的问题**
   - 如果跳过验证，用户在实际对话时才发现 agent 未登录
   - 会导致超时、卡死等更糟糕的用户体验
   - 调试成本远高于注册时验证的成本

3. **成本可接受**
   - 验证只在注册时执行一次（不是每次对话）
   - 对 Claude，测试 prompt 很短（"Say 'OK'"），消耗可忽略
   - 对 Codex/Gemini，只检查认证文件，无 API 调用

**验证策略说明**：
```typescript
// 不同 agent 的验证成本
{
  "claude": {
    "method": "执行测试命令",
    "cost": "~1 API request (极短 prompt)",
    "reason": "Claude 无配置文件，必须实际调用"
  },
  "codex": {
    "method": "检查 ~/.codex/auth.json",
    "cost": "0 API request (仅文件读取)",
    "reason": "Codex 有认证文件"
  },
  "gemini": {
    "method": "检查 ~/.gemini/credentials.json",
    "cost": "0 API request (仅文件读取)",
    "reason": "Gemini 使用 OAuth 凭证文件"
  }
}
```

**用户体验考量**：
- ✅ **提前发现问题**：注册时就知道 agent 是否可用
- ✅ **明确错误提示**：告诉用户如何解决（运行 `/login`）
- ✅ **避免运行时崩溃**：不会在对话进行中才发现问题
- ✅ **成本极低**：大部分验证只读文件，Claude 也仅 1 次短请求

#### 4.4.7 验证失败和超时处理

**验证超时处理：**
```typescript
async function verifyAgentWithTimeout(agent: AgentDefinition): Promise<VerificationResult> {
  try {
    // 每个验证步骤都有独立超时
    const executableCheck = await timeout(checkExecutable(agent.command), 3000);
    const versionCheck = await timeout(checkVersion(agent.command), 3000);
    const authCheck = await timeout(checkAuthenticationStatus(agent), 10000);

    return {
      status: 'success',
      checks: [executableCheck, versionCheck, authCheck]
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      return {
        status: 'failed',
        error: `Verification timeout: ${error.message}. Check your network connection.`
      };
    }
    return {
      status: 'failed',
      error: error.message
    };
  }
}
```

**验证失败处理（注册时）：**
```
Registering agent 'claude'...
✓ Command found: /usr/local/bin/claude
✓ Version: 0.8.0
✗ Authentication check failed: Not authenticated

Error: Agent 'claude' registration failed
─────────────────────────────────────────────
Authentication verification failed.

Please run the following command to log in:
  claude --login

Then try registering again:
  /agents register
```

**验证失败处理（启动对话前）：**
```typescript
async function checkAgentsBeforeConversation(teamConfig: TeamConfig): Promise<void> {
  const registry = await loadRegistry();
  const requiredAgents = teamConfig.agents.map(a => a.name);

  for (const agentName of requiredAgents) {
    const agent = registry.agents[agentName];

    // 检查 1: Agent 是否存在
    if (!agent) {
      throw new Error(
        `Agent '${agentName}' not found in registry.\n` +
        `Please register it first: /agents register`
      );
    }

    // 检查 2: 执行真实验证
    const verifyResult = await verifyAgent(agent);
    if (verifyResult.status === 'failed') {
      throw new Error(
        `Agent '${agentName}' verification failed.\n` +
        `Error: ${verifyResult.error}\n` +
        `Please fix the issue and try again.`
      );
    }
  }
}
```

**总结：**
| 场景 | 是否执行真实验证 | 说明 |
|------|-----------------|------|
| 注册 agent | ✅ 是 | 验证失败则注册失败 |
| 手动 verify | ✅ 是 | 用户主动触发 |
| 启动对话前 | ✅ 是 | 验证失败则拒绝启动 |

**注意：** 不提供跳过验证的环境变量。验证是程序正常运行的前提条件，不可绕过。

## 5. CLI 命令设计

### 5.1 /agents 菜单

```
/agents                     # 显示 agents 菜单
/agents list                # 列出已注册的 agents
/agents register            # 注册新 agents（交互式：自动扫描 + 手动配置）
/agents edit [name]         # 编辑 agent 配置（可选参数：不带参数则交互式选择）
/agents delete [name]       # 删除 agent（可选参数：不带参数则交互式选择）
/agents verify [name]       # 验证 agent 是否可用（可选参数：不带参数则验证全部）
/agents info [name]         # 显示 agent 详细信息（可选参数：不带参数则交互式选择）
```

**命令参数说明：**
- 带 `[name]` 的命令支持两种模式：
  - **快速模式**：`/agents delete claude` - 直接操作指定 agent
  - **交互模式**：`/agents delete` - 显示列表让用户选择

### 5.2 状态机复用 ⭐

所有 `/agents` 命令复用现有 Ink REPL 的状态机组件，确保交互体验一致：

#### 5.2.1 组件映射

| 命令 | 流程步骤 | 使用的组件 |
|------|---------|-----------|
| `/agents register` | 1. 显示扫描结果（多选） | `SelectView` (multiSelect) |
|  | 2. 手动输入配置 | `FormView` |
| `/agents edit` | 1. 选择要编辑的 agent | `SelectView` |
|  | 2. 选择要编辑的字段 | `MenuView` |
|  | 3. 输入新值 | `FormView` |
| `/agents delete` | 1. 选择要删除的 agent | `SelectView` |
|  | 2. 确认删除 | `ConfirmView` |
| `/agents info` | 1. 选择要查看的 agent | `SelectView` |
|  | 2. 显示详情 | `InfoView` (新增) |

#### 5.2.2 非交互模式（命令行）

当从命令行运行（非 REPL 模式）时：
```bash
# 交互模式不可用，必须提供参数
agent-chatter agents list
agent-chatter agents delete claude  # 需要确认
agent-chatter agents verify
```

#### 5.2.3 实现一致性

**关键原则：**
1. 所有交互流程与 `/team` 命令保持一致
2. 快捷键统一（↑↓ 导航，Space 切换，Enter 确认，Esc 取消）
3. 错误处理和提示信息风格统一
4. 颜色主题和 UI 布局统一

### 5.3 命令示例

**列出已注册的 agents:**
```
$ /agents list

Registered Agents (2):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Name      Display Name      Version    Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 claude    Claude Code       0.8.0      ✓ Available
 codex     OpenAI Codex      0.58.0     ✓ Available
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use '/agents info <name>' for details
```

**验证 agent（带参数 - 快速模式）:**
```
$ /agents verify claude

Verifying claude...
✓ Command found: /usr/local/bin/claude
✓ Version: 0.8.0
✓ Authentication: Logged in as user@example.com
✓ Test execution: Success

Agent 'claude' is ready to use.
```

**验证 agent（不带参数 - 验证全部）:**
```
$ /agents verify

Verifying all registered agents...

claude (Claude Code)
  ✓ Command found: /usr/local/bin/claude
  ✓ Version: 0.8.0
  ✓ Ready to use

codex (OpenAI Codex)
  ✓ Command found: /Users/xxx/.nvm/.../codex
  ✓ Version: 0.58.0
  ✓ Ready to use

All agents verified successfully.
```

**删除 agent（不带参数 - 交互式选择）:**
```
$ /agents delete

Select agent to delete:
Use ↑↓ to navigate, Enter to confirm, Esc to cancel

❯ claude - Claude Code (v0.8.0)
  codex - OpenAI Codex (v0.58.0)
  gemini - Google Gemini CLI (v1.0.0)

[User selects 'gemini' and presses Enter]

Are you sure you want to delete 'gemini'? (y/n): y

✓ Agent 'gemini' has been removed from registry
```

**编辑 agent（不带参数 - 交互式选择）:**
```
$ /agents edit

Select agent to edit:
❯ claude - Claude Code (v0.8.0)
  codex - OpenAI Codex (v0.58.0)

[User selects 'codex']

Editing agent: codex
Current configuration:
  Display Name: OpenAI Codex
  Command: codex
  Args: ["exec", "--json", "--full-auto"]
  End Marker: [DONE]

What would you like to edit?
❯ 1. Display name
  2. Command path
  3. Arguments
  4. End marker
  5. Cancel

[User selects '3. Arguments']

Current args: ["exec", "--json", "--full-auto"]
New args (comma-separated): exec, --json, --full-auto, --skip-git-repo-check

✓ Updated codex configuration
```

**查看 agent 详情（交互式选择）:**
```
$ /agents info

Select agent to view:
❯ claude - Claude Code (v0.8.0)
  codex - OpenAI Codex (v0.58.0)

[User selects 'claude']

Agent: claude (Claude Code)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Command:      claude
Version:      0.8.0
Arguments:    --append-system-prompt "Always end..."
End Marker:   [DONE]
Use PTY:      No
Registered:   2024-11-18 10:30:00
Last Verified: 2024-11-18 14:25:00
Status:       ✓ Available

Use '/agents edit claude' to modify configuration
```

## 6. 实现计划

### 6.1 核心模块

**新增文件：**

```
src/
├── registry/
│   ├── AgentRegistry.ts         # Agent registry 管理类
│   ├── AgentScanner.ts          # 自动扫描 agents
│   ├── AgentValidator.ts        # 验证 agent 可用性
│   └── RegistryStorage.ts       # 读写 ~/.agent-chatter/agents/config.json
│
├── cli/
│   └── AgentCommands.ts         # /agents 命令实现
│
└── utils/
    └── AgentDefaults.ts         # 各 agent 的默认配置模板
```

**修改文件：**

```
src/cli.ts                       # 添加 /agents 命令
src/repl/ReplModeInk.tsx        # 添加 /agents 菜单项
src/utils/ConversationStarter.ts # 支持从 registry 加载 agents
```

### 6.2 AgentRegistry 类设计

```typescript
export class AgentRegistry {
  private registryPath: string;
  private agents: Map<string, AgentDefinition>;

  constructor(registryPath?: string) {
    this.registryPath = registryPath ||
      path.join(os.homedir(), '.agent-chatter', 'agents', 'config.json');
    this.agents = new Map();
  }

  // 加载 registry
  async load(): Promise<void>;

  // 保存 registry
  async save(): Promise<void>;

  // 注册 agent
  async register(agent: AgentDefinition): Promise<void>;

  // 获取 agent
  get(name: string): AgentDefinition | undefined;

  // 列出所有 agents
  list(): AgentDefinition[];

  // 删除 agent
  async delete(name: string): Promise<void>;

  // 更新 agent
  async update(name: string, updates: Partial<AgentDefinition>): Promise<void>;

  // 验证 agent 是否可用
  async verify(name: string): Promise<VerificationResult>;

  // 检查 registry 是否为空
  isEmpty(): boolean;
}
```

### 6.3 AgentScanner 类设计

```typescript
export class AgentScanner {
  // 扫描所有支持的 agents
  async scanAll(): Promise<ScannedAgent[]>;

  // 扫描特定 agent
  async scan(agentType: 'claude' | 'codex' | 'gemini'): Promise<ScannedAgent | null>;

  // 验证指定路径的命令
  async validateCommand(command: string): Promise<ValidationResult>;

  // 获取默认配置模板
  getDefaultConfig(agentType: string): AgentDefinition;
}

interface ScannedAgent {
  name: string;
  displayName: string;
  command: string;
  version?: string;
  found: boolean;
}
```

### 6.4 实现步骤

**Phase 1: 核心基础设施（2-3 天）**
1. 实现 `AgentRegistry` 类
2. 实现 `RegistryStorage` - 读写 `~/.agent-chatter/agents/config.json`
3. 实现 `AgentDefaults` - 各 agent 的默认配置
4. 单元测试

**Phase 2: 扫描和验证（2-3 天）**
1. 实现 `AgentScanner` - 自动扫描系统
2. 实现 `AgentValidator` - 验证 agent 可用性
3. 整合手动配置到注册主流程
4. 单元测试

**Phase 3: CLI 命令（2-3 天）**
1. 实现 `/agents` 命令集
2. 交互式注册流程（自动扫描 + 手动配置）
3. 交互式选择功能（edit, delete, info）
4. 快速模式支持（带参数直接操作）
5. 集成测试

**Phase 4: REPL 集成（1-2 天）**
1. 修改 REPL 菜单，添加 `/agents` 选项
2. 首次启动检测和引导
3. 用户体验优化

**Phase 5: Team 配置支持（1-2 天）**
1. 修改 `ConversationStarter` 支持：
   - 从全局 registry 加载和合并 agent 配置
   - 使用启动 cwd 作为所有 member 的 cwd
   - 从 member.instructionFile 加载指令
2. 更新 `/team create` 支持全局目录：
   - Team 配置生成到 `~/.agent-chatter/teams/{name}/config.json`
   - 不再在当前项目目录创建 teams/ 文件夹
3. 更新所有示例配置文件为新格式（schema 1.1）
4. 文档和示例更新

**Phase 6: 测试和文档（1-2 天）**
1. 端到端测试
2. 更新 README
3. 编写用户指南

## 7. 向后兼容和配置迁移

### 7.1 破坏性变更声明

本次修改**不考虑向后兼容**，原因：
- 当前无现网用户
- 配置格式需要根本性重构
- 全局 agent registry 是核心架构变更

### 7.2 SchemaVersion 升级

```json
{
  "schemaVersion": "1.1",  // 从 1.0 升级到 1.1
  "agents": [ ... ]
}
```

程序加载配置时的版本检查：
```typescript
if (config.schemaVersion === "1.0") {
  throw new Error(
    `Unsupported configuration format (schema 1.0).\n` +
    `Please update your configuration to schema 1.1.\n` +
    `See migration guide: https://github.com/.../migration-guide.md`
  );
}
```

### 7.3 迁移指导

对于已有配置文件的用户（仅限开发团队内部）：

**步骤 1：注册 agents 到全局 registry**
```bash
agent-chatter agents register
```

**步骤 2：更新 team 配置文件**

旧格式 (schema 1.0)：
```json
{
  "schemaVersion": "1.0",
  "agents": [
    {
      "name": "claude",
      "command": "claude",
      "args": ["--append-system-prompt", "..."],
      "endMarker": "[DONE]",
      "usePty": false
    }
  ],
  "team": {
    "name": "my-team",
    "members": [
      {
        "displayName": "Claude Reviewer",
        "name": "claude-reviewer",
        "type": "ai",
        "agentType": "claude",
        "roleDir": "./teams/my-team/reviewer/claude-reviewer",
        // workDir 字段已移除，cwd 取决于启动目录
        "instructionFile": "./teams/my-team/reviewer/claude-reviewer/AGENTS.md"
      }
    ]
  }
}
```

新格式 (schema 1.1) - **迁移到全局目录**：
```json
{
  "schemaVersion": "1.1",
  "agents": [
    {
      "name": "claude"  // 最简形式，使用全局配置
    }
  ],
  "team": {
    "name": "my-team",
    // workDir 字段已删除，cwd 由启动目录决定
    "roleDefinitions": [...],
    "members": [
      {
        "displayName": "Claude Reviewer",
        "displayRole": "Reviewer",
        "name": "claude-reviewer",
        "type": "ai",
        "role": "reviewer",
        "agentType": "claude",
        "themeColor": "cyan",
        "roleDir": "~/.agent-chatter/teams/my-team/reviewer/claude-reviewer",
        "instructionFile": "~/.agent-chatter/teams/my-team/reviewer/claude-reviewer/AGENTS.md"
        // ❌ 移除 workDir 字段（统一使用 team.workDir）
      }
    ]
  }
}
```

**关键变更**：
1. ✅ agents 数组改为对象数组，只需 name 字段引用全局 registry
2. ✅ 添加 team.workDir 对象
3. ✅ member.workDir 字段删除
4. ✅ member.instructionFile **保留**（仍然需要）
5. ✅ 所有路径迁移到 `~/.agent-chatter/teams/` 下

**步骤 3：验证配置**
```bash
agent-chatter agents verify
```

### 7.4 错误提示和引导

**检测到旧格式时：**
```
Error: Incompatible configuration format
─────────────────────────────────────────
Your configuration uses schema 1.0, which is no longer supported.

Changes in schema 1.1:
1. Agents must be registered globally in ~/.agent-chatter/agents/config.json
2. Team configs reference agents by name with optional overrides
3. Team-level workDir replaces member-level workDir

Migration steps:
1. Run: agent-chatter agents register
2. Update your team config (see migration guide)
3. Set team.workDir for your project

Documentation:
https://github.com/.../docs/migration-guide.md
```

### 7.5 README 和 CHANGELOG 更新

**README.md 需要添加：**
```markdown
## Breaking Changes in v1.1

⚠️ **Important**: Version 1.1 introduces breaking changes to the configuration format.

If you have existing configurations from v1.0, please follow the [Migration Guide](docs/migration-guide.md).

### What Changed
- Agents are now registered globally in `~/.agent-chatter/agents/config.json`
- Team configurations reference agents by name
- Unified `workDir` at team level (replaces member-level `workDir`)
```

**CHANGELOG.md 需要添加：**
```markdown
## [1.1.0] - 2024-11-XX

### Breaking Changes
- **[BREAKING]** Configuration schema upgraded from 1.0 to 1.1
- **[BREAKING]** Agents must be registered globally before use
- **[BREAKING]** Team config `workDir` moved from member to team level
- **[BREAKING]** Agent inline definitions no longer supported

### Added
- Global agent registry system
- `/agents` command suite for agent management
- Auto-scan and registration workflow
- Agent authentication verification
- Team-level workDir configuration

### Migration
See [Migration Guide](docs/migration-guide.md) for upgrading from v1.0
```

## 8. 错误处理

### 8.1 首次启动时没有 agents

```
Error: No agents registered
─────────────────────────────────
Agent Chatter requires at least one AI CLI agent to function.

Please register agents using:
  /agents register

Or learn more:
  /help agents
```

### 8.2 Team 配置引用不存在的 agent

```
Error loading team configuration: team-config.json
─────────────────────────────────
Agent 'gemini' not found in registry

The team configuration references agent 'gemini',
but it is not registered in ~/.agent-chatter/agents/config.json

Solutions:
1. Register gemini: /agents register
2. Edit team config to use a different agent
3. Remove gemini from agents array
```

### 8.3 Agent 不可用

```
Warning: Agent 'codex' verification failed
─────────────────────────────────
Command: codex
Error: Command not found in PATH

The agent is registered but cannot be executed.
Please ensure:
1. Codex CLI is properly installed
2. The command path is correct: /agents edit codex
3. The command is in your PATH

To remove this agent: /agents delete codex
```

## 9. 安全考虑

### 9.1 权限

- `~/.agent-chatter/agents/config.json` 权限：`0600` (仅用户可读写)
- 验证命令路径，防止路径注入
- 不执行未验证的命令

### 9.2 命令验证

注册 agent 时：
1. 检查命令是否存在
2. 尝试执行 `--version` 或 `--help`
3. 验证响应格式
4. 确认是预期的 CLI 工具

## 10. 未来扩展

### 10.1 Agent 插件系统

支持第三方 agents：

```json
{
  "name": "custom-ai",
  "type": "plugin",
  "plugin": {
    "package": "@custom/ai-agent",
    "version": "^1.0.0",
    "config": { ... }
  }
}
```

### 10.2 云端 Agent Registry

支持从云端同步 agent 配置：

```bash
agent-chatter agents sync --from cloud
agent-chatter agents push --to cloud
```

### 10.3 Agent 版本管理

跟踪和管理 agent 版本：

```bash
agent-chatter agents upgrade claude
agent-chatter agents version claude 0.9.0
```

## 11. 成功指标

1. **首次启动体验**：新用户在 2 分钟内完成 agent 注册
2. **配置复用**：减少 80% 的重复配置工作
3. **错误率**：减少 90% 的配置错误
4. **用户满意度**：用户调研评分 > 4.5/5

## 12. 附录

### 12.1 默认 Agent 配置模板

**Claude Code:**
```json
{
  "name": "claude",
  "displayName": "Claude Code",
  "command": "claude",
  "args": [
    "--append-system-prompt",
    "Always end your response with [DONE] on a new line. Keep responses concise."
  ],
  "endMarker": "[DONE]",
  "usePty": false
}
```

**OpenAI Codex:**
```json
{
  "name": "codex",
  "displayName": "OpenAI Codex",
  "command": "codex",
  "args": ["exec", "--json", "--full-auto", "--skip-git-repo-check"],
  "endMarker": "[DONE]",
  "usePty": false
}
```

**Google Gemini:**
```json
{
  "name": "gemini",
  "displayName": "Google Gemini CLI",
  "command": "gemini",
  "args": ["-p"],
  "endMarker": "[DONE]",
  "usePty": false
}
```

### 12.2 文件系统布局

```
~/.agent-chatter/
├── agents/
│   └── config.json          # Agent registry
├── config.json              # 程序配置（预留）
├── logs/                    # 日志目录（预留）
└── cache/                   # 缓存目录（预留）

~/.agent-chatter/
├── teams/
│   ├── {team-name-1}/
│   │   ├── config.json      # Team 配置文件
│   │   ├── team_instruction.md
│   │   └── ...
│   └── {team-name-2}/
│       ├── config.json      # Team 配置文件
│       └── ...
└── ...
```

## 13. 测试计划 ⭐

### 13.1 需要更新的现有测试

#### 13.1.1 Sample Config Integration Tests
**文件**: `tests/integration/sampleConfigs.integration.test.ts`

**需要更新：**
- 更新所有示例配置文件为 schema 1.1 格式
- agents 数组改为对象数组（带可选覆盖）
- 添加 team.workDir 验证
- 移除 member.workDir 验证

**新增测试用例：**
```typescript
it('validates agent overrides in team config', () => {
  const config = loadConfig('team-with-overrides.json');
  expect(config.agents[0].name).toBe('claude');
  expect(config.agents[0].args).toBeDefined();  // 覆盖字段
});

it('validates team.workDir structure', () => {
  const config = loadConfig('team-config.json');
  expect(config.team.workDir).toMatchObject({
    name: expect.any(String),
    displayName: expect.any(String),
    directory: expect.any(String)
  });
});
```

#### 13.1.2 ConversationStarter Tests
**文件**: `tests/integration/conversationStarter.integration.test.ts`

**需要更新：**
- Mock AgentRegistry 加载
- 测试 agent 配置合并逻辑
- 测试从全局 registry 解析 agents

**新增测试用例：**
```typescript
it('merges team overrides with registry config', async () => {
  // Setup: Registry has base config, team overrides args
  mockRegistry.set('claude', { name: 'claude', args: ['--base'] });
  const team = {
    agents: [{ name: 'claude', args: ['--override'] }]
  };

  const result = await loadTeamAgents(team);
  expect(result[0].args).toEqual(['--override']);  // 覆盖成功
});

it('throws error when agent not in registry', async () => {
  const team = { agents: [{ name: 'nonexistent' }] };

  await expect(loadTeamAgents(team))
    .rejects.toThrow('Agent \'nonexistent\' not found in registry');
});
```

### 13.2 新增单元测试

#### 13.2.1 AgentRegistry Tests
**文件**: `tests/unit/registry/AgentRegistry.test.ts` (新增)

**测试覆盖：**
```typescript
describe('AgentRegistry', () => {
  it('loads registry from file');
  it('saves registry to file');
  it('registers new agent');
  it('gets agent by name');
  it('lists all agents');
  it('deletes agent');
  it('updates agent configuration');
  it('checks if registry is empty');
  it('throws error when getting nonexistent agent');
});
```

#### 13.2.2 AgentScanner Tests
**文件**: `tests/unit/registry/AgentScanner.test.ts` (新增)

**测试覆盖：**
```typescript
describe('AgentScanner', () => {
  it('scans all agents');
  it('prioritizes PATH over standard paths');
  it('detects version correctly');
  it('handles multiple version formats');
  it('resolves symlinks');
  it('handles command not found');
  it('times out on slow commands');
});
```

#### 13.2.3 AgentValidator Tests
**文件**: `tests/unit/registry/AgentValidator.test.ts` (新增)

**测试覆盖：**
```typescript
describe('AgentValidator', () => {
  describe('Authentication checks', () => {
    it('validates Claude authentication');
    it('validates Codex authentication');
    it('validates Gemini authentication');
    it('detects expired tokens');
    it('handles missing config files');
  });

  describe('Executable checks', () => {
    it('verifies command exists');
    it('verifies command is executable');
    it('handles permission errors');
  });
});
```

#### 13.2.4 Config Merge Tests
**文件**: `tests/unit/utils/ConfigMerger.test.ts` (新增)

**测试覆盖：**
```typescript
describe('Agent Config Merging', () => {
  it('uses registry config when no override');
  it('overrides args field');
  it('overrides endMarker field');
  it('overrides usePty field');
  it('prevents command override');
  it('validates override types');
});
```

### 13.3 新增集成测试

#### 13.3.1 /agents Command Tests
**文件**: `tests/integration/agentsCommands.integration.test.ts` (新增)

**测试场景：**
```typescript
describe('/agents CLI commands', () => {
  it('registers agent through interactive flow');
  it('lists all registered agents');
  it('edits agent configuration');
  it('deletes agent with confirmation');
  it('verifies agent authentication');
  it('handles agent not found errors');
});
```

#### 13.3.2 End-to-End Flow Test
**文件**: `tests/e2e/firstTimeUser.e2e.test.ts` (新增)

**测试完整流程：**
```typescript
describe('First-time user flow', () => {
  it('completes full workflow', async () => {
    // 1. Start program (no agents)
    // 2. Run /agents register
    // 3. Select agents from scan
    // 4. Verify registration
    // 5. Create team config
    // 6. Start conversation
    // 7. Verify agent works
  });
});
```

### 13.4 REPL 交互测试

#### 13.4.1 State Machine Tests
**文件**: `tests/integration/agentsREPL.integration.test.ts` (新增)

**测试覆盖：**
- SelectView 交互（多选 agents）
- FormView 交互（手动配置）
- MenuView 交互（选择编辑字段）
- 快捷键响应
- 错误处理和提示

### 13.5 文档和示例更新

#### 13.5.1 README 更新
- 添加 Agent Registry 概念说明
- 更新快速开始指南
- 添加迁移指南链接
- 更新配置示例

#### 13.5.2 示例配置文件更新
需要更新的文件：
- `agent-chatter-config.json`
- `codex-test-config.json`
- `codex-test-config-windows.json`
- `multi-agent-config.json`
- `examples/multi-role-demo-config.json`

#### 13.5.3 设计文档更新
- `design/team-configuration.md` - 更新 workDir 说明
- 新增 `docs/migration-guide.md` - 迁移指南
- 新增 `docs/agent-registry.md` - Agent Registry 用户文档

### 13.6 测试环境准备

**Mock 工具：**
- Mock AgentRegistry 读写
- Mock CLI 命令执行
- Mock 文件系统操作
- Mock 认证检查

**测试数据：**
- 创建测试用的 registry 文件
- 创建多种格式的 team 配置
- 准备认证测试数据

### 13.7 测试优先级

**P0 (必须):**
1. AgentRegistry CRUD 操作
2. Agent 配置合并逻辑
3. Authentication 验证
4. Schema 版本检查
5. 基础 /agents 命令

**P1 (重要):**
1. Agent 扫描算法
2. REPL 交互流程
3. 错误处理
4. 配置迁移验证

**P2 (可选):**
1. 性能测试
2. 边界条件
3. 用户体验测试

---

## 14. 架构委员会评审后的关键决策 ⭐

### 14.1 产品经理决策汇总

针对架构委员会提出的关键问题，产品经理做出以下明确决策：

#### 决策 1: Schema 版本升级
- ✅ **Team 配置 schemaVersion 升级到 1.1**
- ✅ **Registry 有独立的 schemaVersion（也是 1.1）**
- ✅ **两者独立演进**

#### 决策 2: Per-Member WorkDir 设为可选字段（折中方案）
- ✅ **member.workDir 作为可选字段保留**
- ✅ **默认所有 member 共享 team.workDir（推荐99%场景）**
- ✅ **特殊场景可以为 member 设置专属 workDir**
- ⚠️ **不考虑向后兼容**（当前无现网用户）

**决策过程**：
1. **产品经理初始决策**：完全删除 member.workDir
2. **架构委员会反对**：提出4个需要独立 workDir 的场景
3. **最终决策**：移除 member.workDir / team.workDir
   - 运行时 cwd = 启动目录（或未来沙箱入口）
   - 切换项目 = 在目标目录执行 `agent-chatter`
   - 配置文件不再包含 workDir 字段

#### 决策 4: member.instructionFile 字段保留
- ✅ **member.instructionFile 必须保留**
- ❌ **不能删除**（之前的设计文档误删了）

**说明**：
- 删除的应该只是 member.workDir
- instructionFile 是每个 member 的角色定义文件，必须保留
- 典型值：`~/.agent-chatter/teams/{name}/{role}/{member}/AGENTS.md`

#### 决策 5: /team create 行为调整
- ✅ **/team create 生成配置到 `~/.agent-chatter/teams/`**
- ❌ **不再在当前项目目录创建 teams/ 文件夹**
- ✅ **与 Team-Project 解耦理念一致**

#### 决策 6: 必须执行真实 CLI 验证
- ❌ **用户不可跳过真实 CLI 命令验证**
- ✅ **这是程序运行的先决条件**

**理由**：
1. Agent CLI 不可用 = 程序完全无法工作
2. 没有"降级使用"的可能性
3. 提前验证避免运行时更严重的问题
4. 成本极低（Codex/Gemini 只读文件，Claude 仅 1 次短请求）

### 14.2 设计文档修正摘要

基于以上决策和架构委员会第二轮反馈，设计文档进行了以下修正：

**第一轮修正（响应产品经理决策）：**
1. **所有 schemaVersion 从 "1.0" 改为 "1.1"**
2. **Registry 添加独立的 schemaVersion 字段**
3. **恢复所有 member 配置中的 instructionFile 字段**
4. **添加 Section 2.4 详细说明 Team-Project 解耦理念**
5. **添加 Section 4.4.6 说明为什么必须执行真实验证**
6. **更新 Section 7.3 迁移示例，包含完整字段**
7. **更新 Phase 5 实现计划，/team create 行为调整**

**第二轮修正（响应架构委员会反馈）：**
8. **添加 Section 3.2 完整的 Team 配置结构**
   - 3.2.1: TeamWorkDir 接口定义
   - 3.2.2: RoleDefinition 接口定义
   - 3.2.3: TeamMember 接口定义（包含可选的 workDir）
   - 3.2.4: 完整 JSON 配置示例（包含 roleDefinitions）
   - 3.2.5: 文件系统布局（/team create 生成的目录结构）

9. **member.workDir 改为可选字段**
   - 推荐99%情况不填（使用 team.workDir）
   - 特殊场景可以覆盖
   - 决策过程详细记录在 Section 14.1

10. **简化验证机制为"每次真实验证"**
   - ❌ **删除验证缓存机制**（产品经理决策）
   - ✅ 注册时真实验证，验证失败则注册失败
   - ✅ 启动对话前真实验证，验证失败则拒绝启动
   - ✅ 不提供跳过验证的环境变量（验证是前提条件）
   - ✅ 保留 lastVerified 时间戳（仅用于记录，不用于判断）
   - 4.4.5: 明确所有场景都执行真实验证
   - 4.4.7: 简化为验证失败和超时处理

11. **统一 workDir 的运行时行为**
   - 2.4.3: 添加 getMemberWorkDir() 函数
   - 明确优先级：member.workDir > team.workDir
   - 解决了描述与实现的冲突

**第三轮修正（响应架构委员会第三轮反馈）：**
12. **删除验证缓存机制，改为每次真实验证**（产品经理决策）
   - ❌ 删除 lastVerifyStatus, lastVerifyError 字段
   - ❌ 删除所有缓存检查逻辑
   - ❌ 删除离线环境/CI 环境的缓存方案
   - ❌ 删除环境变量跳过选项
   - ✅ 所有场景都执行真实验证（注册时、启动对话前）
   - ✅ 验证失败直接报错，不可绕过
   - ✅ 保留 lastVerified 时间戳（仅用于记录）
   - 4.4.5: 重写为"验证时机"（无缓存）
   - 4.4.7: 简化为"验证失败和超时处理"

13. **统一 workDir 描述与运行时行为**
   - 2.4.2: 修正措辞，明确"默认共享，可选覆盖"
   - 2.4.3: 添加 getMemberWorkDir() 实现逻辑
   - 解决"描述说放弃但代码定义了可选字段"的冲突

---

## 15. 设计改进摘要（第一轮产品经理评审后）

本设计在第一轮产品经理审阅后进行了以下改进：

### 15.1 交互体验优化

1. **统一的注册流程**
   - 移除独立的 `--custom` 选项
   - 将手动配置整合到主注册流程中
   - 用户无需记忆额外的命令参数

2. **交互式列表选择**
   - 所有管理命令支持可选参数模式
   - 快速模式：`/agents delete claude` （直接操作）
   - 交互模式：`/agents delete` （列表选择）
   - 避免拼写错误，提升易用性

### 13.2 架构决策

1. **不考虑向后兼容**
   - 简化实现复杂度
   - 统一配置格式
   - 旧配置需手动迁移

2. **明确的路径规范**
   - 全局 registry: `~/.agent-chatter/agents/config.json`
   - Team 配置: `teams/{team-name}/config.json`
   - 清晰的配置层次结构

### 13.3 用户体验提升

**改进前的问题：**
- 需要记忆 `--custom` 参数
- 需要手动输入 agent 名称（易错）
- 自动扫描和手动配置流程割裂

**改进后的优势：**
- ✅ 流程统一，学习曲线平缓
- ✅ 交互式选择，操作直观
- ✅ 支持快捷操作，兼顾效率
- ✅ 减少用户决策负担

---

**文档版本**: 4.0
**创建日期**: 2024-11-18
**最后更新**: 2024-11-18（架构委员会第三轮评审后修订）
**作者**: Claude Code
**审阅**: Product Manager (两轮) + Architecture Committee (三轮)
**状态**: ✅ 已通过架构委员会第三轮评审，等待开发实施

**评审历史**：
- v1.0: 初版，提交产品经理评审
- v2.0: 响应产品经理反馈，提交架构委员会第一轮评审
- v3.0: 响应架构委员会反馈，member.workDir改为可选 + 完善验证机制细节
- v4.0: 响应架构委员会第三轮反馈，删除验证缓存 + 统一workDir运行时行为
