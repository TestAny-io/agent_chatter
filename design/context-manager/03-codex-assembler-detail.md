# CodexContextAssembler 详细设计

## 1. 模块概述

### 1.1 职责

`CodexContextAssembler` 负责将通用上下文数据组装成 OpenAI Codex CLI 专用的 Prompt 格式。

**核心特点**：
- System Instruction **内嵌**在 Prompt 中，使用 `[SYSTEM]` 标记
- 所有部分都在单一 Prompt 中，通过方括号标记分隔
- 输出只有 `prompt`，**没有** `systemFlag`（Codex CLI 不支持分离的系统指令参数）

### 1.2 文件位置

```
src/context/assemblers/CodexContextAssembler.ts
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
  prompt: string;       // 完整 Prompt（通过 stdin 发送）
  systemFlag?: string;  // undefined - Codex 不使用此字段
}
```

### 2.3 Codex 输出结构

```
┌──────────────────────────────────────────────────────────┐
│  AssemblerOutput                                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  prompt (完整内容，通过 stdin 发送):                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  [SYSTEM]                                          │  │
│  │  {systemInstruction}                               │  │
│  │  {instructionFileText}                             │  │
│  │                                                    │  │
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
│  systemFlag: undefined (Codex 不使用)                    │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**Section 顺序**：`[SYSTEM] → [TEAM_TASK] → [CONTEXT] → [MESSAGE]`

---

## 3. 类定义

### 3.1 类签名

```typescript
export class CodexContextAssembler implements IContextAssembler {
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
return 'openai-codex';
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
│  1. 构建 [SYSTEM] 部分                                      │
│     ↓                                                        │
│  2. 构建 [TEAM_TASK] 部分                                   │
│     ↓                                                        │
│  3. 构建 [CONTEXT] 部分                                     │
│     ↓                                                        │
│  4. 构建 [MESSAGE] 部分                                     │
│     ↓                                                        │
│  5. 按顺序组合（跳过空部分）                                │
│     ↓                                                        │
│  6. 检查字节预算并裁剪                                      │
│     ↓                                                        │
│  7. 返回 { prompt, systemFlag: undefined }                  │
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

  const sections: string[] = [];

  // Step 1: [SYSTEM] - 仅当有内容时添加
  const systemBody = this.buildSystemBody(systemInstruction, instructionFileText);
  if (systemBody) {
    sections.push(`[SYSTEM]\n${systemBody}`);
  }

  // Step 2: [TEAM_TASK] - 仅当有内容时添加
  if (teamTask?.trim()) {
    sections.push(`[TEAM_TASK]\n${teamTask.trim()}`);
  }

  // Step 3: [CONTEXT] - 仅当有消息时添加
  if (contextMessages.length > 0) {
    const contextLines = contextMessages.map(msg =>
      `- ${msg.from} -> ${msg.to}: ${msg.content}`
    );
    sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
  }

  // Step 4: [MESSAGE] - 仅当有内容时添加
  if (currentMessage?.trim()) {
    sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
  }

  // Step 5: 组合
  let prompt = sections.join('\n\n');

  // Step 6: 检查字节预算
  prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

  // Step 7: 返回（Codex 不使用 systemFlag）
  return { prompt, systemFlag: undefined };
}
```

---

## 5. 辅助方法

### 5.1 buildSystemBody()

**职责**：构建 `[SYSTEM]` 部分的内容（不含标记）

```typescript
private buildSystemBody(
  systemInstruction?: string,
  instructionFileText?: string
): string | null {
  const parts: string[] = [];

  if (systemInstruction?.trim()) {
    parts.push(systemInstruction.trim());
  }

  if (instructionFileText?.trim()) {
    parts.push(instructionFileText.trim());
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join('\n\n');
}
```

**处理规则**：
| systemInstruction | instructionFileText | 结果 |
|-------------------|---------------------|------|
| undefined | undefined | `null` |
| "You are Sarah" | undefined | `"You are Sarah"` |
| undefined | "Be concise" | `"Be concise"` |
| "You are Sarah" | "Be concise" | `"You are Sarah\n\nBe concise"` |
| "  " (空白) | "text" | `"text"` |

### 5.2 applyByteBudget()

**职责**：确保 Prompt 不超过字节预算

```typescript
private applyByteBudget(
  prompt: string,
  maxBytes: number,
  contextMessages: PromptContextMessage[]
): string {
  const currentBytes = Buffer.byteLength(prompt, 'utf8');

  if (currentBytes <= maxBytes) {
    return prompt;
  }

  // 调用共享的裁剪工具
  return trimContextToFit(prompt, maxBytes, contextMessages);
}
```

**裁剪策略**（与 Claude Assembler 相同）：
1. 优先保留 `[SYSTEM]`、`[MESSAGE]`、`[TEAM_TASK]`
2. 从 `[CONTEXT]` 的最旧消息开始移除
3. 如果仍超限，截断 `[MESSAGE]`

---

## 6. 输出示例

### 6.1 完整输出示例

**输入**：
```typescript
{
  contextMessages: [
    { from: 'kailai', to: 'sarah', content: 'Can you review this code?' },
    { from: 'sarah', to: 'max', content: 'I found a security issue' }
  ],
  currentMessage: 'What security issues did you find?',
  teamTask: 'Review the authentication module',
  systemInstruction: 'You are Sarah, a security expert',
  instructionFileText: 'Always prioritize security over features',
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `[SYSTEM]
You are Sarah, a security expert

Always prioritize security over features

[TEAM_TASK]
Review the authentication module

[CONTEXT]
- kailai -> sarah: Can you review this code?
- sarah -> max: I found a security issue

[MESSAGE]
What security issues did you find?`,

  systemFlag: undefined
}
```

### 6.2 无系统指令示例

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

**注意**：`[SYSTEM]` 和 `[CONTEXT]` 部分完全省略。

### 6.3 只有消息的示例

**输入**：
```typescript
{
  contextMessages: [],
  currentMessage: 'Hello Codex',
  teamTask: null,
  systemInstruction: undefined,
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `[MESSAGE]
Hello Codex`,

  systemFlag: undefined
}
```

---

## 7. 与 Codex CLI 的集成

### 7.1 CLI 调用方式

```bash
# AgentManager 生成的命令
codex exec --output-format jsonl < prompt.txt
```

### 7.2 AgentManager 使用示例

```typescript
// AgentManager.ts
const { prompt } = assembler.assemble(input);

// Codex 不需要 systemFlag，所有内容都在 prompt 中
const args = ['exec', '--output-format', 'jsonl'];

const process = spawn('codex', args);
process.stdin.write(prompt);
process.stdin.end();
```

### 7.3 与 Claude 的区别

| 方面 | Claude | Codex |
|------|--------|-------|
| System Instruction | 通过 `--append-system-prompt` | 内嵌在 `[SYSTEM]` |
| CLI 参数 | 需要 systemFlag | 不需要 |
| Prompt 结构 | 无 [SYSTEM] | 有 [SYSTEM] |

---

## 8. 边界条件处理

### 8.1 空输入处理

| 输入状态 | 处理方式 |
|---------|---------|
| `systemInstruction = undefined` | 不输出 `[SYSTEM]` 部分 |
| `instructionFileText = undefined` | 不影响 `[SYSTEM]`（如果 systemInstruction 存在） |
| 两者都为空 | 不输出 `[SYSTEM]` 部分 |
| `contextMessages = []` | 不输出 `[CONTEXT]` 部分 |
| `currentMessage = ''` | 不输出 `[MESSAGE]` 部分 |
| `teamTask = null` | 不输出 `[TEAM_TASK]` 部分 |
| 全部为空 | 返回 `{ prompt: '', systemFlag: undefined }` |

### 8.2 特殊字符处理

与 Claude Assembler 相同：
- 内容不做转义
- 保留换行符、方括号、Unicode 字符

### 8.3 字节预算超限

裁剪优先级（从低到高）：
1. `[CONTEXT]` 最旧消息
2. `[MESSAGE]` 内容
3. `[SYSTEM]` 和 `[TEAM_TASK]` 不裁剪

---

## 9. 单元测试用例

### 9.1 基本功能

```typescript
describe('CodexContextAssembler', () => {
  it('getAgentType returns openai-codex');

  describe('assemble', () => {
    it('produces correct format with all sections');
    it('returns undefined systemFlag');
    it('follows correct section order: SYSTEM -> TEAM_TASK -> CONTEXT -> MESSAGE');
  });
});
```

### 9.2 [SYSTEM] 部分构建

```typescript
describe('[SYSTEM] section', () => {
  it('includes systemInstruction');
  it('includes instructionFileText');
  it('joins both with double newline');
  it('omits when both undefined');
  it('omits when both whitespace');
  it('trims whitespace from inputs');
});
```

### 9.3 空部分处理

```typescript
describe('empty section handling', () => {
  it('omits [SYSTEM] when no instructions');
  it('omits [TEAM_TASK] when teamTask is null');
  it('omits [CONTEXT] when contextMessages is empty');
  it('omits [MESSAGE] when currentMessage is empty');
  it('returns empty prompt when all sections empty');
});
```

### 9.4 字节预算

```typescript
describe('byte budget', () => {
  it('returns unchanged when within budget');
  it('trims oldest context messages first');
  it('preserves SYSTEM section');
  it('preserves TEAM_TASK section');
  it('truncates MESSAGE as last resort');
});
```

### 9.5 格式验证

```typescript
describe('format validation', () => {
  it('uses correct section markers with brackets');
  it('uses correct context message format with arrows');
  it('separates sections with double newline');
  it('includes newline after each section marker');
});
```

---

## 10. 与 Claude Assembler 的对比

### 10.1 相同点

| 特性 | Claude | Codex |
|------|--------|-------|
| Section 标记格式 | `[SECTION]` | `[SECTION]` |
| Context 消息格式 | `- from -> to: content` | `- from -> to: content` |
| 空部分处理 | 省略 | 省略 |
| 字节预算裁剪 | Context 优先 | Context 优先 |

### 10.2 不同点

| 特性 | Claude | Codex |
|------|--------|-------|
| System Instruction | `systemFlag` 分离 | 内嵌 `[SYSTEM]` |
| 输出字段 | `{ prompt, systemFlag }` | `{ prompt }` |
| Section 顺序 | TEAM_TASK → CONTEXT → MESSAGE | SYSTEM → TEAM_TASK → CONTEXT → MESSAGE |

---

## 附录 A：完整代码框架

```typescript
// src/context/assemblers/CodexContextAssembler.ts

import { IContextAssembler, AssemblerInput, AssemblerOutput } from '../IContextAssembler.js';
import { AgentType } from '../../models/AgentConfig.js';
import { PromptContextMessage } from '../../utils/PromptBuilder.js';
import { trimContextToFit } from '../utils/contextTrimmer.js';

export class CodexContextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'openai-codex';
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

    const sections: string[] = [];

    // [SYSTEM] - inline system instruction
    const systemBody = this.buildSystemBody(systemInstruction, instructionFileText);
    if (systemBody) {
      sections.push(`[SYSTEM]\n${systemBody}`);
    }

    // [TEAM_TASK]
    if (teamTask?.trim()) {
      sections.push(`[TEAM_TASK]\n${teamTask.trim()}`);
    }

    // [CONTEXT]
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `- ${msg.from} -> ${msg.to}: ${msg.content}`
      );
      sections.push(`[CONTEXT]\n${contextLines.join('\n')}`);
    }

    // [MESSAGE]
    if (currentMessage?.trim()) {
      sections.push(`[MESSAGE]\n${currentMessage.trim()}`);
    }

    let prompt = sections.join('\n\n');

    // Apply byte budget
    prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

    return { prompt, systemFlag: undefined };
  }

  private buildSystemBody(
    systemInstruction?: string,
    instructionFileText?: string
  ): string | null {
    const parts: string[] = [];

    if (systemInstruction?.trim()) {
      parts.push(systemInstruction.trim());
    }

    if (instructionFileText?.trim()) {
      parts.push(instructionFileText.trim());
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  private applyByteBudget(
    prompt: string,
    maxBytes: number,
    contextMessages: PromptContextMessage[]
  ): string {
    const currentBytes = Buffer.byteLength(prompt, 'utf8');

    if (currentBytes <= maxBytes) {
      return prompt;
    }

    return trimContextToFit(prompt, maxBytes, contextMessages);
  }
}
```
