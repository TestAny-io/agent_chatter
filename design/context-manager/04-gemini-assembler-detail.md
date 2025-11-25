# GeminiContextAssembler 详细设计

## 1. 模块概述

### 1.1 职责

`GeminiContextAssembler` 负责将通用上下文数据组装成 Google Gemini CLI 专用的 Prompt 格式。

**核心特点**：
- **不使用方括号标记**，采用更自然的文本分隔方式
- System Instruction 以 `Instructions:` 开头
- 对话历史以 `Conversation so far:` 开头
- 当前消息以 `Your task:` 或直接嵌入
- 输出只有 `prompt`，**没有** `systemFlag`

### 1.2 文件位置

```
src/context/assemblers/GeminiContextAssembler.ts
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
  systemFlag?: string;  // undefined - Gemini 不使用此字段
}
```

### 2.3 Gemini 输出结构

```
┌──────────────────────────────────────────────────────────┐
│  AssemblerOutput                                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  prompt (完整内容，通过 stdin 发送):                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Instructions:                                     │  │
│  │  {systemInstruction}                               │  │
│  │  {instructionFileText}                             │  │
│  │                                                    │  │
│  │  Team Task:                                        │  │
│  │  {teamTask}                                        │  │
│  │                                                    │  │
│  │  Conversation so far:                              │  │
│  │  - {from}: {content}                               │  │
│  │  - {from}: {content}                               │  │
│  │  ...                                               │  │
│  │                                                    │  │
│  │  Your task:                                        │  │
│  │  {currentMessage}                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  systemFlag: undefined (Gemini 不使用)                   │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**关键差异**：
- 无方括号 `[]`，使用冒号结尾的标题
- Context 消息格式为 `- from: content`（无箭头，无 to）

---

## 3. 类定义

### 3.1 类签名

```typescript
export class GeminiContextAssembler implements IContextAssembler {
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
return 'google-gemini';
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
│  1. 构建 "Instructions:" 部分                               │
│     ↓                                                        │
│  2. 构建 "Team Task:" 部分                                  │
│     ↓                                                        │
│  3. 构建 "Conversation so far:" 部分                        │
│     ↓                                                        │
│  4. 构建 "Your task:" 部分                                  │
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

  // Step 1: Instructions: - 仅当有内容时添加
  const instructionsBody = this.buildInstructionsBody(systemInstruction, instructionFileText);
  if (instructionsBody) {
    sections.push(`Instructions:\n${instructionsBody}`);
  }

  // Step 2: Team Task: - 仅当有内容时添加
  if (teamTask?.trim()) {
    sections.push(`Team Task:\n${teamTask.trim()}`);
  }

  // Step 3: Conversation so far: - 仅当有消息时添加
  if (contextMessages.length > 0) {
    const contextLines = contextMessages.map(msg =>
      `- ${msg.from}: ${msg.content}`
    );
    sections.push(`Conversation so far:\n${contextLines.join('\n')}`);
  }

  // Step 4: Your task: - 仅当有内容时添加
  if (currentMessage?.trim()) {
    sections.push(`Your task:\n${currentMessage.trim()}`);
  }

  // Step 5: 组合
  let prompt = sections.join('\n\n');

  // Step 6: 检查字节预算
  prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

  // Step 7: 返回（Gemini 不使用 systemFlag）
  return { prompt, systemFlag: undefined };
}
```

---

## 5. 辅助方法

### 5.1 buildInstructionsBody()

**职责**：构建 `Instructions:` 部分的内容（不含标题）

```typescript
private buildInstructionsBody(
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
  return trimContextToFitGemini(prompt, maxBytes, contextMessages);
}
```

**Gemini 专用裁剪**：
由于 Gemini 的格式与 Claude/Codex 不同，可能需要专门的裁剪函数来处理 `Conversation so far:` 部分。

---

## 6. Context 消息格式

### 6.1 格式规范

**Gemini 格式**：
```
- {from}: {content}
```

**对比其他 Assembler**：
| Assembler | 格式 |
|-----------|------|
| Claude | `- {from} -> {to}: {content}` |
| Codex | `- {from} -> {to}: {content}` |
| **Gemini** | `- {from}: {content}` |

### 6.2 为什么省略 `to` 字段

Gemini 的 Prompt 设计更强调对话流而非路由关系：
- 简化消息格式，减少 token 消耗
- Gemini 不需要知道消息的目标接收者
- 保持与 Gemini 原生对话格式的一致性

---

## 7. 输出示例

### 7.1 完整输出示例

**输入**：
```typescript
{
  contextMessages: [
    { from: 'kailai', to: 'carol', content: 'Can you design the UI?' },
    { from: 'max', to: 'carol', content: 'I suggest a clean interface' }
  ],
  currentMessage: 'What UI framework should we use?',
  teamTask: 'Design the user dashboard',
  systemInstruction: 'You are Carol, a UI/UX designer',
  instructionFileText: 'Focus on accessibility and user experience',
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `Instructions:
You are Carol, a UI/UX designer

Focus on accessibility and user experience

Team Task:
Design the user dashboard

Conversation so far:
- kailai: Can you design the UI?
- max: I suggest a clean interface

Your task:
What UI framework should we use?`,

  systemFlag: undefined
}
```

### 7.2 无 Instructions 示例

**输入**：
```typescript
{
  contextMessages: [
    { from: 'kailai', to: 'carol', content: 'Hello' }
  ],
  currentMessage: 'What do you suggest?',
  teamTask: null,
  systemInstruction: undefined,
  instructionFileText: undefined,
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `Conversation so far:
- kailai: Hello

Your task:
What do you suggest?`,

  systemFlag: undefined
}
```

### 7.3 只有消息的示例

**输入**：
```typescript
{
  contextMessages: [],
  currentMessage: 'Hello Gemini',
  teamTask: null,
  systemInstruction: undefined,
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `Your task:
Hello Gemini`,

  systemFlag: undefined
}
```

---

## 8. 与 Gemini CLI 的集成

### 8.1 CLI 调用方式

```bash
# AgentManager 生成的命令
gemini --output-format jsonl < prompt.txt
```

### 8.2 AgentManager 使用示例

```typescript
// AgentManager.ts
const { prompt } = assembler.assemble(input);

const args = ['--output-format', 'jsonl'];

const process = spawn('gemini', args);
process.stdin.write(prompt);
process.stdin.end();
```

### 8.3 Gemini JSONL 输出解析

**重要**：Gemini 的 JSONL 输出包含 `role` 字段，必须过滤 `role=user` 的消息。

这在 `JsonlMessageFormatter.ts` 中处理（Bug 4 修复）：
```typescript
// 只处理 assistant 消息
if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
  parts.push(stripAnsi(obj.content));
}
```

---

## 9. 边界条件处理

### 9.1 空输入处理

| 输入状态 | 处理方式 |
|---------|---------|
| `systemInstruction = undefined` | 不输出 `Instructions:` 部分 |
| `instructionFileText = undefined` | 不影响（如果 systemInstruction 存在） |
| 两者都为空 | 不输出 `Instructions:` 部分 |
| `contextMessages = []` | 不输出 `Conversation so far:` 部分 |
| `currentMessage = ''` | 不输出 `Your task:` 部分 |
| `teamTask = null` | 不输出 `Team Task:` 部分 |
| 全部为空 | 返回 `{ prompt: '', systemFlag: undefined }` |

### 9.2 特殊字符处理

- 内容不做转义
- 保留换行符、冒号、Unicode 字符
- `to` 字段被忽略，不出现在输出中

### 9.3 字节预算超限

裁剪优先级（从低到高）：
1. `Conversation so far:` 最旧消息
2. `Your task:` 内容
3. `Instructions:` 和 `Team Task:` 不裁剪

---

## 10. 单元测试用例

### 10.1 基本功能

```typescript
describe('GeminiContextAssembler', () => {
  it('getAgentType returns google-gemini');

  describe('assemble', () => {
    it('produces correct format with all sections');
    it('returns undefined systemFlag');
    it('follows correct section order');
    it('uses natural language headers (no brackets)');
  });
});
```

### 10.2 Instructions 部分构建

```typescript
describe('Instructions section', () => {
  it('includes systemInstruction');
  it('includes instructionFileText');
  it('joins both with double newline');
  it('omits when both undefined');
  it('omits when both whitespace');
  it('uses "Instructions:" header');
});
```

### 10.3 Context 消息格式

```typescript
describe('Conversation so far section', () => {
  it('formats messages as "- from: content"');
  it('ignores "to" field');
  it('uses "Conversation so far:" header');
  it('separates messages with newlines');
});
```

### 10.4 空部分处理

```typescript
describe('empty section handling', () => {
  it('omits Instructions when no instructions');
  it('omits Team Task when teamTask is null');
  it('omits Conversation so far when contextMessages is empty');
  it('omits Your task when currentMessage is empty');
  it('returns empty prompt when all sections empty');
});
```

### 10.5 字节预算

```typescript
describe('byte budget', () => {
  it('returns unchanged when within budget');
  it('trims oldest context messages first');
  it('preserves Instructions section');
  it('preserves Team Task section');
  it('truncates Your task as last resort');
});
```

---

## 11. 与其他 Assembler 的对比

### 11.1 标题格式对比

| 部分 | Claude | Codex | Gemini |
|------|--------|-------|--------|
| System | (systemFlag) | `[SYSTEM]` | `Instructions:` |
| Team Task | `[TEAM_TASK]` | `[TEAM_TASK]` | `Team Task:` |
| Context | `[CONTEXT]` | `[CONTEXT]` | `Conversation so far:` |
| Message | `[MESSAGE]` | `[MESSAGE]` | `Your task:` |

### 11.2 消息格式对比

| Assembler | Context 消息格式 |
|-----------|-----------------|
| Claude | `- from -> to: content` |
| Codex | `- from -> to: content` |
| **Gemini** | `- from: content` |

### 11.3 设计理念差异

- **Claude/Codex**：结构化标记，便于机器解析
- **Gemini**：自然语言风格，更接近人类对话

---

## 附录 A：完整代码框架

```typescript
// src/context/assemblers/GeminiContextAssembler.ts

import { IContextAssembler, AssemblerInput, AssemblerOutput } from '../IContextAssembler.js';
import { AgentType } from '../../models/AgentConfig.js';
import { PromptContextMessage } from '../../utils/PromptBuilder.js';
import { trimContextToFitGemini } from '../utils/contextTrimmer.js';

export class GeminiContextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'google-gemini';
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

    // Instructions:
    const instructionsBody = this.buildInstructionsBody(systemInstruction, instructionFileText);
    if (instructionsBody) {
      sections.push(`Instructions:\n${instructionsBody}`);
    }

    // Team Task:
    if (teamTask?.trim()) {
      sections.push(`Team Task:\n${teamTask.trim()}`);
    }

    // Conversation so far:
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `- ${msg.from}: ${msg.content}`
      );
      sections.push(`Conversation so far:\n${contextLines.join('\n')}`);
    }

    // Your task:
    if (currentMessage?.trim()) {
      sections.push(`Your task:\n${currentMessage.trim()}`);
    }

    let prompt = sections.join('\n\n');

    // Apply byte budget
    prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

    return { prompt, systemFlag: undefined };
  }

  private buildInstructionsBody(
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

    return trimContextToFitGemini(prompt, maxBytes, contextMessages);
  }
}
```

---

## 附录 B：Gemini CLI 特性参考

### B.1 支持的输出格式

```bash
gemini --output-format jsonl  # JSONL 流式输出
gemini --output-format text   # 纯文本输出
```

### B.2 JSONL 输出示例

```json
{"type":"message","role":"user","content":"Instructions:\nYou are Carol..."}
{"type":"message","role":"assistant","content":"我理解了任务需求...","delta":true}
{"type":"result","success":true}
```

**关键**：第一行 `role=user` 是我们发送的 prompt，必须过滤掉。
