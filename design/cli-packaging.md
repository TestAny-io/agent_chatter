# Agent Chatter CLI 包化实施方案

## 1. 背景与目标

> 更新：成员级 `workDir` 已移除，运行时工作目录取决于启动时的 `cwd`（或未来的沙箱入口），配置不再支持 per-member workDir。

### 1.1 当前问题

- **开发环境依赖**: 用户需要在源码目录运行 `node out/cli.js`，依赖编译后的输出目录
- **路径污染**: 运行时生成的文件（registry、team工作区）与源码混在一起
- **分发困难**: 无法通过标准 npm 方式安装和使用
- **用户体验差**: 无法在任意目录执行 `agent-chatter` 命令

### 1.2 目标

1. **标准化 CLI 包**: 支持 `npm install -g @testany/agent-chatter` 全局安装
2. **npx 支持**: 支持 `npx @testany/agent-chatter start -c config.json` 临时运行
3. **目录分离**:
   - 源码目录: `/Users/dev/source code/agent_chatter`
   - 全局安装目录: `~/.nvm/versions/node/v22.14.0/lib/node_modules/@testany/agent-chatter`
   - 运行时数据: `~/.agent-chatter/*`（工作目录由启动 cwd 决定，不再支持 team/member workDir 配置）
4. **开发友好**: 支持 `npm link` 进行开发调试
5. **CI/CD 就绪**: 支持自动化构建、测试、发布流程

### 1.3 Schema 版本策略

**当前**: Agent Chatter **强制要求** 使用 **Schema 1.1** 配置格式

**核心原则**:
- 所有配置文件**必须**声明 `schemaVersion: "1.1"`
- Schema 1.1 要求 agents 在全局 registry 注册，team 配置仅引用 agent 名称
- **不再支持** Schema 1.0 (内联完整 agent 定义)

**CLI 行为**:
- 解析配置时强制检查 `schemaVersion` 字段
- `schemaVersion: "1.1"`: ✓ 正常解析
- `schemaVersion: "1.0"` 或缺失: ✗ **立即报错**，提示迁移

**错误提示示例**:
```
Error: Unsupported configuration schema version.

  Found: schemaVersion = "1.0" (or missing)
  Required: schemaVersion = "1.1"

Schema 1.0 is no longer supported. Please migrate your configuration to Schema 1.1.
Migration guide: design/team-configuration.md

Key changes in Schema 1.1:
  - Agents must be registered in global registry (~/.agent-chatter/agents/config.json)
  - Team config only references agent names, not full definitions
  - Team config can override args/usePty, but NOT command path

Quick migration steps:
  1. Run: agent-chatter agents register <agent-name>
  2. Update config: Remove 'command' field from config.agents[]
  3. Set: "schemaVersion": "1.1"
```

**实现位置**: `src/utils/ConversationStarter.ts:loadConfig()`

## 2. 解决方案概览

### 2.1 核心改动

```
┌─────────────────────────────────────────────────────────────┐
│                  Agent Chatter CLI 包化架构                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  源码仓库 (Development)                                      │
│  └─ /source code/agent_chatter/                             │
│     ├─ package.json (bin: "agent-chatter" -> out/cli.js)   │
│     ├─ src/                                                 │
│     ├─ out/                                                 │
│     └─ design/, tests/, etc.                                │
│                                                             │
│  ↓ npm pack / npm publish                                   │
│                                                             │
│  npm registry                                               │
│  └─ @testany/agent-chatter@0.0.1.tgz                        │
│                                                             │
│  ↓ npm install -g                                           │
│                                                             │
│  全局安装 (User Environment)                                 │
│  └─ ~/.nvm/.../node_modules/@testany/agent-chatter/         │
│     ├─ package.json                                         │
│     ├─ out/cli.js (executable)                              │
│     └─ node_modules/                                        │
│                                                             │
│  ↓ agent-chatter start -c ...                               │
│                                                             │
│  运行时数据 (Runtime)                                        │
│  ├─ ~/.agent-chatter/agents/config.json (全局 registry)     │
│  ├─ /path/to/project/.agent-chatter/ (运行时数据)          │
│  └─ /tmp/agent-chatter-session-xxx/ (临时文件)               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 3. 实施步骤

### 3.1 Phase 1: package.json 配置

#### 3.1.1 当前 package.json 需要的修改

```json
{
  "name": "@testany/agent-chatter",
  "version": "0.0.1",
  "description": "Multi-agent conversation orchestration CLI",
  "type": "module",
  "main": "out/cli.js",
  "bin": {
    "agent-chatter": "out/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "prepublishOnly": "npm run build && npm test",
    "pack:local": "npm pack",
    "install:global": "npm install -g $(npm pack | tail -1)",
    "uninstall:global": "npm uninstall -g @testany/agent-chatter",
    "link:dev": "npm run build && npm link",
    "unlink:dev": "npm unlink -g"
  },
  "files": [
    "out/**/*",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "keywords": [
    "cli",
    "ai",
    "agent",
    "conversation",
    "orchestration",
    "claude",
    "gemini",
    "codex"
  ],
  "author": "TestAny.io",
  "license": "UNLICENSED",
  "private": false,
  "publishConfig": {
    "access": "restricted"
  }
}
```

#### 3.1.2 关键字段说明

- **name**: `@testany/agent-chatter` - 使用 scoped package 避免命名冲突
- **bin**: 指向编译后的 CLI 入口，npm 会自动创建软链接
- **files**: 限制发布包大小，仅包含必要文件（out/, README.md, LICENSE）
  - ⚠️ **重要**: 使用 `files` 字段时，不需要 `.npmignore`（优先级更高，更明确）
  - 包内容完全由 `files` 数组控制，避免两种机制冲突
- **prepublishOnly**: 发布前构建并测试（仅在 `npm publish` 时运行）
  - ⚠️ **注意**: 不使用 `prepare`，因为它会在用户 `npm install` 时运行，导致缺少 devDependencies 而失败
  - 发布的包应包含预构建的 `out/` 目录，用户无需编译
- **engines**: 指定 Node.js 最低版本要求
- **publishConfig.access**: "restricted" 用于私有包，"public" 用于公开发布

### 3.2 Phase 2: CLI 入口脚本修改

#### 3.2.1 确保 out/cli.js 有可执行头

**当前**: `src/cli.ts` 已有 `#!/usr/bin/env node`

**验证**:
```bash
head -1 out/cli.js
# 应输出: #!/usr/bin/env node
```

**如果缺失**: TypeScript 编译会保留第一行的 shebang，无需额外处理。

#### 3.2.2 路径解析修复

**问题**: 当前代码可能使用相对路径加载模板、配置等。

**检查点**:
1. `loadConfig()` - 已使用 `path.resolve(configPath)`，✓ 正确
2. `AgentRegistry` - 默认使用 `~/.agent-chatter/agents/config.json`，✓ 正确
3. team 配置的 `workDir`, `roleDir`, `instructionFile` - 用户配置，✓ 正确

**结论**: 当前代码已正确处理路径，无需修改。

### 3.3 Phase 3: 默认配置目录策略

#### 3.3.1 全局 Registry 位置

**Registry 路径优先级** (从高到低):
1. **CLI 参数**: `--registry <path>` (所有命令支持)
2. **环境变量**: `AGENT_CHATTER_REGISTRY=<path>`
3. **默认位置**: `~/.agent-chatter/agents/config.json`

**代码实现**:

```typescript
// src/registry/RegistryStorage.ts
import * as os from 'os';
import * as path from 'path';

export class RegistryStorage {
  private filePath: string;

  constructor(registryPath?: string) {
    // 优先级: 1. 传入参数  2. 环境变量  3. 默认位置
    this.filePath = registryPath
      || process.env.AGENT_CHATTER_REGISTRY
      || path.join(os.homedir(), '.agent-chatter', 'agents', 'config.json');
  }
}
```

**CLI 命令支持**:

```typescript
// src/cli.ts
import { Command } from 'commander';

const program = new Command();

// 全局选项
program
  .name('agent-chatter')
  .option('--registry <path>', 'Custom agent registry path (default: ~/.agent-chatter/agents/config.json)');

// 所有子命令都可访问 program.opts().registry
program
  .command('start')
  .option('-c, --config <path>', 'Team configuration file')
  .action((options) => {
    const registryPath = program.opts().registry;
    // 传递给 initializeServices({ registryPath })
  });

program
  .command('agents')
  .command('register <name>')
  .action((name, options) => {
    const registryPath = program.opts().registry;
    const registry = new AgentRegistry(registryPath);
    // ...
  });
```

**使用场景**:

| 场景 | 命令示例 | Registry 路径 |
|------|----------|---------------|
| 默认使用 | `agent-chatter agents list` | `~/.agent-chatter/agents/config.json` |
| 环境变量 | `AGENT_CHATTER_REGISTRY=/custom/path agent-chatter agents list` | `/custom/path` |
| CLI 参数 | `agent-chatter --registry /tmp/test.json agents list` | `/tmp/test.json` |
| 测试环境 | `agent-chatter --registry ./test/registry.json start -c config.json` | `./test/registry.json` |

**注意**:
- `AGENT_CHATTER_REGISTRY` 环境变量**仅用于生产/测试环境**，不应在文档中过度强调
- **推荐用法**: 正常用户使用默认路径，测试/CI 使用 `--registry` 参数
- 集成测试中应传递 `registryPath` 参数而非依赖环境变量

#### 3.3.2 Team 工作目录

- **默认**: `{roleDir}/work` (已实现)
- **workDir**: 由启动时的工作目录决定，不再支持 team/member 配置字段

**无需修改**: 完全由用户配置控制，不依赖包安装位置。

### 3.4 Phase 4: 构建与打包

#### 3.4.1 构建流程

```bash
# 1. 清理旧构建
rm -rf out/

# 2. TypeScript 编译
npm run build
# 等价于: tsc

# 3. 验证输出
ls -la out/
# 应包含: cli.js, *.js, *.d.ts, node_modules/ (如果有依赖)

# 4. 打包
npm pack
# 输出: testany-agent-chatter-0.0.1.tgz
```

#### 3.4.2 包内容控制

**策略**: 使用 `package.json` 的 `files` 字段控制包内容，**不使用 `.npmignore`**

**理由**:
- `files` 是白名单机制，明确列出要包含的文件，更安全
- `.npmignore` 是黑名单机制，容易遗漏新增的文件
- 两者同时存在会增加维护成本和混淆

**验证包内容**:

```bash
# 打包
npm pack

# 查看包内容
tar -tzf testany-agent-chatter-0.0.1.tgz

# 应仅包含:
# package/package.json
# package/out/cli.js
# package/out/**/*.js
# package/out/**/*.d.ts
# package/README.md
# package/LICENSE
```

**注意**:
- `out/` 目录必须包含在包内，因为 `bin` 指向 `out/cli.js`
- 发布的包包含**预构建**的代码，用户无需编译

### 3.5 Phase 5: 本地测试

#### 3.5.1 npm pack 测试

```bash
# 1. 在项目根目录打包
cd /Users/kailaichen/Downloads/source\ code/agent_chatter
npm pack

# 2. 创建测试目录
mkdir -p ~/test-agent-chatter
cd ~/test-agent-chatter

# 3. 安装本地包
npm install -g ~/Downloads/source\ code/agent_chatter/testany-agent-chatter-0.0.1.tgz

# 4. 验证安装
which agent-chatter
# 应输出: /Users/kailaichen/.nvm/versions/node/v22.14.0/bin/agent-chatter

agent-chatter --version
# 应输出: 0.0.1

# 5. 测试功能
agent-chatter status
agent-chatter agents list

# 6. 卸载
npm uninstall -g @testany/agent-chatter
```

#### 3.5.2 npm link 开发测试

```bash
# 开发者工作流程

# 1. 在源码目录建立链接
cd /Users/kailaichen/Downloads/source\ code/agent_chatter
npm run build
npm link
# 输出: /Users/kailaichen/.nvm/.../bin/agent-chatter -> .../@testany/agent-chatter/out/cli.js

# 2. 在任意目录测试
cd ~/Documents/my-project
agent-chatter --help

# 3. 修改代码后重新构建
cd /Users/kailaichen/Downloads/source\ code/agent_chatter
# 修改 src/cli.ts
npm run build
# 立即生效，无需重新 link

# 4. 取消链接
npm unlink -g @testany/agent-chatter
```

### 3.6 Phase 6: 分发策略

#### 3.6.1 内部分发 (Private NPM Registry)

**GitHub Packages**

```bash
# 1. 在 package.json 添加 repository
{
  "repository": {
    "type": "git",
    "url": "https://github.com/testany/agent-chatter.git"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}

# 2. 认证
echo "//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN" >> ~/.npmrc

# 3. 发布
npm publish

# 4. 用户安装
npm install -g @testany/agent-chatter --registry=https://npm.pkg.github.com
```

#### 3.6.2 公开发布 (npmjs.com)

```bash
# 1. 注册 npm 账号
npm adduser

# 2. 修改 package.json
{
  "name": "@testany/agent-chatter",
  "publishConfig": {
    "access": "public"  # 公开包
  }
}

# 3. 发布
npm publish --access public

# 4. 用户安装
npm install -g @testany/agent-chatter
```

### 3.7 Phase 7: CI/CD 集成

#### 3.7.1 GitHub Actions 工作流

创建 `.github/workflows/publish.yml`:

```yaml
name: Publish Package

on:
  push:
    tags:
      - 'v*'  # 触发条件: 推送 v1.0.0 等标签

jobs:
  build-and-publish:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Package verification (smoke test)
        run: |
          # 打包
          PACKAGE_FILE=$(npm pack | tail -1)
          echo "Created package: $PACKAGE_FILE"

          # 查看包内容
          echo "Package contents:"
          tar -tzf "$PACKAGE_FILE"

          # 验证必需文件存在
          tar -tzf "$PACKAGE_FILE" | grep -q "package/out/cli.js" || exit 1
          tar -tzf "$PACKAGE_FILE" | grep -q "package/package.json" || exit 1
          tar -tzf "$PACKAGE_FILE" | grep -q "package/README.md" || exit 1

          # 全局安装包
          npm install -g "$PACKAGE_FILE"

          # 验证可执行文件
          which agent-chatter || exit 1

          # 运行核心命令 (smoke tests)
          agent-chatter --version
          agent-chatter --help
          agent-chatter status
          agent-chatter agents list  # 应返回空列表或已注册的 agents

          # 验证 registry 参数
          agent-chatter --registry /tmp/test-registry.json agents list

          echo "✓ Package smoke tests passed"

      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

#### 3.7.2 本地 CI 模拟

在发布前本地运行相同的验证步骤:

```bash
# 清理环境
npm run build
npm test

# 打包
PACKAGE_FILE=$(npm pack | tail -1)

# 安装包
npm install -g "$PACKAGE_FILE"

# 运行 smoke tests
agent-chatter --version
agent-chatter --help
agent-chatter status
agent-chatter agents list

# 清理
npm uninstall -g @testany/agent-chatter
rm "$PACKAGE_FILE"
```

#### 3.7.3 发布流程

```bash
# 1. 更新版本号
npm version patch  # 0.0.1 -> 0.0.2
# 或
npm version minor  # 0.0.1 -> 0.1.0
# 或
npm version major  # 0.0.1 -> 1.0.0

# 2. 推送 tag
git push origin main --tags

# 3. GitHub Actions 自动构建、测试、验证打包、发布
```

## 4. 目录结构对比

### 4.1 开发环境

```
/Users/kailaichen/Downloads/source code/agent_chatter/
├── package.json                 # bin: agent-chatter -> out/cli.js
├── tsconfig.json
├── src/
│   ├── cli.ts                  # #!/usr/bin/env node
│   ├── commands/
│   ├── models/
│   ├── registry/
│   └── utils/
├── out/                        # 编译输出 (npm run build)
│   ├── cli.js
│   ├── commands/
│   └── ...
├── tests/
├── design/
└── node_modules/
```

### 4.2 全局安装后

```
~/.nvm/versions/node/v22.14.0/
├── bin/
│   └── agent-chatter -> ../lib/node_modules/@testany/agent-chatter/out/cli.js
└── lib/node_modules/
    └── @testany/
        └── agent-chatter/
            ├── package.json
            ├── out/
            │   ├── cli.js
            │   └── ...
            ├── node_modules/
            └── README.md
```

### 4.3 运行时数据

```
~/.agent-chatter/
└── agents/
    └── config.json              # 全局 agent registry

/path/to/project/
├── teams/
│   └── my-team/
│       ├── team_instruction.md
│       ├── member1/
│       │   ├── AGENTS.md
│       └── shared-work/        # （历史）team workDir —— 已弃用，运行时使用启动目录
└── agent-chatter-config.json
```

## 5. 使用场景示例

### 5.1 全局安装后的使用

```bash
# 场景 1: 在任意目录使用
cd ~/Documents/my-ai-project
agent-chatter agents scan
agent-chatter agents register claude

# 场景 2: 运行团队对话
agent-chatter start -c ./config/team1.json -m "Start the review"

# 场景 3: 使用 npx (无需全局安装)
npx @testany/agent-chatter start -c config.json

# 场景 4: 项目内局部安装
npm install @testany/agent-chatter --save-dev
npx agent-chatter start -c config.json
```

### 5.2 开发者使用 npm link

```bash
# 开发者 A 在源码目录
cd ~/dev/agent-chatter
npm run build
npm link

# 开发者 A 在测试项目中
cd ~/test-project
agent-chatter --version  # 使用链接的版本
# 修改源码后只需 npm run build，无需重新 link

# 开发者 B 协作
cd ~/dev/agent-chatter
git pull
npm run build
npm link
```

## 6. 测试验证清单

### 6.1 功能测试 (手动)

- [ ] `npm pack` 生成 .tgz 包
- [ ] `npm install -g <tgz>` 全局安装成功
- [ ] `which agent-chatter` 找到可执行文件
- [ ] `agent-chatter --version` 显示正确版本
- [ ] `agent-chatter --help` 显示帮助信息
- [ ] `agent-chatter status` 检测 AI CLI 工具
- [ ] `agent-chatter agents scan` 扫描可用 agents
- [ ] `agent-chatter agents register claude` 注册 agent
- [ ] `agent-chatter start -c config.json` 启动对话
- [ ] 在非源码目录运行所有命令

### 6.2 自动化 Smoke Tests (CI)

**必须在 CI 中自动运行** (参考 3.7.1):

- [ ] 打包后验证包内容 (`tar -tzf`)
- [ ] 全局安装打包文件
- [ ] 验证可执行文件存在 (`which agent-chatter`)
- [ ] 运行 `agent-chatter --version`
- [ ] 运行 `agent-chatter --help`
- [ ] 运行 `agent-chatter status`
- [ ] 运行 `agent-chatter agents list`
- [ ] 验证 `--registry` 参数 (`agent-chatter --registry /tmp/test.json agents list`)

**CI 验证脚本** (添加到 `.github/workflows/publish.yml`):

```bash
# 见 3.7.1 完整实现
PACKAGE_FILE=$(npm pack | tail -1)
npm install -g "$PACKAGE_FILE"
agent-chatter --version
agent-chatter --help
agent-chatter status
agent-chatter agents list
agent-chatter --registry /tmp/test-registry.json agents list
```

### 6.3 路径隔离测试

- [ ] 全局 registry 写入 `~/.agent-chatter/agents/config.json`
- [ ] `--registry` 参数可以覆盖默认路径
- [ ] Team workDir 写入用户配置的路径
- [ ] 源码目录不产生运行时文件
- [ ] `node_modules/` 不在工作区创建

### 6.4 开发流程测试

- [ ] `npm link` 创建开发链接
- [ ] 修改源码后 `npm run build` 立即生效
- [ ] `npm unlink` 取消链接
- [ ] `npm test` 所有测试通过
- [ ] TypeScript 编译无错误

### 6.5 分发测试

- [ ] `npm pack` 包大小合理 (< 5MB)
- [ ] .tgz 包不包含 src/, tests/, design/
- [ ] .tgz 包包含 out/, package.json, README.md
- [ ] 安装后可执行文件有 +x 权限
- [ ] 在另一台机器安装测试

## 7. 风险与注意事项

### 7.1 依赖管理

**风险**: 生产依赖未正确标记，导致安装后缺少模块

**缓解**:
```json
{
  "dependencies": {
    "commander": "^11.0.0",
    "ink": "^4.0.0",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0"
  }
}
```

**验证**:
```bash
# 在干净环境测试
rm -rf node_modules package-lock.json
npm install --production
npm run build
```

### 7.2 Shebang 行处理

**风险**: Windows 用户无法执行（Windows 不支持 shebang）

**缓解**: npm 会自动生成 `.cmd` 包装脚本

**验证**: 在 Windows 上测试 `agent-chatter.cmd --help`

### 7.3 ESM vs CommonJS

**当前**: `"type": "module"` (ESM)

**注意**:
- 所有 import 必须包含 `.js` 扩展名
- 动态 import 使用 `await import()`
- `__dirname` 不可用，需用 `import.meta.url`

**已验证**: 当前代码已正确使用 ESM

### 7.4 构建脚本时机

**风险**: `prepare` 脚本在用户 `npm install` 时运行，但 devDependencies 不会被安装

**问题**:
```json
{
  "scripts": {
    "prepare": "npm run build"  // ❌ 错误: 用户安装时会失败
  }
}
```

用户运行 `npm install -g @testany/agent-chatter` 时:
1. npm 下载包（包含 package.json 但**没有** out/ 目录）
2. npm 安装 dependencies（**不包括** devDependencies，所以没有 TypeScript）
3. npm 运行 `prepare` 脚本
4. `npm run build` 调用 `tsc`，但 tsc 不存在 → **失败**

**正确做法**:
```json
{
  "scripts": {
    "prepublishOnly": "npm run build && npm test"  // ✓ 仅在发布前运行
  },
  "files": [
    "out/**/*"  // 发布的包已包含预构建的 out/ 目录
  ]
}
```

**原理**:
- `prepublishOnly`: 仅在 `npm publish` 前运行（开发者环境，有 devDependencies）
- 发布的包已包含编译后的 `out/` 目录
- 用户安装时**不需要**编译，直接使用预构建的代码

### 7.5 全局安装权限

**风险**: `npm install -g` 需要 sudo (Linux/Mac)

**缓解**:
1. 使用 nvm/fnm 管理 Node.js (推荐)
2. 配置 npm prefix: `npm config set prefix ~/.npm-global`
3. 使用 npx (无需全局安装)

### 7.6 版本管理

**策略**:
- 遵循 [Semantic Versioning](https://semver.org/)
- 主版本 (1.0.0): 不兼容的 API 变更
- 次版本 (0.1.0): 向后兼容的功能新增
- 补丁版本 (0.0.1): 向后兼容的 bug 修复

**自动化**:
```bash
npm version patch -m "Fix: registry cache bug"
npm version minor -m "Feature: add team export command"
npm version major -m "Breaking: redesign config schema"
```

## 8. 后续优化建议

### 8.1 短期 (1-2 周)

1. **添加示例配置**:
   ```bash
   agent-chatter init  # 生成 ./agent-chatter-config.json 模板
   ```

2. **改进错误提示**:
   - 未安装 agent 时给出清晰的安装指引
   - 配置文件错误时高亮具体位置

3. **日志系统**:
   - `--verbose` 显示详细日志
   - `--quiet` 静默模式
   - 日志写入 `~/.agent-chatter/logs/`

### 8.2 中期 (1-2 月)

1. **插件系统**:
   - 支持第三方 agent 类型
   - `agent-chatter plugin install @testany/agent-chatter-gpt4`

2. **配置管理**:
   ```bash
   agent-chatter config set defaultRegistry /custom/path
   agent-chatter config get
   ```

3. **Team 模板**:
   ```bash
   agent-chatter team create --template=code-review
   agent-chatter team export ./my-team --output=template.zip
   ```

### 8.3 长期 (3-6 月)

1. **Web UI**: 启动本地服务器查看对话历史
2. **Docker 支持**: 容器化部署
3. **多租户**: 支持企业级多团队管理

## 9. 实施时间表

| 阶段 | 任务 | 负责人 | 工期 | 交付物 |
|------|------|--------|------|--------|
| Phase 1 | package.json 配置 | 开发者 | 1天 | 更新的 package.json |
| Phase 2 | CLI 脚本验证 | 开发者 | 0.5天 | 验证报告 |
| Phase 3 | 路径处理审查 | 架构师 | 1天 | 代码审查报告 |
| Phase 4 | 构建流程测试 | QA | 1天 | 测试报告 |
| Phase 5 | 本地安装测试 | QA | 1天 | 功能测试报告 |
| Phase 6 | 分发方案选型 | PM | 2天 | 分发策略文档 |
| Phase 7 | CI/CD 配置 | DevOps | 2天 | 自动化流水线 |
| Phase 8 | 文档编写 | Tech Writer | 2天 | README, 安装指南 |
| **总计** | | | **11天** | 完整的 CLI 包 |

## 10. 验收标准

### 10.1 功能验收

- [ ] 在 3 个不同的目录安装测试，均成功运行
- [ ] 所有 223 个测试用例通过
- [ ] npm pack 生成的包 < 10MB
- [ ] 支持 Node.js 18, 20, 22 LTS 版本

### 10.2 文档验收

- [ ] README.md 包含安装、快速开始、命令参考
- [ ] CHANGELOG.md 记录版本变更
- [ ] 贡献指南 (CONTRIBUTING.md)
- [ ] API 文档 (如需对外发布)

### 10.3 安全验收

- [ ] `npm audit` 无高危漏洞
- [ ] 依赖树扁平化，无重复依赖
- [ ] 敏感信息不在 package.json 中
- [ ] 确认不存在 `.npmignore` 文件（仅使用 `package.json` 的 `files` 字段控制包内容）
- [ ] 确认包内容与 `files` 列表一致（通过 `tar -tzf *.tgz` 验证）

## 11. 参考资料

- [npm CLI 包开发指南](https://docs.npmjs.com/cli/v9/using-npm/developers)
- [Semantic Versioning](https://semver.org/)
- [Node.js Shebang](https://nodejs.org/api/cli.html#cli_shebang)
- [npm-link 工作原理](https://docs.npmjs.com/cli/v9/commands/npm-link)
- [GitHub Packages 使用指南](https://docs.github.com/en/packages)

## 12. 附录

### 12.1 完整的 package.json 示例

```json
{
  "name": "@testany/agent-chatter",
  "version": "0.0.1",
  "description": "Multi-agent conversation orchestration CLI for AI assistants",
  "type": "module",
  "main": "out/cli.js",
  "bin": {
    "agent-chatter": "out/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "compile": "tsc",
    "pack:local": "npm pack",
    "install:global": "npm install -g $(npm pack | tail -1)",
    "uninstall:global": "npm uninstall -g @testany/agent-chatter",
    "link:dev": "npm run build && npm link",
    "unlink:dev": "npm unlink -g",
    "prepublishOnly": "npm run build && npm test"
  },
  "files": [
    "out/**/*",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "cli",
    "ai",
    "agent",
    "conversation",
    "orchestration",
    "claude",
    "gemini",
    "openai",
    "multi-agent"
  ],
  "author": "TestAny.io <support@testany.io>",
  "license": "UNLICENSED",
  "repository": {
    "type": "git",
    "url": "https://github.com/testany/agent-chatter.git"
  },
  "bugs": {
    "url": "https://github.com/testany/agent-chatter/issues"
  },
  "homepage": "https://github.com/testany/agent-chatter#readme",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "ink": "^4.0.0",
    "react": "^18.2.0",
    "ink-text-input": "^5.0.1",
    "ink-select-input": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.0.0",
    "vitest": "^1.6.0",
    "ink-testing-library": "^3.0.0"
  },
  "publishConfig": {
    "access": "restricted",
    "registry": "https://registry.npmjs.org/"
  }
}
```

---

## 13. 架构委员会第一轮评审问题修正

### 13.1 修正内容

本文档已针对架构委员会第一轮评审意见进行全面修正：

#### 问题 1: Schema 模式不统一 ✓ 已修正
- **新增**: 1.3 节强制要求 Schema 1.1，不再支持 Schema 1.0
- **行为**: 遇到非 1.1 版本立即报错，提供详细迁移指引
- **实现**: `src/utils/ConversationStarter.ts:loadConfig()` 需实现版本检查
- **参考**: `design/team-configuration.md` 迁移指南

#### 问题 2: Registry 注入方式不完整 ✓ 已修正
- **新增**: 3.3.1 完整的 Registry 路径优先级文档
- **新增**: CLI `--registry <path>` 全局参数支持
- **新增**: 使用场景表格和代码示例
- **明确**: `AGENT_CHATTER_REGISTRY` 环境变量仅用于测试/CI

#### 问题 3: npm 包文件列表与 .npmignore 冲突 ✓ 已修正
- **修正**: 3.1.2 和 3.4.2 强调**仅使用 `files` 字段**
- **删除**: 原 3.4.2 的 `.npmignore` 配置说明
- **删除**: 附录 12.2 的 `.npmignore` 完整示例
- **原理**: `files` 白名单机制更安全，避免维护冲突

#### 问题 4: prepare 脚本构建隐患 ✓ 已修正
- **修正**: 3.1.1 package.json 使用 `prepublishOnly` 代替 `prepare`
- **新增**: 7.4 详细说明 `prepare` 风险和正确做法
- **修正**: 附录 12.1 完整 package.json 示例移除 `prepare`
- **原理**: 发布包含预构建 `out/` 目录，用户无需编译

#### 问题 5: 缺少包安装后的自动化验证 ✓ 已修正
- **新增**: 3.7.1 GitHub Actions 包含完整 smoke test 步骤
- **新增**: 3.7.2 本地 CI 模拟脚本
- **新增**: 6.2 自动化 Smoke Tests 清单
- **验证**: 包内容、安装、核心命令、`--registry` 参数

### 13.2 变更影响

| 变更项 | 影响范围 | 行动项 |
|--------|----------|--------|
| Schema 1.1 标准化 | 文档说明 | 用户应优先使用 Schema 1.1 |
| `--registry` CLI 参数 | CLI 代码 | 需实现全局选项并传递到所有命令 |
| 移除 `.npmignore` | 构建流程 | 确保不创建 `.npmignore` 文件 |
| 使用 `prepublishOnly` | package.json | 更新 scripts 字段 |
| CI smoke tests | GitHub Actions | 实现 3.7.1 完整验证流程 |

### 13.3 后续步骤

1. **代码实现**: 在 `src/cli.ts` 添加 `--registry` 全局选项
2. **Schema 版本检查**: 在 `src/utils/ConversationStarter.ts:loadConfig()` 实现强制版本检查
3. **更新 package.json**: 确保使用 `prepublishOnly` 而非 `prepare`
4. **创建 CI workflow**: 实现 `.github/workflows/publish.yml`
5. **测试验证**: 本地运行 3.7.2 的 CI 模拟脚本
6. **清理构建**: 确保项目中不存在 `.npmignore` 文件
7. **文档更新**: 在 README 中说明**仅支持** Schema 1.1

### 13.4 第二轮评审修正 (2025-01-19)

架构委员会第二轮评审要求进一步加强策略一致性：

#### 修正 1: 强制 Schema 1.1，移除向后兼容 ✓ 已修正
- **问题**: 第一轮修正中仍保留"Schema 1.0 仅作向后兼容"的表述，会让团队误以为 1.0 还能用
- **修正**: 1.3 节改为**强制要求** Schema 1.1，非 1.1 版本**立即报错**
- **新增**: 详细的错误提示示例，包含迁移步骤
- **影响**: 需在 `loadConfig()` 中添加版本检查，拒绝 1.0 或缺失版本

#### 修正 2: 安全验收清单移除 .npmignore 检查 ✓ 已修正
- **问题**: 10.3 节仍有"`.npmignore 正确排除私有文件`"检查项，与前面"不使用 .npmignore"策略冲突
- **修正**: 改为两项新检查：
  - "确认不存在 `.npmignore` 文件"
  - "确认包内容与 `files` 列表一致"
- **验证方法**: `tar -tzf *.tgz` 核对包内容

#### 变更影响

| 变更项 | 影响范围 | 行动项 |
|--------|----------|--------|
| 强制 Schema 1.1 检查 | `ConversationStarter.ts` | 实现版本检查和错误提示 |
| 移除所有 Schema 1.0 示例 | 文档、测试 | 清理残留的 1.0 配置示例 |
| 验收清单更新 | 测试流程 | 添加 .npmignore 不存在的检查 |

---

**文档版本**: 2.1 (第二轮评审修正版)
**最后更新**: 2025-01-19
**修订内容**:
- 第一轮: 5 项架构问题修正 (Schema策略、Registry注入、files vs .npmignore、prepare脚本、CI验证)
- 第二轮: 2 项策略一致性加强 (强制Schema 1.1、移除.npmignore检查)
**审阅者**: [待定]
**批准者**: [待定]
