# REPL Agents 集成设计（修订版 v2）

## 概述

本设计实现 REPL 模式下的完整 agent 管理功能，采用业务逻辑与 UI 展示分离的架构。终端 CLI 只是辅助通道，绝大多数用户会直接留在 agent-chatter REPL 里完成所有操作。

**核心架构原则：**
1. **直接使用 AgentRegistry**：复用现有的 `AgentRegistry` 类，避免重复包装
2. **组件拆分**：Agents 菜单从 `ReplModeInk.tsx` 拆分到独立的 `AgentsMenu.tsx`
3. **输入框处理**：使用 `ink-text-input` 实现光标支持（Option B）
4. **状态流管理**：清晰的关注点分离和状态管理
5. **加载状态**：所有异步操作都显示加载提示

---

## 1. 架构概览

### 1.1 组件结构

```
src/
├── registry/
│   ├── AgentRegistry.ts           # 现有：核心业务逻辑（直接使用）
│   └── RegistryStorage.ts         # 现有：持久化层
├── commands/
│   └── AgentsCommand.ts           # 现有：CLI handlers（已调用 AgentRegistry）
└── repl/
    ├── ReplModeInk.tsx            # 修改：移除 agents 逻辑，添加 agentsMenu 模式
    └── components/
        └── AgentsMenu.tsx         # 新增：Agents 菜单 UI 组件
```

### 1.2 数据流

```
用户输入
    ↓
ReplModeInk (mode: 'agentsMenu')
    ↓
AgentsMenu 组件 (UI + 交互)
    ↓
AgentRegistry (业务逻辑 + 持久化)
```

**设计决策：不创建服务层**
- `AgentRegistry` 已经提供了所有需要的便捷方法（第 241-369 行）
- 这些方法已经是纯异步函数，返回结构化数据
- CLI handlers 已经在直接使用这些方法
- REPL 菜单应该复用相同的 API，避免重复包装

---

## 2. AgentRegistry API 接口

### 2.1 现有的便捷方法

**位置**：`src/registry/AgentRegistry.ts:241-369`

`AgentRegistry` 已经提供了 REPL 和 CLI 都需要的所有操作：

```typescript
// 扫描系统中的 AI CLI 工具
async scanAgents(): Promise<ScannedAgent[]>

// 注册 agent（返回操作结果）
async registerAgent(
  agentType: AgentType,
  commandPath?: string,
  version?: string
): Promise<{ success: boolean; error?: string }>

// 验证 agent 可用性
async verifyAgent(name: string): Promise<VerificationResult>

// 列出所有 agents（异步）
async listAgents(): Promise<AgentDefinition[]>

// 获取单个 agent（异步）
async getAgent(name: string): Promise<AgentDefinition | undefined>

// 删除 agent（返回操作结果）
async deleteAgent(name: string): Promise<{ success: boolean; error?: string }>

// 更新 agent（返回操作结果）
async updateAgent(
  name: string,
  updates: Partial<AgentDefinition>
): Promise<{ success: boolean; error?: string }>
```

### 2.2 数据类型

**位置**：`src/registry/RegistryStorage.ts:14-24`

```typescript
export interface AgentDefinition {
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

**位置**：`src/registry/AgentRegistry.ts:18-32`

```typescript
export interface VerificationResult {
  name: string;
  status: 'verified' | 'failed';
  error?: string;
  checks?: CheckResult[];
}

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}
```

**位置**：`src/registry/AgentScanner.ts`

```typescript
export interface ScannedAgent {
  name: string;
  displayName: string;
  command: string;
  version?: string;
  found: boolean;
}
```

---

## 3. CLI Handler 现状

### 3.1 现有实现已经正确

**位置**：`src/commands/AgentsCommand.ts`

CLI handlers 已经在直接使用 `AgentRegistry`，这是正确的架构：

**示例 - handleList** (第 173-204 行)：
```typescript
export async function handleList(options: { verbose?: boolean }, registryPath?: string): Promise<void> {
  const registry = new AgentRegistry(registryPath);

  // 调用 AgentRegistry 方法
  const agents = await registry.listAgents();

  // CLI 格式化输出
  if (agents.length === 0) {
    console.log(colorize('No registered agents', 'yellow'));
    return;
  }

  for (const agent of agents) {
    console.log(`${colorize('●', 'cyan')} ${agent.displayName}`);
    console.log(`  Command: ${agent.command}`);
    // ... 剩余格式化逻辑
  }
}
```

**REPL 将采用相同模式**：
- 创建 `AgentRegistry` 实例
- 调用相同的方法
- 用 Ink 组件展示结果（而非 console.log）

---

## 4. 输入框与光标（Option B）

### 4.1 添加 ink-text-input

**依赖**：
```bash
npm install ink-text-input@^6.0.0
```

**版本兼容性验证**：
- ✅ **React 19.2.0**：ink-text-input peerDependencies 要求 `react: ">=18"`
- ✅ **Ink 6.5.0**：ink-text-input peerDependencies 要求 `ink: ">=5"`
- ✅ **Node.js 20+**：项目要求 `">=20.0.0"`

**验证命令**：
```bash
$ npm view ink-text-input peerDependencies
{ ink: '>=5', react: '>=18' }
```

**结论**：完全兼容，可以安全安装。

### 4.2 在 ReplModeInk.tsx 中集成

**当前实现**（第 1447-1460 行）：
```tsx
<Box marginTop={1}>
  <Text color="cyan">agent-chatter&gt; </Text>
  <Text>{input}</Text>
</Box>
```

**新实现**：
```tsx
import TextInput from 'ink-text-input';

// 在组件 state 中
const [showInput, setShowInput] = useState(true);

// 在渲染中（第 1447-1460 行）
{showInput && (
  <Box marginTop={1}>
    <Text color="cyan">agent-chatter&gt; </Text>
    <TextInput
      value={input}
      onChange={setInput}
      onSubmit={handleInputSubmit}
      showCursor={mode === 'normal' || mode === 'conversation' || mode === 'wizard' || mode === 'form'}
      focus={mode === 'normal' || mode === 'conversation' || mode === 'wizard' || mode === 'form'}
    />
  </Box>
)}
```

**关键改动**：
- 用 `TextInput` 组件的 `onChange` 替代手动 `useInput` 字符串拼接
- `showCursor` prop 根据模式控制光标可见性
- `focus` prop 控制输入是否激活
- 在 menu/select/agentsMenu 模式时，隐藏输入或设置 `showCursor={false}`
- 移除手动光标闪烁逻辑（不再需要）

**Handler 迁移**：
```typescript
const handleInputSubmit = (value: string) => {
  if (mode === 'conversation') {
    handleConversationInput(value);
  } else if (mode === 'wizard') {
    handleWizardInput(value);
  } else if (mode === 'form') {
    handleFormSubmit();
  } else {
    handleCommand(value);
  }
  setInput('');
};
```

---

## 5. REPL 状态管理

### 5.1 新模式：'agentsMenu'

**位置**：`src/repl/ReplModeInk.tsx`

**类型定义**（第 443 行）：
```typescript
type AppMode = 'normal' | 'conversation' | 'wizard' | 'menu' | 'form' | 'select' | 'agentsMenu';
```

**说明**：
- 只需要在 App 组件添加 `'agentsMenu'` 到 `AppMode` 类型
- **不需要** App 级别的状态：所有 agents 菜单状态都在 `AgentsMenu` 组件内部管理（见第 6.2 节）
- App 组件只负责：
  1. 模式切换：`setMode('agentsMenu')`
  2. 渲染 AgentsMenu 组件
  3. 处理关闭回调：`onClose={() => setMode('normal')}`

### 5.2 Registry 路径管理

**正确的默认路径**：
```typescript
import { RegistryStorage } from '../registry/RegistryStorage.js';

function App({ registryPath }: { registryPath?: string }) {
  // 使用 RegistryStorage 的默认路径逻辑
  const defaultPath = new RegistryStorage().getPath();
  const [registry] = useState(registryPath || defaultPath);

  // 将 registry 传递给所有 agent 操作
}
```

**关键点**：
- **正确路径**：`~/.agent-chatter/agents/config.json`（RegistryStorage.ts:50）
- **错误路径**：`~/.agent-chatter/registry.json`（之前设计文档的错误）
- **必须复用**：使用 `RegistryStorage` 的默认路径逻辑，确保 CLI 和 REPL 读写同一个文件

**CLI 修改**（程序入口点）：
```typescript
// 在 index.ts 或主 CLI 文件中
const options = program.opts();
render(<App registryPath={options.registry} />);
```

---

## 6. AgentsMenu 组件设计

### 6.1 组件接口

**文件**：`src/repl/components/AgentsMenu.tsx`

```typescript
export interface AgentsMenuProps {
  registryPath: string;
  onClose: () => void;
  onShowMessage: (message: string, color?: string) => void;
}

export function AgentsMenu({ registryPath, onClose, onShowMessage }: AgentsMenuProps) {
  // 组件实现
}
```

### 6.2 内部状态

```typescript
const [view, setView] = useState<'main' | 'list' | 'register' | 'verify' | 'info' | 'edit' | 'delete'>('main');
const [loading, setLoading] = useState(false);
const [loadingMessage, setLoadingMessage] = useState('');
const [selectedIndex, setSelectedIndex] = useState(0);

// AgentRegistry 实例
const [registry] = useState(() => new AgentRegistry(registryPath));

// 视图特定状态
const [agents, setAgents] = useState<AgentDefinition[]>([]);
const [scanResult, setScanResult] = useState<ScannedAgent[]>([]);
const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
const [currentAgent, setCurrentAgent] = useState<AgentDefinition | null>(null);
const [editForm, setEditForm] = useState<any>(null);
```

### 6.3 主菜单视图

**显示**：
```
┌─────────────────────────────────────────┐
│          Agents Management              │
└─────────────────────────────────────────┘

Main Menu
────────────────────────────────────────────────────────
▶ List all registered agents
  Register new agents (scan system)
  Verify agent availability
  Show agent details
  Edit agent configuration
  Delete an agent
  Back to REPL

Use ↑↓ to navigate, Enter to select, Ctrl+C to cancel
```

**实现**：
```tsx
{view === 'main' && (
  <SelectView
    title="Agents Management"
    options={[
      'List all registered agents',
      'Register new agents (scan system)',
      'Verify agent availability',
      'Show agent details',
      'Edit agent configuration',
      'Delete an agent',
      'Back to REPL'
    ]}
    selectedIndex={selectedIndex}
    multiSelect={false}
  />
)}
```

**导航处理**：
```typescript
useInput((input, key) => {
  if (view === 'main') {
    if (key.upArrow) {
      setSelectedIndex(prev => prev > 0 ? prev - 1 : 6);
    } else if (key.downArrow) {
      setSelectedIndex(prev => prev < 6 ? prev + 1 : 0);
    } else if (key.return) {
      handleMainMenuSelect(selectedIndex);
    }
  }
});

const handleMainMenuSelect = async (index: number) => {
  switch (index) {
    case 0: await showList(); break;
    case 1: await showRegister(); break;
    case 2: await showVerify(); break;
    case 3: await showInfo(); break;
    case 4: await showEdit(); break;
    case 5: await showDelete(); break;
    case 6: onClose(); break;
  }
};
```

---

## 7. 详细的子操作交互

### 7.1 列出 Agents

**流程**：
1. 用户从主菜单选择 "List all registered agents"
2. 设置 `loading=true`, `loadingMessage="Loading registered agents..."`
3. 调用 `registry.listAgents()`
4. 将结果存储到 `agents` state
5. 设置 `view='list'`, `loading=false`
6. 显示列表，支持 ↑↓ 导航
7. 按 `Esc` 或选择 "Back" 返回主菜单

**UI**：
```
┌─────────────────────────────────────────┐
│       Registered AI Agents (3)          │
└─────────────────────────────────────────┘

▶ ● Claude Code (v2.3.1)
    Command: claude

  ● OpenAI Codex (v1.0.0)
    Command: /path/to/codex-wrapper.sh

  ● Google Gemini CLI
    Command: gemini

────────────────────────────────────────────
Press ↑↓ to scroll, Esc to go back
```

**实现**：
```typescript
const showList = async () => {
  setLoading(true);
  setLoadingMessage('Loading registered agents...');

  try {
    const result = await registry.listAgents();
    setAgents(result);
    setView('list');
    setSelectedIndex(0);
  } catch (error) {
    onShowMessage(`Error loading agents: ${error}`, 'red');
  } finally {
    setLoading(false);
  }
};
```

### 7.2 注册 Agents

**流程**：
1. 用户从主菜单选择 "Register new agents (scan system)"
2. 设置 `loading=true`, `loadingMessage="Scanning system for AI CLI tools..."`
3. 调用 `registry.scanAgents()`
4. 在多选列表中显示扫描结果
5. 用户使用 ↑↓ 导航，Space 切换选择
6. 用户按 Enter 确认
7. 对于每个选中的 agent：
   - 设置 `loading=true`, `loadingMessage="Registering {agentName}..."`
   - 调用 `registry.registerAgent(agentType, commandPath, version)`
   - 显示成功/错误消息
8. 询问 "Verify registered agents now? (y/n)"
9. 如果是，进入 verify 视图
10. 返回主菜单

**UI - 扫描结果**：
```
┌─────────────────────────────────────────┐
│      Register New Agents                │
└─────────────────────────────────────────┘

Found 3 AI CLI tools on your system:

▶ ☑ Claude Code (v2.3.1)
      Command: claude

  ☐ OpenAI Codex (detected)
      Command: codex

  ☐ Google Gemini CLI
      Command: gemini

────────────────────────────────────────────
Use ↑↓ to navigate, Space to toggle selection
Press Enter to register selected agents
Press Esc to cancel
```

**实现**：
```typescript
const showRegister = async () => {
  setLoading(true);
  setLoadingMessage('Scanning system for AI CLI tools...');

  try {
    const result = await registry.scanAgents();
    setScanResult(result);
    setSelectedAgents(new Set()); // 开始时无选择
    setView('register');
    setSelectedIndex(0);
  } catch (error) {
    onShowMessage(`Scan failed: ${error}`, 'red');
  } finally {
    setLoading(false);
  }
};

const handleRegisterConfirm = async () => {
  if (selectedAgents.size === 0) {
    onShowMessage('No agents selected', 'yellow');
    return;
  }

  const toRegister = scanResult.filter(a => selectedAgents.has(a.name) && a.found);

  for (const agent of toRegister) {
    setLoading(true);
    setLoadingMessage(`Registering ${agent.displayName}...`);

    const result = await registry.registerAgent(
      agent.name as AgentType,
      agent.command,
      agent.version
    );

    if (result.success) {
      onShowMessage(`✓ Registered: ${agent.displayName}`, 'green');
    } else {
      onShowMessage(`✗ Failed to register ${agent.displayName}: ${result.error}`, 'red');
    }
  }

  setLoading(false);

  // 询问是否验证
  // TODO: 实现确认对话框
  setView('main');
};
```

### 7.3 验证 Agents

**流程**：
1. 用户从主菜单选择 "Verify agent availability"
2. 设置 `loading=true`, `loadingMessage="Loading agents..."`
3. 调用 `registry.listAgents()`
4. 显示 agent 列表（单选或 "All agents"）
5. 用户选择 agent（或 "All"）
6. 设置 `loading=true`, `loadingMessage="Verifying {agentName}..."`
7. 调用 `registry.verifyAgent(name)`（单个）或循环调用（全部）
8. 显示验证结果
9. 按任意键返回主菜单

**UI - 选择**：
```
┌─────────────────────────────────────────┐
│      Verify Agent Availability          │
└─────────────────────────────────────────┘

Select agent to verify:

▶ All agents
  Claude Code
  OpenAI Codex
  Google Gemini CLI

────────────────────────────────────────────
Use ↑↓ to navigate, Enter to select
```

**UI - 结果**：
```
┌─────────────────────────────────────────┐
│      Verification Results               │
└─────────────────────────────────────────┘

Claude Code
  ✓ Command exists: claude found in PATH
  ✓ Executable: Has execute permissions
  ✓ Response test: Responds correctly
  Status: ✓ VERIFIED

────────────────────────────────────────────
Press any key to continue
```

**实现**：
```typescript
const showVerify = async () => {
  setLoading(true);
  setLoadingMessage('Loading agents...');

  try {
    const agentList = await registry.listAgents();
    setAgents(agentList);
    setView('verify');
    setSelectedIndex(0);
  } finally {
    setLoading(false);
  }
};

const handleVerifySelect = async (index: number) => {
  if (index === 0) {
    // 验证所有
    setLoading(true);
    setLoadingMessage('Verifying all agents...');

    const results: VerificationResult[] = [];
    for (const agent of agents) {
      const result = await registry.verifyAgent(agent.name);
      results.push(result);
    }
    setVerificationResults(results);
  } else {
    // 验证单个 agent
    const agent = agents[index - 1];
    setLoading(true);
    setLoadingMessage(`Verifying ${agent.displayName}...`);

    const result = await registry.verifyAgent(agent.name);
    setVerificationResults([result]);
  }

  setLoading(false);
  // 停留在 verify 视图显示结果
};
```

### 7.4 显示 Agent 信息

**流程**：
1. 用户从主菜单选择 "Show agent details"
2. 加载 agent 列表并显示选择
3. 用户选择 agent
4. 调用 `registry.getAgent(name)`
5. 显示详细信息
6. 自动运行验证检查
7. 按任意键返回

**UI**：
```
┌─────────────────────────────────────────┐
│      Agent Details: Claude Code         │
└─────────────────────────────────────────┘

Name:          claude
Display Name:  Claude Code
Command:       claude
Arguments:     (none)
End Marker:    [DONE]
Use PTY:       false
Version:       2.3.1
Installed At:  2025-11-18T10:30:00Z

Availability Check:
  ✓ Command exists: claude found in PATH
  ✓ Executable: Has execute permissions
  ✓ Response test: Responds correctly

Status: ✓ AVAILABLE

────────────────────────────────────────────
Press any key to continue
```

### 7.5 编辑 Agent 配置

**流程**：
1. 用户从主菜单选择 "Edit agent configuration"
2. 加载并显示 agent 列表（单选）
3. 用户选择 agent
4. 将 agent 信息加载到表单
5. 显示表单，字段包括：command、args、endMarker、usePty
6. 用户用 Tab 导航，用 TextInput 编辑
7. 按 Enter 保存，Esc 取消
8. 调用 `registry.updateAgent(name, updates)`
9. 显示成功/错误消息
10. 自动验证更新后的配置
11. 返回主菜单

**UI**：
```
┌─────────────────────────────────────────┐
│      Edit Agent: Claude Code            │
└─────────────────────────────────────────┘

▶ Command:    claude
  Arguments:  (empty)
  End Marker: [DONE]
  Use PTY:    false

────────────────────────────────────────────
Use Tab to navigate fields
Press Enter to save, Esc to cancel
```

**实现**：使用现有 `FormView` 组件（第 347-387 行），预填充值。

### 7.6 删除 Agent

**流程**：
1. 用户从主菜单选择 "Delete an agent"
2. 加载并显示 agent 列表（单选）
3. 用户选择 agent
4. 显示确认对话框，包含 agent 详情
5. 用户确认 (y/n)
6. 调用 `registry.deleteAgent(name)`
7. 显示成功/错误消息
8. 返回主菜单

**UI - 确认**：
```
┌─────────────────────────────────────────┐
│      Delete Agent                       │
└─────────────────────────────────────────┘

⚠  WARNING: This action cannot be undone

Agent to delete:
  Name:         claude
  Display Name: Claude Code
  Command:      claude

────────────────────────────────────────────
Confirm deletion? (y/N)
```

**实现**：使用现有确认模式（第 1304-1330 行）。

---

## 8. 加载状态与错误处理

### 8.1 加载指示器组件

**创建** `src/repl/components/LoadingIndicator.tsx`：

```tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export interface LoadingIndicatorProps {
  message: string;
}

export function LoadingIndicator({ message }: LoadingIndicatorProps) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box marginY={1}>
      <Text color="cyan">{message}{dots}</Text>
    </Box>
  );
}
```

### 8.2 在 AgentsMenu 中使用

```tsx
{loading && <LoadingIndicator message={loadingMessage} />}
```

### 8.3 防止双重执行

**模式**：
```typescript
const [operationInProgress, setOperationInProgress] = useState(false);

const performOperation = async () => {
  if (operationInProgress) return;  // 防止双击

  setOperationInProgress(true);
  setLoading(true);

  try {
    // ... 操作
  } finally {
    setLoading(false);
    setOperationInProgress(false);
  }
};
```

---

## 9. 与 ReplModeInk 的集成

### 9.1 命令处理器

**位置**：`handleAgentsCommand`（第 931-970 行）

**当前实现**：显示帮助文本，建议使用 CLI

**新实现**：
```typescript
const handleAgentsCommand = (args: string[]) => {
  // 如果用户只输入 "/agents"，进入 agents 菜单
  if (args.length === 0) {
    setMode('agentsMenu');
    setInput('');
    setSelectedIndex(0);
    return;
  }

  // 如果用户输入 "/agents <subcommand>"，仍然建议 CLI
  const subcommand = args[0].toLowerCase();
  setOutput(prev => [...prev,
    <Box key={`agents-cli-hint-${getNextKey()}`} flexDirection="column" marginY={1}>
      <Text color="yellow">Tip: Type /agents to enter interactive menu</Text>
      <Text dimColor>Or use the CLI: agent-chatter agents {subcommand}</Text>
    </Box>
  ]);
};
```

### 9.2 渲染 AgentsMenu

**位置**：组件渲染部分（约第 1440 行）

```tsx
{/* Agents 菜单 */}
{mode === 'agentsMenu' && (
  <AgentsMenu
    registryPath={registry}
    onClose={() => {
      setMode('normal');
      setInput('');
    }}
    onShowMessage={(message, color) => {
      setOutput(prev => [
        ...prev,
        <Text key={`agents-msg-${getNextKey()}`} color={color || 'white'}>
          {message}
        </Text>
      ]);
    }}
  />
)}
```

### 9.3 在 Agents 菜单中隐藏输入

```tsx
{/* 输入框 */}
{(mode === 'normal' || mode === 'conversation' || mode === 'wizard' || mode === 'form') && (
  <Box marginTop={1}>
    <Text color="cyan">agent-chatter&gt; </Text>
    <TextInput ... />
  </Box>
)}
```

**注意**：当 `mode === 'agentsMenu'` 时隐藏输入，因为 AgentsMenu 处理自己的导航。

### 9.4 禁用根 useInput 处理（关键修改）

**问题**：AgentsMenu 组件内部有自己的 `useInput` hook，但根组件的 `useInput`（第 582-753 行）会同时处理按键，导致冲突。

**解决方案**：在根 `useInput` 开头添加 `agentsMenu` 模式检查

**位置**：`src/repl/ReplModeInk.tsx:582`

**修改**：
```typescript
useInput((inputChar: string, key: any) => {
  // ========== 关键修改：在 agentsMenu 模式下不处理任何输入 ==========
  if (mode === 'agentsMenu') {
    return;  // AgentsMenu 组件会处理所有输入
  }

  // Ctrl+C 退出或取消
  if (key.ctrl && inputChar === 'c') {
    if (mode === 'conversation' && activeCoordinator) {
      // 退出对话模式
      // ...
    } else if (mode === 'wizard') {
      // ...
    } else if (mode === 'menu') {
      // ...
    } else if (mode === 'form') {
      // ...
    } else if (mode === 'select') {
      // ...
    } else {
      setOutput(prev => [...prev, <Text color="cyan" key="goodbye">Goodbye! 👋</Text>]);
      setTimeout(() => exit(), 100);
      return;
    }
  }

  // ... 剩余的输入处理逻辑
});
```

**原理**：
1. 当 `mode === 'agentsMenu'` 时，根 `useInput` 立即返回，不处理任何按键
2. AgentsMenu 组件内部的 `useInput` 会处理所有导航和交互
3. 这避免了两个 `useInput` hook 同时处理同一个按键事件

**测试场景**：
- ✅ 在 agentsMenu 模式按 Enter：只触发 AgentsMenu 的选择逻辑，不会执行 `handleCommand()`
- ✅ 在 agentsMenu 模式按字母键：不会被添加到 `input` state
- ✅ 按 Ctrl+C：AgentsMenu 内部处理退出
- ✅ 退出 agentsMenu 后：根 `useInput` 恢复正常工作

---

## 10. 测试计划

### 10.1 单元测试

**文件**：`tests/registry/AgentRegistry.test.ts`（可能已存在）

**测试用例**：
```typescript
describe('AgentRegistry', () => {
  describe('listAgents', () => {
    it('未注册 agents 时应返回空数组');
    it('应返回所有已注册的 agents');
  });

  describe('scanAgents', () => {
    it('应检测已安装的 CLI 工具');
    it('应分离已找到和未找到的 agents');
  });

  describe('registerAgent', () => {
    it('应成功注册新 agent');
    it('agent 已存在时应返回错误');
  });

  describe('verifyAgent', () => {
    it('应验证已安装的 agent');
    it('缺失 agent 应失败');
    it('应返回详细检查结果');
  });

  describe('deleteAgent', () => {
    it('应删除现有 agent');
    it('不存在的 agent 应返回错误');
  });
});
```

**运行**：`npm test -- AgentRegistry.test.ts`

### 10.2 REPL 集成测试

**文件**：`tests/repl/agents-menu.test.tsx`

**测试用例**：
```typescript
describe('AgentsMenu REPL 集成', () => {
  it('应使用 /agents 命令进入 agents 菜单');
  it('应使用方向键导航');
  it('应使用 Enter 键选择选项');
  it('应使用 Ctrl+C 退出菜单');
  it('应在异步操作期间显示加载指示器');
  it('应正确显示 agent 列表');
  it('应在 register 流程中处理多选');
  it('应在失败时显示错误消息');
  it('根 useInput 在 agentsMenu 模式应被禁用');
});
```

**测试方法**：使用 Ink 的测试工具渲染组件并模拟输入。

### 10.3 光标可见性测试

**文件**：`tests/repl/cursor.test.tsx`

**测试用例**：
```typescript
describe('输入光标', () => {
  it('应在 normal 模式显示光标');
  it('应在 conversation 模式显示光标');
  it('应在 menu 模式隐藏光标');
  it('应在 agentsMenu 模式隐藏光标');
});
```

### 10.4 CLI Smoke 测试

**确保现有 CLI 测试仍然通过**：

```bash
npm test -- AgentsCommand.test.ts
```

**GitHub Actions**：所有现有 CI 测试必须通过：
- `npm run build`
- `npm test`
- CLI smoke 测试

---

## 11. 实施阶段

### Phase 1: 输入光标（优先级：中）
**预计时长**：30-60 分钟

**任务**：
1. 安装 `ink-text-input@^6.0.0`
2. 用 `<TextInput>` 替换手动输入处理
3. 根据模式配置光标可见性
4. 移除手动光标闪烁代码（如果有）
5. 测试所有模式下的光标行为

**交付物**：使用 `ink-text-input` 的工作光标

**验收标准**：
- 光标在 normal、conversation、wizard、form 模式可见
- 光标在 menu、select、agentsMenu 模式隐藏
- 无闪烁或双光标问题

---

### Phase 2: AgentsMenu 组件（优先级：高）
**预计时长**：4-6 小时

**任务**：
1. 创建 `AgentsMenu.tsx` 骨架
2. 实现主菜单视图
3. 实现 List 视图（7.1）
4. 实现 Register 视图（7.2）
5. 实现 Verify 视图（7.3）
6. 实现 Info 视图（7.4）
7. 实现 Edit 视图（7.5）
8. 实现 Delete 视图（7.6）
9. 添加加载指示器
10. 添加错误处理

**交付物**：完整的 `AgentsMenu` 组件

**验收标准**：
- 所有六个操作端到端工作
- 异步操作期间显示加载状态
- 错误消息正确显示
- 导航流畅
- 直接使用 `AgentRegistry` API

---

### Phase 3: REPL 集成（优先级：高）
**预计时长**：1-2 小时

**任务**：
1. 向 `ReplModeInk` 添加 `agentsMenu` 模式
2. 从 CLI 选项传递 `registryPath`（使用正确的默认路径）
3. 更新 `handleAgentsCommand` 进入菜单
4. 渲染 `<AgentsMenu>` 组件
5. 处理菜单关闭回调
6. 在 agents 菜单中隐藏输入框
7. **关键**：在根 `useInput` 添加 `agentsMenu` 模式检查
8. 测试完整流程：`/agents` → 操作 → 退出

**交付物**：REPL 中完全集成的 agents 菜单

**验收标准**：
- `/agents` 进入交互式菜单
- 所有操作在 REPL 中工作
- 退出菜单返回 normal 模式
- 无 UI 故障或状态泄漏
- 根 `useInput` 不会干扰 AgentsMenu 的输入处理

---

### Phase 4: 测试与优化（优先级：中）
**预计时长**：2-3 小时

**任务**：
1. 编写 REPL 集成测试
2. 编写光标可见性测试
3. 运行所有测试并修复失败
4. 手动测试所有流程
5. 测试 useInput 隔离逻辑
6. 更新文档

**交付物**：完整测试覆盖和文档

**验收标准**：
- 所有自动化测试通过
- 手动测试检查清单完成
- 文档已更新

---

## 12. 架构决策记录

### 12.1 为什么不创建服务层？

**问题**：原设计提议创建 `AgentRegistryService` 包装 `AgentRegistry`。

**分析**：
- `AgentRegistry` 已经提供了便捷方法（第 241-369 行）
- 这些方法已经返回结构化数据（`{success, error}`）
- CLI handlers 已经在直接使用这些方法
- 再包装一层会导致重复定义类型和错误处理

**决定**：不创建服务层。REPL 和 CLI 都直接使用 `AgentRegistry`。

**好处**：
- 代码更少，更易维护
- 单一真相来源
- 避免类型定义重复
- 与现有 CLI 架构一致

---

### 12.2 为什么选择 ink-text-input？

**问题**：手动光标实现复杂且容易出错。

**解决方案**：使用经过实战检验的 `ink-text-input` 库。

**好处**：
- 自动光标闪烁
- 原生输入处理
- 复制/粘贴支持
- 维护良好的库

**权衡**：
- 额外依赖
- 必须确保版本兼容性

**验证结果**：
```bash
$ npm view ink-text-input peerDependencies
{ ink: '>=5', react: '>=18' }
```
- ✅ Ink 6.5.0 满足 `>=5`
- ✅ React 19.2.0 满足 `>=18`

**决定**：使用 `ink-text-input`（Option B）。小的依赖成本换来大的 UX 改进。

---

### 12.3 为什么提取 AgentsMenu 组件？

**问题**：`ReplModeInk.tsx` 已有 1470+ 行且还在增长。

**解决方案**：将 agents 菜单提取到独立组件。

**好处**：
- 更好的关注点分离
- 更易单独测试
- 更清晰的代码组织
- 未来功能可复用

**权衡**：
- 需要传递 props/回调
- 稍微复杂的状态管理

**决定**：提取组件。文件大小和复杂度证明提取是合理的。

---

### 12.4 为什么需要禁用根 useInput？

**问题**：Ink 的 `useInput` hook 在父子组件中都调用时，两者会同时接收按键事件。

**后果**：
- 在 agentsMenu 模式按 Enter 会同时触发：
  - AgentsMenu 的选择逻辑
  - 根组件的 `handleCommand()`
- 输入字母会同时：
  - 被 AgentsMenu 处理
  - 被添加到根组件的 `input` state

**解决方案**：在根 `useInput` 开头添加模式检查：
```typescript
if (mode === 'agentsMenu') return;
```

**决定**：必须在根 `useInput` 中添加此检查，否则会导致严重的交互冲突。

---

## 13. 安全与验证

### 13.1 Agent Registry 路径验证

**风险**：用户提供的 `--registry` 路径可能是恶意的，导致路径遍历攻击（directory traversal）。

**示例攻击**：
```bash
agent-chatter --registry "../../../../etc/passwd" agents list
# 可能尝试写入系统敏感文件
```

**现状**：
- `RegistryStorage` 构造函数（src/registry/RegistryStorage.ts:42-44）**没有任何验证**
- 直接接受用户输入：`this.registryPath = registryPath || this.getDefaultRegistryPath();`
- 存在路径遍历风险

**缓解措施（需要实现）**：

**方案 1：在 RegistryStorage 构造函数中验证**（推荐）

**位置**：`src/registry/RegistryStorage.ts:42-44`

**实现**：
```typescript
import * as path from 'path';
import * as os from 'os';

constructor(registryPath?: string) {
  if (registryPath) {
    // 验证用户提供的路径
    this.registryPath = this.validateRegistryPath(registryPath);
  } else {
    this.registryPath = this.getDefaultRegistryPath();
  }
}

/**
 * 验证并规范化 registry 路径
 *
 * SECURITY: 防止路径遍历攻击
 *
 * ❌ 错误方案：使用 startsWith() 检查
 *    - 安全漏洞：'/Users/al' 会错误允许 '/Users/alex/file.json'（路径逃逸）
 *    - 可用性 bug：Windows 上大小写敏感，'c:\users\me' 不匹配 'C:\Users\me'
 *
 * ✅ 正确方案：使用 path.relative() 检查相对路径是否向上逃逸
 */
private validateRegistryPath(userPath: string): string {
  // 1. 规范化路径，解析 .. 和 .
  const normalized = path.normalize(userPath);

  // 2. 转换为绝对路径
  const absolute = path.resolve(normalized);

  // 3. 防止路径遍历攻击
  // 确保路径在用户主目录或当前工作目录内
  const homeDir = os.homedir();
  const cwd = process.cwd();

  // 使用 path.relative() 计算相对路径
  const relativeToHome = path.relative(homeDir, absolute);
  const relativeToCwd = path.relative(cwd, absolute);

  // 检查路径是否在 homeDir 或 cwd 内部
  // 路径在目录内部当且仅当相对路径：
  //   - 不以 '..' 开头（不是向上逃逸到父目录）
  //   - 不以路径分隔符开头（不是绝对路径或根路径）
  //   - 不是绝对路径（Windows 上不同盘符会返回绝对路径）
  //   - 长度大于 0（不是目录本身）
  const isInsideHome = relativeToHome.length > 0 &&
                       !relativeToHome.startsWith('..') &&
                       !relativeToHome.startsWith(path.sep) &&
                       !path.isAbsolute(relativeToHome);

  const isInsideCwd = relativeToCwd.length > 0 &&
                      !relativeToCwd.startsWith('..') &&
                      !relativeToCwd.startsWith(path.sep) &&
                      !path.isAbsolute(relativeToCwd);

  if (!isInsideHome && !isInsideCwd) {
    throw new Error(
      `Invalid registry path: ${userPath}\n` +
      `Registry path must be within home directory (${homeDir}) or current directory (${cwd})\n` +
      `Resolved to: ${absolute}`
    );
  }

  // 4. 确保路径以 .json 结尾
  if (!absolute.endsWith('.json')) {
    throw new Error(
      `Invalid registry path: ${userPath}\n` +
      `Registry path must end with .json`
    );
  }

  return absolute;
}
```

**方案 2：在 CLI 入口点验证**（备选）

如果不想修改 `RegistryStorage`，可以在 CLI 解析 `--registry` 选项时验证：

**位置**：`src/cli.ts` 或主入口文件

```typescript
// 解析命令行选项后
const options = program.opts();

if (options.registry) {
  // 使用相同的验证逻辑
  options.registry = validateRegistryPath(options.registry);
}
```

**其他安全措施**：
- ✅ 使用 `mode: 0o600` 限制文件权限（仅用户可读写）— RegistryStorage.ts:121
- ✅ 目录创建使用 `mode: 0o700` — RegistryStorage.ts:59
- ✅ 文件创建时设置严格权限

**决定**：
- **Phase 1 实施时**：采用方案 1（推荐），在 `RegistryStorage` 构造函数中验证
- **验收标准**：能够阻止路径遍历攻击，如 `--registry ../../etc/passwd`

### 13.2 命令注入防护

**风险**：Agent `command` 字段可能包含 shell 注入。

**缓解措施**：
- 使用 `child_process.spawn()` 配合参数数组，永远不用 shell 字符串
- 验证 command 是可执行文件路径
- 永远不使用 `shell: true` 选项

---

## 14. 未来增强功能（超出范围）

### 14.1 运行时 Registry 切换

**功能**：允许 `/registry set <path>` 在 REPL 中切换 registry。

**复杂度**：中等

**价值**：低（大多数用户使用默认 registry）

**决定**：推迟到未来版本。

---

### 14.2 Agent 模板

**功能**：常见 agent 设置的预配置模板。

**复杂度**：低

**价值**：中等

**决定**：推迟到未来版本。

---

### 14.3 批量操作

**功能**：一次注册/验证/删除多个 agents。

**复杂度**：低（已支持多选注册）

**价值**：低

**决定**：已部分实现（register 多选）。其余推迟。

---

## 15. 完成定义

### 功能要求
- [ ] 用户可以用 `/agents` 进入 agents 菜单
- [ ] 用户可以列出所有已注册的 agents
- [ ] 用户可以注册新 agents（扫描 + 选择 + 注册）
- [ ] 用户可以验证 agent 可用性
- [ ] 用户可以查看 agent 详细信息
- [ ] 用户可以编辑 agent 配置
- [ ] 用户可以删除 agents
- [ ] 所有操作显示加载状态
- [ ] 所有错误都优雅处理

### 技术要求
- [ ] 直接使用 `AgentRegistry` API（不创建服务层）
- [ ] `AgentsMenu` 组件从 `ReplModeInk` 提取
- [ ] 使用 `ink-text-input` 实现光标
- [ ] 使用正确的 registry 路径（`~/.agent-chatter/agents/config.json`）
- [ ] 实现 registry 路径验证（防止路径遍历攻击）
- [ ] 根 `useInput` 在 `agentsMenu` 模式被禁用
- [ ] 模式间无状态泄漏
- [ ] App 组件不添加 `agentsMenuState`（所有状态在 AgentsMenu 内部）

### 测试要求
- [ ] REPL 集成测试
- [ ] 光标可见性测试
- [ ] useInput 隔离测试
- [ ] 所有现有 CLI 测试通过
- [ ] 手动测试检查清单完成

### 文档要求
- [ ] 本设计文档
- [ ] 复杂逻辑的代码注释
- [ ] 必要时更新 README

---

## 16. 开放问题

### Q1: 是否应该缓存扫描结果？

**背景**：`scanAgents()` 运行命令行检查，速度慢（3-5 秒）。

**选项**：
1. 无缓存：始终新鲜，但慢
2. 会话缓存：在 REPL 会话内缓存
3. 持久缓存：缓存到磁盘，带 TTL

**建议**：从无缓存开始。如果用户抱怨再添加会话缓存。

---

### Q2: 是否应该允许编辑 agent name？

**背景**：Agent `name` 是 registry 中的主键。

**风险**：更改 name 需要删除并重新注册。

**建议**：不。Name 不可变。用户必须删除并用不同 name 注册新 agent。

---

## 17. 现有用户迁移路径

**场景**：已经使用 `agent-chatter agents ...` CLI 的用户。

**影响**：无。CLI 继续完全相同工作。

**建议**：在 REPL 中显示提示："Tip: Type /agents for interactive menu"

---

## 18. 附录：组件复用

### 可复用的现有组件

**来自 `ReplModeInk.tsx`**：

1. **SelectView**（第 393-440 行）
   - 用于：主菜单、agent 列表选择、verify 选择
   - 支持：单选、多选、方向键导航

2. **FormView**（第 347-387 行）
   - 用于：编辑 agent 配置
   - 支持：逐字段输入、验证、错误显示

3. **确认模式**（第 1304-1330 行）
   - 用于：删除确认
   - 支持：Yes/No 提示

**不需要新 UI 组件。** 所有交互都可以从现有原语构建。

---

## 19. 评审意见响应

### 评审意见 1：冗余的服务层 ✅ 已解决

**原问题**：设计提议创建 `AgentRegistryService`，但 `AgentRegistry` 已经提供所有需要的方法。

**解决方案**：
- ✅ 移除整个第2章"服务层设计"
- ✅ 更新第2章为"AgentRegistry API 接口"，说明直接使用现有 API
- ✅ 更新所有示例代码为直接调用 `registry.listAgents()` 等方法
- ✅ 架构决策 12.1 说明为什么不创建服务层

---

### 评审意见 2：错误的默认 registry 路径 ✅ 已解决

**原问题**：设计使用错误路径 `~/.agent-chatter/registry.json`，实际路径是 `~/.agent-chatter/agents/config.json`。

**解决方案**：
- ✅ 第 5.2 节更新为使用 `RegistryStorage` 的默认路径逻辑
- ✅ 示例代码：`const defaultPath = new RegistryStorage().getPath();`
- ✅ 明确标注正确和错误路径的对比

---

### 评审意见 3：ink-text-input 兼容性假设 ✅ 已验证

**原问题**：设计假设 `ink-text-input@6` 与 React 19 兼容，但未验证。

**验证结果**：
```bash
$ npm view ink-text-input peerDependencies
{ ink: '>=5', react: '>=18' }
```

**结论**：
- ✅ `react: '>=18'` **包括 React 19**
- ✅ `ink: '>=5'` 支持 Ink 6.5.0
- ✅ 完全兼容，无需降级或寻找替代方案

**文档更新**：
- ✅ 第 4.1 节添加了详细的兼容性验证
- ✅ 包含了验证命令和结果

---

### 评审意见 4：缺少 useInput 更新说明 ✅ 已解决

**原问题**：设计未说明如何在 `agentsMenu` 模式下禁用根 `useInput` handler。

**解决方案**：
- ✅ 第 9.4 节"禁用根 useInput 处理（关键修改）"完整说明
- ✅ 提供具体代码修改位置（第 582 行）
- ✅ 解释为什么需要禁用（避免父子 useInput 冲突）
- ✅ 提供测试场景验证逻辑正确性
- ✅ 架构决策 12.4 说明设计理由

---

## 19.2 第二轮评审意见响应

### 评审意见 5：路径验证不存在 ✅ 已解决

**原问题**：设计第 13.1 节声称"RegistryStorage 已经实现了路径规范化（第 49-50 行）"，但实际上 `RegistryStorage` 构造函数根本没有任何验证，直接接受用户输入。

**现状分析**：
```typescript
// src/registry/RegistryStorage.ts:42-44
constructor(registryPath?: string) {
  this.registryPath = registryPath || this.getDefaultRegistryPath();
}
```
- ❌ 没有路径规范化
- ❌ 没有路径验证
- ❌ 存在路径遍历攻击风险

**解决方案**：
- ✅ 第 13.1 节删除错误声明，承认现状
- ✅ 提供完整的路径验证实现（`validateRegistryPath` 方法）
- ✅ 提供两个实现方案：
  - 方案 1（推荐）：在 `RegistryStorage` 构造函数中验证
  - 方案 2（备选）：在 CLI 入口点验证
- ✅ 添加具体的验证逻辑：
  - 路径规范化（`path.normalize`）
  - 转换为绝对路径（`path.resolve`）
  - 限制在主目录或当前目录内
  - 确保以 `.json` 结尾
- ✅ 添加验收标准：能够阻止 `--registry ../../etc/passwd` 等攻击

---

### 评审意见 6：agentsMenuState 是死代码 ✅ 已解决

**原问题**：设计第 5.1 节要求在 App 组件添加 `agentsMenuState` 状态，但第 6.2 节又把所有状态移到了 `AgentsMenu` 组件内部，之后再也没有引用 App 级别的状态。这会导致添加无用的死代码。

**冲突分析**：
- 第 5.1 节：定义 App 级别的 `agentsMenuState`
- 第 6.2 节：定义 AgentsMenu 组件内部的 `view`, `loading`, `selectedIndex` 等状态
- 第 7-9 章：所有示例代码只使用 AgentsMenu 内部状态
- 结果：App 的 `agentsMenuState` 从未被引用 = 死代码

**解决方案**：
- ✅ 第 5.1 节删除 `agentsMenuState` 状态定义
- ✅ 明确说明：只需要添加 `'agentsMenu'` 到 `AppMode` 类型
- ✅ 说明 App 组件职责：
  1. 模式切换：`setMode('agentsMenu')`
  2. 渲染 AgentsMenu 组件
  3. 处理关闭回调
- ✅ 所有状态管理都在 AgentsMenu 组件内部（第 6.2 节）

**架构理由**：
- 符合 React 的"状态提升"原则
- AgentsMenu 是自包含组件，管理自己的状态
- App 组件只负责路由/模式切换

---

## 19.3 第三轮评审意见响应

### 评审意见 7：路径验证 startsWith() 存在安全漏洞和可用性 bug ✅ 已解决

**原问题**：第 13.1 节的 `validateRegistryPath` 使用 `absolute.startsWith(homeDir)` 检查路径是否在目录内，但该方法存在严重缺陷。

**缺陷 1：安全漏洞（路径逃逸）**
```typescript
// ❌ 错误的实现：
if (!absolute.startsWith(homeDir) && !absolute.startsWith(cwd)) { ... }

// 漏洞示例：
const homeDir = '/Users/al';
const absolute = '/Users/alex/registry.json';
absolute.startsWith(homeDir); // ✓ true - 错误地通过检查！

// 实际上 '/Users/alex/registry.json' 在 '/Users/alex/' 目录内
// 而不是 '/Users/al/' 目录内，攻击者可以访问其他用户目录
```

**缺陷 2：可用性 bug（Windows 大小写敏感）**
```typescript
// Windows 路径不区分大小写，但 JavaScript 字符串比较区分大小写
const homeDir = 'C:\\Users\\me';       // os.homedir() 返回
const userInput = 'c:\\users\\me\\foo.json';  // 用户输入
userInput.startsWith(homeDir);  // ✗ false - 错误地拒绝有效路径！
```

**正确方案：使用 `path.relative()` 检查**

**原理**：
- `path.relative(from, to)` 返回从 `from` 到 `to` 的相对路径
- 如果相对路径以 `..` 开头，说明 `to` 在 `from` 的外部（向上逃逸）
- 如果相对路径不以 `..` 开头，说明 `to` 在 `from` 的内部

**示例**：
```typescript
path.relative('/Users/al', '/Users/al/registry.json');
// → 'registry.json' (内部，不以 '..' 开头) ✓

path.relative('/Users/al', '/Users/alex/registry.json');
// → '../alex/registry.json' (外部，以 '..' 开头) ✗

path.relative('/Users/al', '/etc/passwd');
// → '../../etc/passwd' (外部，以 '..' 开头) ✗

// Windows 大小写处理（path.relative 正确处理）：
path.relative('C:\\Users\\me', 'c:\\users\\me\\foo.json');
// → 'foo.json' (内部，路径规范化后正确识别) ✓
```

**解决方案**：
- ✅ 第 13.1 节完全重写 `validateRegistryPath` 实现（第 1242-1299 行）
- ✅ 使用 `path.relative()` 代替 `startsWith()`
- ✅ 检查相对路径是否以 `..` 开头（防止向上逃逸）
- ✅ 检查相对路径是否以路径分隔符开头（防止绝对路径）
- ✅ 检查相对路径是否为绝对路径（Windows 不同盘符检测）
- ✅ 检查相对路径长度大于 0（防止使用目录本身作为文件）
- ✅ 添加详细注释说明安全漏洞和正确方案

**新实现关键代码**：
```typescript
const relativeToHome = path.relative(homeDir, absolute);
const isInsideHome = relativeToHome.length > 0 &&
                     !relativeToHome.startsWith('..') &&
                     !relativeToHome.startsWith(path.sep) &&
                     !path.isAbsolute(relativeToHome);
```

**安全性提升**：
- ✅ 阻止路径逃逸攻击：`/Users/alex/registry.json` 被正确识别为在 `/Users/al/` 外部
- ✅ 阻止目录遍历攻击：`../../etc/passwd` 被正确识别为向上逃逸
- ✅ 修复 Windows 大小写问题：`c:\users\me\foo.json` 被正确接受

**验收标准**：
- ✅ 阻止 `--registry /Users/alex/file.json`（当 homeDir 为 `/Users/al`）
- ✅ 阻止 `--registry ../../etc/passwd`
- ✅ 接受 `--registry c:\users\me\foo.json`（Windows，任意大小写）
- ✅ 接受 `--registry ~/mydir/config.json`（正常使用）

---

## 20. 总结

本设计提供了在 REPL 模式下实现 agent 管理的完整、生产就绪的实施计划。架构直接复用现有的 `AgentRegistry` API，避免重复包装，使代码库可维护和可测试。

**关键成功因素**：
1. 直接使用 `AgentRegistry` API，避免过度设计
2. 使用正确的 registry 路径，确保数据一致性
3. 组件提取保持文件可管理
4. 适当的状态管理和 useInput 隔离防止 bug
5. 全面测试确保质量
6. 分阶段实施降低风险

**预计总工作量**：8-12 小时（减少 4 小时，因为不需要创建服务层）

**风险级别**：低（明确定义的范围，复用现有 API）

**用户影响**：高（REPL 用户的主要 UX 改进）
