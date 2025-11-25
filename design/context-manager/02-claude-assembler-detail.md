# ClaudeContextAssembler 详细设计

## 1. 模块概述

### 1.1 职责

`ClaudeContextAssembler` 负责将通用上下文数据组装成 Claude Code CLI 专用的 Prompt 格式。

**核心特点**：
- System Instruction 通过 `--append-system-prompt` CLI 参数传递，不嵌入 Prompt 正文
- 使用 `[TEAM_TASK]`、`[CONTEXT]`、`[MESSAGE]` 等带方括号的标记分隔各部分
- 输出包含两部分：`prompt`（主体）和 `systemFlag`（系统指令）

### 1.2 文件位置

```
src/context/assemblers/ClaudeContextAssembler.ts
```

### 1.3 接口实现

```typescript
implements IContextAssembler
```

---

## 2. 输入输出格式

### 2.1 输入（AssemblerInput）

```typescript
interface AssemblerInput {
  contextMessages: PromptContextMessage[];  // 已清理标记的历史消息
  currentMessage: string;                    // 已清理标记的当前消息
  teamTask: string | null;                   // 团队任务
  systemInstruction?: string;                // 成员系统指令
  instructionFileText?: string;              // 指令文件内容
  maxBytes: number;                          // 字节预算
}
```

### 2.2 输出（AssemblerOutput）

```typescript
interface AssemblerOutput {
  prompt: string;       // 主体 Prompt（发送到 stdin）
  systemFlag?: string;  // 系统指令（传给 --append-system-prompt）
}
```

### 2.3 Claude 特有输出结构

```
┌──────────────────────────────────────────────────────────┐
│  AssemblerOutput                                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  prompt (主体，通过 stdin 发送):                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  [TEAM_TASK]                                       │  │
│  │  {teamTask}                                        │  │
│  │                                                    │  │
│  │  [CONTEXT]                                         │  │
│  │  - {from} -> {to}: {content}                       │  │
│  │  - {from} -> {to}: {content}                       │  │
│  │  ...                                               │  │
│  │                                                    │  │
│  │  [MESSAGE]                                         │  │
│  │  {currentMessage}                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  systemFlag (通过 --append-system-prompt 传递):          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  {systemInstruction}                               │  │
│  │                                                    │  │
│  │  {instructionFileText}                             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 类定义

### 3.1 类签名

```typescript
export class ClaudeContextAssembler implements IContextAssembler {
  getAgentType(): AgentType;
  assemble(input: AssemblerInput): AssemblerOutput;
}
```

### 3.2 getAgentType()

**签名**：
```typescript
getAgentType(): AgentType
```

**返回值**：
```typescript
return 'claude-code';
```

---

## 4. assemble() 方法详细设计

### 4.1 方法签名

```typescript
assemble(input: AssemblerInput): AssemblerOutput
```

### 4.2 算法流程

```
┌─────────────────────────────────────────────────────────────┐
│                    assemble() 流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. 构建 systemFlag                                         │
│     ↓                                                        │
│  2. 构建 [TEAM_TASK] 部分                                   │
│     ↓                                                        │
│  3. 构建 [CONTEXT] 部分                                     │
│     ↓                                                        │
│  4. 构建 [MESSAGE] 部分                                     │
│     ↓                                                        │
│  5. 组合 prompt（不含空部分）                               │
│     ↓                                                        │
│  6. 调用 trimmer 检查字节限制                               │
│     ↓                                                        │
│  7. 返回 { prompt, systemFlag }                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 详细实现

```typescript
assemble(input: AssemblerInput): AssemblerOutput {
  const {
    contextMessages,
    currentMessage,
    teamTask,
    systemInstruction,
    instructionFileText,
    maxBytes
  } = input;

  // Step 1: 构建 systemFlag
  const systemFlag = this.buildSystemFlag(systemInstruction, instructionFileText);

  // Step 2: 构建各部分
  const sections: string[] = [];

  // [TEAM_TASK] - 仅当有内容时添加
  if (teamTask?.trim()) {
    sections.push(`[TEAM_TASK]\n${teamTask.trim()}`);
  }

  // [CONTEXT] - 仅当有消息时添加
  if (contextMessages.length > 0) {
    const contextLines = contextMessages.map(msg =>
      `- ${msg.from} -> ${msg.to}: ${msg.content}`
    );
    sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
  }

  // [MESSAGE] - 仅当有内容时添加
  if (currentMessage?.trim()) {
    sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
  }

  // Step 3: 组合 prompt
  let prompt = sections.join('\n\n');

  // Step 4: 检查字节限制并裁剪
  const result = this.applyByteBudget(prompt, systemFlag, maxBytes, contextMessages);

  return result;
}
```

---

## 5. 辅助方法

### 5.1 buildSystemFlag()

**职责**：构建系统指令字符串

```typescript
private buildSystemFlag(
  systemInstruction?: string,
  instructionFileText?: string
): string | undefined {
  const parts: string[] = [];

  if (systemInstruction?.trim()) {
    parts.push(systemInstruction.trim());
  }

  if (instructionFileText?.trim()) {
    parts.push(instructionFileText.trim());
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join('\n\n');
}
```

**处理规则**：
| systemInstruction | instructionFileText | 结果 |
|-------------------|---------------------|------|
| undefined | undefined | `undefined` |
| "You are Max" | undefined | `"You are Max"` |
| undefined | "Always be helpful" | `"Always be helpful"` |
| "You are Max" | "Always be helpful" | `"You are Max\n\nAlways be helpful"` |
| "  " (空白) | "text" | `"text"` |

### 5.2 applyByteBudget()

**职责**：确保输出不超过字节预算

```typescript
private applyByteBudget(
  prompt: string,
  systemFlag: string | undefined,
  maxBytes: number,
  contextMessages: PromptContextMessage[]
): AssemblerOutput {
  // 计算当前总字节数
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const systemBytes = systemFlag ? Buffer.byteLength(systemFlag, 'utf8') : 0;
  const totalBytes = promptBytes + systemBytes;

  // 如果在预算内，直接返回
  if (totalBytes <= maxBytes) {
    return { prompt, systemFlag };
  }

  // 需要裁剪：优先裁剪 context（保留最近的消息）
  // 调用共享的 trimContext 工具
  const trimmedPrompt = trimContextToFit(
    prompt,
    maxBytes - systemBytes,
    contextMessages
  );

  return { prompt: trimmedPrompt, systemFlag };
}
```

**裁剪策略**：
1. 优先保留 `[MESSAGE]` 和 `[TEAM_TASK]`
2. 从 `[CONTEXT]` 的**最旧消息**开始移除
3. 如果移除所有 context 仍超限，截断 `[MESSAGE]`
4. `systemFlag` 不裁剪（固定内容，应在设置时限制大小）

---

## 6. 输出示例

### 6.1 完整输出示例

**输入**：
```typescript
{
  contextMessages: [
    { from: 'kailai', to: 'max', content: 'Hi, please help design a feature' },
    { from: 'max', to: 'sarah', content: 'I suggest using a microservice architecture' }
  ],
  currentMessage: 'What do you think about this approach?',
  teamTask: 'Design a user authentication system',
  systemInstruction: 'You are Sarah, a backend engineer',
  instructionFileText: 'Focus on security and scalability',
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `[TEAM_TASK]
Design a user authentication system

[CONTEXT]
- kailai -> max: Hi, please help design a feature
- max -> sarah: I suggest using a microservice architecture

[MESSAGE]
What do you think about this approach?`,

  systemFlag: `You are Sarah, a backend engineer

Focus on security and scalability`
}
```

### 6.2 空部分处理示例

**输入**（无 teamTask，无 context）：
```typescript
{
  contextMessages: [],
  currentMessage: 'Hello',
  teamTask: null,
  systemInstruction: 'You are Max',
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `[MESSAGE]
Hello`,

  systemFlag: `You are Max`
}
```

**注意**：`[TEAM_TASK]` 和 `[CONTEXT]` 部分完全省略，不输出空标签。

### 6.3 无系统指令示例

**输入**：
```typescript
{
  contextMessages: [],
  currentMessage: 'Hello',
  teamTask: 'Build a feature',
  systemInstruction: undefined,
  instructionFileText: undefined,
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `[TEAM_TASK]
Build a feature

[MESSAGE]
Hello`,

  systemFlag: undefined
}
```

---

## 7. 与 Claude Code CLI 的集成

### 7.1 CLI 调用方式

```bash
# AgentManager 生成的命令
claude \
  --append-system-prompt "You are Max..." \
  --print \
  --output-format stream-json \
  < prompt.txt
```

### 7.2 AgentManager 使用示例

```typescript
// AgentManager.ts
const { prompt, systemFlag } = assembler.assemble(input);

const args = ['--print', '--output-format', 'stream-json'];

if (systemFlag) {
  args.push('--append-system-prompt', systemFlag);
}

// 通过 stdin 发送 prompt
const process = spawn('claude', args);
process.stdin.write(prompt);
process.stdin.end();
```

---

## 8. 边界条件处理

### 8.1 空输入处理

| 输入状态 | 处理方式 |
|---------|---------|
| `contextMessages = []` | 不输出 `[CONTEXT]` 部分 |
| `currentMessage = ''` | 不输出 `[MESSAGE]` 部分 |
| `teamTask = null` | 不输出 `[TEAM_TASK]` 部分 |
| `teamTask = '  '` (空白) | 不输出 `[TEAM_TASK]` 部分 |
| 全部为空 | 返回 `{ prompt: '', systemFlag: undefined }` |

### 8.2 特殊字符处理

Prompt 内容**不做转义**，原样保留：
- 换行符 `\n`：保留
- 方括号 `[]`：保留（消息内容中的不影响解析）
- Unicode 字符：保留

### 8.3 字节预算超限

裁剪顺序：
1. 移除最旧的 context 消息
2. 如果仍超限，截断 currentMessage
3. systemFlag 不裁剪

---

## 9. 单元测试用例

### 9.1 基本功能

```typescript
describe('ClaudeContextAssembler', () => {
  it('getAgentType returns claude-code');

  describe('assemble', () => {
    it('produces correct format with all sections');
    it('separates systemFlag from prompt');
    it('joins systemInstruction and instructionFileText');
  });
});
```

### 9.2 空部分处理

```typescript
describe('empty section handling', () => {
  it('omits [TEAM_TASK] when teamTask is null');
  it('omits [TEAM_TASK] when teamTask is whitespace');
  it('omits [CONTEXT] when contextMessages is empty');
  it('omits [MESSAGE] when currentMessage is empty');
  it('returns empty prompt when all sections empty');
  it('returns undefined systemFlag when no instructions');
});
```

### 9.3 系统指令构建

```typescript
describe('buildSystemFlag', () => {
  it('returns undefined when both undefined');
  it('returns systemInstruction only');
  it('returns instructionFileText only');
  it('joins both with double newline');
  it('trims whitespace from inputs');
  it('ignores whitespace-only inputs');
});
```

### 9.4 字节预算

```typescript
describe('byte budget', () => {
  it('returns unchanged when within budget');
  it('trims oldest context messages first');
  it('preserves MESSAGE section');
  it('preserves TEAM_TASK section');
  it('does not trim systemFlag');
});
```

### 9.5 格式验证

```typescript
describe('format validation', () => {
  it('uses correct section markers');
  it('uses correct context message format');
  it('separates sections with double newline');
  it('preserves newlines within content');
});
```

---

## 10. 与其他 Assembler 的差异

| 特性 | Claude | Codex | Gemini |
|------|--------|-------|--------|
| System Instruction 位置 | `systemFlag` 分离 | 内嵌 `[SYSTEM]` | 内嵌 `Instructions:` |
| 部分标记格式 | `[SECTION]` | `[SECTION]` | 无方括号 |
| Context 格式 | `- from -> to: content` | `- from -> to: content` | `- from: content` |
| 空部分 | 省略 | 省略 | 省略 |

---

## 附录 A：完整代码框架

```typescript
// src/context/assemblers/ClaudeContextAssembler.ts

import { IContextAssembler, AssemblerInput, AssemblerOutput } from '../IContextAssembler.js';
import { AgentType } from '../../models/AgentConfig.js';
import { trimContextToFit } from '../utils/contextTrimmer.js';

export class ClaudeContextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'claude-code';
  }

  assemble(input: AssemblerInput): AssemblerOutput {
    const {
      contextMessages,
      currentMessage,
      teamTask,
      systemInstruction,
      instructionFileText,
      maxBytes
    } = input;

    // Build systemFlag (for --append-system-prompt)
    const systemFlag = this.buildSystemFlag(systemInstruction, instructionFileText);

    // Build sections
    const sections: string[] = [];

    if (teamTask?.trim()) {
      sections.push(`[TEAM_TASK]\n${teamTask.trim()}`);
    }

    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `- ${msg.from} -> ${msg.to}: ${msg.content}`
      );
      sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
    }

    if (currentMessage?.trim()) {
      sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
    }

    let prompt = sections.join('\n\n');

    // Apply byte budget
    return this.applyByteBudget(prompt, systemFlag, maxBytes, contextMessages);
  }

  private buildSystemFlag(
    systemInstruction?: string,
    instructionFileText?: string
  ): string | undefined {
    const parts: string[] = [];

    if (systemInstruction?.trim()) {
      parts.push(systemInstruction.trim());
    }

    if (instructionFileText?.trim()) {
      parts.push(instructionFileText.trim());
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  private applyByteBudget(
    prompt: string,
    systemFlag: string | undefined,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): AssemblerOutput {
    const promptBytes = Buffer.byteLength(prompt, 'utf8');
    const systemBytes = systemFlag ? Buffer.byteLength(systemFlag, 'utf8') : 0;

    if (promptBytes + systemBytes <= maxBytes) {
      return { prompt, systemFlag };
    }

    const trimmedPrompt = trimContextToFit(
      prompt,
      maxBytes - systemBytes,
      contextMessages
    );

    return { prompt: trimmedPrompt, systemFlag };
  }
}
```
