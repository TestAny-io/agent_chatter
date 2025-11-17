# Claude Code多角色技术规范

## 架构师问题详细解答

基于Claude Code官方文档和实际机制，详细回答多角色agent实现的技术问题。

---

## 1. 系统指令/记忆机制

### System Prompt配置方式

**三种方式**（按优先级从低到高）：

#### 方式A：CLAUDE.md文件（推荐用于项目配置）

**分层加载机制**：
```
~/.claude/CLAUDE.md          # 全局配置（所有项目默认）
  ↓
/project/CLAUDE.md           # 项目配置（覆盖全局）
  ↓
/project/CLAUDE.local.md     # 本地配置（gitignore，个人定制）
```

**查找规则**：
1. Claude Code启动时，从当前工作目录向上查找CLAUDE.md
2. 找到项目根CLAUDE.md后，合并全局~/.claude/CLAUDE.md
3. CLAUDE.local.md最后加载，优先级最高

**示例CLAUDE.md**：
```markdown
# Role: Security Reviewer

You are Alice, a security code reviewer. Focus ONLY on:
- SQL injection vulnerabilities
- XSS attack vectors
- Authentication and authorization issues
- Input validation
- Cryptographic weaknesses

Always identify yourself as Alice.
End all responses with [DONE]

## Team Context

@team_instruction.md

## Coding Standards

@standards/security.md
```

**模块化语法**：
- `@filename.md` - 引用其他文件
- 支持相对路径和绝对路径
- 在context window中展开为完整内容

#### 方式B：命令行参数（启动时一次性注入）

```bash
# 1. 追加到默认system prompt（推荐）
claude --append-system-prompt "You are Alice, a security reviewer. End with [DONE]"

# 2. 完全替换system prompt（移除所有Claude Code默认功能）
claude --system-prompt "You are Alice..."

# 3. 从文件加载
claude --system-prompt-file /path/to/alice-prompt.txt
```

**关键约束**：
- ⚠️ **只在进程启动时生效，无法运行时修改**
- ⚠️ `--system-prompt`会移除所有默认功能（工具调用、文件操作等），慎用
- ✅ `--append-system-prompt`是最安全的选择

#### 方式C：settings.json（全局或项目级）

**位置**：
- 全局：`~/.claude/settings.json`
- 项目：`/project/.claude/settings.json`

**示例**：
```json
{
  "systemPrompt": "You are Alice, a security reviewer.",
  "model": "sonnet",
  "dangerMode": false
}
```

### 能否在运行中切换角色？

**答案：❌ 不能**

**原因**：
1. System prompt是进程启动时的配置参数
2. Claude Code维护持久化的会话状态（对话历史）
3. `/clear`只清除对话历史，不重置system prompt
4. 唯一方法是**终止进程并重启**（等同于启动新进程）

**结论**：必须为每个角色启动独立进程。

---

## 2. 目录/上下文加载

### CLAUDE.md - Claude的分层指令文件

**完全对应**：
- Codex: `AGENTS.md`
- Gemini: `GEMINI.md`
- Claude Code: `CLAUDE.md`

### 查找路径规则

**启动时的加载顺序**：

```
1. 全局配置
   ~/.claude/CLAUDE.md

2. 从当前目录向上查找项目根
   /path/to/project/CLAUDE.md
   /path/to/CLAUDE.md
   /path/CLAUDE.md
   ... (直到找到或到达文件系统根)

3. 本地覆盖
   /project/CLAUDE.local.md

4. 合并到context window
```

**示例目录结构**：
```
/Team_A/
  CLAUDE.md                    # 团队级指令（可选）
  team_instruction.md          # 团队规范
  /Alice/
    CLAUDE.md                  # Alice的角色指令
    work/                      # Alice的工作目录
      → /real/business/path    # 符号链接到真实资料
  /Bob/
    CLAUDE.md                  # Bob的角色指令
    work/
      → /another/path
```

**Alice的CLAUDE.md**：
```markdown
# Role: Security Reviewer - Alice

I am Alice, a security code reviewer.

## Team Standards
@../team_instruction.md

## My Focus Areas
- SQL injection
- XSS vulnerabilities
- Authentication flaws
```

**工作流程**：
```bash
# 启动Alice
cd /Team_A/Alice/work
claude

# Claude Code加载：
# 1. ~/.claude/CLAUDE.md (全局)
# 2. /Team_A/Alice/CLAUDE.md (检测到并加载)
# 3. 展开 @../team_instruction.md (团队规范)
```

### @引用语法的强大之处

**模块化组织**：
```markdown
# CLAUDE.md
@team/standards.md
@team/glossary.md
@role/security-focus.md
@personal/preferences.md
```

**自动展开**：
- 所有@引用的文件内容在启动时展开到context window
- 相对路径相对于CLAUDE.md所在目录
- 可以跨目录引用（如`@../team_instruction.md`）

---

## 3. 配置/缓存路径

### 默认路径

**配置目录**：
```
~/.claude/
  ├── CLAUDE.md          # 全局指令
  ├── settings.json      # 全局设置
  ├── auth.json          # 认证信息
  └── sessions/          # 会话历史
```

**缓存目录**：
```
~/.claude/cache/         # 模型缓存
~/.claude/logs/          # 日志文件
```

### 自定义配置目录

#### 环境变量：CLAUDE_CONFIG_DIR

**用途**：指定Claude Code的配置根目录

```bash
# 为Alice设置独立配置目录
CLAUDE_CONFIG_DIR=/Team_A/Alice/home claude
```

**⚠️ 已知问题**（GitHub Issue #3833）：
- 即使设置了`CLAUDE_CONFIG_DIR`，Claude Code仍会在工作目录创建`.claude/`
- 官方文档未明确说明此变量的完整行为
- **不推荐依赖此变量进行隔离**

#### 更可靠的隔离方案

**方案1：修改HOME环境变量**（推荐）

```bash
# Alice的启动脚本
HOME=/Team_A/Alice/home claude

# 这会让Claude Code使用：
# /Team_A/Alice/home/.claude/
# /Team_A/Alice/home/.claude/sessions/
# /Team_A/Alice/home/.claude/logs/
```

**优势**：
- ✅ 完全隔离配置、缓存、日志
- ✅ 不依赖未文档化的环境变量
- ✅ 符合Unix标准做法

**方案2：Git Worktrees**（官方推荐）

```bash
# 为每个角色创建独立的worktree
git worktree add /Team_A/Alice main-alice
git worktree add /Team_A/Bob main-bob

# 每个worktree有独立的：
# - .claude/ 目录
# - git分支
# - 工作文件
```

**优势**：
- ✅ Anthropic官方推荐
- ✅ Git原生支持
- ✅ 每个角色有独立的代码分支
- ⚠️ 需要Git仓库

### 多进程并发时的隔离

**关键发现**（基于社区工具）：

**隔离层级**：
1. **进程级隔离**：每个进程有独立的内存和上下文
2. **文件系统隔离**：
   - 通过不同的`HOME`或`cwd`
   - 或通过Git worktrees
3. **会话ID隔离**：
   - 社区工具（如claude-session-manager）使用会话ID
   - 每个会话有独立的历史文件

**示例**：
```typescript
// Agent Chatter的实现策略
interface ProcessConfig {
  roleId: string;
  workingDir: string;    // /Team_A/Alice
  homeDir: string;       // /Team_A/Alice/home
  cwd: string;           // /Team_A/Alice/work
}

function spawnClaudeProcess(config: ProcessConfig): ChildProcess {
  return spawn('claude', [], {
    cwd: config.cwd,
    env: {
      ...process.env,
      HOME: config.homeDir,  // 隔离配置目录
      // CLAUDE_CONFIG_DIR: config.homeDir + '/.claude'  // 可选，但不可靠
    }
  });
}
```

---

## 4. 环境变量支持

### 核心环境变量

| 变量名 | 用途 | 可靠性 | 说明 |
|--------|------|--------|------|
| `ANTHROPIC_API_KEY` | API认证 | ✅ 高 | 必需，用于Claude API调用 |
| `HOME` | 配置目录 | ✅ 高 | Claude使用`$HOME/.claude/` |
| `CLAUDE_CONFIG_DIR` | 配置根目录 | ⚠️ 中 | 未完整文档化，有已知bug |
| `HTTPS_PROXY` | 代理设置 | ✅ 高 | 企业环境常用 |
| `CLAUDE_CODE_USE_BEDROCK` | AWS Bedrock | ✅ 高 | 企业云服务 |

### 推荐的环境变量策略

**为每个角色设置独立环境**：

```bash
# Alice的启动脚本 (/Team_A/Alice/start.sh)
#!/bin/bash
export HOME=/Team_A/Alice/home
export ANTHROPIC_API_KEY="sk-ant-..."  # 可选，或从全局继承
cd /Team_A/Alice/work
claude
```

**或在Node.js中**：
```typescript
spawn('claude', [], {
  cwd: '/Team_A/Alice/work',
  env: {
    HOME: '/Team_A/Alice/home',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    PATH: process.env.PATH
  }
});
```

### settings.json中的环境变量

**项目级配置**：`/Team_A/Alice/.claude/settings.json`

```json
{
  "environmentVariables": {
    "CUSTOM_VAR": "alice-specific-value"
  },
  "model": "sonnet",
  "systemPrompt": "You are Alice..."
}
```

**优势**：
- 自动加载，无需手动export
- 适合团队共享配置
- 版本控制友好

---

## 5. 最佳实践

### 官方推荐：Git Worktrees + CLAUDE.md

**适用场景**：需要Git版本控制的项目

**目录布局**：
```
/Team_A_Repo/
  .git/
  worktrees/
    alice/              # git worktree for Alice
      CLAUDE.md         # Alice's role instruction
      .claude/          # Alice's session data
      src/              # Source code (alice's branch)
    bob/                # git worktree for Bob
      CLAUDE.md
      .claude/
      src/              # Source code (bob's branch)
```

**启动方式**：
```bash
# Terminal 1: Alice
cd /Team_A_Repo/worktrees/alice
claude

# Terminal 2: Bob
cd /Team_A_Repo/worktrees/bob
claude

# 完全隔离：
# - 不同的CLAUDE.md
# - 不同的.claude/sessions/
# - 不同的git分支
# - 不同的context window
```

### Agent Chatter推荐：HOME隔离 + CLAUDE.md

**适用场景**：非Git团队（市场、PMO、财务等）

**目录布局**：
```
/Team_A/
  team_instruction.md        # 团队规范
  /Alice/
    home/                    # HOME目录（隔离配置）
      .claude/
        CLAUDE.md            # 也可以放这里作为全局配置
        settings.json
        sessions/
        logs/
    CLAUDE.md                # Alice的角色指令（推荐）
    work/                    # 工作目录
      → /real/path           # 符号链接到真实资料
  /Bob/
    home/
      .claude/
    CLAUDE.md
    work/
      → /another/path
```

**Alice的CLAUDE.md**：
```markdown
# Alice - Security Reviewer

I am Alice, a security code reviewer for Team A.

## Team Context
@../team_instruction.md

## Focus Areas
- SQL injection
- XSS vulnerabilities
- Authentication issues

## Output Format
Always end responses with [DONE]
```

**启动脚本**（`/Team_A/Alice/start.sh`）：
```bash
#!/bin/bash
# Alice的启动入口

# 设置隔离的HOME
export HOME=/Team_A/Alice/home

# 进入工作目录（会自动加载当前目录的CLAUDE.md）
cd /Team_A/Alice/work

# 启动Claude Code
echo "Starting Alice (Security Reviewer)..."
claude
```

**AgentManager实现**：
```typescript
class AgentManager {
  async startClaudeRole(roleConfig: {
    roleId: string;
    roleDir: string;      // /Team_A/Alice
    workDir: string;      // /Team_A/Alice/work
    claudeMd: string;     // /Team_A/Alice/CLAUDE.md
  }): Promise<ChildProcess> {

    const homeDir = path.join(roleConfig.roleDir, 'home');

    // 确保home/.claude/目录存在
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true });

    // 可选：复制CLAUDE.md到home/.claude/作为全局配置
    // 或者依赖工作目录的CLAUDE.md

    const process = spawn('claude', [], {
      cwd: roleConfig.workDir,
      env: {
        ...process.env,
        HOME: homeDir,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    console.log(`Started Claude for role ${roleConfig.roleId}`);
    console.log(`  HOME: ${homeDir}`);
    console.log(`  CWD: ${roleConfig.workDir}`);
    console.log(`  CLAUDE.md: ${roleConfig.claudeMd}`);

    return process;
  }
}
```

### 社区工具启发

**ccswitch**（会话切换工具）：
- 通过会话ID隔离
- 每个会话独立的历史文件
- 可学习其会话管理机制

**GitButler**（Git分支管理）：
- 每个Claude会话对应一个Git分支
- 自动commit每轮对话
- 适合代码协作场景

**crystal**（多会话管理）：
- 自动创建worktrees
- 管理多个Claude实例
- 提供状态监控

**启发**：Agent Chatter可以借鉴这些工具的：
- 会话ID机制
- 自动化目录管理
- 状态监控和切换

---

## 对比：Claude vs Codex vs Gemini

| 特性 | Claude Code | Codex | Gemini CLI |
|------|-------------|-------|------------|
| **指令文件** | CLAUDE.md | AGENTS.md | GEMINI.md |
| **分层加载** | ✅ 全局+项目 | ✅ 全局+项目 | ✅ 多层级 |
| **模块化引用** | ✅ @语法 | ❓ 待确认 | ❓ 待确认 |
| **配置目录** | ~/.claude/ | ~/.codex/ | ~/.gemini/ |
| **自定义HOME** | ✅ 可靠 | ✅ CODEX_HOME | ✅ 可靠 |
| **环境变量** | HOME, CLAUDE_CONFIG_DIR | CODEX_HOME | HOME, GEMINI_* |
| **多实例支持** | ✅ Git worktrees | ✅ 不同CODEX_HOME | ✅ 不同HOME |
| **官方推荐** | Git worktrees | 不同CODEX_HOME | ❓ 待确认 |

**统一方案可行性**：✅ 高度可行

**关键统一点**：
1. 所有CLI都支持指令文件（*.md）
2. 所有CLI都可以通过环境变量隔离
3. 所有CLI都需要独立进程per角色

---

## Agent Chatter的统一实现方案

### Team Configuration Schema扩展

**添加角色目录配置**：

```json
{
  "roles": [
    {
      "title": "Alice - Security",
      "name": "alice",
      "type": "ai",
      "role": "SecurityReviewer",
      "agentName": "claude",
      "systemInstruction": "You are Alice...",

      // 新增字段
      "roleDir": "/Team_A/Alice",           // 角色入口目录
      "workDir": "/Team_A/Alice/work",      // 工作目录（可为符号链接）
      "homeDir": "/Team_A/Alice/home",      // HOME目录（隔离配置）
      "instructionFile": "/Team_A/Alice/CLAUDE.md"  // 指令文件路径
    }
  ]
}
```

### AgentManager统一启动逻辑

```typescript
class AgentManager {
  async startAgent(
    agentType: 'claude' | 'codex' | 'gemini',
    roleConfig: RoleConfig
  ): Promise<ChildProcess> {

    const env: Record<string, string> = {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || ''
    };

    // 根据不同CLI设置环境变量
    switch (agentType) {
      case 'claude':
        env.HOME = roleConfig.homeDir;
        // env.CLAUDE_CONFIG_DIR = roleConfig.homeDir + '/.claude';  // 可选
        break;

      case 'codex':
        env.CODEX_HOME = roleConfig.homeDir + '/.codex';
        break;

      case 'gemini':
        env.HOME = roleConfig.homeDir;
        // env.GEMINI_CONFIG_HOME = roleConfig.homeDir + '/.gemini';  // 如果支持
        break;
    }

    const process = spawn(agentType, [], {
      cwd: roleConfig.workDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return process;
  }
}
```

### 用户文档示例

**创建团队和角色**：

```bash
# 1. 创建团队目录
mkdir -p /Team_A/{Alice,Bob}/work
mkdir -p /Team_A/{Alice,Bob}/home

# 2. 创建团队规范
cat > /Team_A/team_instruction.md << 'EOF'
# Team A - Code Review Standards

## Team Goals
Ensure code quality, security, and performance.

## Review Process
1. Security review by Alice
2. Performance review by Bob
3. Human approval
EOF

# 3. 创建Alice的角色指令
cat > /Team_A/Alice/CLAUDE.md << 'EOF'
# Alice - Security Reviewer

I am Alice, a security code reviewer.

## Team Context
@../team_instruction.md

## My Responsibilities
- Review code for security vulnerabilities
- Focus on: SQL injection, XSS, auth issues
- End all responses with [DONE]
EOF

# 4. 创建启动脚本
cat > /Team_A/Alice/start.sh << 'EOF'
#!/bin/bash
export HOME=/Team_A/Alice/home
cd /Team_A/Alice/work
claude
EOF
chmod +x /Team_A/Alice/start.sh

# 5. 创建符号链接到真实资料
ln -s /real/business/path /Team_A/Alice/work/project

# 6. 启动Alice
/Team_A/Alice/start.sh
```

---

## 验证清单（V7-V9：Claude专用）

| 编号 | 项目 | 验证要点 |
|------|------|----------|
| V7 | Claude多角色 | 不同HOME目录下并发运行，确保.claude/sessions/和logs/分离 |
| V8 | Claude Team目录 | Team根team_instruction.md + 子目录CLAUDE.md组合，@引用正确展开 |
| V9 | Claude.md分层 | 全局~/.claude/CLAUDE.md + 项目CLAUDE.md + CLAUDE.local.md加载顺序正确 |

**V7详细测试**：
```bash
# Terminal 1: Alice
HOME=/Team_A/Alice/home claude

# Terminal 2: Bob
HOME=/Team_A/Bob/home claude

# 验证隔离：
ls /Team_A/Alice/home/.claude/sessions/  # 应只有Alice的历史
ls /Team_A/Bob/home/.claude/sessions/    # 应只有Bob的历史
```

**V8详细测试**：
```bash
# 在Alice的CLAUDE.md中
# @../team_instruction.md

# 启动后，在Claude对话中询问：
# "What are the team standards you should follow?"

# 预期：Claude应该能回答team_instruction.md中的内容
```

---

## 总结：Claude Code完全支持多角色架构

### ✅ 与Codex/Gemini方案一致

| 能力 | Claude Code |
|------|-------------|
| 指令文件 | ✅ CLAUDE.md |
| 分层加载 | ✅ 全局+项目+本地 |
| 模块化引用 | ✅ @语法 |
| 环境变量隔离 | ✅ HOME |
| 多进程并发 | ✅ 官方推荐Git worktrees |
| 独立配置 | ✅ $HOME/.claude/ |
| 统一方案 | ✅ 完全兼容 |

### 推荐实现路径

**Phase 1：核心隔离**
- 使用HOME环境变量隔离配置
- 每个角色独立的CLAUDE.md
- AgentManager管理进程生命周期

**Phase 2：团队协作**
- team_instruction.md团队规范
- CLAUDE.md中@引用团队文件
- 符号链接到真实工作资料

**Phase 3：用户体验**
- 一键启动脚本（start.sh）
- 可视化角色切换
- 自动化目录初始化

**下一步**：执行V7-V9验证，确认Claude Code的具体行为细节。

---

**文档版本**: v1.0
**创建日期**: 2025-11-16
**作者**: Claude Code (作为自己回答关于自己的问题😊)
**状态**: 待验证
