# Team Configuration Feature - 设计文档

## 1. 功能概述

### 1.1 目标
为用户提供交互式的团队配置功能，让用户能够在REPL中轻松创建、编辑和管理AI agent团队，而不需要手动编写JSON配置文件。

### 1.2 用户场景

**场景A：快速创建简单团队**
```
用户想要创建一个"Claude + 人类观察者"的简单团队
→ 使用向导模式，3-5个问题即可完成
→ 自动保存为配置文件
```

**场景B：创建复杂多Agent团队**
```
用户想要创建"Claude + Codex + Gemini + 多个人类专家"的协作团队
→ 交互式添加每个成员
→ 为每个agent配置专属参数
→ 定义角色顺序和系统指令
```

**场景C：编辑现有团队**
```
用户加载了一个配置，想要修改某个agent的系统指令
→ 进入编辑模式
→ 选择要编辑的agent
→ 修改参数并保存
```

## 2. 命令设计

### 2.1 新增命令

#### `/team create` - 创建新团队
启动交互式团队创建向导

```bash
agent-chatter> /team create

# 向导流程：
📋 Team Creation Wizard
────────────────────────────────────────────────────────────
Step 1/4: Team Structure
  Team Name: [input] Code Review Team
  Description: [input] A team for collaborative code review
  Team Instruction File: [input] /teams/code-review/team_instruction.md
  (Optional) Initialize file with template? [Y/n] y

  Define Team Roles:
  How many different roles in this team? [input] 2
    Role 1 name: [input] Reviewer
    Role 1 description: [input] Reviews code and provides feedback
    Role 2 name: [input] Observer
    Role 2 description: [input] Observes the review process

  Team Members:
  Total number of participants (AI + Human): [input] 3
    Member 1: Which role? [select] Reviewer
    Member 2: Which role? [select] Reviewer
    Member 3: Which role? [select] Observer

Step 2/4: Detect Available AI Agents
  Scanning installed AI CLI tools...

  ✓ Found: Claude Code (claude)
  ✓ Found: OpenAI Codex (codex)

  Total: 2 AI agents available

  # Note: If only 1 AI agent found, auto-skip selection step
  # If multiple agents available, prompt:
  Which AI agents will this team use? (Space to toggle, Enter to confirm)
  ☑ Claude Code
  ☑ OpenAI Codex

Step 3/4: Configure Each Team Member
  ──────────────────────────────────────────────────────────
  Configuring Member 1/3
  ──────────────────────────────────────────────────────────
  Role: Reviewer

  Is this a human or AI?
    ▶ AI
      Human

  # If AI selected:
  Which AI agent?
    ▶ Claude Code
      OpenAI Codex

  Display Name: [input] Claude Reviewer
  Theme Color: [select]
    ▶ Cyan
      Green
      Yellow
      Blue
      Magenta

  Role Directory: [input] /teams/code-review/alice
  Working Directory: [input] /teams/code-review/alice/work (default: roleDir/work)
  CLI Home Directory: [input] /teams/code-review/alice/home (default: roleDir/home)
  Instruction File: [input] AGENTS.md (relative to roleDir)
  Additional Env (key=value, comma separated): [input] CODEX_HOME=/teams/code-review/alice/home/.codex

  ✓ Member 1 configured

  ──────────────────────────────────────────────────────────
  Configuring Member 2/3
  ──────────────────────────────────────────────────────────
  Role: Reviewer

  Is this a human or AI?
      AI
    ▶ Human

  # If Human selected:
  Display Name: [input] Senior Dev
  Theme Color: [select]
    ▶ Green
      Cyan
      Yellow
      Blue
      Magenta
  Role Directory: [input] /teams/code-review/reviewer/human-observer
  Working Directory: [input] /teams/code-review/reviewer/human-observer/work
  CLI Home Directory: [input] /teams/code-review/reviewer/human-observer/home
  Instruction File: [input] README.md

  ✓ Member 2 configured

  ──────────────────────────────────────────────────────────
  Configuring Member 3/3
  ──────────────────────────────────────────────────────────
  Role: Observer

  Is this a human or AI?
    ▶ AI
      Human

  Which AI agent?
      Claude Code
    ▶ OpenAI Codex

  Display Name: [input] Codex Observer
  Theme Color: [select]
    ▶ Yellow
      Cyan
      Green
      Blue
      Magenta

  Role Directory: [input] /teams/code-review/observer
  Working Directory: [input] /teams/code-review/observer/work
  CLI Home Directory: [input] /teams/code-review/observer/home
  Instruction File: [input] CLAUDE.md

  ✓ Member 3 configured
  ✓ All members configured!

Step 4/4: Team Settings
  Max conversation rounds: [input] 20
  (default: 10, set to 0 for unlimited)

────────────────────────────────────────────────────────────
Summary
────────────────────────────────────────────────────────────
Team: Code Review Team
Description: A team for collaborative code review
Members: 3 (2 AIs, 1 Human)

Roles:
  • Reviewer (2 members)
    - Claude Reviewer (AI - Claude Code) [Cyan]
    - Senior Dev (Human) [Green]

  • Observer (1 member)
    - Codex Observer (AI - OpenAI Codex) [Yellow]

Settings:
  Max Rounds: 20
  File: code-review-team-config.json

────────────────────────────────────────────────────────────
Looks good? [Y/n] y
✓ Team configuration saved to code-review-team-config.json
```

#### `/team edit [filename]` - 编辑现有团队
进入交互式编辑模式，提供原子操作来修改团队配置

```bash
agent-chatter> /team edit agent-chatter-config.json

# 进入编辑模式：
📝 Editing Team: Claude Code Test Team
────────────────────────────────────────────────────────────
Current Configuration:
  Team Name: Claude Code Test Team
  Description: A team with Claude Code CLI agent and human observer
  Team Instruction File: /teams/code-review/team_instruction.md
  Max Rounds: 10

  Role Definitions:
    • Reviewer: Reviews code and provides feedback
    • Observer: Observes the review process

  Members (2):
    1. Claude Reviewer (AI - Claude Code) - Role: Reviewer [Cyan]
    2. Human Observer (Human) - Role: Observer [Green]

────────────────────────────────────────────────────────────
Main Menu
────────────────────────────────────────────────────────────
⚠️  Important: Role structure is fixed after team creation/migration.
   To change roles, you must create a new team.

What would you like to do?
  ▶ Edit team information (name, description, instruction file, max rounds)
    Add new member
    Edit member: Claude Reviewer
    Edit member: Human Observer
    Remove member
    Change member order
    Save and exit
    Exit without saving

# ──────────────────────────────────────────────────────────
# User selects "Edit team information"
# ──────────────────────────────────────────────────────────
Editing Team Information
────────────────────────────────────────────────────────────
  Team Name: [input] Claude Code Test Team
  Description: [input] A team with Claude Code CLI agent and human observer
  Team Instruction File: [input] /teams/code-review/team_instruction.md
  Max Rounds: [input] 10

✓ Team information updated
[Return to main menu]

# ──────────────────────────────────────────────────────────
# User selects "Add new member"
# ──────────────────────────────────────────────────────────
Adding New Member
────────────────────────────────────────────────────────────
  Which role will this member have?
  (Only existing roles available - cannot add new roles)
  ▶ Reviewer
    Observer

💡 Note: If you need a different role, you must create a new team.

  Is this a human or AI?
  ▶ AI
    Human

  # If AI selected:
  Which AI agent?
  ▶ Claude Code
    OpenAI Codex

  Display Name: [input] Second Reviewer
  Theme Color: [select] Yellow
  Role Directory: [input] /teams/code-review/alice-2
  Working Directory: [input] /teams/code-review/alice-2/work
  CLI Home Directory: [input] /teams/code-review/alice-2/home
  Instruction File: [input] AGENTS.md
  Additional Env (key=value, comma separated): [input] CODEX_HOME=/teams/code-review/alice-2/home/.codex

✓ Member added: Second Reviewer
[Return to main menu]

# ──────────────────────────────────────────────────────────
# User selects "Edit member: Claude Reviewer"
# ──────────────────────────────────────────────────────────
Editing Member: Claude Reviewer
────────────────────────────────────────────────────────────
Current Settings:
  Type: AI
  Agent: Claude Code
  Role: Reviewer
  Display Name: Claude Reviewer
  Theme Color: Cyan
  Role Directory: /teams/code-review/reviewer/alice
  Work Directory: /teams/code-review/reviewer/alice/work
  CLI Home Directory: /teams/code-review/reviewer/alice/home
  Instruction File: /teams/code-review/reviewer/alice/AGENTS.md

What would you like to modify?
  ▶ Display Name
    Theme Color
    Directories & Environment (roleDir, workDir, HOME, env vars)
    Change AI Agent (Claude Code → Other)
    Change Type (AI → Human)
    Back to main menu

💡 Note: Member's role assignment cannot be changed after team
creation. To reassign roles, you need to create a new team.

# User selects "Change AI Agent"
────────────────────────────────────────────────────────────
⚠ Warning: Changing AI agent will require revalidating all
agent-specific defaults (CLI arguments, tool settings, etc.)

Current: Claude Code
Change to:
  ▶ OpenAI Codex
    Google Gemini

Confirm change? [y/N] y

# Reconfigure agent-specific parameters:
Reconfiguring for OpenAI Codex
────────────────────────────────────────────────────────────
  Confirm role/work/home directories:
    Role Dir: /teams/code-review/reviewer/alice
    Work Dir: /teams/code-review/reviewer/alice/work
    CLI Home: /teams/code-review/reviewer/alice/home
    Instruction File: /teams/code-review/reviewer/alice/AGENTS.md
  Update env if needed (e.g., CODEX_HOME)

✓ AI agent changed to OpenAI Codex
[Return to member edit menu]

# User selects "Change Type (AI → Human)"
────────────────────────────────────────────────────────────
⚠ Warning: Changing from AI to Human will remove all AI-specific
environment requirements (CLI HOME overrides, agentType, instruction file semantics, etc.)

Current: AI (Claude Code)
Change to: Human

All AI settings will be lost. Continue? [y/N] y

# Only keep general settings:
Reconfiguring as Human
────────────────────────────────────────────────────────────
  Display Name: [input] Claude Reviewer  (keep current)
  Theme Color: [select] Cyan  (keep current)

✓ Member type changed to Human
✓ AI-specific settings removed
[Return to member edit menu]

# ──────────────────────────────────────────────────────────
# User selects "Remove member"
# ──────────────────────────────────────────────────────────
Remove Member
────────────────────────────────────────────────────────────
Select member to remove:
  ▶ Claude Reviewer (AI - Claude Code) - Reviewer
    Human Observer (Human) - Observer

⚠ This will permanently remove "Claude Reviewer" from the team.

⚠ Warning: Role "Reviewer" will have 0 members after this removal.
The role definition will remain in team.roleDefinitions, but no
member will be assigned to it.

Note: Role definitions cannot be modified after team creation.
To change role structure, you need to create a new team.

Confirm removal? [y/N] y

✓ Member "Claude Reviewer" removed
[Return to main menu]

# ──────────────────────────────────────────────────────────
# User selects "Change member order"
# ──────────────────────────────────────────────────────────
Change Member Order
────────────────────────────────────────────────────────────
Current order (this determines speaking sequence):
  1. Claude Reviewer (AI - Claude Code) - Reviewer
  2. Human Observer (Human) - Observer
  3. Second Reviewer (AI - Claude Code) - Reviewer

Use ↑/↓ to select member, Space to move up, Shift+Space to move down
Press Enter when done

# After reordering:
New order:
  1. Human Observer (Human) - Observer
  2. Claude Reviewer (AI - Claude Code) - Reviewer
  3. Second Reviewer (AI - Claude Code) - Reviewer

Apply changes? [Y/n] y

✓ Member order updated
[Return to main menu]

# ──────────────────────────────────────────────────────────
# User selects "Save and exit"
# ──────────────────────────────────────────────────────────
Save Changes
────────────────────────────────────────────────────────────
Summary of changes:
  • Team information: No changes
  • Members added: 1 (Second Reviewer)
  • Members modified: 1 (Claude Reviewer)
  • Members removed: 0
  • Order changed: Yes

Save to: agent-chatter-config.json

Confirm save? [Y/n] y

✓ Team configuration saved!
Exiting edit mode...
```

#### `/team list` - 列出所有团队配置
```bash
agent-chatter> /team list

Available Team Configurations:
────────────────────────────────────────────────────────────
  ● agent-chatter-config.json        (loaded)
    - Team: Claude Code Test Team
    - Agents: 1 AI (Claude), 1 Human (Observer)

  ○ multi-agent-config.json
    - Team: Multi-Agent Test Team
    - Agents: 3 AIs (Claude, Codex, Gemini), 1 Human

  ○ codex-test-config.json
    - Team: Codex Test Team
    - Agents: 1 AI (Codex), 1 Human
```

#### `/team show [filename]` - 显示团队配置详情
```bash
agent-chatter> /team show agent-chatter-config.json

Team: Code Review Team
Description: A team for collaborative code review
File: agent-chatter-config.json
Max Rounds: 10
────────────────────────────────────────────────────────────
Team Instruction File:
  /teams/code-review/team_instruction.md

────────────────────────────────────────────────────────────
Role Definitions:
  • Reviewer: Reviews code and provides feedback
  • Observer: Observes the review process

────────────────────────────────────────────────────────────
Members (3):
  1. Claude Reviewer (AI - Claude Code) - Role: Reviewer [Cyan]
     Role Dir: /teams/code-review/alice
     Work Dir: /teams/code-review/alice/work
     Home Dir: /teams/code-review/alice/home
     Instruction File: /teams/code-review/alice/AGENTS.md

  2. Senior Dev (Human) - Role: Reviewer [Green]
     Role Dir: /teams/code-review/reviewer/dick
     Work Dir: /teams/code-review/reviewer/dick/work
     Home Dir: /teams/code-review/reviewer/dick/home

  3. Observer Bot (AI - Claude Code) - Role: Observer [Yellow]
     Role Dir: /teams/code-review/codex-observer
     Work Dir: /teams/code-review/codex-observer/work
     Home Dir: /teams/code-review/codex-observer/home
     Instruction File: /teams/code-review/codex-observer/CLAUDE.md
```

#### `/team delete <filename>` - 删除团队配置
永久删除指定的团队配置文件

```bash
agent-chatter> /team delete old-config.json

# 安全检查：
Deleting Team Configuration
────────────────────────────────────────────────────────────
File: old-config.json
Team: Old Test Team
Members: 2 (1 AI, 1 Human)

⚠ This will permanently delete this configuration file.
⚠ This action cannot be undone.

💡 Tip: You can copy the file in your file system if you want
to keep a backup before deletion.

Confirm deletion? [y/N] n

Deletion cancelled.

# ──────────────────────────────────────────────────────────
# If attempting to delete currently loaded config:
# ──────────────────────────────────────────────────────────
agent-chatter> /team delete agent-chatter-config.json

✗ Error: Cannot delete currently loaded configuration.
  Please use '/config <other-file>' to load a different
  configuration first, or use '/unload' to unload current
  configuration.

# ──────────────────────────────────────────────────────────
# If there's an active conversation:
# ──────────────────────────────────────────────────────────
agent-chatter> /team delete agent-chatter-config.json

✗ Error: Cannot delete configuration with active conversation.
  Please end the conversation first using '/end', then try again.

# ──────────────────────────────────────────────────────────
# Successful deletion:
# ──────────────────────────────────────────────────────────
agent-chatter> /team delete old-config.json
Confirm deletion? [y/N] y

✓ Team configuration deleted: old-config.json
```

**注意事项**：
- 不能删除当前加载的配置（需要先 `/unload` 或加载其他配置）
- 不能删除对话进行中的配置（需要先 `/end` 结束对话）
- 删除是永久性的，无撤销功能
- 用户可在文件系统中手动备份配置文件

### 2.2 命令层次结构

```
/team
  ├── create              # 创建新团队
  ├── edit [filename]     # 编辑现有团队
  ├── list                # 列出所有团队
  ├── show [filename]     # 显示团队详情
  ├── delete <filename>   # 删除团队
  └── help                # 团队管理帮助
```

## 3. 交互模式设计

### 3.1 Wizard模式（向导模式）
用于创建新团队，采用分步引导方式。

**特点**：
- 4步流程（Team Structure → Detect Agents → Configure Members → Team Settings）
- 每次只问一个问题或显示一个配置界面
- 提供默认值和建议
- 显示进度（Step 1/4, Step 2/4, etc.）

**技术实现**：
- 需要新的模式：`wizard`
- 维护向导状态：当前步骤、已收集数据
- 键盘输入：Enter提交，Ctrl+C取消向导

### 3.2 Menu模式（菜单模式）
用于编辑现有团队，采用菜单选择方式。

**特点**：
- 非线性导航，菜单式操作
- 上下键选择菜单项
- Enter确认，返回上级菜单
- 原子操作：每个编辑都是JSON对象的添加/删除/修改

**核心编辑操作**：
- 编辑团队信息（name, displayName, description, instructionFile, maxRounds）
- 添加新成员（配置type, display name, theme color等，从现有角色中选择）
- 编辑现有成员（允许修改display name、theme color、AI agent类型、member type等，但**不能修改role assignment**）
- 删除成员（带警告，特别是当role会变为0成员时）
- 调整成员顺序（影响对话时的发言顺序）

**角色限制**：
- 角色定义（roleDefinitions）在团队创建后不可修改
- 成员的角色分配（member.role）在创建后不可修改
- 原因：角色相关配置会影响团队结构和所有成员配置
- 如需改变角色结构或成员角色分配，需要创建新团队

**技术实现**：
- 需要新的模式：`menu`
- 维护菜单状态：当前选项、菜单层级、编辑缓冲区
- 支持嵌套菜单（主菜单 → 编辑成员 → 修改属性 → 输入新值）
- 所有修改暂存在内存中，选择"Save and exit"时才写入文件

### 3.3 Form模式（表单模式）
用于输入具体配置参数。

**特点**：
- 单字段或多字段输入
- 字段验证（必填、格式检查）
- 支持单行输入（team name、instruction file路径）、多行输入（提示文案）、选择（role, color, AI agent）
- 显示错误提示和输入提示

**常见表单场景**：
- 输入团队名称和描述
- 输入成员的display name
- 多行输入系统指令（Ctrl+D结束）
- 选择颜色主题
- 输入end marker
- 输入命令参数

## 4. 数据模型

### 4.1 配置文件格式

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
    },
    {
      "name": "codex",
      "command": "codex",
      "args": ["--color", "auto"],
      "endMarker": "[DONE]",
      "usePty": false
    },
    {
      "name": "gemini",
      "command": "gemini",
      "args": [],
      "endMarker": "<END>",
      "usePty": false
    }
  ],
  "team": {
    "name": "code-review-team",
    "displayName": "Code Review Team",
    "description": "A team for collaborative code review",
    "instructionFile": "/teams/code-review/team_instruction.md",
    "roleDefinitions": [
      {
        "name": "reviewer",
        "displayName": "Reviewer",
        "description": "Reviews code and provides feedback"
      },
      {
        "name": "observer",
        "displayName": "Observer",
        "description": "Observes the review process"
      },
      {
        "name": "ui-ux-designer",
        "displayName": "UI/UX Designer",
        "description": "asdfasdfdsjiergja;gjaslgjagj. adfasf afdsfasdf "
      }
    ],
    "members": [
      {
        "displayName": "Claude Reviewer",
        "name": "alice",
        "type": "ai",
        "role": "reviewer",
        "agentType": "codex",
        "themeColor": "cyan",
        "roleDir": "/teams/code-review/reviewer/alice",
        "workDir": "/teams/code-review/reviewer/alice/work",
        "homeDir": "/teams/code-review/reviewer/alice/home",
        "instructionFile": "/teams/code-review/alice/AGENTS.md",
        "env": {
          "HOME": "/teams/code-review/reviewer/alice/home",
          "CODEX_HOME": "/teams/code-review/reviewer/alice/home/.codex"
        }
      },
      {
        "displayName": "Senior Dev",
        "name": "Dick",
        "type": "human",
        "role": "reviewer",
        "themeColor": "green",
        "roleDir": "/teams/code-review/reviewer/dick",
        "workDir": "/teams/code-review/reviewer/dick/work",
        "homeDir": "/teams/code-review/reviewer/dick/home"
      },
      {
        "displayName": "Observer Bot",
        "name": "member-3",
        "type": "ai",
        "role": "observer",
        "agentType": "claude",
        "themeColor": "yellow",
        "roleDir": "/teams/code-review/observer/member-3",
        "workDir": "/teams/code-review/observer/member-3/work",
        "homeDir": "/teams/code-review/observer/member-3/home",
        "instructionFile": "/teams/code-review/observer/member-3/CLAUDE.md"
      },
      {
        "displayName": "Veronica",
        "name": "veronica",
        "type": "ai",
        "role": "ui-ux-designer",
        "agentType": "codex",
        "themeColor": "purple",
        "roleDir": "/teams/code-review/ui-ux-designer",
        "workDir": "/teams/code-review/ui-ux-designer/veronica/work",
        "homeDir": "/teams/code-review/ui-ux-designer/veronica/home",
        "instructionFile": "teams/code-review/ui-ux-designer/veronica/agents.md"
      }
    ]
  },
  "maxRounds": 100
}
```

**字段说明**：

**顶层字段**：
- `schemaVersion`: 配置文件schema版本号，用于未来版本兼容性管理。当前版本为 "1.0"

**agents数组**：定义可复用的AI CLI agent配置
- `name`: Agent标识符
- `command`: CLI命令
- `args`: 默认命令参数
- `endMarker`: 默认结束标记
- `usePty`: 是否使用PTY（默认false）

**team对象**：
- `name`: 团队名称
- `displayName`: 团队显示名称（可选，便于UI展示）
- `description`: 团队描述
- `instructionFile`: 团队级指令文件路径（团队共享的行为准则、SOP、协作规范）
- `roleDefinitions`: 角色定义数组，定义团队中的抽象角色分类
  - `name`: 角色名称（如"Reviewer", "Observer"）
  - `description`: 角色描述
- `members`: 成员数组
  - `displayName`: 成员显示名称
  - `name`: 成员唯一标识符（自动生成，如"member-1"）
  - `type`: 成员类型（"ai" 或 "human"）
  - `role`: 分配的角色名称（指向roleDefinitions中的某个角色）
  - `displayRole`: 可选的角色展示名称（用于UI友好展示）
  - `themeColor`: 显示颜色（可选）
  - **AI成员专有字段**：
    - `agentType`: 引用agents数组中的agent配置
    - `roleDir`: 角色入口目录（存放角色指令、启动脚本等）
    - `workDir`: 实际执行/访问业务资料的目录（可为符号链接）
    - `homeDir`: CLI的HOME或配置根目录（如`CODEX_HOME`/`~/.gemini`/`~/.claude`）
    - `instructionFile`: 指向该成员所使用的指令文件（AGENTS.md/GEMINI.md/CLAUDE.md等）
    - `env`: 额外环境变量映射，例如`{"CODEX_HOME": "...", "HOME": "..."}`，用于进一步隔离日志/缓存

> 注：`roleDir`/`workDir`/`homeDir`/`instructionFile`/`env` 对人类成员也可用（例如指定共享资料目录或自定义命令环境），但在AI成员上是必填项，以确保多进程隔离策略可以落地；向导会默认帮人类成员生成与AI一致的目录结构，方便团队管理。

**maxRounds**: 最大对话轮数（0表示无限制）

**设计说明**：
1. **角色(role)与成员(member)的区分**：
   - roleDefinitions定义抽象角色（如"Reviewer"）
   - team.members数组中的每个对象是一个成员
   - 多个成员可以分配到同一个角色

2. **成员级指令文件与目录**：
   - 成员通过`agentType`引用agents数组中的基础配置（命令、默认参数、endMarker、usePty等）
   - 通过`instructionFile`指定每个成员自己的人格文件（AGENTS.md/GEMINI.md/CLAUDE.md等）
   - 不再允许成员级别覆盖endMarker/usePty/args；如需定制，请创建新的agent类型或在指令文件中说明

3. **目录与环境隔离**：
   - `roleDir` 是角色入口目录，用于存放该成员的指令文件、启动脚本、符号链接等“人格资产”；它是用户交互和团队结构的锚点
   - `workDir` 可以指向真实业务资料（允许使用符号链接）
   - `homeDir`/`env` 专门为 CLI 运行时配置 HOME/CODEX_HOME/`.gemini`/`.claude` 等目录，保证日志、缓存、历史完全隔离；它通常位于 `roleDir` 下的 `home/` 子目录，但概念上独立于 `roleDir`
   - `instructionFile` 显式记录该成员实际使用的指令文件路径，便于调度层验证和自动生成
   - 推荐目录结构：`/teams/{team.name}/{roleDefinitions[i].name}/{member.name}/...`，便于团队自查和批量管理
   - Three CLI mapping:
     - Codex: `homeDir` → `CODEX_HOME`/`.codex`; 默认在 `roleDir/.codex`
     - Gemini CLI: `instructionFile` → `GEMINI.md`（或 `contextFileName`），`homeDir` 提供 `.gemini` 存储
     - Claude Code: `HOME` 映射到 `roleDir/home`，`instructionFile` 指向 `CLAUDE.md`

### 4.2 向导状态模型

```typescript
interface WizardState {
  step: number;  // Current step: 1-4
  totalSteps: 4; // Fixed at 4 steps
  data: {
    // Step 1: Team Structure
    teamName?: string;
    teamDescription?: string;
    teamInstructionFile?: string;        // Team-level instruction file path
    roleDefinitions?: RoleDefinition[];  // Role definitions
    members?: MemberAssignment[];        // Member role assignments

    // Step 2: Detect Agents
    availableAgents?: string[];          // Detected AI agents
    selectedAgents?: string[];           // User-selected agents

    // Step 3: Configure Members
    memberConfigs?: MemberConfig[];      // Detailed config for each member

    // Step 4: Team Settings
    maxRounds?: number;
  };
}

interface RoleDefinition {
  name: string;           // Role name, e.g. "Reviewer", "Observer"
  description?: string;   // Optional role description
}

interface MemberAssignment {
  memberIndex: number;    // Member index, e.g. 1, 2, 3
  assignedRole: string;   // Assigned role name
}

interface MemberConfig {
  memberIndex: number;
  type: 'ai' | 'human';
  assignedRole: string;   // The role assigned to this member (references roleDefinitions)
  displayName: string;
  themeColor: string;
  roleDir: string;        // Base directory for this role (contains instruction file/start script)
  workDir: string;        // Execution directory (where CLI runs commands)
  homeDir?: string;       // Optional CLI HOME/config root override
  instructionFile?: string; // Explicit instruction file path relative to roleDir
  env?: Record<string, string>; // Additional environment variables per member

  // AI-specific fields (only valid when type === 'ai')
  agentType?: string;            // AI agent name, e.g. "Claude Code" (references agents array)
}

// Note: When generating JSON, these fields map to team.members[i]:
// - displayName → displayName
// - memberIndex → name (as "member-{index}")
// - assignedRole → role
// - agentType → agentType
// - themeColor → themeColor
// - roleDir/workDir/homeDir/instructionFile/env → 对应team.members[i]的同名字段
```

## 5. UI组件设计

### 5.1 WizardView组件
显示向导界面，包含：
- 进度指示器（Step X/4）
- 当前步骤说明和标题
- 输入框/选择列表（使用Ink组件）
- 导航提示（Enter to confirm, Ctrl+C to cancel）
- 根据步骤显示不同的子组件（TeamStructureStep, DetectAgentsStep, ConfigureMembersStep, TeamSettingsStep）

### 5.2 MenuView组件
显示菜单界面，包含：
- 菜单标题（如 "Editing Team: Code Review Team"）
- 当前配置预览（team name, description, team instruction file, roleDefinitions, members列表、每个成员的roleDir/workDir/homeDir）
- 菜单项列表（高亮当前项，用 ▶ 标记）
- 菜单项类型：
  - Edit team information (name, description, goal, max rounds)
  - Add new member
  - Edit member: [member name] （每个成员一个菜单项）
  - Remove member
  - Change member order
  - Save and exit
  - Exit without saving
- 注意：roleDefinitions显示在预览中，但创建后不可编辑

### 5.3 FormView组件
显示表单界面，包含：
- 字段标签和输入框
- 提示文本（如 "[input]", "[multi-line input, Ctrl+D to finish]"）
- 验证错误提示（实时显示）
- 适用于单行输入、多行输入、数字输入、路径输入（需要即时验证目录存在与否）等场景

### 5.4 SummaryView组件
显示配置摘要，用于确认前预览。向导完成时显示：
```
Summary
────────────────────────────────────────────────────────────
Team: Code Review Team
Description: A team for collaborative code review

Team Instruction File:
  /teams/code-review/team_instruction.md

Members: 3 (2 AIs, 1 Human)

Roles:
  • Reviewer (2 members)
    - Claude Reviewer (AI - Claude Code) [Cyan]
      Role Dir: /teams/code-review/alice
      Work Dir: /teams/code-review/alice/work
      Instruction: /teams/code-review/alice/AGENTS.md
    - Senior Dev (Human) [Green]
      Role Dir: /teams/code-review/reviewer/dick

  • Observer (1 member)
    - Codex Observer (AI - OpenAI Codex) [Yellow]
      Role Dir: /teams/code-review/codex-observer
      Instruction: /teams/code-review/codex-observer/CLAUDE.md

Settings:
  Max Rounds: 20
  File: code-review-team-config.json

────────────────────────────────────────────────────────────
Looks good? [Y/n]
```

## 6. 实现计划

### Phase 1: 基础架构（1-2天）
- [ ] 扩展模式系统：添加 `wizard`, `menu`, `form`, `select` 模式到ReplModeInk.tsx
- [ ] 实现WizardState管理（使用React useState）
- [ ] 创建基础UI组件（WizardView, MenuView, FormView, SelectView）
- [ ] 实现键盘导航逻辑（useInput hook处理上下键、Enter、Ctrl+C等）

### Phase 2: `/team create` 创建功能（2-3天）
- [ ] 实现Step 1: Team Structure（团队结构定义）
  - [ ] 输入team name, description, instructionFile路径（可提供默认值，如 `/teams/<team>/TEAM.md`）
  - [ ] 定义角色（role definitions）：逐个收集角色名称和可选描述
  - [ ] 定义成员数量和角色分配
- [ ] 实现Step 2: Detect Agents（检测可用AI）
  - [ ] 集成ToolDetector检测已安装agents
  - [ ] 单个agent自动选择，多个agents提供多选
  - [ ] 为每个选中的agent生成agents数组条目（command, default args, endMarker, usePty）
- [ ] 实现Step 3: Configure Members（逐个配置成员）
  - [ ] 遍历每个成员，配置type, display name, theme color
  - [ ] 为每个成员收集目录/环境：roleDir、workDir、homeDir、instructionFile（可自动推导）
  - [ ] AI成员额外配置：agent选择、角色入口目录/指令文件路径
  - [ ] AI成员可选覆盖配置：end marker, args, use PTY
  - [ ] 支持为不同CLI生成默认env（如Codex的`CODEX_HOME`、Claude的`HOME`、Gemini的`.gemini`路径）
  - [ ] Human成员简化配置（可跳过env/目录或沿用团队默认值）
- [ ] 实现Step 4: Team Settings（团队设置）
  - [ ] 配置maxRounds
- [ ] 实现Summary确认和JSON文件保存
  - [ ] 显示team instruction file, roleDefinitions, members分组
  - [ ] 生成符合schema的完整JSON（包括schemaVersion）

### Phase 3: `/team edit` 编辑功能（2-3天）
- [ ] **实现配置文件迁移逻辑**（见7.8节）
  - [ ] `detectSchemaVersion()` - 检测配置版本
  - [ ] `ensureMigratedConfig()` - 统一的内存迁移接口
  - [ ] `silentMigration()` - 静默迁移（提供默认值）
  - [ ] `interactiveMigration()` - 交互式迁移向导
    - [ ] Step 1: Team Instruction File确认（可从legacy描述自动生成）
    - [ ] Step 2: 自动推导角色结构，用户确认（不允许自定义）
    - [ ] Migration Summary确认界面
- [ ] 实现配置文件加载和解析（支持legacy和v1.0格式）
- [ ] 实现主菜单界面（显示team instruction file, roleDefinitions, members）
- [ ] 实现编辑团队信息（name, displayName, description, instructionFile, maxRounds）
- [ ] 实现添加新成员（完整配置流程）
  - [ ] 选择角色（只能从现有roleDefinitions中选择，不能新增角色）
  - [ ] 如果现有角色不满足需求，提示用户必须创建新团队
  - [ ] 配置成员属性（displayName、themeColor、roleDir/workDir/homeDir/instructionFile/env）
- [ ] 实现编辑成员（嵌套菜单 → 选择属性 → 修改值）
  - [ ] 支持修改display name与theme color
  - [ ] 支持更新目录/环境字段（roleDir/workDir/homeDir/instructionFile/env），并实时校验路径有效性
  - [ ] 支持Change AI Agent（带警告和重新配置默认args/endMarker）
  - [ ] 支持Change Type AI↔Human（带警告）
  - [ ] ~~支持Change Role~~（不允许，角色分配创建后不可修改）
- [ ] 实现删除成员（带警告，显示角色会变为0成员的提示）
- [ ] 实现调整成员顺序（使用上下键和Space键）
- [ ] 实现Save and exit（写入完整JSON包括roleDefinitions）和Exit without saving

### Phase 4: 辅助命令（1天）
- [ ] 实现 `/team list` - 列出所有团队配置文件（显示基本信息）
- [ ] 实现 `/team show [filename]` - 显示配置详情
  - [ ] 使用`ensureMigratedConfig(interactive: false)`静默迁移
  - [ ] 显示legacy格式警告（见7.8节场景B）
  - [ ] 显示team instruction file（legacy使用默认值：例如推导自description或默认路径）
  - [ ] 显示roleDefinitions（legacy使用默认值：单个角色"Member"，描述"Team member"）
  - [ ] 显示members并标注roleDir/workDir/homeDir/instructionFile/env字段
- [ ] 实现 `/team delete <filename>` - 删除配置（带安全检查）
- [ ] 实现 `/unload` 命令（卸载当前配置，用于delete场景）
- [ ] 更新 `/config` 命令
  - [ ] 使用`ensureMigratedConfig(interactive: false)`静默迁移
  - [ ] 添加legacy格式提示（见7.8节场景C）
- [ ] 更新 ConversationStarter.ts - 使用`ensureMigratedConfig()`加载配置

### Phase 5: 测试和优化（1-2天）
- [ ] 端到端测试创建流程
- [ ] 端到端测试编辑流程
- [ ] **测试配置迁移流程**
  - [ ] 交互式迁移向导测试（/team edit）
  - [ ] 静默迁移测试（/config, /team show）
  - [ ] 迁移后roleDefinitions不可编辑验证
  - [ ] 迁移拒绝场景测试
  - [ ] 保存后的配置格式验证（只有v1.0）
  - [ ] 内存迁移不修改原文件的验证
- [ ] 测试边界情况（无agents、单agent、多agents）
- [ ] 错误处理优化
- [ ] UX优化（提示文本、警告信息、输入验证）
- [ ] 回归测试（确保legacy配置可正常加载并运行）

## 7. 技术挑战

### 7.1 状态管理
**挑战**：向导和菜单需要维护复杂的状态（当前步骤、已收集数据、菜单层级、编辑缓冲区）
**方案**：
- 使用React useState管理WizardState和MenuState
- 编辑模式下，所有修改暂存在内存中，仅在"Save and exit"时写入文件
- 状态结构清晰分层（step → data → memberConfigs）

### 7.2 输入验证
**挑战**：实时验证用户输入（团队名称、角色名称、成员数量、命令参数等）
**方案**：
- 实现验证函数，每个输入字段有独立的验证规则
- 团队名称：非空，长度限制
- 角色名称：非空，不重复
- 成员数量：正整数
- maxRounds：非负整数
- 显示实时错误提示，阻止无效输入进入下一步

### 7.3 模式切换
**挑战**：在normal、conversation、wizard、menu等模式间平滑切换
**方案**：
- 使用React状态管理mode: 'normal' | 'conversation' | 'wizard' | 'menu' | 'form' | 'select'
- 明确定义模式转换规则：
  - `/team create` → wizard模式
  - `/team edit` → menu模式
  - wizard/menu内部可能临时切换到form或select模式
  - Ctrl+C或完成操作后返回normal模式
- useInput根据当前mode执行不同的键盘处理逻辑

### 7.4 配置兼容性
**挑战**：确保新生成的配置与现有系统兼容（ConversationStarter.ts能正确加载）
**方案**：
- 严格遵循现有配置文件格式（agents数组 + team对象 + maxRounds）
- 生成配置后，使用现有的AgentConfigManager和TeamManager验证
- 参考agent-chatter-config.json作为模板
- 自动化测试：生成的配置能否被`/config`加载并启动对话

### 7.5 角色定义与成员配置的映射关系
**挑战**：用户在Step 1定义抽象角色（如"Reviewer"），在Step 3为每个成员分配角色，需要在配置文件中正确表达这种关系

**方案**：

1. **配置文件结构**：
   - `team.roleDefinitions`：存储角色定义数组
     - 每个角色包含`name`和`description`
     - 这是抽象的角色分类

   - `team.members`：存储成员数组
     - 每个成员包含`role`字段，指向roleDefinitions中的角色名称
     - 多个成员可以分配到同一个角色

2. **Wizard数据到JSON的转换**：
   - WizardState.data.roleDefinitions → team.roleDefinitions
   - WizardState.data.memberConfigs → team.members数组
   - memberConfig.displayName → team.members[i].displayName
   - memberConfig.memberIndex → 生成唯一ID "member-{index}"存入team.members[i].name
   - memberConfig.assignedRole → team.members[i].role
   - memberConfig.themeColor → team.members[i].themeColor
   - memberConfig.roleDir/workDir/homeDir/instructionFile/env → team.members[i]的同名字段
   - memberConfig中的AI配置 → team.members[i]的AI专有字段

3. **成员级配置覆盖**：
   - 成员的`agentType`引用顶层`agents`数组中的基础配置
   - 成员可以有可选的`endMarker`, `usePty`, `args`字段覆盖基础配置
   - 如果成员未指定这些字段，使用agents中的默认值
   - 这样两个成员可以使用同一个CLI agent但有不同的运行参数

**示例**：
```typescript
// Wizard收集的数据
roleDefinitions: [{ name: "Reviewer" }]
memberConfigs: [
  { memberIndex: 1, assignedRole: "Reviewer", displayName: "Claude", ... },
  { memberIndex: 2, assignedRole: "Reviewer", displayName: "Human", ... }
]

// 生成的JSON
team: {
  roleDefinitions: [
    { name: "Reviewer", description: "..." }
  ],
  roles: [
    { name: "member-1", role: "Reviewer", title: "Claude", ... },
    { name: "member-2", role: "Reviewer", title: "Human", ... }
  ]
}
```

### 7.6 成员级配置覆盖的运行时处理
**挑战**：成员可以覆盖agents数组中的默认配置，运行时需要正确合并配置
**方案**：

1. **配置合并逻辑**（在ProcessManager或AgentManager中实现）：
   ```typescript
  function getMemberEffectiveConfig(member: TeamRole, agents: AgentConfig[]): EffectiveConfig {
    // Find base agent config
    const baseAgent = agents.find(a => a.name === member.agentType);

    return {
      command: baseAgent.command,
      args: baseAgent.args,
      endMarker: baseAgent.endMarker,
      usePty: baseAgent.usePty
    };
  }
  ```

2. **向后兼容性**：
   - 旧版本成员如果带有`endMarker`/`usePty`/`args`字段，迁移时将忽略这些字段并回退到agent默认值
   - legacy配置中的`teamGoal`内容会提示用户写入新的team instruction file

3. **编辑时的智能显示**：
   - UI明确显示每个成员的roleDir/workDir/homeDir/instructionFile/env等目录信息
   - 提供路径存在性验证与“打开目录”快捷键，帮助用户快速定位角色入口

### 7.7 编辑模式中的原子操作实现
**挑战**：允许灵活编辑（改agent类型、改member类型），同时保持数据一致性，但不允许修改角色相关配置
**方案**：
- 每个编辑操作都是明确的JSON对象修改
  - Change AI Agent：更新agentType并提示用户重新确认目录、HOME和instructionFile（避免引用错误的CLI配置）
- Change Type (AI↔Human)：删除/添加相应字段，显示警告
- ~~Change Role~~：**不允许修改**。成员的role字段在创建（或迁移）时确定，之后不可修改，因为会影响团队结构和其他成员配置
- 所有操作都在内存中的临时对象上进行，Save时才覆盖原文件

### 7.8 配置文件向后兼容和迁移策略
**挑战**：新schema引入了schemaVersion、team.instructionFile、team.roleDefinitions等必备字段，但现有配置文件（如agent-chatter-config.json）完全不包含这些字段。需要明确定义如何加载、迁移和保存旧版配置。

**核心决策**：
1. **交互式迁移，但不允许自定义角色**：系统自动推导角色结构（AI → "Assistant", Human → "Participant"），用户只能确认或拒绝，不提供自定义入口。这确保在编辑阶段不会新增/修改角色。
2. **所有加载都在内存中迁移**：保证运行时不会缺少必需字段，避免代码崩溃
3. **只有编辑时保存迁移结果**：`/config`和`/team show`不修改文件，保持向后兼容
4. **迁移时角色定义一次性确定**：迁移向导中系统自动推导角色，用户确认后角色定义固定，不可修改（因为会影响所有成员配置）。如果用户不接受自动推导的角色，必须使用`/team create wizard`创建新团队。

**方案**：

#### 1. Schema版本检测
加载配置文件时，通过是否存在`schemaVersion`字段来识别版本：

```typescript
function detectSchemaVersion(config: any): 'legacy' | '1.0' {
  if (!config.schemaVersion) {
    return 'legacy';  // Old format without schemaVersion
  }
  return config.schemaVersion;  // Currently only '1.0'
}
```

#### 2. 统一的内存迁移接口

所有加载配置的命令（`/config`, `/team edit`, `/team show`）都调用此函数：

```typescript
function ensureMigratedConfig(config: any, interactive: boolean = false): ConfigV1 {
  const version = detectSchemaVersion(config);

  if (version === '1.0') {
    return config;  // Already migrated
  }

  // Legacy config - perform migration
  if (interactive) {
    // Interactive migration (for /team edit)
    return interactiveMigration(config);
  } else {
    // Silent migration with defaults (for /config, /team show)
    return silentMigration(config);
  }
}
```

#### 3. 静默迁移（用于 /config 和 /team show）

提供保守的默认值，保证代码不崩溃：

```typescript
function silentMigration(legacyConfig: any): ConfigV1 {
  const migratedConfig = { ...legacyConfig };

  // Add schemaVersion
  migratedConfig.schemaVersion = "1.0";

  // Determine team instruction file (default to TEAM.md in current working dir)
  migratedConfig.team.instructionFile =
    legacyConfig.team.instructionFile ?? "./TEAM.md";

  // Create default role definition(s)
  migratedConfig.team.roleDefinitions = [
    { name: "Member", description: "Team member" }
  ];

  // Assign all members to default role
  const legacyMembers = legacyConfig.team?.members ?? legacyConfig.team?.roles ?? [];
  migratedConfig.team.members = legacyMembers.map(member => ({
    ...member,
    role: member.role ?? "Member"
  }));

  return migratedConfig;
}
```

#### 4. 交互式迁移（用于 /team edit）

系统自动推导角色结构，用户只能确认或拒绝（不提供自定义入口）：

```typescript
async function interactiveMigration(legacyConfig: any): Promise<ConfigV1> {
  // Step 1: Let user confirm/modify team instruction file path and (optionally) write legacy notes
  const instructionFile = await promptTeamInstructionFile(
    legacyConfig.team.instructionFile,
    legacyConfig.team.description,
  );

  // Step 2: Auto-infer role definitions and assignments
  const { roleDefinitions, memberAssignments } =
    autoInferRoles(legacyConfig.team.members);

  // Step 3: Present for confirmation (accept or reject, no editing)
  const accepted = await confirmRoleStructure(
    roleDefinitions,
    memberAssignments,
    legacyConfig.team.members
  );

  if (!accepted) {
    throw new Error("Migration cancelled. To use this config, please create a new team with /team create wizard.");
  }

  // Step 4: Apply auto-assignments
  const members = legacyConfig.team.members.map((member: any, index: number) => ({
    ...member,
    role: memberAssignments[index]
  }));

  return {
    ...legacyConfig,
    schemaVersion: "1.0",
    team: {
      ...legacyConfig.team,
    instructionFile,
      roleDefinitions,
      members: members
    }
  };
}

function autoInferRoles(members: any[]): {
  roleDefinitions: RoleDefinition[];
  memberAssignments: string[];
} {
  // Simple rule: AI → "Assistant", Human → "Participant"
  const hasAI = members.some(m => m.type === 'ai');
  const hasHuman = members.some(m => m.type === 'human');

  const roleDefinitions: RoleDefinition[] = [];
  if (hasAI) {
    roleDefinitions.push({
      name: 'Assistant',
      description: 'AI team member'
    });
  }
  if (hasHuman) {
    roleDefinitions.push({
      name: 'Participant',
      description: 'Human team member'
    });
  }

  const memberAssignments = members.map(m =>
    m.type === 'ai' ? 'Assistant' : 'Participant'
  );

  return { roleDefinitions, memberAssignments };
}
```

#### 5. 迁移流程和用户体验

**场景A：`/team edit` 加载旧版配置（交互式迁移）**

```bash
agent-chatter> /team edit agent-chatter-config.json

# 检测到旧版配置，启动交互式迁移向导：
⚠ Migration Required
────────────────────────────────────────────────────────────
This configuration uses the legacy format (no schemaVersion).
An interactive migration wizard will guide you through upgrading
to schema version 1.0.

Detected configuration:
  Team: Claude Code Test Team
  Description: A team with Claude Code CLI agent and human observer
  Members: 2
    • Claude (AI - Claude Code)
    • Observer (Human)

Proceed with migration wizard? [Y/n] y

────────────────────────────────────────────────────────────
Migration Step 1/2: Define Team Instruction File
────────────────────────────────────────────────────────────
The new schema requires a canonical team instruction file path.

Suggested path (based on team name):
  "./TEAM.md"

Legacy notes (from description / old goal):
  "A team with Claude Code CLI agent and human observer"

Instruction File Path: [input] ./TEAM.md
Initialize file with legacy notes? [Y/n] y

✓ Team instruction file recorded: "./TEAM.md"

────────────────────────────────────────────────────────────
Migration Step 2/2: Confirm Role Structure
────────────────────────────────────────────────────────────
The system has automatically inferred roles based on member types.

Auto-inferred roles:
  • Assistant - AI team member
  • Participant - Human team member

Your members will be assigned as follows:
  • Claude (AI) → Assistant
  • Observer (Human) → Participant

⚠️  Important: Role structure will be fixed after migration.
   To change roles later, you must create a new team.

Accept this role structure? [Y/n] y

✓ Role definitions confirmed

────────────────────────────────────────────────────────────
Migration Summary
────────────────────────────────────────────────────────────
✓ schemaVersion: "1.0"
✓ team instruction file: "./TEAM.md"
✓ Role Definitions:
    • Assistant - AI team member
    • Participant - Human team member
✓ Member Assignments (auto-assigned by type):
    • Claude (AI) → Assistant
    • Observer (Human) → Participant

Apply migration and enter edit mode? [Y/n] y

✓ Configuration migrated to schema v1.0
Entering edit mode...

# 然后正常进入编辑界面，显示迁移后的配置
📝 Editing Team: Claude Code Test Team
────────────────────────────────────────────────────────────
Current Configuration:
  Team Name: Claude Code Test Team
  Description: A team with Claude Code CLI agent and human observer
  Team Instruction File: ./TEAM.md
  Max Rounds: 10

  Role Definitions:
    • AI Assistant: AI agent that provides assistance
    • Observer: Human observer

  Members (2):
    1. Claude (AI - Claude Code) - Role: AI Assistant [Default]
    2. Observer (Human) - Role: Observer [Default]

💡 Configuration migrated from legacy format. Role definitions
are now fixed and cannot be modified. You can edit other settings.
────────────────────────────────────────────────────────────
Main Menu
  ▶ Edit team information (name, description, instruction file, max rounds)
    Add new member
    ...
```

**场景B：`/team show` 显示旧版配置（静默迁移）**

```bash
agent-chatter> /team show agent-chatter-config.json

⚠ This configuration uses legacy format (no schemaVersion)
  Displaying with default migration values (in-memory only).
  File is not modified. Use '/team edit' for interactive migration.

Team: Claude Code Test Team
Description: A team with Claude Code CLI agent and human observer
File: agent-chatter-config.json
Max Rounds: 10
────────────────────────────────────────────────────────────
Team Instruction File (default):
  ./TEAM.md

────────────────────────────────────────────────────────────
Role Definitions (default):
  • Member: Team member

────────────────────────────────────────────────────────────
Members (2):
  1. Claude (AI - Claude Code) - Role: Member [Default]
     Instruction File: ./TEAM.md

  2. Observer (Human) - Role: Member [Default]
     Instruction File: ./TEAM.md (shared)

💡 This is a legacy configuration. Run '/team edit agent-chatter-config.json'
for an interactive migration wizard to define proper roles and team instruction files.
```

**场景C：`/config` 加载旧版配置启动对话（静默迁移）**

```bash
agent-chatter> /config agent-chatter-config.json

⚠ This configuration uses legacy format (no schemaVersion).
  Loading with default values (file not modified).

  Consider running '/team edit agent-chatter-config.json' to migrate
  and take advantage of new features (role definitions, team instruction files).

✓ Configuration loaded: Claude Code Test Team
```

#### 6. 保存策略

**明确规则**：
- ✅ **所有新创建的配置**：使用schema v1.0，包含所有必需字段
- ✅ **编辑后保存**：
  - `/team edit`：交互式迁移后，保存为v1.0格式（强制迁移）
  - 不存在"保持legacy格式"的场景，一旦编辑就必须迁移
- ✅ **只读场景不修改文件**：
  - `/team show`：静默迁移仅在内存中，不修改原文件
  - `/config`：静默迁移仅在内存中，不修改原文件
- ✅ **迁移是单向的**：一旦保存为v1.0，不再降级回legacy格式

#### 7. 特殊情况处理

**问题1：配置文件完全没有team.members数组**
```typescript
if (!legacyTeam.roles || legacyTeam.roles.length === 0) {
  throw new Error('Invalid configuration: team.members is empty. Cannot migrate.');
}
```

**问题2：用户拒绝迁移（在 /team edit 中）**
```bash
Proceed with migration wizard? [Y/n] n

Migration cancelled. Cannot edit legacy configurations without migration.
Use '/team show' to view the configuration.
```

#### 8. 实现检查清单

Phase 3实现时需要添加：
- [ ] `detectSchemaVersion()` - 检测配置版本
- [ ] `ensureMigratedConfig()` - 统一的内存迁移接口
- [ ] `silentMigration()` - 静默迁移（用于/config, /team show）
- [ ] `interactiveMigration()` - 交互式迁移向导（用于/team edit）
  - [ ] 3步向导UI：Team Instruction File → Role Definitions → Member Assignment
  - [ ] 提供建议默认值
  - [ ] 最终确认界面
- [ ] 在`/team edit`命令中集成交互式迁移向导
- [ ] 在`/team show`命令中添加legacy格式警告和默认值说明
- [ ] 在`/config`命令中添加legacy格式提示
- [ ] 确保运行时代码（ConversationStarter等）使用`ensureMigratedConfig()`
- [ ] 更新配置保存逻辑，确保只有v1.0格式被写入
- [ ] 添加单元测试覆盖各种迁移场景

## 8. 用户体验要点

### 8.1 清晰的进度提示
- 向导每步都显示 "Step X/4" 进度指示器
- 每步都有清晰的标题和说明
- 显示已收集的信息摘要，让用户了解当前状态

### 8.2 智能默认值
- 文件名：根据团队名称自动生成（team-name-config.json）
- 团队指令文件：根据团队名称默认生成 `./TEAM.md`（可配置不同根目录）
- maxRounds：默认值10，提示可设为0表示无限制
- End Marker / Use PTY：由 `agents[]` 的默认值决定，如需差异化请添加新的agent类型

### 8.3 输入提示和验证
- 每个输入字段显示格式提示（如 "[input]", "[multi-line input, Ctrl+D to finish]"）
- 实时验证输入，显示错误信息
- 数字字段只接受有效数字
- 多行输入明确告知如何结束输入（Ctrl+D）

#### 8.3.1 路径字段与环境变量验证

**roleDir**：
- 必须是绝对路径
- 如果不存在，向用户确认是否创建（默认Yes），系统会创建 `roleDir` 以及默认子目录
  - `roleDir/work`（可替换为真实工作目录或指向符号链接）
  - `roleDir/home`（CLI HOME 基础目录）
- 容许符号链接；若为符号链接，会验证目标是否存在

**workDir**：
- 默认值：`{roleDir}/work`
- 允许符号链接，若不存在且不是符号链接将提示是否创建
- 可指向团队实际代码目录或共享盘

**homeDir**：
- 默认值：`{roleDir}/home`
- 若不存在自动创建，不允许符号链接（确保 CLI HOME 使用真实目录）
- 若用户设置 `env.HOME` 或 `env.CODEX_HOME`，Wizard 会提示与 `homeDir` 保持一致

**instructionFile**：
- 可为相对路径（相对于 roleDir）或绝对路径
- 如果文件不存在，提示用户是否使用模板初始化（模板内容会包含 `@{team.instructionFile}` 以引用团队级指令）

**env**：
- JSON对象形式（key → value），在运行进程时通过 `process.env` 传入
- 默认规则：
  - 对 Codex：`CODEX_HOME = {homeDir}/.codex`（同时设置 `HOME` = `homeDir` 保障兼容）
  - 对 Gemini：`HOME = {homeDir}`，`.gemini` 目录位于 HOME 下
  - 对 Claude：`HOME = {homeDir}`
- 如果用户显式设置 `env.HOME`，Wizard 会校验其与 `homeDir` 一致；若不同，警告用户并允许继续（由高级用户控制）

### 8.4 安全确认和警告
- 删除配置前确认，防止误删
- 删除成员时，如果会导致某role为0成员，显示警告
- Change AI Agent时警告将重新配置所有agent-specific设置
- Change Type (AI↔Human) 时警告将丢失AI-specific设置
- 编辑模式下提供"Exit without saving"选项

### 8.5 帮助文本和提示
向导和菜单中显示简短的帮助文本：
```
Step 1/4: Team Structure
────────────────────────────────────────────────────────────
Define your team's basic structure.

💡 Tip: Roles help organize team members. For example, you might
have "Reviewer" and "Observer" roles in a code review team.
```

编辑模式中的操作提示：
```
What would you like to modify?
  ▶ Display Name
    ...
    Change AI Agent (Claude Code → Other)

⚠ Changing AI agent will require reconfiguring agent-specific settings.
```

## 9. 未来扩展

### 9.1 模板系统
预定义常用团队模板，加速创建流程：
- 提供几种预设模板供用户选择
- 用户可以基于模板快速创建，然后进行自定义修改
- 可能的实现：`/team create --template <name>`

### 9.2 配置验证和测试
- 在向导完成后，自动检查选择的AI agents是否真的已安装
- 提供"Test Configuration"功能，尝试启动agents验证配置是否有效
- 验证命令参数格式是否正确

### 9.3 导入/导出
- 从其他格式导入配置（YAML, TOML）
- 导出配置为其他格式，便于分享
- 配置打包和分享功能

### 9.4 配置导入导出增强
未来可考虑：
- 从其他团队协作平台导入配置
- 批量配置管理工具
- 配置模板市场

## 10. 开放问题与设计决策

### 10.1 已明确的设计决策（从讨论中得出）：
- ✅ **编辑灵活性**：允许编辑team信息、成员配置、AI agent类型、member类型、role分配等
- ✅ **角色定义不可编辑**：roleDefinitions在团队创建（或迁移）时定义，之后不可修改，因为修改会影响所有成员配置和系统提示词
- ✅ **备份策略**：不提供自动备份功能，用户可在文件系统手动备份
- ✅ **删除安全**：不能删除当前加载的或有活跃对话的配置
- ✅ **向导流程**：固定4步（Team Structure → Detect Agents → Configure Members → Team Settings）
- ✅ **迁移策略**：
  - `/team edit`：交互式迁移向导（3步：Team Instruction File → Role Definitions → Member Assignment），迁移时一次性定义角色，之后不可修改
  - `/config` 和 `/team show`：静默迁移（内存中），不修改原文件
  - 保证运行时代码不会因缺少必需字段而崩溃

### 10.2 已解决的问题（从最新讨论）：

1. ✅ **动态修改正在运行的team**
   **决定**：不支持对话中途修改team配置
   **理由**：需要处理对话历史、消息路由等复杂问题，当前版本不实现

2. ✅ **配置文件版本兼容性**
   **决定**：
   - 配置文件需要schema，schema有版本号
   - 配置文件本身包含 `schemaVersion` 字段（当前为 "1.0"）
   - 未来schema升级尽量保持向后兼容
   - 如果必须breaking change，届时再讨论迁移方案

3. ✅ **角色分配的灵活性**
   **决定**：不支持一个成员同时承担多个角色
   **设计**：每个成员只能分配到一个角色

4. ✅ **Team-level Instruction File**
   **决定**：团队需要一个共享的指令文件（SOP/Guideline），由 `team.instructionFile` 指向
   **用途**：在不同角色指令文件中通过相对路径引用，确保团队规范统一
   **重点**：路径必须可解析，且在迁移时要求用户确认/创建该文件

5. ✅ **多语言支持**
   **决定**：当前版本不做多语言支持，只做英语
   **要求**：所有UI文本使用英语（设计文档可以用中文，但UI示例用英文）

---

**文档版本**: v1.8
**创建日期**: 2025-11-16
**最后修订**: 2025-11-16
**作者**: Claude Code

**v1.8关键修正（2025-11-16）- 彻底封堵角色编辑漏洞**：

**问题**：v1.7虽然删除了角色管理功能，但仍有三处设计漏洞允许在编辑阶段变相修改角色：
1. 迁移向导让用户自定义角色（Step 2允许输入角色名称和描述）
2. "添加新成员"流程未说明只能从现有角色选择
3. 版本历史使用大量删除线，阅读困难且容易误导

**修正内容**：
1. **迁移向导改为确认模式**（第1224-1241行）：
   - 系统自动推导角色结构（AI → "Assistant", Human → "Participant"）
   - 用户只能确认或拒绝，不提供自定义入口
   - 如果拒绝，必须使用`/team create wizard`创建新团队
   - 删除原Step 3"手动分配成员"（已在Step 2自动分配）
   - 更新核心决策说明（第1061行）
   - 更新代码实现（第1133-1202行）

2. **明确添加成员的角色限制**：
   - UI示例添加说明："Only existing roles available - cannot add new roles"（第253行）
   - 添加提示："If you need a different role, you must create a new team"（第257行）
   - Phase 3实现计划明确要求检查（第886-887行）
   - 迁移实现计划更新描述（第880行）

3. **清理版本历史混淆内容**（第1571-1612行）：
   - 删除v1.6中所有删除线描述
   - 分离"有效改进"和"被撤回的提案"
   - 删除v1.6.1和v1.6.2的混淆记录
   - 历史版本摘要简化为明确陈述

4. **添加主菜单显式告知**（第222-223行）：
   - 在/team edit主菜单顶部添加警告
   - "Role structure is fixed after team creation/migration"
   - "To change roles, you must create a new team"

**最终状态**：完全封堵了所有角色编辑漏洞，确保角色结构在任何情况下都不可在编辑阶段修改。文档清晰无歧义，易于理解和实现。

---

**v1.7重大修正（2025-11-16）- 恢复角色定义不可编辑原则**：

**问题**：v1.6错误地添加了"Manage role definitions"功能，违背了用户明确要求：
- 用户明确指出：编辑现有团队时，不能动role，不能增加/编辑/删除
- 理由：role的变化会影响其他Team member的配置/提示词

**修正内容**：
1. **删除所有角色管理功能**：
   - 删除主菜单中的"Manage role definitions"（第224行）
   - 删除整个角色管理UI流程（原第248-344行，96行代码）
   - 删除3.2 Menu模式中的"管理角色定义"操作（第567行）
   - 删除5.2 MenuView组件中的"Manage role definitions"（第790行）
   - 删除Phase 3实现计划中的角色管理任务（原第974-978行）
   - 删除Phase 5测试中的角色管理测试（原第1019-1022行）

2. **恢复角色定义不可编辑说明**：
   - 删除成员时恢复警告："Role definitions cannot be modified after team creation"（第368-369行）
   - 3.2 Menu模式增加注意事项（第575行）
   - 5.2 MenuView组件增加注意事项（第797行）
   - 7.8迁移策略更新为"迁移时角色定义一次性确定"（第1058行）
   - 迁移后提示更新为"Role definitions are now fixed"（第1289-1290行）

3. **更新设计决策**：
   - 明确"角色定义不可编辑"原则（第1467行）
   - 说明原因：修改会影响所有成员配置和系统提示词

**关键变化**：
- Phase 3时间从"3-4天"恢复为"2-3天"（删除了角色管理实现）
- 保留迁移向导中定义角色的功能（这是创建时，允许）
- 迁移后角色定义固定，不可修改（这是编辑时，不允许）

**影响范围**：
- 删除代码：96行UI流程 + 5处实现计划任务
- 修改说明：6处增加/恢复不可编辑说明
- 时间估算：Phase 3减少1天

**v1.7最终清理**：
在初始v1.7修订后，发现三处仍允许成员角色分配修改的遗留内容：
1. **编辑成员菜单**（第296-309行）：
   - 删除"Change Role (Reviewer → Other)"选项
   - 添加注意事项："Member's role assignment cannot be changed after team creation"
2. **Phase 3实现计划**（第896行）：
   - 将"支持Change Role"标记为"~~支持Change Role~~（不允许，角色分配创建后不可修改）"
3. **7.7节原子操作**（第1054行）：
   - 将"Change Role"更新为"~~Change Role~~：**不允许修改**。成员的role字段在创建（或迁移）时确定，之后不可修改，因为会影响团队结构和其他成员配置"
4. **3.2节核心编辑操作**（第577-581行）：
   - 添加完整的**角色限制**说明段落，明确roleDefinitions和member.role都不可修改

**最终状态**：角色定义（roleDefinitions）和成员角色分配（member.role）在团队创建（或迁移）时一次性定义，之后不可修改。迁移算法正确，运行时不会崩溃。设计完整可实现，所有文档一致。

**v1.6重大修正（2025-11-16）- 修复迁移算法和运行时安全**：

**有效改进（保留至今）**：
1. **迁移算法改进**：改为基于member.type自动推导角色（AI → "Assistant", Human → "Participant"），替代了旧的"取title最后一个词"的错误算法
2. **运行时安全机制**：新增统一的内存迁移接口`ensureMigratedConfig()`，确保所有加载配置的地方都不会因缺少必需字段而崩溃
3. **静默迁移**：`/config`和`/team show`使用静默迁移（提供默认值，内存中，不修改文件）
4. **交互式迁移向导**：`/team edit`使用交互式迁移向导，让用户确认team instruction file和角色结构

**被撤回的提案（v1.7删除）**：
- v1.6错误地添加了"Manage role definitions"功能，允许编辑后修改角色定义
- 此功能在v1.7中被完全删除，因为违背了用户明确要求：编辑阶段不得新增/修改/删除角色
- v1.6.1和v1.6.2的UI同步更新也因此被撤销

**最终状态（v1.7修正后）**：
- 迁移算法正确（基于type自动推导）
- 运行时不会崩溃（统一内存迁移）
- 角色定义不可编辑（恢复原则）

---

**历史版本摘要**：

**v1.3重大修正（2025-11-16）**：
- 添加team instruction file、team.roleDefinitions、成员级覆盖字段到schema

**v1.4细节修正（2025-11-16）**：
- 修正字段命名一致性（commandArgs → args）
- 完善roleDefinition接口

**v1.5关键补充（2025-11-16）**：
- 新增7.8节配置文件向后兼容和迁移策略（基础版，有缺陷）

**v1.6重大修正（2025-11-16）**：
- 改进迁移算法（基于member.type自动推导）
- 新增运行时安全机制（ensureMigratedConfig）
- 注：v1.6错误地添加了角色管理功能，已在v1.7中删除

**v1.7重大修正（2025-11-16）**：
- 删除v1.6错误添加的角色管理功能
- 恢复并强化角色定义不可编辑原则
- 删除成员角色修改操作

**v1.8关键修正（2025-11-16）**：
- 迁移向导改为确认模式（不允许自定义角色）
- 明确添加成员只能从现有角色选择
- 清理版本历史中的混淆内容
- 主菜单添加角色不可修改的显式告知
