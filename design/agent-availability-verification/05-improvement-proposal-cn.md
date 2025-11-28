# Agent 验证改进提案

## 执行摘要

本文档提出了对 Agent 验证系统的全面重新设计，旨在：
1. 正确检测所有认证方法
2. 区分网络错误与认证错误
3. 提供可操作的错误消息
4. 减少 API 配额消耗

## 验证结果覆盖矩阵（用户视角）

从用户角度来看，验证完成后有三种结果：**APPROVE（通过）**、**WARN（警告但通过）**、**FAIL（失败阻止）**。

### 完整覆盖矩阵

| 场景 | 结果 | 用户看到的消息示例 |
|------|------|-------------------|
| **APPROVE（直接通过）** |||
| 环境变量有效 (API Key) | ✅ APPROVE | `✓ claude: Authenticated via ANTHROPIC_API_KEY` |
| CLI 状态命令返回成功 | ✅ APPROVE | `✓ codex: Authenticated via OAuth session` |
| 凭证文件存在且格式正确 | ✅ APPROVE | `✓ gemini: Authenticated via Google OAuth` |
| Bedrock/Vertex 模式 + 相应凭证完整 | ✅ APPROVE | `✓ claude: Authenticated via AWS Bedrock` |
| **WARN（警告但通过）** |||
| 网络连通性检查失败，但本地凭证存在 | ⚠️ WARN | `⚠ claude: Cannot reach api.anthropic.com. Proceeding with local credentials.` |
| CLI 状态命令不存在/超时，但凭证文件存在 | ⚠️ WARN | `⚠ codex: Status command unavailable. Local credentials found.` |
| 外部依赖缺失但非必需 (gcloud/aws CLI) | ⚠️ WARN | `⚠ claude: AWS CLI not found. Bedrock mode unavailable, using API key.` |
| macOS 上 `claude auth status` 失败（Keychain 不可读） | ⚠️ WARN | `⚠ claude: Cannot verify Keychain auth. Proceeding.` |
| CLI 状态命令返回未知退出码 | ⚠️ WARN | `⚠ gemini: Unknown exit code 99. Proceeding with caution.` |
| **FAIL（失败阻止）** |||
| 无任何凭证（环境变量、文件、状态命令全无） | ❌ FAIL | `✗ claude: No credentials found. Run: claude auth login` |
| CLI 状态命令明确返回"未认证" | ❌ FAIL | `✗ codex: Not logged in. Run: codex login` |
| Gemini 退出码 41（明确认证错误） | ❌ FAIL | `✗ gemini: Authentication failed (exit 41). Run: gemini` |
| Bedrock/Vertex 模式已启用但凭证缺失 | ❌ FAIL | `✗ claude: Bedrock mode enabled but AWS credentials missing` |
| 凭证文件存在但格式无效/损坏 | ❌ FAIL | `✗ codex: auth.json corrupted. Delete and re-run: codex login` |
| Agent CLI 未安装 | ❌ FAIL | `✗ claude: Command not found. Install: npm install -g @anthropic-ai/claude-code` |

### 决策树（简化）

```
开始验证
    │
    ├── CLI 可执行文件存在？
    │       ├── 否 → ❌ FAIL (CONFIG_MISSING)
    │       └── 是 ↓
    │
    ├── 连通性检查
    │       ├── 失败 → 记录警告，继续 (不阻止！)
    │       └── 成功 ↓
    │
    ├── 环境变量存在？
    │       └── 是 → ✅ APPROVE
    │
    ├── Bedrock/Vertex 模式？
    │       ├── 是 + 凭证完整 → ✅ APPROVE
    │       └── 是 + 凭证缺失 → ❌ FAIL (AUTH_MISSING)
    │
    ├── CLI 状态命令
    │       ├── 返回"已认证" → ✅ APPROVE
    │       ├── 返回"未认证" → ❌ FAIL (AUTH_MISSING)
    │       ├── 命令不存在/超时 → 继续检查文件 ↓
    │       └── 未知错误/退出码 → 继续检查文件 ↓
    │
    ├── 凭证文件存在？
    │       ├── 存在且有效 + 前面有网络/命令警告 → ⚠️ WARN (VERIFICATION_INCOMPLETE)
    │       ├── 存在且有效 + 无其他问题 → ✅ APPROVE
    │       ├── 存在但损坏 → ❌ FAIL (CONFIG_INVALID)
    │       └── 不存在 → ❌ FAIL (AUTH_MISSING)
    │
    └── 结束
```

### 关键原则说明

1. **网络问题永不阻止**：用户可能在代理后、VPN 中、或防火墙限制环境中，直接 TCP 检查失败不代表 CLI 无法工作。
2. **不确定时选择 WARN 而非 FAIL**：一次失败的对话优于被错误阻止的部署。
3. **FAIL 仅用于明确的失败**：必须有来自 CLI 或文件系统的明确证据证明认证不存在或无效。

## 设计原则

### P1: 快速失败，具体失败 (Fail Fast, Fail Specific)

```
Bad:  "认证检查失败：网络错误"
Good: "网络错误 (第4层)：无法连接 api.anthropic.com:443。请检查防火墙或代理设置。"
```

### P2: 优先检查低成本项 (Check Cheap Before Expensive)

```
1. 环境变量 (即时，免费)
2. 文件存在性 (快速，本地)
3. 网络连通性 (快速，无 API 调用)
4. CLI 状态命令 (快速，无配额消耗)
5. API 调用 (慢，消耗配额) - 最后的手段
```

### P3: 无假阴性 (优雅降级)

如有疑问，让用户通过。一次失败的对话体验优于被阻止的部署。

**关键推论**：如果状态命令失败或网络检查失败，我们应该：
- 准确分类错误 (NETWORK_* vs AUTH_* vs UNKNOWN)
- 如果是 UNKNOWN 或不确定的错误：**通过并发出警告**，而不是阻止
- 仅在明确的认证失败时阻止 (例如：来自 API 的明确 401/403)

```typescript
// 示例：状态命令失败但存在凭证文件
if (statusCommandFailed && credentialFilesExist) {
  return {
    passed: true,  // 通过并警告，不要阻止
    warning: '无法在线验证凭证。将使用本地凭证继续。',
    errorType: 'VERIFICATION_INCOMPLETE'
  };
}
```

## 架构分层设计

### 设计目标

本模块的所有组件必须支持未来的 repo 拆分：
- **Core 层**：纯逻辑库，无 UI 依赖，可在 CLI/云端/CI 环境运行
- **UI 层**：负责交互、格式化输出、用户确认

### 分层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI Layer (src/repl/)                           │
│                     负责：格式化输出、错误消息展示                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ServiceInitializer                                                      │
│  - 接收 Core 层返回的 VerificationResult                                  │
│  - 格式化错误消息（添加颜色、图标、换行）                                    │
│  - 调用 IOutput 接口展示给用户                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 调用
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Core Layer (src/services/validation/)               │
│              纯逻辑库，无 UI 依赖，可在 CLI/云端/CI 运行                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    AgentValidator (验证器)                        │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  - verify(agent): VerificationResult                            │    │
│  │  - 聚合各检查器结果                                               │    │
│  │  - 返回结构化数据（不格式化消息）                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                      │                                  │
│         ┌────────────────────────────┴────────────────────┐             │
│         ▼                                                 ▼             │
│  ┌─────────────────────────────┐      ┌─────────────────────────────┐   │
│  │   ConnectivityChecker       │      │   Auth Checkers             │   │
│  ├─────────────────────────────┤      ├─────────────────────────────┤   │
│  │ - checkConnectivity(agent)  │      │ ClaudeAuthChecker           │   │
│  │ - DNS/TCP 检测              │      │ CodexAuthChecker            │   │
│  │ - 返回 ConnectivityResult   │      │ GeminiAuthChecker           │   │
│  └─────────────────────────────┘      └─────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    types.ts (类型定义)                            │    │
│  ├─────────────────────────────────────────────────────────────────┤    │
│  │  ErrorType, CheckResult, VerificationResult, ConnectivityResult  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core 层 vs UI 层职责

| 职责 | Core 层 | UI 层 |
|------|---------|-------|
| 执行检测 | ✅ `checkConnectivity()`, `checkAuth()` | 调用 Core |
| 返回结构化结果 | ✅ `VerificationResult` | 接收并处理 |
| 错误类型分类 | ✅ 返回 `ErrorType` | 转换为人类可读消息 |
| 格式化消息 | ❌ | ✅ 添加颜色、图标、换行 |
| 输出到终端 | ❌ | ✅ 调用 `IOutput` |
| 提供解决建议 | ✅ 返回 `resolution` 字段 | 格式化展示 |

### 文件结构

```
src/
├── services/validation/                # ===== Core 层 =====
│   │                                   # 纯逻辑，无 UI 依赖
│   │                                   # 未来拆分到 agent-chatter-core repo
│   ├── types.ts                        # ErrorType, CheckResult, VerificationResult
│   ├── AgentValidator.ts               # 验证器主类
│   ├── ConnectivityChecker.ts          # 网络连通性检查
│   └── auth/
│       ├── AuthChecker.ts              # 认证检查器接口
│       ├── ClaudeAuthChecker.ts        # Claude 认证检查
│       ├── CodexAuthChecker.ts         # Codex 认证检查
│       └── GeminiAuthChecker.ts        # Gemini 认证检查
│
└── repl/                               # ===== UI 层 =====
    │                                   # 未来拆分到 agent-chatter-repl repo
    └── services/
        └── ServiceInitializer.ts       # 格式化并展示验证结果
```

### 关键设计约束

1. **Core 层禁止依赖**：
   - ❌ 不能依赖 `IOutput` 或任何输出接口
   - ❌ 不能依赖 Ink/Inquirer 等 UI 库
   - ❌ 不能直接调用 `console.log/error`
   - ✅ 只能返回纯数据结构

2. **错误消息模板在 UI 层**：
   - Core 层返回 `errorType: 'AUTH_MISSING'` 和 `resolution: 'Run: claude auth login'`
   - UI 层负责组合成 `"✗ Authentication Error: Not logged in.\n   Suggested fix: Run: claude auth login"`

3. **测试独立性**：
   - Core 层可独立进行单元测试，无需 mock UI
   - UI 层测试关注格式化逻辑

## 新的验证流程

```
                    ┌─────────────────────┐
                    │  checkExecutable()  │
                    └──────────┬──────────┘
                               │ pass
                    ┌──────────▼──────────┐
                    │  checkConnectivity()│ ─── fail ──→ WARN (不阻止)
                    └──────────┬──────────┘
                               │ pass/warn
                    ┌──────────▼──────────┐
                    │ checkAuthentication()│
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
           明确通过           不确定           明确失败
             pass             (warn)            fail
              │                │                │
              ▼                ▼                ▼
          VERIFIED      VERIFIED+WARN       FAILED
```

**关键变更**：连通性检查失败**不再阻止**验证。它只会添加一个警告。这确保了处于代理后或受限网络中的用户如果拥有本地凭证仍可继续。

## 错误分类

### 新的错误类型

```typescript
export type ErrorType =
  // 网络错误 (OSI 第1-4层) - 仅警告，不阻止
  | 'NETWORK_DNS'        // DNS 解析失败
  | 'NETWORK_TIMEOUT'    // 连接超时
  | 'NETWORK_REFUSED'    // 连接被拒绝
  | 'NETWORK_UNREACHABLE'// 网络不可达
  | 'NETWORK_PROXY'      // 代理配置问题
  | 'NETWORK_TLS'        // TLS/SSL 证书问题

  // 认证错误 (OSI 第7层)
  | 'AUTH_MISSING'       // 未找到凭证 - 阻止
  | 'AUTH_INVALID'       // API 拒绝凭证 (401/403) - 阻止
  | 'AUTH_EXPIRED'       // 令牌/密钥过期 - 阻止 (建议重新登录)
  | 'AUTH_PERMISSION'    // 凭证有效但权限不足 - 阻止

  // 配置错误
  | 'CONFIG_MISSING'     // Agent CLI 未安装 - 阻止
  | 'CONFIG_INVALID'     // 配置无效 - 阻止
  | 'CONFIG_VERSION'     // 版本不兼容 - 警告
  | 'CONFIG_DEPENDENCY'  // 缺少外部依赖 (gcloud, aws cli) - 警告

  // 不确定状态 - 通过并警告
  | 'VERIFICATION_INCOMPLETE'  // 无法完全验证，但存在本地凭证
  | 'STATUS_COMMAND_UNAVAILABLE'; // CLI 不支持状态命令
```

### 错误严重性分类

| 错误类型 | 是否阻止? | 理由 |
|------------|-----------|-----------|
| `NETWORK_*` | 否 (警告) | CLI 可能使用代理；直接检查不能反映 CLI 的行为 |
| `AUTH_MISSING` | 是 | 无凭证 = 肯定无法工作 |
| `AUTH_INVALID` | 是 | API 明确拒绝了凭证 |
| `AUTH_EXPIRED` | 是 | 需要重新登录，但用户可以轻松修复 |
| `CONFIG_MISSING` | 是 | Agent 未安装 |
| `CONFIG_DEPENDENCY` | 否 (警告) | 缺少外部工具，但可能不需要 |
| `VERIFICATION_INCOMPLETE` | 否 (警告) | 存在本地凭证，只是无法在线验证 |

### 错误解决方法消息

```typescript
const ErrorResolutions: Record<ErrorType, string> = {
  NETWORK_DNS: '检查互联网连接。尝试：ping api.anthropic.com',
  NETWORK_TIMEOUT: '网络缓慢或被阻止。检查防火墙/VPN 设置。',
  NETWORK_REFUSED: '服务器不可用。检查 API 端点是否可访问。',
  NETWORK_PROXY: '配置代理：export https_proxy=http://proxy:port',
  NETWORK_TLS: 'SSL 问题。企业网络？设置 NODE_EXTRA_CA_CERTS。',

  AUTH_MISSING: '未找到凭证。运行登录命令。',
  AUTH_INVALID: '凭证被拒绝。重新运行登录命令。',
  AUTH_EXPIRED: '会话已过期。运行登录命令以刷新。',
  AUTH_PERMISSION: '访问被拒绝。检查账户权限。',

  CONFIG_MISSING: 'Agent 未安装。运行：npm install -g <agent>',
  CONFIG_INVALID: '配置无效。检查 ~/.agent/config.json',
  CONFIG_VERSION: '版本不匹配。更新 agent：npm update -g <agent>'
};
```

## Core 层实现细节

> **注意**：本章节描述的所有模块均属于 Core 层（`src/services/validation/`），**不依赖任何 UI 组件**。

### 1. 连通性检查模块

```typescript
// src/services/validation/ConnectivityChecker.ts

import * as dns from 'dns';
import * as net from 'net';

export interface ConnectivityResult {
  reachable: boolean;
  latencyMs?: number;
  error?: string;
  errorType?: 'NETWORK_DNS' | 'NETWORK_TIMEOUT' | 'NETWORK_REFUSED' | 'NETWORK_TLS';
}

const API_ENDPOINTS: Record<string, { host: string; port: number }> = {
  claude: { host: 'api.anthropic.com', port: 443 },
  codex: { host: 'api.openai.com', port: 443 },
  gemini: { host: 'generativelanguage.googleapis.com', port: 443 }
};

export async function checkConnectivity(agentType: string): Promise<ConnectivityResult> {
  const endpoint = API_ENDPOINTS[agentType];
  if (!endpoint) {
    return { reachable: true }; // 未知 agent，跳过检查
  }

  const startTime = Date.now();

  // 步骤 1: DNS 解析
  try {
    await dns.promises.resolve4(endpoint.host);
  } catch (error: any) {
    return {
      reachable: false,
      error: `Cannot resolve ${endpoint.host}`,
      errorType: 'NETWORK_DNS'
    };
  }

  // 步骤 2: TCP 连接
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(endpoint.port, endpoint.host);
      socket.setTimeout(5000);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });
    });

    return {
      reachable: true,
      latencyMs: Date.now() - startTime
    };
  } catch (error: any) {
    if (error.code === 'ETIMEDOUT' || error.message === 'Connection timeout') {
      return {
        reachable: false,
        error: `Timeout connecting to ${endpoint.host}`,
        errorType: 'NETWORK_TIMEOUT'
      };
    }
    if (error.code === 'ECONNREFUSED') {
      return {
        reachable: false,
        error: `Connection refused by ${endpoint.host}`,
        errorType: 'NETWORK_REFUSED'
      };
    }
    return {
      reachable: false,
      error: error.message,
      errorType: 'NETWORK_TIMEOUT'
    };
  }
}
```

### 2. Claude Auth 检查器 (修订版)

```typescript
// src/services/validation/auth/ClaudeAuthChecker.ts

export async function checkClaudeAuth(command: string): Promise<AuthCheckResult> {
  // 优先级 1: 环境变量 (即时)
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { passed: true, method: 'ANTHROPIC_API_KEY env var' };
  }
  if (process.env.CLAUDE_API_KEY?.trim()) {
    return { passed: true, method: 'CLAUDE_API_KEY env var (legacy)' };
  }

  // 优先级 2: 云提供商模式
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    const awsOk = await checkAWSCredentials();
    if (awsOk) {
      return { passed: true, method: 'AWS Bedrock' };
    }
    return { passed: false, errorType: 'AUTH_MISSING', message: 'Bedrock mode enabled but AWS credentials missing' };
  }

  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    const gcpOk = await checkGCPCredentials();
    if (gcpOk) {
      return { passed: true, method: 'Vertex AI' };
    }
    return { passed: false, errorType: 'AUTH_MISSING', message: 'Vertex mode enabled but GCP credentials missing' };
  }

  // 优先级 3: CLI 状态命令 (推荐)
  try {
    const { stdout, stderr } = await execAsync(`"${command}" auth status`, { timeout: 5000 });
    const output = stdout + stderr;

    // 解析输出以获取认证状态
    if (output.includes('authenticated') || output.includes('logged in')) {
      return { passed: true, method: 'OAuth session' };
    }
    if (output.includes('not authenticated') || output.includes('not logged in')) {
      return { passed: false, errorType: 'AUTH_MISSING', message: 'Not logged in. Run: claude auth login' };
    }
    // 如果没有明确失败，假设已认证
    return { passed: true, method: 'OAuth session' };
  } catch {
    // 命令不可用或失败，继续文件检查
  }

  // 优先级 4: 凭证文件
  const platform = os.platform();

  // Linux: 检查 .credentials.json
  if (platform === 'linux') {
    const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (fs.existsSync(credsPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        if (creds.accessToken || creds.refreshToken) {
          return { passed: true, method: 'OAuth credentials file' };
        }
      } catch {
        // 解析错误，继续
      }
    }
  }

  // macOS: 无法读取 Keychain，假设认证状态命令是权威的
  if (platform === 'darwin') {
    // 上面已经尝试过 auth status
    // 如果到了这里，假设未认证
    return {
      passed: false,
      errorType: 'AUTH_MISSING',
      message: 'Not authenticated. Run: claude auth login'
    };
  }

  // 优先级 5: 检查主配置中的 API key
  const configPaths = [
    path.join(os.homedir(), '.claude.json'),
    path.join(os.homedir(), '.claude', 'settings.json')
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.apiKeyHelper) {
          // 配置了 API key helper
          return { passed: true, method: 'API key helper script' };
        }
      } catch {
        // 解析错误
      }
    }
  }

  return {
    passed: false,
    errorType: 'AUTH_MISSING',
    message: 'No credentials found. Run: claude auth login (or set ANTHROPIC_API_KEY)'
  };
}

async function checkAWSCredentials(): Promise<boolean> {
  // 检查 AWS 环境变量
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return true;
  }
  // 检查 AWS 凭证文件
  const awsCredsPath = path.join(os.homedir(), '.aws', 'credentials');
  return fs.existsSync(awsCredsPath);
}

async function checkGCPCredentials(): Promise<boolean> {
  // 检查 GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  // 检查 ADC
  const adcPath = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  return fs.existsSync(adcPath);
}
```

### 3. Codex Auth 检查器 (修订版)

```typescript
// src/services/validation/auth/CodexAuthChecker.ts

export async function checkCodexAuth(command: string): Promise<AuthCheckResult> {
  // 优先级 1: 环境变量
  if (process.env.OPENAI_API_KEY?.trim()) {
    return { passed: true, method: 'OPENAI_API_KEY env var' };
  }
  if (process.env.CODEX_API_KEY?.trim()) {
    return { passed: true, method: 'CODEX_API_KEY env var' };
  }

  // 优先级 2: CLI 状态命令 (推荐 - 处理 OAuth 刷新)
  try {
    await execAsync(`"${command}" login status`, { timeout: 5000 });
    // 退出码 0 = 已认证
    return { passed: true, method: 'OAuth session' };
  } catch (error: any) {
    // 非零退出码 = 未认证
    // 但首先检查是否是网络错误
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      return {
        passed: false,
        errorType: 'NETWORK_TIMEOUT',
        message: 'Cannot reach OpenAI servers. Check network connection.'
      };
    }
    // 认证失败 - 检查文件以获取更多上下文
  }

  // 优先级 3: 检查 auth 文件进行诊断
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      if (auth.OPENAI_API_KEY || auth.tokens?.access_token) {
        // 文件中有凭证但状态命令失败
        return {
          passed: false,
          errorType: 'AUTH_EXPIRED',
          message: 'Credentials may be expired. Run: codex login'
        };
      }
    } catch {
      // 解析错误
    }
  }

  return {
    passed: false,
    errorType: 'AUTH_MISSING',
    message: 'Not authenticated. Run: codex login'
  };
}
```

### 4. Gemini Auth 检查器 (修订版)

```typescript
// src/services/validation/auth/GeminiAuthChecker.ts

export async function checkGeminiAuth(command: string): Promise<AuthCheckResult> {
  // 优先级 1: 环境变量
  if (process.env.GEMINI_API_KEY?.trim()) {
    return { passed: true, method: 'GEMINI_API_KEY env var' };
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return { passed: true, method: 'GOOGLE_API_KEY env var' };
  }

  // 优先级 2: Vertex AI 模式
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    // 检查服务账号
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      if (fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        return { passed: true, method: 'Vertex AI Service Account' };
      }
      return {
        passed: false,
        errorType: 'AUTH_INVALID',
        message: `Service account file not found: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`
      };
    }

    // 检查 ADC
    try {
      await execAsync('gcloud auth application-default print-access-token', { timeout: 5000 });
      return { passed: true, method: 'Vertex AI ADC' };
    } catch {
      return {
        passed: false,
        errorType: 'AUTH_MISSING',
        message: 'Vertex AI mode enabled but no credentials. Run: gcloud auth application-default login'
      };
    }
  }

  // 优先级 3: OAuth 凭证文件
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const customConfig = process.env.GEMINI_CONFIG_DIR;

  const credPaths = [
    customConfig ? path.join(customConfig, 'oauth_creds.json') : null,
    path.join(home, '.gemini', 'oauth_creds.json'),
    path.join(xdgConfig, 'gemini', 'oauth_creds.json')
  ].filter(Boolean) as string[];

  for (const credPath of credPaths) {
    if (fs.existsSync(credPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        if (creds.access_token || creds.refresh_token) {
          return { passed: true, method: 'Google OAuth' };
        }
      } catch {
        // 解析错误
      }
    }
  }

  // 优先级 4: 尝试 CLI (检查退出码)
  try {
    const result = await execAsync(`echo "test" | "${command}" 2>&1; echo "EXIT:$?"`, {
      timeout: 10000,
      shell: true
    });
    const exitMatch = result.stdout.match(/EXIT:(\d+)/);
    if (exitMatch) {
      const exitCode = parseInt(exitMatch[1], 10);
      if (exitCode === 0) {
        return { passed: true, method: 'CLI test passed' };
      }
      if (exitCode === 41) {
        return {
          passed: false,
          errorType: 'AUTH_MISSING',
          message: 'Not authenticated. Run: gemini (or set GEMINI_API_KEY)'
        };
      }
    }
  } catch (error: any) {
    // 检查 IPv6 问题
    if (error.message?.includes('ENOTFOUND') || error.message?.includes('ETIMEDOUT')) {
      return {
        passed: false,
        errorType: 'NETWORK_DNS',
        message: 'Network issue (possibly IPv6). Try: NODE_OPTIONS="--dns-result-order=ipv4first" gemini'
      };
    }
  }

  return {
    passed: false,
    errorType: 'AUTH_MISSING',
    message: 'No credentials found. Run: gemini (or set GEMINI_API_KEY)'
  };
}
```

## CLI 状态命令可用性

### 各版本的已知命令支持

| Agent | 状态命令 | 最低版本 | 不可用时的回退 |
|-------|----------------|-----------------|-------------------------|
| Claude | `claude auth status` | v1.0.0+ | 检查凭证文件 |
| Codex | `codex login status` | v0.1.0+ | 检查 `~/.codex/auth.json` |
| Gemini | N/A | N/A | 检查简单命令的退出码 |

### 处理缺失的状态命令

```typescript
async function tryStatusCommand(command: string, statusArgs: string[]): Promise<StatusCommandResult> {
  try {
    const { stdout, stderr } = await execAsync(`"${command}" ${statusArgs.join(' ')}`, {
      timeout: 5000
    });
    return { available: true, output: stdout + stderr };
  } catch (error: any) {
    // 区分 "command not found/invalid args" 和 "auth failed"
    if (error.code === 127 || error.message?.includes('unknown command') ||
        error.message?.includes('invalid option')) {
      return {
        available: false,
        errorType: 'STATUS_COMMAND_UNAVAILABLE',
        fallbackNeeded: true
      };
    }
    // 状态命令存在但返回错误 (可能是认证问题)
    return { available: true, output: error.stderr || error.message };
  }
}
```

### 降级策略

```
1. 尝试状态命令
   ├── 成功 → 使用结果
   ├── 认证错误 → 报告 AUTH_* 错误
   └── 命令不可用 → 回退到文件检查
       └── 文件存在 → 通过并带有 VERIFICATION_INCOMPLETE 警告
       └── 无文件 → 报告 AUTH_MISSING
```

## 外部依赖处理

### Agent 的依赖

| Agent | 外部依赖 | 何时需要 | 如果缺失 |
|-------|---------------------|-------------|------------|
| Claude | `aws` CLI | 仅 Bedrock 模式 | CONFIG_DEPENDENCY 警告 |
| Claude | `gcloud` CLI | 仅 Vertex 模式 | CONFIG_DEPENDENCY 警告 |
| Codex | 无 | - | - |
| Gemini | `gcloud` CLI | 仅 Vertex AI ADC | CONFIG_DEPENDENCY 警告 |

### 依赖检查实现

```typescript
async function checkExternalDependency(dep: 'aws' | 'gcloud'): Promise<DependencyResult> {
  const commands = {
    aws: 'aws --version',
    gcloud: 'gcloud --version'
  };

  try {
    await execAsync(commands[dep], { timeout: 3000 });
    return { available: true };
  } catch {
    return {
      available: false,
      errorType: 'CONFIG_DEPENDENCY',
      message: `${dep} CLI not installed. Required for ${dep === 'aws' ? 'Bedrock' : 'Vertex AI'} mode.`, 
      blocking: false  // 不阻止 - 用户可能不需要此模式
    };
  }
}
```

### 当依赖缺失时

如果用户设置了 `CLAUDE_CODE_USE_BEDROCK=1` 但没有 AWS CLI：
```typescript
// 不要：立即阻止
// 要：先尝试其他认证方法，警告 Bedrock 不可用
return {
  passed: false,
  errorType: 'CONFIG_DEPENDENCY',
  message: 'Bedrock mode requires AWS CLI. Install aws-cli or use different auth method.',
  blocking: false,
  fallbackSuggestion: 'Try: ANTHROPIC_API_KEY env var or claude auth login'
};
```

## UI 层集成

> **注意**：本章节描述的是 UI 层（`src/repl/`）的职责。Core 层（`src/services/validation/`）只返回结构化数据，不负责格式化输出。

### Core 层返回的数据接口

以下接口定义在 Core 层（`src/services/validation/types.ts`），供 UI 层使用：

```typescript
// ===== Core 层类型定义 =====
// 文件：src/services/validation/types.ts

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;           // 纯文本，无格式化
  errorType?: ErrorType;
  resolution?: string;       // 可操作的修复建议（纯文本）
  warning?: string;          // 非阻止性警告（纯文本）
}

export interface VerificationResult {
  name: string;
  status: 'verified' | 'verified_with_warnings' | 'failed';
  error?: string;            // 纯文本错误描述
  errorType?: ErrorType;
  warnings?: string[];       // 纯文本警告列表
  checks: CheckResult[];
}
```

### 数据流向：Core 层 → UI 层

```
┌─────────────────────────────────────────────────────────────────┐
│                         Core 层                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AgentValidator.verify()                                        │
│      │                                                          │
│      ▼                                                          │
│  VerificationResult {                                           │
│    status: 'failed',                                            │
│    errorType: 'AUTH_MISSING',                                   │
│    error: 'Not authenticated',        ← 纯文本，无格式           │
│    checks: [...]                                                │
│  }                                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 返回数据
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          UI 层                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ServiceInitializer.initializeServices()                        │
│      │                                                          │
│      ▼                                                          │
│  格式化错误消息：                                                 │
│    - 添加颜色（红色/黄色/绿色）                                    │
│    - 添加图标（✓/✗/⚠）                                           │
│    - 添加换行和缩进                                              │
│    - 组合错误类型标签 + 详情 + 解决方案                            │
│      │                                                          │
│      ▼                                                          │
│  IOutput.error() / IOutput.warn()                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### UI 层格式化逻辑

> 以下代码位于 UI 层（`src/repl/services/ServiceInitializer.ts`）

```typescript
if (verification.status !== 'verified') {
  let errorMsg = `Agent "${member.agentType}" verification failed`;

  // 添加具体错误类型
  if (verification.errorType) {
    const typeLabel = verification.errorType.startsWith('NETWORK_')
      ? 'Network Error'
      : verification.errorType.startsWith('AUTH_')
        ? 'Authentication Error'
        : 'Configuration Error';
    errorMsg += `\n\nType: ${typeLabel}`;
  }

  // 添加错误详情
  errorMsg += `\nDetails: ${verification.error}`;

  // 添加解决方案
  if (verification.errorType) {
    errorMsg += `\n\nSuggested Fix: ${ErrorResolutions[verification.errorType]}`;
  }

  // 添加检查详情
  if (verification.checks?.length) {
    errorMsg += '\n\nDiagnostic Checks:';
    for (const check of verification.checks) {
      const icon = check.passed ? '✓' : '✗';
      errorMsg += `\n  ${icon} ${check.name}: ${check.message}`;
    }
  }

  throw new Error(errorMsg);
}
```

## 测试用例

### 需要的单元测试

```typescript
describe('AgentValidator', () => {
  describe('Claude Auth', () => {
    it('detects ANTHROPIC_API_KEY env var');
    it('detects CLAUDE_CODE_USE_BEDROCK with AWS creds');
    it('detects OAuth on Linux via credentials file');
    it('uses claude auth status command');
    it('reports auth missing when no creds found');
    it('returns VERIFICATION_INCOMPLETE when status fails but files exist');
  });

  describe('Codex Auth', () => {
    it('detects OPENAI_API_KEY env var');
    it('uses codex login status command');
    it('detects expired tokens');
    it('distinguishes network from auth errors');
    it('falls back to file check when status command unavailable');
  });

  describe('Gemini Auth', () => {
    it('detects GEMINI_API_KEY env var');
    it('detects Vertex AI with service account');
    it('detects Vertex AI with ADC');
    it('detects Google OAuth');
    it('reports IPv6 issues with resolution');
    it('returns CONFIG_DEPENDENCY when gcloud missing for Vertex');
  });

  describe('Connectivity', () => {
    it('detects DNS failures');
    it('detects connection timeouts');
    it('detects connection refused');
    it('passes when API reachable');
    it('returns warning (not blocking) when network check fails');
  });

  describe('Graceful Degradation', () => {
    it('passes with warning when network unreachable but local creds exist');
    it('passes with warning when status command unavailable');
    it('blocks only on definitive auth failures');
  });
});
```

### CI/CD 和离线测试

**挑战**：测试在 CI 环境中运行，没有：
- 真实的 CLI 安装 (claude, codex, gemini)
- 对 API 端点的网络访问
- 有效凭证

**策略**：在适当的边界进行 Mock

```typescript
// Mock execAsync for CLI status commands
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, cb) => {
    if (cmd.includes('claude auth status')) {
      cb(null, 'Authenticated as user@example.com', '');
    } else if (cmd.includes('codex login status')) {
      cb(null, 'Logged in via ChatGPT OAuth', '');
    }
  })
}));

// Mock fs for credential files
vi.mock('fs', () => ({
  existsSync: vi.fn((path) => {
    if (path.includes('.claude/.credentials.json')) return true;
    return false;
  }),
  readFileSync: vi.fn((path) => {
    if (path.includes('.credentials.json')) {
      return JSON.stringify({ accessToken: 'mock', refreshToken: 'mock' });
    }
    throw new Error('File not found');
  })
}));

// Mock dns/net for connectivity
vi.mock('dns', () => ({
  promises: {
    resolve4: vi.fn().mockResolvedValue(['1.2.3.4'])
  }
}));
```

### 测试环境标志

```typescript
// 在测试中，跳过真实网络/CLI 调用
const SKIP_REAL_VERIFICATION = process.env.CI === 'true' ||
                                process.env.SKIP_AGENT_VERIFICATION === 'true';

if (SKIP_REAL_VERIFICATION) {
  // 使用 mock 实现
}
```

## 迁移计划

### 阶段 1: 添加连通性检查 (低风险)

1. 创建 `ConnectivityChecker.ts`
2. 添加到 auth 检查前的验证流程
3. 更新错误消息以区分网络问题

### 阶段 2: 更新 Auth 检查器 (中等风险)

1. 添加环境变量优先级检查
2. 添加 CLI 状态命令使用
3. 扩充凭证文件路径
4. 更新错误类型和消息

### 阶段 3: UI 增强 (低风险)

1. 更新 `CheckResult` 接口
2. 添加解决方案建议
3. 改进 ServiceInitializer 中的错误显示

## 成功指标

| 指标 | 之前 | 目标 |
|--------|--------|--------|
| 假阴性率 | 未知 (高) | < 1% |
| 错误诊断时间 | 分钟级 | 秒级 |
| Auth 相关支持工单 | 多 | 少 |
| 每次验证的 API 配额 | 1 次调用 | 0 次调用 |

## 附录：命令参考

### 各 Agent 的状态命令

| Agent | 状态命令 | 退出码 | 可用性 |
|-------|----------------|------------|--------------|
| Claude | `claude auth status` | 0 = auth, 非0 = no auth | v1.0.0+ (先验证可用性) |
| Codex | `codex login status` | 0 = auth, 非0 = no auth | v0.1.0+ (先验证可用性) |
| Gemini | N/A | 41 = auth error | 无状态命令；使用测试提示的退出码 |

**注意**：始终处理状态命令不存在的情况（旧版本 CLI，自定义构建）。

### 环境变量

| Agent | 主要 | 次要 |
|-------|---------|-----------|
| Claude | `ANTHROPIC_API_KEY` | `CLAUDE_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` |
| Codex | `OPENAI_API_KEY` | `CODEX_API_KEY` |
| Gemini | `GEMINI_API_KEY` | `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_APPLICATION_CREDENTIALS` |

## 附录：代理和防火墙注意事项

### 为什么直接连通性检查可能会失败

我们的 `checkConnectivity()` 使用直接 TCP 连接到 API 端点。然而：

1. **企业代理**：CLI 工具可能配置为使用 `https_proxy`，通过代理服务器路由流量。直接 TCP 检查会失败，但 CLI 工作正常。

2. **防火墙规则**：防火墙可能允许来自特定进程（如 node/python）的流量，但阻止来自我们验证代码的原始套接字连接。

3. **VPN 分流**：部分流量可能通过 VPN 路由，而其他流量直接连接。

### 处理策略

```typescript
async function checkConnectivity(agentType: string): Promise<ConnectivityResult> {
  const result = await directConnectionCheck(agentType);

  if (!result.reachable) {
    // 不要阻止！CLI 可能通过代理工作
    return {
      reachable: false,
      warning: `Direct connection to ${endpoint} failed. If you use a proxy, the CLI may still work.`, 
      errorType: 'NETWORK_TIMEOUT',
      blocking: false  // 关键：不阻止验证
    };
  }

  return { reachable: true };
}
```

### 代理相关环境变量

| 变量 | 使用者 |
|----------|---------|
| `https_proxy` / `HTTPS_PROXY` | 大多数 CLI |
| `http_proxy` / `HTTP_PROXY` | 部分 CLI |
| `no_proxy` / `NO_PROXY` | 绕过列表 |
| `NODE_EXTRA_CA_CERTS` | 企业 SSL 证书 |
| `NODE_OPTIONS="--dns-result-order=ipv4first"` | IPv6 问题 |

### 建议

**切勿仅基于连通性检查失败而阻止验证。** 而是：
1. 记录警告
2. 继续进行 auth 检查
3. 让 CLI 处理网络路由
4. 仅在 auth 检查明确失败（401/403 来自 API）时才失败

## 附录：实现注意事项

以下是实现时需要特别注意的要点，确保系统的健壮性和正确性。

### 注意事项 1：状态命令可用性处理

状态命令可能在以下情况下不可用或行为不一致：
- 旧版本 CLI 不支持状态命令
- 自定义构建的 CLI 移除了状态命令
- 状态命令的输出格式随版本变化

**实现要求**：

```typescript
async function executeStatusCommand(
  command: string,
  args: string[],
  timeout: number = 5000
): Promise<StatusResult> {
  try {
    const { stdout, stderr, code } = await execAsync(
      `"${command}" ${args.join(' ')}`,
      { timeout }
    );

    return {
      available: true,
      exitCode: code,
      output: stdout + stderr
    };
  } catch (error: any) {
    // 区分"命令/参数不存在"和"命令存在但执行失败"
    const isCommandNotFound =
      error.code === 127 ||  // Unix: command not found
      error.code === 'ENOENT' ||  // spawn 找不到
      error.message?.includes('unknown command') ||
      error.message?.includes('unrecognized option') ||
      error.message?.includes('invalid argument') ||
      error.stderr?.includes('Usage:');  // 帮助信息通常表示参数错误

    if (isCommandNotFound) {
      return {
        available: false,
        fallbackNeeded: true,
        reason: 'STATUS_COMMAND_UNAVAILABLE'
      };
    }

    // 命令存在但执行出错（可能是认证问题）
    return {
      available: true,
      exitCode: error.code ?? -1,
      output: error.stderr || error.message
    };
  }
}
```

### 注意事项 2：macOS Keychain 处理 (Claude)

macOS 上 Claude 使用系统 Keychain 存储 OAuth 凭证，我们无法直接读取。

**处理策略**：

```typescript
async function checkClaudeAuthMacOS(command: string): Promise<AuthCheckResult> {
  // 1. 优先检查环境变量
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { passed: true, method: 'ANTHROPIC_API_KEY' };
  }

  // 2. 尝试状态命令
  const statusResult = await executeStatusCommand(command, ['auth', 'status']);

  if (statusResult.available) {
    // 状态命令可用，根据输出判断
    if (isAuthenticatedOutput(statusResult.output)) {
      return { passed: true, method: 'OAuth (Keychain)' };
    }
    if (isNotAuthenticatedOutput(statusResult.output)) {
      return { passed: false, errorType: 'AUTH_MISSING' };
    }
  }

  // 3. 状态命令不可用或输出不确定
  //    macOS 无法读取 Keychain，只能返回 VERIFICATION_INCOMPLETE
  //    但这不等于 AUTH_MISSING！
  return {
    passed: true,  // 不阻止！
    warning: 'Cannot verify Keychain credentials. If auth fails at runtime, run: claude auth login',
    errorType: 'VERIFICATION_INCOMPLETE'
  };
}
```

**关键点**：在 macOS 上，如果状态命令不可用且没有文件凭证，**不要返回 AUTH_MISSING**。用户可能有有效的 Keychain 凭证。应返回 `VERIFICATION_INCOMPLETE` 并让用户通过。

### 注意事项 3：连通性检查必须非阻塞

连通性检查是诊断辅助，**绝不能**阻止验证流程。

**实现要求**：

```typescript
interface ConnectivityResult {
  reachable: boolean;
  latencyMs?: number;
  warning?: string;
  errorType?: NetworkErrorType;
  // 注意：没有 blocking 字段，因为永远不阻塞
}

async function checkConnectivityNonBlocking(
  agentType: string
): Promise<ConnectivityResult> {
  const endpoint = API_ENDPOINTS[agentType];
  if (!endpoint) {
    return { reachable: true };  // 未知 agent，跳过
  }

  // 使用 Promise.race 确保不超时
  const timeoutMs = 3000;  // 3 秒硬超时

  try {
    const result = await Promise.race([
      performConnectivityCheck(endpoint),
      new Promise<ConnectivityResult>((resolve) =>
        setTimeout(() => resolve({
          reachable: false,
          warning: `Connectivity check timed out (${timeoutMs}ms). Continuing anyway.`,
          errorType: 'NETWORK_TIMEOUT'
        }), timeoutMs)
      )
    ]);

    return result;
  } catch (error) {
    // 任何错误都不应阻止验证
    return {
      reachable: false,
      warning: `Connectivity check failed: ${error.message}. Continuing anyway.`,
      errorType: 'NETWORK_UNKNOWN'
    };
  }
}

// 主验证流程中的调用方式
async function verify(agent: AgentConfig): Promise<VerificationResult> {
  const warnings: string[] = [];

  // 连通性检查 - 仅收集警告
  const connectivity = await checkConnectivityNonBlocking(agent.type);
  if (!connectivity.reachable && connectivity.warning) {
    warnings.push(connectivity.warning);
  }
  // 注意：无论连通性结果如何，都继续

  // 继续认证检查...
  const authResult = await checkAuthentication(agent);

  // 合并警告
  return {
    ...authResult,
    warnings: [...warnings, ...(authResult.warnings || [])]
  };
}
```

### 注意事项 4：退出码和输出解析的健壮性

CLI 的退出码和输出格式可能随版本变化，需要健壮的解析策略。

**实现要求**：

```typescript
// 定义已知的退出码含义
const KNOWN_EXIT_CODES = {
  claude: {
    0: 'authenticated',
    1: 'not_authenticated',  // 常见但不保证
    // 其他退出码视为 unknown
  },
  codex: {
    0: 'authenticated',
    // 非 0 通常是 not_authenticated
  },
  gemini: {
    0: 'success',
    41: 'not_authenticated',
    42: 'input_error',
    44: 'sandbox_error',
    52: 'config_error',
    // 其他退出码视为 unknown
  }
};

function interpretExitCode(
  agentType: string,
  exitCode: number,
  output: string
): 'authenticated' | 'not_authenticated' | 'unknown' {
  const known = KNOWN_EXIT_CODES[agentType];
  if (!known) return 'unknown';

  const meaning = known[exitCode];
  if (meaning) return meaning;

  // 退出码未知时，尝试从输出中推断
  const lowerOutput = output.toLowerCase();

  // 明确的认证成功关键词
  if (lowerOutput.includes('authenticated') ||
      lowerOutput.includes('logged in') ||
      lowerOutput.includes('session active')) {
    return 'authenticated';
  }

  // 明确的认证失败关键词
  if (lowerOutput.includes('not authenticated') ||
      lowerOutput.includes('not logged in') ||
      lowerOutput.includes('please login') ||
      lowerOutput.includes('no credentials')) {
    return 'not_authenticated';
  }

  // 无法判断
  return 'unknown';
}

// 使用示例
const result = await executeStatusCommand(command, args);
const interpretation = interpretExitCode(agentType, result.exitCode, result.output);

switch (interpretation) {
  case 'authenticated':
    return { passed: true, method: 'CLI status command' };
  case 'not_authenticated':
    return { passed: false, errorType: 'AUTH_MISSING' };
  case 'unknown':
    // 不确定时，继续检查文件或返回 WARN
    break;
}
```

### 注意事项 5：外部依赖检测流程

检测 aws/gcloud CLI 时，应先尝试其他认证方法，仅在需要时才报告依赖缺失。

**实现要求**：

```typescript
async function checkClaudeAuth(command: string): Promise<AuthCheckResult> {
  // 1. 先检查不需要外部依赖的方法
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { passed: true, method: 'ANTHROPIC_API_KEY' };
  }

  // 2. 检查 OAuth（也不需要外部依赖）
  const oauthResult = await checkClaudeOAuth(command);
  if (oauthResult.passed) {
    return oauthResult;
  }

  // 3. 仅当用户明确启用 Bedrock/Vertex 模式时，才检查依赖
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    const awsAvailable = await checkExternalDep('aws');
    if (!awsAvailable) {
      // 警告而非阻止，因为用户可能有其他方式
      return {
        passed: false,
        errorType: 'CONFIG_DEPENDENCY',
        message: 'Bedrock mode enabled but AWS CLI not found.',
        suggestion: 'Install AWS CLI, or unset CLAUDE_CODE_USE_BEDROCK and use ANTHROPIC_API_KEY'
      };
    }
    // 继续检查 AWS 凭证...
    return await checkBedrockAuth();
  }

  // 4. 如果没有启用特殊模式，且前面的方法都失败，报告 AUTH_MISSING
  return {
    passed: false,
    errorType: 'AUTH_MISSING',
    message: 'No credentials found',
    suggestion: 'Run: claude auth login, or set ANTHROPIC_API_KEY'
  };
}
```

**关键点**：不要在用户没有启用 Bedrock/Vertex 模式时就检查 aws/gcloud CLI。这些是可选依赖。

### 注意事项 6：UI 层错误透传

确保 errorType 从 AgentValidator 一路传递到 UI，不要在中间层丢失或替换为通用消息。

**错误透传链路**：

```
AgentValidator.checkAuth()
    │
    │ 返回: { passed: false, errorType: 'AUTH_MISSING', message: 'Not logged in' }
    │
    ▼
AgentValidator.verify()
    │
    │ 返回: VerificationResult {
    │   status: 'failed',
    │   errorType: 'AUTH_MISSING',  // ← 保留
    │   error: 'Not logged in',
    │   checks: [...]
    │ }
    │
    ▼
AgentRegistry.verifyAgent()
    │
    │ // 直接透传，不要包装成 "Auth check failed"！
    │ 返回原始 VerificationResult
    │
    ▼
ServiceInitializer.initializeServices()
    │
    │ 格式化消息时使用具体的 errorType
    │
    ▼
UI 显示: "Authentication Error: Not logged in. Run: claude auth login"
```

**反模式（禁止）**：

```typescript
// ❌ 错误：在中间层包装错误，丢失 errorType
catch (error) {
  return {
    passed: false,
    message: `Auth check failed: ${error.message}`  // errorType 丢失！
  };
}

// ❌ 错误：UI 层使用通用消息
if (verification.status === 'failed') {
  output.error('Agent verification failed');  // 没有具体信息！
}
```

**正确模式**：

```typescript
// ✓ 正确：保留并透传 errorType
catch (error) {
  if (error.errorType) {
    return {
      passed: false,
      errorType: error.errorType,  // 保留！
      message: error.message
    };
  }
  // 仅当真的不知道错误类型时才用 UNKNOWN
  return {
    passed: false,
    errorType: 'UNKNOWN',
    message: error.message
  };
}

// ✓ 正确：UI 层使用具体信息
if (verification.status === 'failed') {
  const typeLabel = getErrorTypeLabel(verification.errorType);
  const resolution = ErrorResolutions[verification.errorType];
  output.error(`${typeLabel}: ${verification.error}`);
  output.info(`Suggested fix: ${resolution}`);
}
```