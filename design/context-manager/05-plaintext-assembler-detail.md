# PlainTextAssembler 详细设计

## 1. 模块概述

### 1.1 职责

`PlainTextAssembler` 是一个**备选 Assembler**，用于处理未知或不受支持的 Agent 类型。

**核心特点**：
- 作为 ContextManager 的**默认后备方案**
- 不使用任何特殊标记或格式
- 简单的文本拼接，最大兼容性
- 当遇到未知 agentType 时自动启用

### 1.2 文件位置

```
src/context/assemblers/PlainTextAssembler.ts
```

### 1.3 接口实现

```typescript
implements IContextAssembler
```

### 1.4 使用场景

| 场景 | 说明 |
|------|------|
| 未知 agentType | 配置了非标准 Agent 类型 |
| 新增 Agent 类型 | 在添加专用 Assembler 前的临时方案 |
| 调试/测试 | 验证上下文内容而非格式 |
| 纯文本 Agent | 某些 Agent 可能不需要结构化 Prompt |

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
  prompt: string;       // 纯文本 Prompt
  systemFlag?: string;  // undefined - PlainText 不使用
}
```

### 2.3 PlainText 输出结构

```
┌──────────────────────────────────────────────────────────┐
│  AssemblerOutput                                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  prompt (纯文本，无特殊格式):                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  {systemInstruction}                               │  │
│  │  {instructionFileText}                             │  │
│  │                                                    │  │
│  │  {teamTask}                                        │  │
│  │                                                    │  │
│  │  {from}: {content}                                 │  │
│  │  {from}: {content}                                 │  │
│  │  ...                                               │  │
│  │                                                    │  │
│  │  {currentMessage}                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  systemFlag: undefined                                   │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

**格式特点**：
- 无标题（如 `Instructions:`）
- 无标记（如 `[SYSTEM]`）
- 最简单的文本拼接
- 双换行分隔各部分

---

## 3. 类定义

### 3.1 类签名

```typescript
export class PlainTextAssembler implements IContextAssembler {
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
return 'unknown' as AgentType;  // 特殊标识，表示通用/后备
```

**注意**：此方法主要用于识别 Assembler 类型，PlainTextAssembler 不对应特定 agentType。

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
│  1. 构建系统指令部分（无标题）                              │
│     ↓                                                        │
│  2. 添加团队任务（无标题）                                  │
│     ↓                                                        │
│  3. 构建对话历史（简单列表）                                │
│     ↓                                                        │
│  4. 添加当前消息（无标题）                                  │
│     ↓                                                        │
│  5. 拼接所有非空部分                                        │
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

  const parts: string[] = [];

  // Step 1: 系统指令（无标题）
  const systemBody = this.buildSystemBody(systemInstruction, instructionFileText);
  if (systemBody) {
    parts.push(systemBody);
  }

  // Step 2: 团队任务（无标题）
  if (teamTask?.trim()) {
    parts.push(teamTask.trim());
  }

  // Step 3: 对话历史（简单格式）
  if (contextMessages.length > 0) {
    const contextLines = contextMessages.map(msg =>
      `${msg.from}: ${msg.content}`
    );
    parts.push(contextLines.join('\n'));
  }

  // Step 4: 当前消息（无标题）
  if (currentMessage?.trim()) {
    parts.push(currentMessage.trim());
  }

  // Step 5: 拼接
  let prompt = parts.join('\n\n');

  // Step 6: 字节预算
  prompt = this.applyByteBudget(prompt, maxBytes, contextMessages);

  return { prompt, systemFlag: undefined };
}
```

---

## 5. 辅助方法

### 5.1 buildSystemBody()

**职责**：构建系统指令内容

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

  return trimContextToFitPlainText(prompt, maxBytes, contextMessages);
}
```

---

## 6. 输出示例

### 6.1 完整输出示例

**输入**：
```typescript
{
  contextMessages: [
    { from: 'kailai', to: 'agent', content: 'Hello, how are you?' },
    { from: 'max', to: 'agent', content: 'I am doing well, thanks!' }
  ],
  currentMessage: 'What can you help me with?',
  teamTask: 'Assist with general questions',
  systemInstruction: 'You are a helpful assistant',
  instructionFileText: 'Be concise and friendly',
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `You are a helpful assistant

Be concise and friendly

Assist with general questions

kailai: Hello, how are you?
max: I am doing well, thanks!

What can you help me with?`,

  systemFlag: undefined
}
```

### 6.2 最小输出示例

**输入**：
```typescript
{
  contextMessages: [],
  currentMessage: 'Hello',
  teamTask: null,
  systemInstruction: undefined,
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `Hello`,
  systemFlag: undefined
}
```

### 6.3 只有系统指令和消息

**输入**：
```typescript
{
  contextMessages: [],
  currentMessage: 'What is 2+2?',
  teamTask: null,
  systemInstruction: 'You are a math tutor',
  maxBytes: 768 * 1024
}
```

**输出**：
```typescript
{
  prompt: `You are a math tutor

What is 2+2?`,

  systemFlag: undefined
}
```

---

## 7. Context 消息格式

### 7.1 格式规范

**PlainText 格式**：
```
{from}: {content}
```

**对比所有 Assembler**：
| Assembler | 格式 |
|-----------|------|
| Claude | `- {from} -> {to}: {content}` |
| Codex | `- {from} -> {to}: {content}` |
| Gemini | `- {from}: {content}` |
| **PlainText** | `{from}: {content}` |

### 7.2 格式选择理由

- **最简单**：无前缀 `-`，无箭头 `->`
- **最兼容**：适用于任何可能的 Agent
- **最直观**：类似聊天记录格式

---

## 8. 与 ContextManager 的集成

### 8.1 触发条件

```typescript
// ContextManager.ts
assemblePrompt(agentType: AgentType, input: AssemblerInput): AssemblerOutput {
  const assembler = this.assemblers.get(agentType);

  if (!assembler) {
    // 未知 agentType，使用 PlainTextAssembler
    console.warn(`[ContextManager] Unknown agentType "${agentType}", using PlainTextAssembler`);
    return new PlainTextAssembler().assemble(input);
  }

  return assembler.assemble(input);
}
```

### 8.2 日志输出

当 PlainTextAssembler 被调用时，ContextManager 输出警告日志：
```
[ContextManager] Unknown agentType "custom-agent", using PlainTextAssembler
```

---

## 9. 边界条件处理

### 9.1 空输入处理

| 输入状态 | 处理方式 |
|---------|---------|
| `systemInstruction = undefined` | 跳过系统指令部分 |
| `instructionFileText = undefined` | 跳过（如果 systemInstruction 也为空） |
| `contextMessages = []` | 跳过对话历史部分 |
| `currentMessage = ''` | 跳过当前消息部分 |
| `teamTask = null` | 跳过团队任务部分 |
| 全部为空 | 返回 `{ prompt: '', systemFlag: undefined }` |

### 9.2 特殊字符处理

- 内容完全原样保留
- 不做任何转义或编码
- 保留所有换行符、空格、特殊字符

### 9.3 字节预算超限

裁剪策略（与其他 Assembler 一致）：
1. 优先移除最旧的对话消息
2. 必要时截断当前消息
3. 系统指令和团队任务不裁剪

---

## 10. 单元测试用例

### 10.1 基本功能

```typescript
describe('PlainTextAssembler', () => {
  it('getAgentType returns unknown');

  describe('assemble', () => {
    it('produces plain text output without markers');
    it('returns undefined systemFlag');
    it('joins parts with double newlines');
  });
});
```

### 10.2 内容格式

```typescript
describe('content format', () => {
  it('outputs systemInstruction without title');
  it('outputs teamTask without title');
  it('outputs contextMessages as "from: content"');
  it('outputs currentMessage without title');
  it('omits to field from context');
});
```

### 10.3 空部分处理

```typescript
describe('empty section handling', () => {
  it('omits system body when both instructions undefined');
  it('omits team task when null');
  it('omits context when empty array');
  it('omits current message when empty string');
  it('returns empty prompt when all parts empty');
});
```

### 10.4 字节预算

```typescript
describe('byte budget', () => {
  it('returns unchanged when within budget');
  it('trims oldest context messages first');
  it('preserves system body');
  it('preserves team task');
});
```

### 10.5 ContextManager 集成

```typescript
describe('ContextManager fallback', () => {
  it('uses PlainTextAssembler for unknown agentType');
  it('logs warning for unknown agentType');
  it('produces valid output for unknown agentType');
});
```

---

## 11. 与其他 Assembler 的对比总结

### 11.1 格式对比

| 特性 | Claude | Codex | Gemini | PlainText |
|------|--------|-------|--------|-----------|
| 标记风格 | `[SECTION]` | `[SECTION]` | `Title:` | 无 |
| System 分离 | 是 (systemFlag) | 否 | 否 | 否 |
| Context 格式 | `- from -> to:` | `- from -> to:` | `- from:` | `from:` |
| 复杂度 | 高 | 高 | 中 | 低 |

### 11.2 使用场景对比

| Assembler | 主要场景 |
|-----------|---------|
| Claude | Claude Code CLI |
| Codex | OpenAI Codex CLI |
| Gemini | Google Gemini CLI |
| **PlainText** | 后备/未知 Agent |

---

## 附录 A：完整代码框架

```typescript
// src/context/assemblers/PlainTextAssembler.ts

import { IContextAssembler, AssemblerInput, AssemblerOutput } from '../IContextAssembler.js';
import { AgentType } from '../../models/AgentConfig.js';
import { PromptContextMessage } from '../../utils/PromptBuilder.js';
import { trimContextToFitPlainText } from '../utils/contextTrimmer.js';

export class PlainTextAssembler implements IContextAssembler {
  getAgentType(): AgentType {
    return 'unknown' as AgentType;
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

    const parts: string[] = [];

    // System body (no title)
    const systemBody = this.buildSystemBody(systemInstruction, instructionFileText);
    if (systemBody) {
      parts.push(systemBody);
    }

    // Team task (no title)
    if (teamTask?.trim()) {
      parts.push(teamTask.trim());
    }

    // Context messages (simple format)
    if (contextMessages.length > 0) {
      const contextLines = contextMessages.map(msg =>
        `${msg.from}: ${msg.content}`
      );
      parts.push(contextLines.join('\n'));
    }

    // Current message (no title)
    if (currentMessage?.trim()) {
      parts.push(currentMessage.trim());
    }

    let prompt = parts.join('\n\n');

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

    return trimContextToFitPlainText(prompt, maxBytes, contextMessages);
  }
}
```

---

## 附录 B：裁剪工具函数设计

由于各 Assembler 的格式不同，裁剪工具可能需要专门处理：

```typescript
// src/context/utils/contextTrimmer.ts

/**
 * PlainText 格式的裁剪
 * 格式: "from: content\nfrom: content\n..."
 */
export function trimContextToFitPlainText(
  prompt: string,
  maxBytes: number,
  contextMessages: PromptContextMessage[]
): string {
  // 实现逻辑：
  // 1. 定位 context 部分（通过识别 "from: content" 格式的连续行）
  // 2. 从最旧消息开始移除
  // 3. 重建 prompt
  // ...
}
```

**注意**：具体裁剪实现将在共享工具模块中详细设计。
