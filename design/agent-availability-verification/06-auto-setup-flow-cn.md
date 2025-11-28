# Agent 自动化设置流程设计

## 文档定位

本文档是 `05-improvement-proposal-cn.md` 的**上层扩展**，关系如下：

```
┌─────────────────────────────────────────────────────────────────────┐
│                      06-auto-setup-flow (本文档)                     │
│                                                                     │
│  解决问题：用户从零开始，如何让 Agent 可用？                           │
│  范围：Node.js 安装 → Agent CLI 安装 → 认证设置                       │
│  目标用户：非技术用户，使用 Electron 桌面应用                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ 依赖
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 05-improvement-proposal (现有文档)                   │
│                                                                     │
│  解决问题：如何准确判断 Agent 是否已认证？                             │
│  范围：认证检测、错误分类、网络诊断                                    │
│  目标用户：已安装好环境的用户                                         │
└─────────────────────────────────────────────────────────────────────┘
```

**关系说明**：
- **05 文档**关注的是"验证"——假设用户已经安装了 Agent CLI，如何准确判断认证状态
- **06 文档（本文档）**关注的是"设置"——从零开始，引导用户完成所有前置条件
- 06 的"认证设置"步骤完成后，会调用 05 的"验证逻辑"来确认设置成功
- 两者共享同一套错误类型定义和 UI 反馈机制

## 问题背景

### 当前用户启动成本

要成功使用 Agent Chatter（以 Claude 为例），用户需要：

| 步骤 | 用户需要做的事 | 难度 |
|------|--------------|------|
| 1 | 安装 Agent Chatter | 简单（下载安装包） |
| 2 | 安装 Node.js | 中等（需要知道去哪下载） |
| 3 | 安装 Claude CLI (`npm install -g @anthropic-ai/claude-code`) | 困难（需要知道命令） |
| 4 | 认证 Claude (`claude auth login` 或设置 API Key) | 困难（需要知道命令） |
| 5 | 创建 Team 配置文件 | 困难（需要知道 JSON 格式） |

**核心问题**：步骤 2-4 对非技术用户来说门槛太高。

### 目标

将步骤 2-4 变成**自动化引导流程**：
- 用户只需要点击"确认"或输入 API Key
- 所有命令和路径由程序自动处理
- 错误情况给出明确的修复指引

## 设计目标

### G1: 跨平台复用

同一套核心逻辑必须在以下环境中工作：
- **REPL 模式**：当前的命令行版本
- **Electron 模式**：未来的桌面应用版本

### G2: 渐进式体验

- 新手用户：全自动引导，只需确认
- 高级用户：可跳过任意步骤，手动配置

### G3: 可靠性优先

- 每一步都有检测 → 确认 → 执行 → 验证的完整流程
- 失败时提供明确的恢复路径

## 完整的依赖链

```
用户启动 Agent Chatter
         │
         ▼
    Node.js 存在？ ──否──→ [安装 Node.js]
         │                    │
        是                    ▼
         │              安装成功？──否──→ 引导用户手动安装
         │                    │
         ◄────────────────────┘
         │
         ▼
    Agent CLI 存在？ ──否──→ [npm install -g xxx]
         │                    │
        是                    ▼
         │              安装成功？──否──→ 显示错误，提供手动命令
         │                    │
         ◄────────────────────┘
         │
         ▼
    Agent 已认证？ ──否──→ [OAuth 或 API Key 设置]
    (调用 05 的验证逻辑)       │
         │                    ▼
        是              设置成功？──否──→ 显示错误，提供帮助链接
         │                    │
         ◄────────────────────┘
         │
         ▼
    ✓ Ready to use
```

## 架构设计

### 核心设计原则

1. **Core/UI 分离**：Core 层是纯逻辑库，可在任何环境（本地/云端/CI）运行；UI 层负责交互和流程编排
2. **每个 Agent 一个 SetupProvider**：将安装和认证逻辑封装在同一个 Provider 中
3. **Core 层不发起交互**：Core 只做检测、安装、验证，返回结果；交互由 UI 层驱动

### 分层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI Layer (src/repl/)                           │
│                     负责：用户交互、流程编排、进度展示                      │
├─────────────────────────────────────────────────────────────────────────┤
│  REPL Mode (Ink/Inquirer)           │    Electron Mode (React) [未来]    │
│  - SetupOrchestrator (流程编排)      │    - SetupOrchestrator            │
│  - UpdateOrchestrator (更新编排)     │    - UpdateOrchestrator           │
│  - SetupUI (交互实现)                │    - SetupUI                      │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 调用
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Core Layer (src/services/setup/)                 │
│              纯逻辑库，无 UI 依赖，可在 CLI/云端/CI 运行                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    SetupService (聚合服务)                        │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  - checkPrerequisites(agentType): PrerequisiteStatus[]          │    │
│  │  - getRuntimeInstallMethods(type): InstallMethod[]              │    │
│  │  - installRuntime(type, method): InstallResult                  │    │
│  │  - installAgentCLI(agentType): InstallResult                    │    │
│  │  - setupAgentAuth(agentType, method, creds?): AuthResult        │    │
│  │  - checkAllUpdates(): UpdateStatus                              │    │
│  │  - updateComponent(type, id): UpdateResult                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                      │                                  │
│         ┌────────────────────────────┴────────────────────┐             │
│         ▼                                                 ▼             │
│  ┌─────────────────────────────┐      ┌─────────────────────────────┐   │
│  │   Agent Setup Providers     │      │   Runtime Providers         │   │
│  ├─────────────────────────────┤      ├─────────────────────────────┤   │
│  │ ClaudeSetupProvider         │      │ NodeRuntimeProvider         │   │
│  │   - detectCLI()             │      │   - detect()                │   │
│  │   - installCLI()            │      │   - getInstallMethods()     │   │
│  │   - checkAuth()             │      │   - install(method)         │   │
│  │   - setupAuth(method, creds)│      │   - checkForUpdate()        │   │
│  ├─────────────────────────────┤      │   - update()                │   │
│  │ CodexSetupProvider          │      ├─────────────────────────────┤   │
│  │ GeminiSetupProvider         │      │ PythonRuntimeProvider (未来)│   │
│  └─────────────────────────────┘      └─────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core 层 vs UI 层职责

| 职责 | Core 层 | UI 层 |
|------|---------|-------|
| 检测状态 | ✅ `detect()`, `checkAuth()` | 调用 core |
| 返回安装方案 | ✅ `getInstallMethods()` | 展示给用户选择 |
| 执行安装（静默） | ✅ `install(method)` | 调用 core |
| 询问用户确认 | ❌ | ✅ `ui.confirm()` |
| 显示进度/日志 | ❌ | ✅ `ui.showProgress()` |
| 流程决策（重试？跳过？） | ❌ | ✅ Orchestrator |
| 打开浏览器 | ❌ 返回 URL | ✅ `ui.openBrowser(url)` |

### 扩展性设计

**新增 Agent**：
1. 在 Core 层创建 `XxxSetupProvider.ts` 实现 `AgentSetupProvider` 接口
2. 声明 `requiredRuntimes`（该 Agent 依赖的运行时）
3. 在 `SetupService` 中注册

```typescript
// Core 层：新增 Agent Provider
setupService.registerAgentProvider(new XxxSetupProvider());
```

**新增运行时依赖**：
1. 在 Core 层创建 `XxxRuntimeProvider.ts` 实现 `RuntimeProvider` 接口
2. 在 `SetupService` 中注册

```typescript
// Core 层：新增 Runtime Provider
setupService.registerRuntimeProvider(new PythonRuntimeProvider());
```

### 文件结构（按分层）

```
src/
├── services/setup/                     # ===== Core 层 =====
│   │                                   # 纯逻辑，无 UI 依赖
│   │                                   # 未来拆分到 agent-chatter-core repo
│   ├── types.ts                        # 纯数据类型定义
│   ├── SetupService.ts                 # 聚合服务（无交互）
│   ├── AppUpdateChecker.ts             # 应用更新检测
│   ├── runtimes/
│   │   ├── RuntimeProvider.ts          # 接口定义
│   │   ├── NodeRuntimeProvider.ts      # Node.js: detect/install/update
│   │   └── PythonRuntimeProvider.ts    # Python（未来）
│   └── agents/
│       ├── AgentSetupProvider.ts       # 接口定义
│       ├── BaseAgentSetupProvider.ts   # 通用逻辑基类
│       ├── ClaudeSetupProvider.ts      # Claude: CLI + Auth
│       ├── CodexSetupProvider.ts       # Codex: CLI + Auth
│       └── GeminiSetupProvider.ts      # Gemini: CLI + Auth
│
└── repl/setup/                         # ===== UI 层 (REPL) =====
    │                                   # 交互和流程编排
    │                                   # 未来拆分到 agent-chatter-repl repo
    ├── SetupOrchestrator.ts            # 设置流程编排（调用 Core + 用户交互）
    ├── UpdateOrchestrator.ts           # 更新流程编排
    └── SetupUI.ts                      # Inquirer/Ink 交互实现

# Electron 版（未来，独立 repo）
# agent-chatter-electron/
# └── src/setup/
#     ├── SetupOrchestrator.ts          # 同样的编排逻辑
#     ├── UpdateOrchestrator.ts
#     └── SetupUI.ts                    # Electron dialog/React 实现
```

## 核心接口定义（Core 层）

以下接口全部属于 Core 层，**不依赖任何 UI**。

### RuntimeProvider 接口

```typescript
// src/services/setup/runtimes/RuntimeProvider.ts

/**
 * 运行时环境提供者接口（Core 层）
 * 每个运行时 (Node.js/Python/Docker) 实现此接口
 *
 * 特点：纯逻辑，无 UI 交互，所有方法返回数据供 UI 层使用
 */
interface RuntimeProvider {
  /** 运行时标识，如 'node', 'python', 'docker' */
  readonly runtimeType: string;

  /** 显示名称，如 'Node.js', 'Python', 'Docker' */
  readonly displayName: string;

  /** 推荐的最低版本 */
  readonly minimumVersion: string;

  /**
   * 检测运行时是否已安装
   */
  detect(): Promise<RuntimeDetectResult>;

  /**
   * 获取当前平台可用的安装方案列表
   * UI 层可展示给用户选择
   */
  getInstallMethods(): Promise<InstallMethod[]>;

  /**
   * 执行安装（静默，无交互）
   * @param method 用户选择的安装方案
   */
  install(method: InstallMethod): Promise<InstallResult>;

  /**
   * 检查是否有新版本
   */
  checkForUpdate(): Promise<UpdateCheckResult>;

  /**
   * 执行更新（静默）
   */
  update(): Promise<UpdateResult>;
}

/** 检测结果 */
interface RuntimeDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
  meetsMinimum: boolean;  // 是否满足最低版本要求
}

/** 安装方案 */
interface InstallMethod {
  id: string;                        // 'brew', 'winget', 'download'
  name: string;                      // 方案名称，如 "Homebrew"
  type: 'command' | 'download';
  command?: string;                  // 安装命令
  downloadUrl?: string;              // 下载链接
  requiresElevation: boolean;        // 是否需要管理员权限
  requiresManualAction: boolean;     // 是否需要用户手动操作（如下载安装包）
}

/** 安装结果 */
interface InstallResult {
  success: boolean;
  error?: string;
  version?: string;                  // 安装后的版本
  requiresRestart?: boolean;         // 是否需要重启终端
}

/** 更新检查结果 */
interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  updateUrl?: string;
}

/** 更新结果 */
interface UpdateResult {
  success: boolean;
  newVersion?: string;
  error?: string;
}
```

### AgentSetupProvider 接口

```typescript
// src/services/setup/agents/AgentSetupProvider.ts

/**
 * Agent 设置提供者接口（Core 层）
 * 每个 Agent (Claude/Codex/Gemini) 实现此接口
 *
 * 特点：纯逻辑，无 UI 交互
 * - 检测方法返回状态数据
 * - 安装/认证方法接收明确参数，静默执行
 * - 需要浏览器的操作返回 URL，由 UI 层打开
 */
interface AgentSetupProvider {
  /** Agent 类型标识，如 'claude', 'codex', 'gemini' */
  readonly agentType: string;

  /** 显示名称，如 'Claude Code', 'OpenAI Codex' */
  readonly displayName: string;

  /** npm 包名，如 '@anthropic-ai/claude-code' */
  readonly npmPackage: string;

  /** CLI 命令名，如 'claude', 'codex', 'gemini' */
  readonly command: string;

  /** 该 Agent 依赖的运行时列表 */
  readonly requiredRuntimes: string[];  // ['node'] 或 ['node', 'python']

  // ===== CLI 检测与安装 =====

  /**
   * 检测 CLI 是否已安装
   */
  detectCLI(): Promise<CLIDetectResult>;

  /**
   * 安装 CLI（静默执行）
   */
  installCLI(): Promise<InstallResult>;

  // ===== 认证检测与设置 =====

  /**
   * 检测认证状态
   */
  checkAuth(): Promise<AuthCheckResult>;

  /**
   * 获取支持的认证方法列表
   * UI 层可展示给用户选择
   */
  getSupportedAuthMethods(): AuthMethod[];

  /**
   * 执行认证设置（静默）
   * @param method 认证方法
   * @param credentials 凭证（API Key 等），OAuth 不需要
   */
  setupAuth(method: AuthMethodType, credentials?: AuthCredentials): Promise<AuthResult>;

  // ===== 更新 =====

  /**
   * 检查 CLI 是否有新版本
   */
  checkForCLIUpdate(): Promise<UpdateCheckResult>;

  /**
   * 更新 CLI（静默）
   */
  updateCLI(): Promise<UpdateResult>;
}

/** CLI 检测结果 */
interface CLIDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
}

/** 认证检查结果 */
interface AuthCheckResult {
  authenticated: boolean;
  method?: string;           // 'OAuth', 'API Key', 'Bedrock' 等
  warning?: string;          // 非阻塞警告
}

/** 认证凭证（用于 API Key 等方式） */
interface AuthCredentials {
  apiKey?: string;
  // 其他认证参数...
}

/** 认证结果 */
interface AuthResult {
  success: boolean;
  error?: string;
  requiresBrowser?: boolean;  // 需要打开浏览器（OAuth）
  browserUrl?: string;        // OAuth 授权 URL，UI 层负责打开
}

/** 认证方法类型 */
type AuthMethodType = 'oauth' | 'api-key' | 'bedrock' | 'vertex';

/** 认证方法描述 */
interface AuthMethod {
  type: AuthMethodType;
  label: string;             // 显示名称
  description: string;       // 说明
  recommended: boolean;      // 是否推荐
  requiresCredentials: boolean;  // 是否需要用户输入凭证
}
```

### SetupService 接口

```typescript
// src/services/setup/SetupService.ts

/**
 * 设置服务（Core 层聚合服务）
 * 聚合所有 Provider，提供统一的检测/安装接口
 *
 * 特点：无 UI 依赖，纯数据输入输出
 */
class SetupService {
  private runtimeProviders: Map<string, RuntimeProvider> = new Map();
  private agentProviders: Map<string, AgentSetupProvider> = new Map();

  // ===== Provider 注册 =====

  registerRuntimeProvider(provider: RuntimeProvider): void;
  registerAgentProvider(provider: AgentSetupProvider): void;
  getRegisteredRuntimeTypes(): string[];
  getRegisteredAgentTypes(): string[];

  // ===== 状态检测 =====

  /**
   * 获取指定 Agent 的所有前置条件状态
   */
  async checkPrerequisites(agentType: string): Promise<PrerequisiteStatus[]>;

  /**
   * 获取指定运行时的安装方案
   */
  async getRuntimeInstallMethods(runtimeType: string): Promise<InstallMethod[]>;

  // ===== 安装操作 =====

  /**
   * 安装指定运行时
   */
  async installRuntime(runtimeType: string, method: InstallMethod): Promise<InstallResult>;

  /**
   * 安装指定 Agent CLI
   */
  async installAgentCLI(agentType: string): Promise<InstallResult>;

  /**
   * 设置 Agent 认证
   */
  async setupAgentAuth(
    agentType: string,
    method: AuthMethodType,
    credentials?: AuthCredentials
  ): Promise<AuthResult>;

  // ===== 更新操作 =====

  /**
   * 检查所有组件更新
   */
  async checkAllUpdates(): Promise<UpdateStatus>;

  /**
   * 更新指定组件
   */
  async updateComponent(
    componentType: 'runtime' | 'agent',
    componentId: string
  ): Promise<UpdateResult>;
}
```

### 前置条件状态（Core 层类型）

```typescript
// src/services/setup/types.ts

/** 前置条件类型 */
type PrerequisiteType = 'runtime' | 'agent-cli' | 'agent-auth';

/** 单个前置条件的状态（Core 层返回的纯数据） */
interface PrerequisiteStatus {
  type: PrerequisiteType;
  id: string;                      // 'node', 'claude', 'claude-auth' 等
  name: string;                    // 显示名称，如 "Node.js Runtime"
  status: 'ready' | 'missing' | 'error';
  version?: string;                // 已安装的版本号
  error?: string;                  // 错误信息
  meetsMinimum?: boolean;          // 是否满足最低版本要求
}

/** 更新状态（Core 层返回的纯数据） */
interface UpdateStatus {
  app: {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
  };
  runtimes: Map<string, {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    belowMinimum: boolean;
  }>;
  agents: Map<string, {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
  }>;
}
```

## UI 层接口定义

以下接口属于 UI 层，在 `src/repl/setup/` 中定义和实现。

### SetupUI 接口

```typescript
// src/repl/setup/SetupUI.ts

/**
 * 设置 UI 接口（UI 层）
 * REPL 和 Electron 各自实现此接口
 */
interface SetupUI {
  /**
   * 请求用户确认 (Yes/No)
   */
  confirm(message: string, detail?: string): Promise<boolean>;

  /**
   * 请求用户从选项中选择
   */
  select<T>(message: string, choices: Array<{
    label: string;
    value: T;
    description?: string;
  }>): Promise<T>;

  /**
   * 请求用户输入文本
   */
  input(message: string, options?: {
    hidden?: boolean;
    placeholder?: string;
  }): Promise<string>;

  /**
   * 显示进度信息
   */
  showProgress(message: string): void;

  /**
   * 显示日志消息
   */
  showInfo(message: string): void;
  showSuccess(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;

  /**
   * 打开外部链接（浏览器）
   */
  openBrowser(url: string): Promise<void>;
}
```

### SetupOrchestrator（UI 层编排器）

```typescript
// src/repl/setup/SetupOrchestrator.ts

import { SetupService, PrerequisiteStatus, InstallMethod } from '../../services/setup';

/**
 * 设置流程编排器（UI 层）
 * 负责用户交互、流程决策、调用 Core 层服务
 */
class SetupOrchestrator {
  constructor(
    private setupService: SetupService,
    private ui: SetupUI
  ) {}

  /**
   * 运行完整的设置流程
   */
  async runSetupFlow(agentType: string): Promise<boolean> {
    // 1. 检测状态（调用 Core）
    const prerequisites = await this.setupService.checkPrerequisites(agentType);

    // 2. 遍历缺失项，逐个处理
    for (const prereq of prerequisites) {
      if (prereq.status !== 'ready') {
        const success = await this.handleMissingPrerequisite(prereq, agentType);
        if (!success) {
          return false;
        }
      }
    }

    this.ui.showSuccess('Setup complete!');
    return true;
  }

  private async handleMissingPrerequisite(
    prereq: PrerequisiteStatus,
    agentType: string
  ): Promise<boolean> {
    switch (prereq.type) {
      case 'runtime':
        return this.handleMissingRuntime(prereq);
      case 'agent-cli':
        return this.handleMissingAgentCLI(agentType);
      case 'agent-auth':
        return this.handleMissingAuth(agentType);
      default:
        return false;
    }
  }

  private async handleMissingRuntime(prereq: PrerequisiteStatus): Promise<boolean> {
    this.ui.showWarning(`${prereq.name} is not installed.`);

    // 获取安装方案（调用 Core）
    const methods = await this.setupService.getRuntimeInstallMethods(prereq.id);

    // 找到可自动安装的方案
    const autoMethod = methods.find(m => !m.requiresManualAction);

    if (autoMethod) {
      const confirm = await this.ui.confirm(
        `Install ${prereq.name} via ${autoMethod.name}?`,
        `Command: ${autoMethod.command}`
      );

      if (confirm) {
        this.ui.showProgress(`Installing ${prereq.name}...`);
        const result = await this.setupService.installRuntime(prereq.id, autoMethod);

        if (result.success) {
          this.ui.showSuccess(`${prereq.name} ${result.version} installed!`);
          if (result.requiresRestart) {
            this.ui.showWarning('Please restart your terminal and run again.');
            return false;
          }
          return true;
        } else {
          this.ui.showError(result.error || 'Installation failed');
          return false;
        }
      }
    }

    // 引导手动安装
    const downloadMethod = methods.find(m => m.downloadUrl);
    if (downloadMethod) {
      const open = await this.ui.confirm(
        `Open ${prereq.name} download page?`
      );
      if (open) {
        await this.ui.openBrowser(downloadMethod.downloadUrl!);
      }
      this.ui.showInfo(`Please install ${prereq.name} manually and restart.`);
    }

    return false;
  }

  private async handleMissingAgentCLI(agentType: string): Promise<boolean> {
    const provider = this.setupService.getAgentProvider(agentType);
    this.ui.showWarning(`${provider.displayName} is not installed.`);

    const confirm = await this.ui.confirm(
      `Install ${provider.displayName}?`,
      `Command: npm install -g ${provider.npmPackage}`
    );

    if (!confirm) {
      return false;
    }

    this.ui.showProgress(`Installing ${provider.displayName}...`);
    const result = await this.setupService.installAgentCLI(agentType);

    if (result.success) {
      this.ui.showSuccess(`${provider.displayName} ${result.version} installed!`);
      return true;
    } else {
      this.ui.showError(result.error || 'Installation failed');
      return false;
    }
  }

  private async handleMissingAuth(agentType: string): Promise<boolean> {
    const provider = this.setupService.getAgentProvider(agentType);
    this.ui.showWarning(`${provider.displayName} is not authenticated.`);

    // 获取认证方法（调用 Core）
    const methods = provider.getSupportedAuthMethods();
    const choices = methods.map(m => ({
      label: m.label,
      value: m.type,
      description: m.description + (m.recommended ? ' (Recommended)' : ''),
    }));

    const selectedMethod = await this.ui.select('Choose authentication method:', choices);

    // 如果需要凭证，请求用户输入
    let credentials: AuthCredentials | undefined;
    const methodInfo = methods.find(m => m.type === selectedMethod);

    if (methodInfo?.requiresCredentials) {
      const apiKey = await this.ui.input('Enter your API key:', { hidden: true });
      credentials = { apiKey };
    }

    // 执行认证（调用 Core）
    this.ui.showProgress('Setting up authentication...');
    const result = await this.setupService.setupAgentAuth(agentType, selectedMethod, credentials);

    if (result.success) {
      this.ui.showSuccess(`${provider.displayName} authenticated!`);
      return true;
    }

    // 需要浏览器
    if (result.requiresBrowser && result.browserUrl) {
      this.ui.showInfo('Opening browser for authentication...');
      await this.ui.openBrowser(result.browserUrl);
      this.ui.showInfo('Complete authentication in browser, then restart.');
      return false;
    }

    this.ui.showError(result.error || 'Authentication failed');
    return false;
  }
}
```

## RuntimeProvider 实现（Core 层）

### NodeRuntimeProvider

```typescript
// src/services/setup/runtimes/NodeRuntimeProvider.ts

/**
 * Node.js 运行时 Provider（Core 层）
 * 纯逻辑，无 UI 依赖
 */
class NodeRuntimeProvider implements RuntimeProvider {
  readonly runtimeType = 'node';
  readonly displayName = 'Node.js';
  readonly minimumVersion = '18.0.0';

  constructor(private platform: NodeJS.Platform = process.platform) {}

  async detect(): Promise<RuntimeDetectResult> {
    try {
      const { stdout } = await execAsync('node --version', { timeout: 5000 });
      const version = stdout.trim();  // "v20.10.0"

      const { stdout: pathOut } = await execAsync(
        this.platform === 'win32' ? 'where node' : 'which node'
      );

      return {
        installed: true,
        version,
        path: pathOut.trim().split('\n')[0],
        meetsMinimum: this.compareVersions(version, this.minimumVersion) >= 0,
      };
    } catch {
      return { installed: false, meetsMinimum: false };
    }
  }

  async getInstallMethods(): Promise<InstallMethod[]> {
    const methods: InstallMethod[] = [];

    if (this.platform === 'darwin') {
      if (await this.commandExists('brew')) {
        methods.push({
          id: 'brew',
          name: 'Homebrew',
          type: 'command',
          command: 'brew install node',
          requiresElevation: false,
          requiresManualAction: false,
        });
      }
      methods.push({
        id: 'download-macos',
        name: 'Node.js Installer',
        type: 'download',
        downloadUrl: 'https://nodejs.org/en/download/',
        requiresElevation: false,
        requiresManualAction: true,
      });
    }

    if (this.platform === 'win32') {
      if (await this.commandExists('winget')) {
        methods.push({
          id: 'winget',
          name: 'Windows Package Manager',
          type: 'command',
          command: 'winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
          requiresElevation: false,
          requiresManualAction: false,
        });
      }
      methods.push({
        id: 'download-windows',
        name: 'Node.js Installer',
        type: 'download',
        downloadUrl: 'https://nodejs.org/en/download/',
        requiresElevation: false,
        requiresManualAction: true,
      });
    }

    if (this.platform === 'linux') {
      if (await this.commandExists('apt-get')) {
        methods.push({
          id: 'apt',
          name: 'APT (NodeSource)',
          type: 'command',
          command: 'curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs',
          requiresElevation: true,
          requiresManualAction: true,  // 需要 sudo
        });
      }
      methods.push({
        id: 'download-linux',
        name: 'Node.js',
        type: 'download',
        downloadUrl: 'https://nodejs.org/en/download/',
        requiresElevation: false,
        requiresManualAction: true,
      });
    }

    return methods;
  }

  async install(method: InstallMethod): Promise<InstallResult> {
    if (method.requiresManualAction) {
      return {
        success: false,
        error: 'Manual installation required',
        requiresRestart: true,
      };
    }

    try {
      await execAsync(method.command!, { timeout: 300000 });

      const result = await this.detect();
      if (result.installed) {
        return {
          success: true,
          version: result.version,
          requiresRestart: false,
        };
      } else {
        return {
          success: false,
          error: 'Installation completed but not detected',
          requiresRestart: true,
        };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async checkForUpdate(): Promise<UpdateCheckResult> {
    const current = await this.detect();
    if (!current.installed) {
      return { hasUpdate: false, currentVersion: 'not installed' };
    }

    try {
      const response = await fetch('https://nodejs.org/dist/index.json');
      const versions = await response.json();
      const latestLTS = versions.find((v: any) => v.lts);

      if (latestLTS) {
        return {
          hasUpdate: this.compareVersions(latestLTS.version, current.version!) > 0,
          currentVersion: current.version!,
          latestVersion: latestLTS.version,
          updateUrl: 'https://nodejs.org/en/download/',
        };
      }
    } catch {
      // 网络错误，忽略
    }

    return { hasUpdate: false, currentVersion: current.version || 'unknown' };
  }

  async update(): Promise<UpdateResult> {
    // 使用相同的 install 逻辑
    const methods = await this.getInstallMethods();
    const autoMethod = methods.find(m => !m.requiresManualAction);

    if (autoMethod) {
      if (this.platform === 'darwin' && autoMethod.id === 'brew') {
        try {
          await execAsync('brew upgrade node', { timeout: 300000 });
          const result = await this.detect();
          return { success: true, newVersion: result.version };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }

      if (this.platform === 'win32' && autoMethod.id === 'winget') {
        try {
          await execAsync('winget upgrade OpenJS.NodeJS.LTS', { timeout: 300000 });
          const result = await this.detect();
          return { success: true, newVersion: result.version };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    }

    return { success: false, error: 'Manual update required' };
  }

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const checkCmd = this.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
      await execAsync(checkCmd, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  private compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [aMajor, aMinor, aPatch] = parse(a);
    const [bMajor, bMinor, bPatch] = parse(b);

    if (aMajor !== bMajor) return aMajor - bMajor;
    if (aMinor !== bMinor) return aMinor - bMinor;
    return aPatch - bPatch;
  }
}
```

### 各运行时平台支持汇总

| 运行时 | macOS | Windows | Linux |
|-------|-------|---------|-------|
| Node.js | brew / .pkg | winget / .msi | apt / .tar.gz |
| Python | brew / .pkg | winget / .exe | apt / source |
| Docker | brew / .dmg | winget / .exe | apt / script |

## AgentSetupProvider 实现（Core 层）

每个 Agent 有一个独立的 Provider，封装其安装和认证逻辑。**全部属于 Core 层，无 UI 依赖**。

### 基类：BaseAgentSetupProvider

```typescript
// src/services/setup/agents/BaseAgentSetupProvider.ts

import { execAsync } from '../../utils/exec';

/**
 * Agent 设置提供者基类（Core 层）
 * 提供通用的 CLI 安装和检测逻辑
 *
 * 特点：纯逻辑，无 UI 交互
 */
abstract class BaseAgentSetupProvider implements AgentSetupProvider {
  abstract readonly agentType: string;
  abstract readonly displayName: string;
  abstract readonly npmPackage: string;
  abstract readonly command: string;
  abstract readonly requiredRuntimes: string[];

  // ===== CLI 检测（通用） =====

  async detectCLI(): Promise<CLIDetectResult> {
    try {
      const { stdout } = await execAsync(
        `${this.command} --version`,
        { timeout: 10000 }
      );

      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : stdout.trim();

      return { installed: true, version };
    } catch {
      return { installed: false };
    }
  }

  // ===== CLI 安装（通用，静默执行） =====

  async installCLI(): Promise<InstallResult> {
    const installCmd = `npm install -g ${this.npmPackage}`;

    try {
      await execAsync(installCmd, { timeout: 300000 });  // 5 分钟超时

      const result = await this.detectCLI();
      if (result.installed) {
        return { success: true, version: result.version };
      } else {
        return {
          success: false,
          error: 'Installation completed but CLI not detected',
          requiresRestart: true,
        };
      }
    } catch (error: any) {
      if (error.message?.includes('EACCES') || error.message?.includes('permission denied')) {
        return { success: false, error: `Permission denied. Try: sudo ${installCmd}` };
      }
      if (error.message?.includes('npm: command not found')) {
        return { success: false, error: 'npm not found. Please install Node.js first.' };
      }
      return { success: false, error: error.message };
    }
  }

  // ===== 更新（通用） =====

  async checkForCLIUpdate(): Promise<UpdateCheckResult> {
    const currentResult = await this.detectCLI();
    if (!currentResult.installed) {
      return { hasUpdate: false, currentVersion: 'not installed' };
    }

    try {
      const { stdout } = await execAsync(
        `npm view ${this.npmPackage} version`,
        { timeout: 10000 }
      );
      const latestVersion = stdout.trim();

      return {
        hasUpdate: this.compareVersions(latestVersion, currentResult.version!) > 0,
        currentVersion: currentResult.version!,
        latestVersion,
      };
    } catch {
      return { hasUpdate: false, currentVersion: currentResult.version || 'unknown' };
    }
  }

  async updateCLI(): Promise<UpdateResult> {
    try {
      await execAsync(`npm install -g ${this.npmPackage}@latest`, { timeout: 300000 });

      const result = await this.detectCLI();
      if (result.installed) {
        return { success: true, newVersion: result.version };
      }
      return { success: false, error: 'Update completed but version detection failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ===== 认证（子类实现） =====

  abstract checkAuth(): Promise<AuthCheckResult>;
  abstract getSupportedAuthMethods(): AuthMethod[];
  abstract setupAuth(method: AuthMethodType, credentials?: AuthCredentials): Promise<AuthResult>;

  // ===== 辅助方法 =====

  protected async saveApiKeyToEnv(
    envVarName: string,
    apiKey: string
  ): Promise<void> {
    const envFilePath = path.join(os.homedir(), '.agent-chatter', '.env');

    await fs.mkdir(path.dirname(envFilePath), { recursive: true });

    let envContent = '';
    try {
      envContent = await fs.readFile(envFilePath, 'utf-8');
    } catch {
      // 文件不存在
    }

    const lines = envContent.split('\n').filter(line =>
      !line.startsWith(`${envVarName}=`)
    );
    lines.push(`${envVarName}=${apiKey}`);

    await fs.writeFile(envFilePath, lines.join('\n'), { mode: 0o600 });
    process.env[envVarName] = apiKey;
  }
}
```

### ClaudeSetupProvider

```typescript
// src/setup/providers/ClaudeSetupProvider.ts

class ClaudeSetupProvider extends BaseAgentSetupProvider {
  readonly agentType = 'claude';
  readonly displayName = 'Claude Code';
  readonly npmPackage = '@anthropic-ai/claude-code';
  readonly command = 'claude';
  readonly requiredRuntimes = ['node'];  // 依赖 Node.js

  // ===== 认证检测 =====

  async checkAuth(): Promise<{ authenticated: boolean; method?: string; warning?: string }> {
    // 1. 检查环境变量
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { authenticated: true, method: 'ANTHROPIC_API_KEY' };
    }

    // 2. 检查 Bedrock 模式
    if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
      const awsOk = await this.checkAWSCredentials();
      if (awsOk) {
        return { authenticated: true, method: 'AWS Bedrock' };
      }
      return { authenticated: false, warning: 'Bedrock mode enabled but AWS credentials missing' };
    }

    // 3. 检查 Vertex 模式
    if (process.env.CLAUDE_CODE_USE_VERTEX === '1') {
      const gcpOk = await this.checkGCPCredentials();
      if (gcpOk) {
        return { authenticated: true, method: 'Vertex AI' };
      }
      return { authenticated: false, warning: 'Vertex mode enabled but GCP credentials missing' };
    }

    // 4. 尝试 CLI 状态命令
    try {
      const { stdout } = await execAsync(`${this.command} auth status`, { timeout: 5000 });
      if (stdout.toLowerCase().includes('authenticated') || stdout.toLowerCase().includes('logged in')) {
        return { authenticated: true, method: 'OAuth' };
      }
    } catch {
      // 命令失败，继续检查文件
    }

    // 5. 检查凭证文件 (Linux)
    if (process.platform === 'linux') {
      const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
      if (fs.existsSync(credsPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
          if (creds.accessToken || creds.refreshToken) {
            return { authenticated: true, method: 'OAuth (credentials file)' };
          }
        } catch {}
      }
    }

    // 6. macOS: Keychain 不可读，返回 VERIFICATION_INCOMPLETE
    if (process.platform === 'darwin') {
      return {
        authenticated: true,  // 不阻止
        warning: 'Cannot verify Keychain credentials. If auth fails, run: claude auth login'
      };
    }

    return { authenticated: false };
  }

  getSupportedAuthMethods(): AuthMethod[] {
    return [
      {
        type: 'oauth',
        label: 'Login with Anthropic account',
        description: 'Opens browser for secure login',
        recommended: true,
      },
      {
        type: 'api-key',
        label: 'Use API key',
        description: 'Enter ANTHROPIC_API_KEY manually',
        recommended: false,
      },
      {
        type: 'bedrock',
        label: 'AWS Bedrock',
        description: 'Use AWS credentials for Bedrock',
        recommended: false,
      },
      {
        type: 'vertex',
        label: 'Google Vertex AI',
        description: 'Use GCP credentials for Vertex',
        recommended: false,
      },
    ];
  }

  async setupAuth(method: AuthMethodType, ui: SetupUICallbacks): Promise<{ success: boolean; error?: string }> {
    switch (method) {
      case 'oauth':
        return this.setupOAuth(ui);
      case 'api-key':
        const apiKey = await ui.input('Enter your Anthropic API key:', {
          hidden: true,
          placeholder: 'sk-ant-...',
        });
        await this.saveApiKeyToEnv('ANTHROPIC_API_KEY', apiKey);
        const result = await this.checkAuth();
        return { success: result.authenticated, error: result.authenticated ? undefined : 'Invalid API key' };
      case 'bedrock':
        return this.setupBedrock(ui);
      case 'vertex':
        return this.setupVertex(ui);
      default:
        return { success: false, error: `Unsupported auth method: ${method}` };
    }
  }

  private async setupOAuth(ui: SetupUICallbacks): Promise<{ success: boolean; error?: string }> {
    ui.log('info', 'Opening browser for Anthropic login...');
    try {
      await execAsync(`${this.command} auth login`, { timeout: 300000 });
      const result = await this.checkAuth();
      return { success: result.authenticated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async setupBedrock(ui: SetupUICallbacks): Promise<{ success: boolean; error?: string }> {
    ui.log('info', 'To use AWS Bedrock, you need:');
    ui.log('info', '1. AWS CLI installed and configured');
    ui.log('info', '2. Set CLAUDE_CODE_USE_BEDROCK=1');

    const hasAWS = await this.checkAWSCredentials();
    if (!hasAWS) {
      await ui.openExternal('https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
      return { success: false, error: 'Please install and configure AWS CLI first' };
    }

    await this.saveApiKeyToEnv('CLAUDE_CODE_USE_BEDROCK', '1');
    return { success: true };
  }

  private async setupVertex(ui: SetupUICallbacks): Promise<{ success: boolean; error?: string }> {
    ui.log('info', 'To use Google Vertex AI, you need:');
    ui.log('info', '1. gcloud CLI installed and configured');
    ui.log('info', '2. Set CLAUDE_CODE_USE_VERTEX=1');

    const hasGCP = await this.checkGCPCredentials();
    if (!hasGCP) {
      await ui.openExternal('https://cloud.google.com/sdk/docs/install');
      return { success: false, error: 'Please install and configure gcloud CLI first' };
    }

    await this.saveApiKeyToEnv('CLAUDE_CODE_USE_VERTEX', '1');
    return { success: true };
  }

  private async checkAWSCredentials(): Promise<boolean> {
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      return true;
    }
    const awsCredsPath = path.join(os.homedir(), '.aws', 'credentials');
    return fs.existsSync(awsCredsPath);
  }

  private async checkGCPCredentials(): Promise<boolean> {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }
    const adcPath = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
    return fs.existsSync(adcPath);
  }
}
```

### CodexSetupProvider

```typescript
// src/setup/providers/CodexSetupProvider.ts

class CodexSetupProvider extends BaseAgentSetupProvider {
  readonly agentType = 'codex';
  readonly displayName = 'OpenAI Codex';
  readonly npmPackage = '@openai/codex';
  readonly command = 'codex';
  readonly requiredRuntimes = ['node'];  // 依赖 Node.js

  async checkAuth(): Promise<{ authenticated: boolean; method?: string; warning?: string }> {
    // 1. 检查环境变量
    if (process.env.OPENAI_API_KEY?.trim()) {
      return { authenticated: true, method: 'OPENAI_API_KEY' };
    }
    if (process.env.CODEX_API_KEY?.trim()) {
      return { authenticated: true, method: 'CODEX_API_KEY' };
    }

    // 2. 使用 codex login status（推荐）
    try {
      await execAsync(`${this.command} login status`, { timeout: 5000 });
      return { authenticated: true, method: 'OAuth' };
    } catch {
      // 非零退出码 = 未认证
    }

    // 3. 检查 auth 文件
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (fs.existsSync(authPath)) {
      try {
        const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        if (auth.OPENAI_API_KEY || auth.tokens?.access_token) {
          return {
            authenticated: false,
            warning: 'Credentials found but may be expired. Try: codex login'
          };
        }
      } catch {}
    }

    return { authenticated: false };
  }

  getSupportedAuthMethods(): AuthMethod[] {
    return [
      {
        type: 'oauth',
        label: 'Login with ChatGPT account',
        description: 'Requires ChatGPT Plus/Pro/Business subscription',
        recommended: true,
      },
      {
        type: 'api-key',
        label: 'Use OpenAI API key',
        description: 'Enter OPENAI_API_KEY manually',
        recommended: false,
      },
    ];
  }

  async setupAuth(method: AuthMethodType, ui: SetupUICallbacks): Promise<{ success: boolean; error?: string }> {
    if (method === 'oauth') {
      ui.log('info', 'Opening browser for ChatGPT login...');
      try {
        await execAsync(`${this.command} login`, { timeout: 300000 });
        const result = await this.checkAuth();
        return { success: result.authenticated };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }

    if (method === 'api-key') {
      const apiKey = await ui.input('Enter your OpenAI API key:', {
        hidden: true,
        placeholder: 'sk-...',
      });
      await this.saveApiKeyToEnv('OPENAI_API_KEY', apiKey);
      const result = await this.checkAuth();
      return { success: result.authenticated };
    }

    return { success: false, error: `Unsupported auth method: ${method}` };
  }
}
```

### GeminiSetupProvider

```typescript
// src/setup/providers/GeminiSetupProvider.ts

class GeminiSetupProvider extends BaseAgentSetupProvider {
  readonly agentType = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly npmPackage = '@google/gemini-cli';  // ✅ 已从源码确认
  readonly command = 'gemini';
  readonly requiredRuntimes = ['node'];  // 依赖 Node.js

  async checkAuth(): Promise<{ authenticated: boolean; method?: string; warning?: string }> {
    // 1. 检查环境变量
    if (process.env.GEMINI_API_KEY?.trim()) {
      return { authenticated: true, method: 'GEMINI_API_KEY' };
    }
    if (process.env.GOOGLE_API_KEY?.trim()) {
      return { authenticated: true, method: 'GOOGLE_API_KEY' };
    }

    // 2. 检查 Vertex AI 模式
    if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        if (fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
          return { authenticated: true, method: 'Vertex AI Service Account' };
        }
      }
      // 检查 ADC
      try {
        await execAsync('gcloud auth application-default print-access-token', { timeout: 5000 });
        return { authenticated: true, method: 'Vertex AI ADC' };
      } catch {}
    }

    // 3. 检查 OAuth 凭证文件
    const credPaths = [
      path.join(os.homedir(), '.gemini', 'oauth_creds.json'),
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gemini', 'oauth_creds.json'),
    ];

    for (const credPath of credPaths) {
      if (fs.existsSync(credPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
          if (creds.access_token || creds.refresh_token) {
            return { authenticated: true, method: 'Google OAuth' };
          }
        } catch {}
      }
    }

    // 4. 尝试执行命令检查退出码
    try {
      const { stdout } = await execAsync(`echo "test" | ${this.command} 2>&1; echo "EXIT:$?"`, {
        timeout: 10000,
        shell: true,
      });
      const exitMatch = stdout.match(/EXIT:(\d+)/);
      if (exitMatch) {
        const exitCode = parseInt(exitMatch[1], 10);
        if (exitCode === 0) {
          return { authenticated: true, method: 'CLI test passed' };
        }
        if (exitCode === 41) {
          return { authenticated: false };  // 明确的认证错误
        }
      }
    } catch {}

    return { authenticated: false };
  }

  getSupportedAuthMethods(): AuthMethod[] {
    return [
      {
        type: 'oauth',
        label: 'Login with Google account',
        description: 'Opens browser for Google OAuth',
        recommended: true,
      },
      {
        type: 'api-key',
        label: 'Use Gemini API key',
        description: 'Enter GEMINI_API_KEY from AI Studio',
        recommended: false,
      },
      {
        type: 'vertex',
        label: 'Google Vertex AI',
        description: 'Use GCP credentials for Vertex',
        recommended: false,
      },
    ];
  }

  async setupAuth(method: AuthMethodType, ui: SetupUICallbacks): Promise<{ success: boolean; error?: string }> {
    if (method === 'oauth') {
      ui.log('info', 'Starting Gemini CLI for authentication...');
      ui.log('info', 'Follow the prompts in the CLI to complete login.');
      try {
        // Gemini 没有专门的 auth 命令，直接运行会触发 OAuth
        await execAsync(this.command, { timeout: 300000 });
        const result = await this.checkAuth();
        return { success: result.authenticated };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }

    if (method === 'api-key') {
      const apiKey = await ui.input('Enter your Gemini API key:', {
        hidden: true,
        placeholder: 'AI...',
      });
      await this.saveApiKeyToEnv('GEMINI_API_KEY', apiKey);
      const result = await this.checkAuth();
      return { success: result.authenticated };
    }

    if (method === 'vertex') {
      ui.log('info', 'To use Vertex AI:');
      ui.log('info', '1. Install gcloud CLI');
      ui.log('info', '2. Run: gcloud auth application-default login');
      ui.log('info', '3. Set GOOGLE_GENAI_USE_VERTEXAI=true');

      await this.saveApiKeyToEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');

      const projectId = await ui.input('Enter your GCP Project ID:');
      await this.saveApiKeyToEnv('GOOGLE_CLOUD_PROJECT', projectId);

      const result = await this.checkAuth();
      return { success: result.authenticated };
    }

    return { success: false, error: `Unsupported auth method: ${method}` };
  }
}
```

### 各 Agent 信息汇总

| Agent | npm 包名 | CLI 命令 | OAuth 命令 | 状态检查 |
|-------|---------|---------|-----------|---------|
| Claude | `@anthropic-ai/claude-code` | `claude` | `claude auth login` | `claude auth status` |
| Codex | `@openai/codex` | `codex` | `codex login` | `codex login status` |
| Gemini | `@google/gemini-cli` | `gemini` | 直接运行触发 | 检查退出码 41 |

## 核心编排器

编排器不包含任何 Agent 或运行时特定逻辑，只负责流程控制。通过注册机制管理 RuntimeProvider 和 AgentSetupProvider。

```typescript
// src/setup/SetupOrchestrator.ts

class SetupOrchestrator {
  private runtimeProviders: Map<string, RuntimeProvider> = new Map();
  private agentProviders: Map<string, AgentSetupProvider> = new Map();

  constructor(platform: NodeJS.Platform = process.platform) {
    // 注册默认 Runtime Providers
    this.registerRuntimeProvider(new NodeRuntimeProvider(platform));
    // 未来可添加：
    // this.registerRuntimeProvider(new PythonRuntimeProvider(platform));
    // this.registerRuntimeProvider(new DockerRuntimeProvider(platform));

    // 注册默认 Agent Providers
    this.registerAgentProvider(new ClaudeSetupProvider());
    this.registerAgentProvider(new CodexSetupProvider());
    this.registerAgentProvider(new GeminiSetupProvider());
  }

  /** 注册新的 Runtime Provider（扩展点） */
  registerRuntimeProvider(provider: RuntimeProvider): void {
    this.runtimeProviders.set(provider.runtimeType, provider);
  }

  /** 注册新的 Agent Provider（扩展点） */
  registerAgentProvider(provider: AgentSetupProvider): void {
    this.agentProviders.set(provider.agentType, provider);
  }

  /** 获取所有已注册的 Agent 类型 */
  getRegisteredAgentTypes(): string[] {
    return Array.from(this.agentProviders.keys());
  }

  /** 获取所有已注册的 Runtime 类型 */
  getRegisteredRuntimeTypes(): string[] {
    return Array.from(this.runtimeProviders.keys());
  }

  /** 检查所有前置条件（不执行安装） */
  async checkPrerequisites(agentType: string): Promise<SetupStatus> {
    const prerequisites: PrerequisiteStatus[] = [];

    // 1. 获取 Agent Provider
    const agentProvider = this.agentProviders.get(agentType);
    if (!agentProvider) {
      prerequisites.push({
        id: 'agent-cli',
        name: `${agentType} CLI`,
        status: 'error',
        error: `Unknown agent type: ${agentType}. Registered: ${this.getRegisteredAgentTypes().join(', ')}`,
        canAutoFix: false,
      });
      return { ready: false, prerequisites };
    }

    // 2. 检查该 Agent 所需的所有运行时
    for (const runtimeType of agentProvider.requiredRuntimes) {
      const runtimeProvider = this.runtimeProviders.get(runtimeType);
      if (!runtimeProvider) {
        prerequisites.push({
          id: `runtime-${runtimeType}` as PrerequisiteId,
          name: `${runtimeType} Runtime`,
          status: 'error',
          error: `Runtime provider not registered: ${runtimeType}`,
          canAutoFix: false,
        });
        return { ready: false, prerequisites };
      }

      const runtimeResult = await runtimeProvider.detect();
      prerequisites.push({
        id: `runtime-${runtimeType}` as PrerequisiteId,
        name: runtimeProvider.displayName,
        status: runtimeResult.installed ? 'ready' : 'missing',
        version: runtimeResult.version,
        canAutoFix: true,
        autoFixDescription: `Install ${runtimeProvider.displayName}`,
      });

      if (!runtimeResult.installed) {
        return { ready: false, prerequisites };
      }
    }

    // 3. 检查 Agent CLI（通过 Provider）
    const cliResult = await agentProvider.detectCLI();
    prerequisites.push({
      id: 'agent-cli',
      name: agentProvider.displayName,
      status: cliResult.installed ? 'ready' : 'missing',
      version: cliResult.version,
      canAutoFix: true,
      autoFixDescription: `Run: npm install -g ${agentProvider.npmPackage}`,
    });

    if (!cliResult.installed) {
      return { ready: false, prerequisites };
    }

    // 4. 检查认证状态（通过 Provider）
    const authResult = await agentProvider.checkAuth();
    prerequisites.push({
      id: 'agent-auth',
      name: `${agentProvider.displayName} Authentication`,
      status: authResult.authenticated ? 'ready' : 'missing',
      canAutoFix: true,
      autoFixDescription: `Run: ${agentProvider.command} to authenticate`,
    });

    return {
      ready: prerequisites.every(p => p.status === 'ready'),
      prerequisites,
    };
  }

  /** 运行完整的设置流程 */
  async runSetupFlow(
    agentType: string,
    ui: SetupUICallbacks
  ): Promise<SetupResult> {
    // 获取 Agent Provider
    const agentProvider = this.agentProviders.get(agentType);
    if (!agentProvider) {
      return {
        success: false,
        error: `Unknown agent type: ${agentType}. Registered: ${this.getRegisteredAgentTypes().join(', ')}`,
        prerequisitesFinal: [],
      };
    }

    // === Step 1: 检查并安装所需的运行时 ===
    const totalRuntimes = agentProvider.requiredRuntimes.length;
    for (let i = 0; i < totalRuntimes; i++) {
      const runtimeType = agentProvider.requiredRuntimes[i];
      const runtimeProvider = this.runtimeProviders.get(runtimeType);

      if (!runtimeProvider) {
        return {
          success: false,
          error: `Runtime provider not registered: ${runtimeType}`,
          prerequisitesFinal: [],
        };
      }

      const progressPercent = Math.floor((i / totalRuntimes) * 30) + 10;  // 10% - 40%
      ui.onProgress({
        ready: false,
        prerequisites: [],
        currentStep: `Checking ${runtimeProvider.displayName}...`,
        progress: progressPercent,
      });

      const runtimeResult = await runtimeProvider.detect();
      if (!runtimeResult.installed) {
        ui.log('warn', `${runtimeProvider.displayName} is not installed.`);

        const method = await runtimeProvider.getBestInstallMethod();

        if (method.requiresUserAction) {
          const proceed = await ui.confirm(
            `${runtimeProvider.displayName} is required. Open download page?`,
            { detail: method.url }
          );
          if (proceed) {
            await ui.openExternal(method.url!);
            ui.log('info', `Please install ${runtimeProvider.displayName} and restart Agent Chatter.`);
            return {
              success: false,
              error: `Waiting for ${runtimeProvider.displayName} installation. Please restart after installing.`,
              prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
            };
          } else {
            return {
              success: false,
              error: `${runtimeProvider.displayName} is required to continue.`,
              prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
            };
          }
        } else {
          const confirm = await ui.confirm(
            `Install ${runtimeProvider.displayName} automatically via ${method.name}?`,
            { detail: `Command: ${method.command}` }
          );
          if (confirm) {
            const installResult = await runtimeProvider.install(ui);
            if (!installResult.success) {
              return {
                success: false,
                error: installResult.error,
                prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
              };
            }
          } else {
            return {
              success: false,
              error: `${runtimeProvider.displayName} is required to continue.`,
              prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
            };
          }
        }
      } else {
        ui.log('success', `${runtimeProvider.displayName} ${runtimeResult.version} detected.`);
      }
    }

    // === Step 2: Agent CLI（通过 Provider） ===
    ui.onProgress({
      ready: false,
      prerequisites: [],
      currentStep: `Checking ${agentProvider.displayName}...`,
      progress: 50,
    });

    const cliResult = await agentProvider.detectCLI();

    if (!cliResult.installed) {
      ui.log('warn', `${agentProvider.displayName} is not installed.`);

      const confirm = await ui.confirm(
        `Install ${agentProvider.displayName}?`,
        { detail: `Command: npm install -g ${agentProvider.npmPackage}` }
      );

      if (confirm) {
        const installResult = await agentProvider.installCLI(ui);
        if (!installResult.success) {
          return {
            success: false,
            error: installResult.error,
            prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
          };
        }
      } else {
        return {
          success: false,
          error: `${agentProvider.displayName} is required to continue.`,
          prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
        };
      }
    } else {
      ui.log('success', `${agentProvider.displayName} ${cliResult.version} detected.`);
    }

    // === Step 3: Authentication（通过 Provider） ===
    ui.onProgress({
      ready: false,
      prerequisites: [],
      currentStep: 'Checking authentication...',
      progress: 75,
    });

    const authResult = await agentProvider.checkAuth();

    if (!authResult.authenticated) {
      ui.log('warn', `${agentProvider.displayName} is not authenticated.`);

      // 从 Provider 获取支持的认证方式
      const supportedMethods = agentProvider.getSupportedAuthMethods();
      const choices = supportedMethods.map(m => ({
        label: m.label,
        value: m.type,
        description: m.description + (m.recommended ? ' (Recommended)' : ''),
      }));

      const selectedMethod = await ui.select('Choose authentication method:', choices);

      const setupResult = await agentProvider.setupAuth(selectedMethod, ui);
      if (!setupResult.success) {
        return {
          success: false,
          error: setupResult.error,
          prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
        };
      }
    } else {
      ui.log('success', `${agentProvider.displayName} authenticated via ${authResult.method}.`);
    }

    // === Complete ===
    ui.onProgress({
      ready: true,
      prerequisites: [],
      currentStep: 'Setup complete!',
      progress: 100,
    });

    return {
      success: true,
      prerequisitesFinal: (await this.checkPrerequisites(agentType)).prerequisites,
    };
  }
}
```

## REPL UI 实现

```typescript
// src/setup/ui/ReplSetupUI.ts

import inquirer from 'inquirer';
import open from 'open';
import chalk from 'chalk';

class ReplSetupUI implements SetupUICallbacks {
  async confirm(message: string, options?: { default?: boolean; detail?: string }): Promise<boolean> {
    if (options?.detail) {
      console.log(chalk.dim(`  ${options.detail}`));
    }

    const result = await inquirer.prompt([{
      type: 'confirm',
      name: 'value',
      message,
      default: options?.default ?? true,
    }]);
    return result.value;
  }

  async select<T>(
    message: string,
    choices: Array<{ label: string; value: T; description?: string }>
  ): Promise<T> {
    const result = await inquirer.prompt([{
      type: 'list',
      name: 'value',
      message,
      choices: choices.map(c => ({
        name: c.description ? `${c.label} - ${chalk.dim(c.description)}` : c.label,
        value: c.value,
      })),
    }]);
    return result.value;
  }

  async input(
    message: string,
    options?: { hidden?: boolean; placeholder?: string; validate?: (v: string) => string | null }
  ): Promise<string> {
    const result = await inquirer.prompt([{
      type: options?.hidden ? 'password' : 'input',
      name: 'value',
      message,
      validate: options?.validate
        ? (input: string) => options.validate!(input) || true
        : undefined,
    }]);
    return result.value;
  }

  onProgress(status: SetupStatus): void {
    if (status.currentStep) {
      console.log();
      console.log(chalk.cyan(`▸ ${status.currentStep}`));
    }
  }

  log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const styles = {
      info: { icon: 'ℹ', color: chalk.blue },
      warn: { icon: '⚠', color: chalk.yellow },
      error: { icon: '✗', color: chalk.red },
      success: { icon: '✓', color: chalk.green },
    };
    const style = styles[level];
    console.log(`${style.color(style.icon)} ${message}`);
  }

  async openExternal(url: string): Promise<void> {
    await open(url);
  }

  // REPL 模式不支持 elevated execution
  execElevated = undefined;
}
```

## 使用示例

### CLI 命令

```bash
# 设置单个 Agent
agent-chatter setup claude
agent-chatter setup codex
agent-chatter setup gemini

# 检查状态（不执行安装）
agent-chatter setup claude --check-only

# 跳过确认（高级用户）
agent-chatter setup claude --yes
```

### 程序调用

```typescript
// 在 REPL 启动时检查并引导设置
async function initializeWithSetup(agentType: string) {
  const orchestrator = new SetupOrchestrator();
  const ui = new ReplSetupUI();

  // 检查前置条件
  const status = await orchestrator.checkAllPrerequisites(agentType);

  if (!status.ready) {
    console.log('\nSome prerequisites are missing. Starting setup...\n');

    const result = await orchestrator.runSetupFlow(agentType, ui);

    if (!result.success) {
      console.error(`\nSetup failed: ${result.error}`);
      process.exit(1);
    }
  }

  console.log('\n✓ All prerequisites satisfied. Starting Agent Chatter...\n');
  // 继续正常启动流程
}
```

## 用户体验示例

### 全新用户（macOS + Homebrew）

```
$ agent-chatter setup claude

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Claude Setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ Checking Node.js...
⚠ Node.js is not installed.

Install Node.js automatically via Homebrew?
  Command: brew install node
? (Y/n): y

ℹ Installing Node.js via Homebrew...
ℹ Running: brew install node
████████████████████████████████ 100%
✓ Node.js v20.10.0 installed successfully!

▸ Checking Claude Code...
⚠ Claude Code is not installed.

Install Claude Code?
  Command: npm install -g @anthropic-ai/claude-code
? (Y/n): y

ℹ Installing Claude Code...
ℹ Running: npm install -g @anthropic-ai/claude-code
████████████████████████████████ 100%
✓ Claude Code 1.0.16 installed successfully!

▸ Checking authentication...
⚠ Claude Code is not authenticated.

? Choose authentication method:
❯ Login with account - Recommended. Opens browser for login.
  Use API key - Enter your API key manually.

ℹ Opening browser for authentication...
(等待用户在浏览器中完成登录)
✓ Successfully authenticated with Claude Code!

▸ Setup complete!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Claude is ready to use!

Quick start:
  agent-chatter start --agent claude

Custom team:
  agent-chatter start --team ./team.json
```

## 版本检测与更新

除了初次安装，还需要处理版本更新场景。涉及三个层面：

```
┌─────────────────────────────────────────────────────────────────┐
│                    版本更新范围                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. Agent Chatter 自身      - 应用更新检测与升级                  │
│  2. Agent CLI (Claude/Codex/Gemini)  - Agent 工具更新            │
│  3. Runtime (Node.js/Python)         - 运行时更新                │
└─────────────────────────────────────────────────────────────────┘
```

### 版本检测接口扩展

#### RuntimeProvider 新增方法

```typescript
interface RuntimeProvider {
  // ... 现有方法 ...

  /**
   * 检查是否有新版本可用
   */
  checkForUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    releaseNotes?: string;
    updateUrl?: string;
  }>;

  /**
   * 获取推荐的最低版本
   * 用于警告用户版本过旧可能导致兼容问题
   */
  getMinimumRecommendedVersion(): string;

  /**
   * 更新运行时
   */
  update(ui: SetupUICallbacks): Promise<{
    success: boolean;
    newVersion?: string;
    error?: string;
  }>;
}
```

#### AgentSetupProvider 新增方法

```typescript
interface AgentSetupProvider {
  // ... 现有方法 ...

  /**
   * 检查 CLI 是否有新版本
   */
  checkForCLIUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    releaseNotes?: string;
    breaking?: boolean;  // 是否有破坏性变更
  }>;

  /**
   * 更新 CLI
   */
  updateCLI(ui: SetupUICallbacks): Promise<{
    success: boolean;
    newVersion?: string;
    error?: string;
  }>;
}
```

### 应用自身更新检测

```typescript
// src/setup/AppUpdateChecker.ts

interface AppVersion {
  current: string;
  latest: string;
  hasUpdate: boolean;
  releaseNotes?: string;
  downloadUrl?: string;
  isBreaking?: boolean;
}

class AppUpdateChecker {
  private readonly updateCheckUrl = 'https://api.testany.io/agent-chatter/version';
  private readonly packageName = 'testany-agent-chatter';

  /**
   * 检查应用更新
   * Electron 版和 REPL 版走不同的渠道
   */
  async checkForUpdate(mode: 'npm' | 'electron'): Promise<AppVersion> {
    const currentVersion = this.getCurrentVersion();

    if (mode === 'npm') {
      return this.checkNpmUpdate(currentVersion);
    } else {
      return this.checkElectronUpdate(currentVersion);
    }
  }

  private getCurrentVersion(): string {
    // 从 package.json 读取
    return require('../package.json').version;
  }

  private async checkNpmUpdate(currentVersion: string): Promise<AppVersion> {
    try {
      const { stdout } = await execAsync(
        `npm view ${this.packageName} version`,
        { timeout: 10000 }
      );
      const latestVersion = stdout.trim();

      return {
        current: currentVersion,
        latest: latestVersion,
        hasUpdate: this.isNewerVersion(latestVersion, currentVersion),
      };
    } catch {
      return { current: currentVersion, latest: currentVersion, hasUpdate: false };
    }
  }

  private async checkElectronUpdate(currentVersion: string): Promise<AppVersion> {
    try {
      const response = await fetch(this.updateCheckUrl);
      const data = await response.json();

      return {
        current: currentVersion,
        latest: data.version,
        hasUpdate: this.isNewerVersion(data.version, currentVersion),
        releaseNotes: data.releaseNotes,
        downloadUrl: data.downloadUrl,
        isBreaking: data.isBreaking,
      };
    } catch {
      return { current: currentVersion, latest: currentVersion, hasUpdate: false };
    }
  }

  /**
   * 执行更新
   */
  async performUpdate(
    mode: 'npm' | 'electron',
    ui: SetupUICallbacks
  ): Promise<{ success: boolean; error?: string }> {
    if (mode === 'npm') {
      ui.log('info', `Updating ${this.packageName}...`);
      try {
        await execAsync(`npm install -g ${this.packageName}@latest`, { timeout: 300000 });
        ui.log('success', 'Update complete! Please restart the application.');
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    } else {
      // Electron 版：下载新版本安装包
      const version = await this.checkElectronUpdate(this.getCurrentVersion());
      if (version.downloadUrl) {
        await ui.openExternal(version.downloadUrl);
        return { success: true };  // 用户手动安装
      }
      return { success: false, error: 'Download URL not available' };
    }
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const [lMajor, lMinor, lPatch] = latest.split('.').map(Number);
    const [cMajor, cMinor, cPatch] = current.split('.').map(Number);

    if (lMajor > cMajor) return true;
    if (lMajor === cMajor && lMinor > cMinor) return true;
    if (lMajor === cMajor && lMinor === cMinor && lPatch > cPatch) return true;
    return false;
  }
}
```

### BaseAgentSetupProvider 更新方法实现

```typescript
// 在 BaseAgentSetupProvider 中添加

abstract class BaseAgentSetupProvider implements AgentSetupProvider {
  // ... 现有代码 ...

  async checkForCLIUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    releaseNotes?: string;
    breaking?: boolean;
  }> {
    const currentResult = await this.detectCLI();
    if (!currentResult.installed) {
      return { hasUpdate: false, currentVersion: 'not installed' };
    }

    try {
      const { stdout } = await execAsync(
        `npm view ${this.npmPackage} version`,
        { timeout: 10000 }
      );
      const latestVersion = stdout.trim();
      const currentVersion = currentResult.version || '0.0.0';

      return {
        hasUpdate: this.isNewerVersion(latestVersion, currentVersion),
        currentVersion,
        latestVersion,
      };
    } catch {
      return { hasUpdate: false, currentVersion: currentResult.version || 'unknown' };
    }
  }

  async updateCLI(ui: SetupUICallbacks): Promise<{
    success: boolean;
    newVersion?: string;
    error?: string;
  }> {
    ui.log('info', `Updating ${this.displayName}...`);

    try {
      await execAsync(`npm install -g ${this.npmPackage}@latest`, { timeout: 300000 });

      const result = await this.detectCLI();
      if (result.installed) {
        ui.log('success', `${this.displayName} updated to ${result.version}`);
        return { success: true, newVersion: result.version };
      }
      return { success: false, error: 'Update completed but version detection failed' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private isNewerVersion(latest: string, current: string): boolean {
    // 版本比较逻辑（同上）
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [lMajor, lMinor, lPatch] = parse(latest);
    const [cMajor, cMinor, cPatch] = parse(current);

    if (lMajor > cMajor) return true;
    if (lMajor === cMajor && lMinor > cMinor) return true;
    if (lMajor === cMajor && lMinor === cMinor && lPatch > cPatch) return true;
    return false;
  }
}
```

### NodeRuntimeProvider 更新方法实现

```typescript
// 在 NodeRuntimeProvider 中添加

class NodeRuntimeProvider implements RuntimeProvider {
  // ... 现有代码 ...

  getMinimumRecommendedVersion(): string {
    return '18.0.0';  // LTS 版本
  }

  async checkForUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    releaseNotes?: string;
    updateUrl?: string;
  }> {
    const current = await this.detect();
    if (!current.installed) {
      return { hasUpdate: false, currentVersion: 'not installed' };
    }

    try {
      // 获取 LTS 版本信息
      const response = await fetch('https://nodejs.org/dist/index.json');
      const versions = await response.json();
      const latestLTS = versions.find((v: any) => v.lts);

      if (latestLTS) {
        const latestVersion = latestLTS.version.replace('v', '');
        const currentVersion = current.version?.replace('v', '') || '0.0.0';

        return {
          hasUpdate: this.isNewerVersion(latestVersion, currentVersion),
          currentVersion: current.version || 'unknown',
          latestVersion: latestLTS.version,
          updateUrl: 'https://nodejs.org/en/download/',
        };
      }
    } catch {
      // 网络错误，忽略
    }

    return { hasUpdate: false, currentVersion: current.version || 'unknown' };
  }

  async update(ui: SetupUICallbacks): Promise<{
    success: boolean;
    newVersion?: string;
    error?: string;
  }> {
    const method = await this.getBestInstallMethod();

    if (this.platform === 'darwin' && await this.commandExists('brew')) {
      ui.log('info', 'Updating Node.js via Homebrew...');
      try {
        await execAsync('brew upgrade node', { timeout: 300000 });
        const result = await this.detect();
        return { success: true, newVersion: result.version };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }

    if (this.platform === 'win32' && await this.commandExists('winget')) {
      ui.log('info', 'Updating Node.js via winget...');
      try {
        await execAsync('winget upgrade OpenJS.NodeJS.LTS', { timeout: 300000 });
        const result = await this.detect();
        return { success: true, newVersion: result.version };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }

    // 其他情况引导用户手动更新
    ui.log('info', 'Please update Node.js manually from: https://nodejs.org');
    await ui.openExternal('https://nodejs.org/en/download/');
    return { success: false, error: 'Manual update required' };
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [lMajor, lMinor, lPatch] = parse(latest);
    const [cMajor, cMinor, cPatch] = parse(current);

    if (lMajor > cMajor) return true;
    if (lMajor === cMajor && lMinor > cMinor) return true;
    if (lMajor === cMajor && lMinor === cMinor && lPatch > cPatch) return true;
    return false;
  }
}
```

### UpdateOrchestrator

统一管理所有更新检测和执行：

```typescript
// src/setup/UpdateOrchestrator.ts

interface UpdateStatus {
  app: {
    hasUpdate: boolean;
    current: string;
    latest?: string;
  };
  runtimes: Map<string, {
    hasUpdate: boolean;
    current: string;
    latest?: string;
    belowMinimum: boolean;
  }>;
  agents: Map<string, {
    hasUpdate: boolean;
    current: string;
    latest?: string;
  }>;
}

class UpdateOrchestrator {
  constructor(
    private appChecker: AppUpdateChecker,
    private runtimeProviders: Map<string, RuntimeProvider>,
    private agentProviders: Map<string, AgentSetupProvider>
  ) {}

  /**
   * 检查所有组件的更新
   */
  async checkAllUpdates(): Promise<UpdateStatus> {
    const status: UpdateStatus = {
      app: { hasUpdate: false, current: '' },
      runtimes: new Map(),
      agents: new Map(),
    };

    // 并行检查所有更新
    const [appUpdate, ...runtimeUpdates] = await Promise.all([
      this.appChecker.checkForUpdate('npm'),
      ...Array.from(this.runtimeProviders.entries()).map(async ([type, provider]) => {
        const update = await provider.checkForUpdate();
        const current = await provider.detect();
        const minVersion = provider.getMinimumRecommendedVersion();
        return {
          type,
          ...update,
          belowMinimum: current.version
            ? this.isVersionBelow(current.version, minVersion)
            : false,
        };
      }),
    ]);

    const agentUpdates = await Promise.all(
      Array.from(this.agentProviders.entries()).map(async ([type, provider]) => {
        const update = await provider.checkForCLIUpdate();
        return { type, ...update };
      })
    );

    // 组装结果
    status.app = {
      hasUpdate: appUpdate.hasUpdate,
      current: appUpdate.current,
      latest: appUpdate.latest,
    };

    for (const update of runtimeUpdates) {
      status.runtimes.set(update.type, {
        hasUpdate: update.hasUpdate,
        current: update.currentVersion,
        latest: update.latestVersion,
        belowMinimum: update.belowMinimum,
      });
    }

    for (const update of agentUpdates) {
      status.agents.set(update.type, {
        hasUpdate: update.hasUpdate,
        current: update.currentVersion,
        latest: update.latestVersion,
      });
    }

    return status;
  }

  /**
   * 显示更新摘要
   */
  async showUpdateSummary(ui: SetupUICallbacks): Promise<void> {
    const status = await this.checkAllUpdates();
    let hasAnyUpdate = false;

    // 应用更新
    if (status.app.hasUpdate) {
      hasAnyUpdate = true;
      ui.log('info', `Agent Chatter: ${status.app.current} → ${status.app.latest}`);
    }

    // 运行时更新
    for (const [type, info] of status.runtimes) {
      if (info.belowMinimum) {
        ui.log('warn', `${type}: ${info.current} (below recommended minimum)`);
        hasAnyUpdate = true;
      } else if (info.hasUpdate) {
        ui.log('info', `${type}: ${info.current} → ${info.latest}`);
        hasAnyUpdate = true;
      }
    }

    // Agent 更新
    for (const [type, info] of status.agents) {
      if (info.hasUpdate) {
        ui.log('info', `${type}: ${info.current} → ${info.latest}`);
        hasAnyUpdate = true;
      }
    }

    if (!hasAnyUpdate) {
      ui.log('success', 'All components are up to date.');
    }
  }

  /**
   * 交互式更新流程
   */
  async runUpdateFlow(ui: SetupUICallbacks): Promise<void> {
    const status = await this.checkAllUpdates();
    const updates: Array<{ label: string; action: () => Promise<void> }> = [];

    // 收集可用更新
    if (status.app.hasUpdate) {
      updates.push({
        label: `Agent Chatter (${status.app.current} → ${status.app.latest})`,
        action: async () => {
          await this.appChecker.performUpdate('npm', ui);
        },
      });
    }

    for (const [type, info] of status.runtimes) {
      if (info.hasUpdate || info.belowMinimum) {
        const provider = this.runtimeProviders.get(type)!;
        updates.push({
          label: `${provider.displayName} (${info.current} → ${info.latest})`,
          action: async () => {
            await provider.update(ui);
          },
        });
      }
    }

    for (const [type, info] of status.agents) {
      if (info.hasUpdate) {
        const provider = this.agentProviders.get(type)!;
        updates.push({
          label: `${provider.displayName} (${info.current} → ${info.latest})`,
          action: async () => {
            await provider.updateCLI(ui);
          },
        });
      }
    }

    if (updates.length === 0) {
      ui.log('success', 'All components are up to date.');
      return;
    }

    // 让用户选择要更新的组件
    const choices = updates.map((u, i) => ({
      label: u.label,
      value: i,
      description: 'Update available',
    }));

    // 可以用 multiSelect 让用户选多个
    const selected = await ui.select('Select component to update:', choices);

    if (selected !== undefined) {
      await updates[selected].action();
    }
  }

  private isVersionBelow(current: string, minimum: string): boolean {
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
    const [cMajor, cMinor, cPatch] = parse(current);
    const [mMajor, mMinor, mPatch] = parse(minimum);

    if (cMajor < mMajor) return true;
    if (cMajor === mMajor && cMinor < mMinor) return true;
    if (cMajor === mMajor && cMinor === mMinor && cPatch < mPatch) return true;
    return false;
  }
}
```

### CLI 命令

```bash
# 检查所有更新
agent-chatter update --check

# 更新所有组件
agent-chatter update --all

# 更新特定组件
agent-chatter update app
agent-chatter update claude
agent-chatter update node

# 跳过版本
agent-chatter update --skip-version 1.2.3
```

### 启动时检查流程

每次应用启动时自动检查更新，无需定时调度：

```typescript
// 在应用启动时
async function checkUpdatesOnStartup(ui: SetupUICallbacks): Promise<void> {
  const orchestrator = new UpdateOrchestrator(appChecker, runtimes, agents);

  // 每次启动都检查
  const status = await orchestrator.checkAllUpdates();

  // 只在有重要更新时提示（应用本身更新 或 运行时版本过低）
  const hasImportantUpdate =
    status.app.hasUpdate ||
    Array.from(status.runtimes.values()).some(r => r.belowMinimum);

  if (hasImportantUpdate) {
    const shouldUpdate = await ui.confirm(
      'Updates available. Would you like to update now?',
      { detail: 'You can also run "agent-chatter update" later.' }
    );

    if (shouldUpdate) {
      await orchestrator.runUpdateFlow(ui);
    }
  }
}
```

### 用户体验示例

```
$ agent-chatter update --check

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Update Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ Agent Chatter: 0.1.18 → 0.2.0 (update available)
ℹ Claude Code: 1.0.16 → 1.0.20 (update available)
✓ OpenAI Codex: 0.50.2 (up to date)
⚠ Node.js: 16.14.0 (below recommended minimum 18.0.0)
✓ Google Gemini: 0.5.1 (up to date)

Run "agent-chatter update" to update components.
```

```
$ agent-chatter update

? Select components to update:
  [x] Agent Chatter (0.1.18 → 0.2.0)
  [x] Claude Code (1.0.16 → 1.0.20)
  [ ] Node.js (16.14.0 → 22.11.0)

Updating Agent Chatter...
✓ Agent Chatter updated to 0.2.0

Updating Claude Code...
✓ Claude Code updated to 1.0.20

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Updates complete!

Note: Please restart Agent Chatter to use the new version.
```

### 文件结构更新

```
src/setup/
├── types.ts
├── SetupOrchestrator.ts
├── UpdateOrchestrator.ts           # 新增：更新编排
├── AppUpdateChecker.ts             # 新增：应用更新检测
├── runtimes/
│   ├── RuntimeProvider.ts          # 更新：新增 checkForUpdate/update 方法
│   ├── NodeRuntimeProvider.ts
│   └── ...
├── agents/
│   ├── AgentSetupProvider.ts       # 更新：新增 checkForCLIUpdate/updateCLI 方法
│   ├── BaseAgentSetupProvider.ts
│   └── ...
└── ui/
    └── ReplSetupUI.ts
```

### 各组件更新方式汇总

| 组件 | 检测方式 | 更新方式 |
|------|---------|---------|
| Agent Chatter (npm) | `npm view testany-agent-chatter version` | `npm install -g testany-agent-chatter@latest` |
| Agent Chatter (Electron) | API 查询 | 下载新安装包 |
| Claude Code | `npm view @anthropic-ai/claude-code version` | `npm install -g @anthropic-ai/claude-code@latest` |
| OpenAI Codex | `npm view @openai/codex version` | `npm install -g @openai/codex@latest` |
| Gemini CLI | `npm view @google/gemini-cli version` | `npm install -g @google/gemini-cli@latest` |
| Node.js | nodejs.org API / `brew outdated` | brew upgrade / winget upgrade / 手动下载 |
| Python | pypi API / `brew outdated` | brew upgrade / winget upgrade / 手动下载 |

## 已确认事项

| 事项 | 说明 | 决定 |
|------|------|------|
| Gemini CLI 包名 | 需确认官方 npm 包名 | **`@google/gemini-cli`** (已从源码确认) |
| Electron 内嵌 Node.js | 是否在 Electron 中内嵌 Node.js runtime | **不内嵌**，帮用户自动（尽量静默）安装 |
| API Key 存储位置 | `~/.agent-chatter/.env` 还是各 CLI 自己的配置 | **必须用 CLI 自己的**存储位置 |
| 更新服务器 API | Electron 版更新检测的服务器端 API 设计 | 延后到 Electron UI 阶段再设计 |
| 破坏性更新处理 | 如何处理不兼容的版本升级 | **强制更新** |
| CLI 状态命令可用性 | 各 Agent CLI 状态命令的基线版本 | 以 **2025-11-27** 各家版本为基线 |

## 研究结果汇总 (2025-11-28)

### Agent CLI 包名与命令

| Agent | npm 包名 | CLI 命令 | 状态命令 | 状态命令退出码 |
|-------|----------|----------|----------|----------------|
| Claude | `@anthropic-ai/claude-code` | `claude` | `claude auth status` | 0=成功, 非0=失败 (有已知 bug) |
| Codex | `@openai/codex` | `codex` | `codex login status` | 0=已认证, 1=未认证或错误 |
| Gemini | `@google/gemini-cli` | `gemini` | **无** | 41=认证错误, 0=成功 |

### 凭证存储位置

| Agent | macOS | Linux | Windows |
|-------|-------|-------|---------|
| Claude | Keychain (加密) | `~/.claude/.credentials.json` | Windows Credential Manager |
| Codex | `~/.codex/auth.json` 或 Keyring | `~/.codex/auth.json` 或 Keyring | `%USERPROFILE%\.codex\auth.json` |
| Gemini | `~/.gemini/oauth_creds.json` | `~/.gemini/oauth_creds.json` | `~/.gemini/oauth_creds.json` |

### 认证环境变量

| Agent | 主要变量 | 次要变量 |
|-------|----------|----------|
| Claude | `ANTHROPIC_API_KEY` | `CLAUDE_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` |
| Codex | `OPENAI_API_KEY` | `CODEX_API_KEY`, `CODEX_HOME` |
| Gemini | `GEMINI_API_KEY` | `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI` |

### OAuth/TTY 交互需求

| Agent | OAuth 登录方式 | TTY 需求 | 备注 |
|-------|----------------|----------|------|
| Claude | 浏览器 OAuth | **需要 TTY**，SSH 连接有问题 | 已知 bug: SSH 环境下认证失败 |
| Codex | 浏览器 OAuth + 本地 HTTP 回调 | `--with-api-key` **禁止 TTY** (必须管道输入) | 其他方式不强制 |
| Gemini | 浏览器 OAuth + 本地 HTTP 回调 | **不需要 TTY** | 支持 `NO_BROWSER` 环境变量 |

### 已知问题与注意事项

1. **Claude `claude auth status` 不可靠**: GitHub Issue #8002 报告即使有有效 OAuth 也显示 "Invalid API key"
2. **Claude SSH 认证失败**: Issue #7358, #5225 - SSH 连接下认证不持久
3. **Claude macOS Keychain**: 无法直接读取，必须依赖 `claude auth status` 命令
4. **Codex `--with-api-key`**: stdin 必须是管道，不能是 TTY
5. **Gemini 无状态命令**: 只能通过运行命令检查退出码 41 来判断认证状态

## 待验证事项

| 事项 | 说明 | 状态 |
|------|------|------|
| npm 全局安装权限 | Windows/macOS 是否需要 sudo/admin | 需测试 |
| OAuth 命令的 TTY 问题 | 各 CLI 在非 TTY 环境下的行为 | 部分已确认 (见上表) |

## 下一步

1. ~~确认各 Agent CLI 的准确包名和命令~~ ✅ 已完成
2. 实现 `SetupOrchestrator` 核心代码
3. 实现 `ReplSetupUI` 并集成到现有 REPL
4. 添加 `agent-chatter setup` CLI 命令
5. 实现 `UpdateOrchestrator` 和更新检测逻辑
6. 添加 `agent-chatter update` CLI 命令
7. 测试各平台（macOS/Windows/Linux）
