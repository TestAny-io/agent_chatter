# ContextManager 详细设计

## 1. 模块概述

### 1.1 职责

`ContextManager` 是会话上下文管理的**单一数据源**（Single Source of Truth），负责：

1. **消息存储** - 存储所有会话消息，维护消息顺序
2. **TeamTask 管理** - 存储和检索团队任务描述
3. **上下文准备** - 为指定 Agent 准备已处理的上下文数据
4. **去重逻辑** - AI→AI 消息的去重处理
5. **标记清理** - 清理消息中的 [NEXT] 等路由标记
6. **生命周期管理** - 支持清空和快照导入导出

### 1.2 设计原则

- **高内聚**：所有上下文相关逻辑集中在此模块
- **低耦合**：不依赖 Coordinator 或 AgentManager 的具体实现
- **无外部实例依赖**：标记清理使用内部纯函数，不依赖 MessageRouter 实例

### 1.3 文件位置

```
src/context/ContextManager.ts
```

---

## 2. 类型定义

### 2.1 引用类型

```typescript
import { ConversationMessage } from '../models/ConversationMessage.js';
import { IContextAssembler, AssemblerInput, AssemblerOutput } from './IContextAssembler.js';
import { AgentType, normalizeAgentType } from '../models/AgentConfig.js';
// 注意：不导入 MessageRouter，标记清理使用内部纯函数
```

### 2.2 内部上下文消息类型

```typescript
/**
 * 内部使用的上下文消息类型（扩展自 PromptContextMessage）
 * 包含 messageId 用于去重
 */
interface InternalContextMessage {
  from: string;
  to: string;
  content: string;
  messageId: string;  // 保留原始消息 ID 用于去重
}

/**
 * 输出给 Assembler 的上下文消息类型（不含 messageId）
 */
interface PromptContextMessage {
  from: string;
  to?: string;
  content: string;
}
```

### 2.3 配置选项类型

```typescript
/**
 * ContextManager 配置选项
 */
interface ContextManagerOptions {
  /** 上下文窗口大小（默认 5 条消息） */
  contextWindowSize?: number;

  /** 最大字节数预算（默认 768KB） */
  maxBytes?: number;

  /** 消息添加后的回调钩子 */
  onMessageAdded?: (msg: ConversationMessage) => void;

  /** TeamTask 变更后的回调钩子 */
  onTeamTaskChanged?: (task: string | null) => void;
}
```

### 2.4 快照类型

```typescript
/**
 * ContextManager 状态快照（用于持久化）
 */
interface ContextSnapshot {
  /** 消息列表 */
  messages: ConversationMessage[];

  /** 团队任务 */
  teamTask: string | null;

  /** 快照时间戳 */
  timestamp: number;

  /** 版本号（用于未来格式兼容） */
  version: 1;
}
```

### 2.5 常量定义

```typescript
/** 默认上下文窗口大小 */
const DEFAULT_CONTEXT_WINDOW_SIZE = 5;

/** 默认最大字节数（768KB） */
const DEFAULT_MAX_BYTES = 768 * 1024;

/** TeamTask 最大字节数（5KB） */
const MAX_TEAM_TASK_BYTES = 5 * 1024;
```

---

## 3. 类定义

### 3.1 类签名

```typescript
export class ContextManager implements IContextProvider {
  // 私有属性
  private messages: ConversationMessage[] = [];
  private teamTask: string | null = null;
  private readonly contextWindowSize: number;
  private readonly maxBytes: number;
  private readonly assemblers: Map<AgentType, IContextAssembler>;
  private readonly onMessageAdded?: (msg: ConversationMessage) => void;
  private readonly onTeamTaskChanged?: (task: string | null) => void;
  private nextMessageId: number = 1;

  constructor(options?: ContextManagerOptions);

  // 公开方法 - 见下文详细说明
}
```

### 3.2 构造函数

```typescript
constructor(options?: ContextManagerOptions) {
  this.contextWindowSize = options?.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE;
  this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  this.onMessageAdded = options?.onMessageAdded;
  this.onTeamTaskChanged = options?.onTeamTaskChanged;

  // 初始化 Assembler 映射
  this.assemblers = new Map();
  this.assemblers.set('claude-code', new ClaudeContextAssembler());
  this.assemblers.set('openai-codex', new CodexContextAssembler());
  this.assemblers.set('google-gemini', new GeminiContextAssembler());
  // PlainTextAssembler 作为默认备选，不放在 Map 中
}
```

---

## 4. 公开方法详细设计

### 4.1 addMessage(msg)

**签名**：
```typescript
addMessage(msg: Omit<ConversationMessage, 'id'>): ConversationMessage
```

**职责**：添加新消息到存储

**算法**：
```
1. 验证消息有效性
   - msg.content 必须是字符串
   - msg.speaker 必须存在且有效

2. 生成唯一 ID
   - id = `msg-${nextMessageId++}`

3. 创建完整消息对象
   - fullMsg = { id, ...msg }

4. 追加到 messages 数组
   - messages.push(fullMsg)

5. 调用钩子（如果存在）
   - onMessageAdded?.(fullMsg)

6. 返回完整消息
   - return fullMsg
```

**验证规则**：
| 条件 | 错误类型 | 错误消息 |
|------|---------|---------|
| `!msg` | TypeError | `Message cannot be null or undefined` |
| `typeof msg.content !== 'string'` | TypeError | `Message content must be a string` |
| `!msg.speaker` | TypeError | `Message speaker is required` |
| `!msg.speaker.roleId` | TypeError | `Message speaker.roleId is required` |

**返回值**：带有生成 ID 的完整消息对象

---

### 4.2 getMessages()

**签名**：
```typescript
getMessages(): ConversationMessage[]
```

**职责**：获取所有消息的只读副本

**算法**：
```
1. 返回 messages 数组的浅拷贝
   - return [...this.messages]
```

**注意**：返回浅拷贝以防止外部修改

---

### 4.3 getLatestMessage()

**签名**：
```typescript
getLatestMessage(): ConversationMessage | null
```

**职责**：获取最新一条消息

**算法**：
```
1. 如果 messages 为空，返回 null
2. 返回 messages 数组最后一项
   - return messages[messages.length - 1] ?? null
```

---

### 4.4 setTeamTask(task)

**签名**：
```typescript
setTeamTask(task: string): void
```

**职责**：设置团队任务，强制执行 5KB 限制

**算法**：
```
1. 计算任务字节数
   - bytes = Buffer.byteLength(task, 'utf8')

2. 检查是否超过限制
   if (bytes > MAX_TEAM_TASK_BYTES) {
     - 截断到 5KB
     - 记录警告日志
   }

3. 存储 teamTask
   - this.teamTask = truncatedTask

4. 调用钩子
   - onTeamTaskChanged?.(this.teamTask)
```

**截断算法**：
```typescript
function truncateToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) {
    return str;
  }

  // 二分查找合适的截断点
  let low = 0, high = str.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return str.slice(0, low);
}
```

**日志输出**（超过限制时）：
```
[ContextManager] TeamTask exceeded 5KB limit (${bytes} bytes), truncated to ${truncatedBytes} bytes
```

---

### 4.5 getTeamTask()

**签名**：
```typescript
getTeamTask(): string | null
```

**职责**：获取当前团队任务

**算法**：
```
1. return this.teamTask
```

---

### 4.6 getContextForAgent(agentId, agentType, options?)

**签名**：
```typescript
getContextForAgent(
  agentId: string,
  agentType: AgentType,
  options?: {
    windowSizeOverride?: number;
    systemInstruction?: string;
    instructionFileText?: string;
  }
): AssemblerInput
```

**职责**：为指定 Agent 准备已处理的上下文输入

**核心算法**：
```
1. 获取最新消息
   - latestMsg = getLatestMessage()
   - 如果没有消息，返回空上下文

2. 归一化 agentType
   - normalizedType = normalizeAgentType(agentType)
   - 注意：调用者传入的可能是 'claude'/'codex'/'gemini'，需归一化为 'claude-code'/'openai-codex'/'google-gemini'

3. 确定上下文窗口大小
   - windowSize = options?.windowSizeOverride ?? this.contextWindowSize

4. 提取上下文消息（排除最后一条）
   - allExceptLast = messages.slice(0, -1)
   - contextMessages = allExceptLast.slice(-windowSize)

5. 转换为内部上下文格式并清理标记
   - internalContext: InternalContextMessage[] = contextMessages.map(msg => ({
       from: msg.speaker.roleName,
       to: this.formatAddressees(msg.routing?.resolvedAddressees),  // 见 4.6.1
       content: stripAllMarkers(msg.content),  // 内部纯函数
       messageId: msg.id  // 保留用于去重
     }))

6. 清理当前消息的标记
   - strippedCurrentMsg = stripAllMarkers(latestMsg.content)

7. 执行去重（仅 AI→AI）
   - deduplicatedContext = this.deduplicateContext(internalContext, latestMsg)

8. 转换为输出格式（移除 messageId）
   - outputContext: PromptContextMessage[] = deduplicatedContext.map(msg => ({
       from: msg.from,
       to: msg.to,
       content: msg.content
     }))

9. 构建 AssemblerInput
   - return {
       contextMessages: outputContext,
       currentMessage: strippedCurrentMsg,
       teamTask: this.teamTask,
       systemInstruction: options?.systemInstruction,
       instructionFileText: options?.instructionFileText,
       maxBytes: this.maxBytes
     }
```

**空状态返回值**：
```typescript
{
  contextMessages: [],
  currentMessage: '',
  teamTask: this.teamTask,
  systemInstruction: options?.systemInstruction,
  instructionFileText: options?.instructionFileText,
  maxBytes: this.maxBytes
}
```

---

### 4.6.1 formatAddressees（私有方法）

**签名**：
```typescript
private formatAddressees(addressees?: string[]): string
```

**职责**：格式化收件人列表为字符串

**算法**：
```typescript
private formatAddressees(addressees?: string[]): string {
  if (!addressees || addressees.length === 0) {
    return 'all';  // 广播消息
  }
  if (addressees.length === 1) {
    return addressees[0];  // 单一收件人
  }
  return addressees.join(', ');  // 多收件人：用逗号分隔
}
```

**示例**：
| 输入 | 输出 |
|------|------|
| `undefined` | `'all'` |
| `[]` | `'all'` |
| `['max']` | `'max'` |
| `['max', 'sarah']` | `'max, sarah'` |
| `['max', 'sarah', 'carol']` | `'max, sarah, carol'` |

---

### 4.6.2 stripAllMarkers（内部纯函数）

**签名**：
```typescript
function stripAllMarkers(message: string): string
```

**职责**：清理消息中的所有路由标记（[FROM]、[NEXT]、[TEAM_TASK]）

**实现**：
```typescript
// 在 ContextManager 模块内部定义的纯函数（不依赖外部实例）
const FROM_PATTERN = /\[FROM:[^\]]+\]/gi;
const NEXT_PATTERN = /\[NEXT:[^\]]*\]/gi;
const TEAM_TASK_PATTERN = /\[TEAM_TASK\][\s\S]*?(?=\[|$)/gi;

function stripAllMarkers(message: string): string {
  let result = message;
  result = result.replace(FROM_PATTERN, '');
  result = result.replace(TEAM_TASK_PATTERN, '');
  result = result.replace(NEXT_PATTERN, '');
  return cleanupWhitespace(result);
}

function cleanupWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/\s{2,}/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}
```

**设计决策**：
- **为什么是纯函数而非使用 MessageRouter 实例**：
  - MessageRouter 的 `stripAllMarkersForContext` 是实例方法
  - ContextManager 不应依赖 MessageRouter 实例
  - 标记清理逻辑简单且稳定，复制为纯函数可降低耦合
  - 未来如果 MessageRouter 重构，不影响 ContextManager

---

### 4.7 去重算法（私有方法）

**签名**：
```typescript
private deduplicateContext(
  contextMessages: InternalContextMessage[],  // 使用内部类型，包含 messageId
  currentMessage: ConversationMessage
): InternalContextMessage[]
```

**职责**：AI→AI 传递时去除重复的最后一条上下文消息

**算法**：
```
1. 检查是否需要去重
   if (currentMessage.speaker.type !== 'ai') {
     return contextMessages;  // 人类消息不去重
   }

2. 检查上下文是否为空
   if (contextMessages.length === 0) {
     return contextMessages;
   }

3. 获取上下文最后一条
   - last = contextMessages[contextMessages.length - 1]

4. 优先按 ID 匹配（最可靠）
   if (last.messageId === currentMessage.id) {
     return contextMessages.slice(0, -1);
   }

5. 备选：按 speaker + content 匹配
   - currentContent = stripAllMarkers(currentMessage.content)  // 使用内部纯函数
   if (last.from === currentMessage.speaker.roleName && last.content === currentContent) {
     return contextMessages.slice(0, -1);
   }

6. 无匹配，返回原样
   return contextMessages;
```

**去重场景示例**：
```
场景：用户 → Max(AI) → Sarah(AI)

messages = [
  { id: 'm1', speaker: {roleName: 'User', type: 'human'}, content: 'Hi' },
  { id: 'm2', speaker: {roleName: 'Max', type: 'ai'}, content: 'Hello!' }
]

处理 Sarah 时：
- latestMsg = m2 (Max 的回复)
- contextMessages = [m1, m2] (窗口内所有消息除了最后一条？不对，应该是除了 latestMsg)
- 实际：contextMessages = [m1]，因为 slice(0, -1) 已经排除了 m2

等等，让我重新理解流程...

正确流程：
1. 用户发送 "Hi" → messages = [m1]
2. 路由到 Max → Max 处理时：
   - latestMsg = m1
   - contextMessages = [] (空，因为只有一条消息)
   - Max 回复 "Hello!" → messages = [m1, m2]
3. 路由到 Sarah → Sarah 处理时：
   - latestMsg = m2 (Max 的回复)
   - allExceptLast = [m1]
   - contextMessages = [m1]
   - currentMessage.speaker.type = 'ai' (因为 latestMsg 是 Max 的消息)
   - 但 m1 的 from 是 'User'，不等于 currentMessage.speaker.roleName 'Max'
   - 所以不去重！

实际需要去重的场景：
当 contextMessages 的最后一项正好等于 currentMessage 时才去重。
这种情况发生在 Bug 7 修复前的并行 NEXT 场景。

修复后的正确行为：
每个 Agent 处理时，latestMsg 就是前一个 Agent 的回复（动态获取）。
contextMessages 是 latestMsg 之前的消息。
所以正常情况下不会有重复。

去重逻辑实际是防护性代码，处理边缘情况。
```

---

### 4.8 clear()

**签名**：
```typescript
clear(): void
```

**职责**：清空所有状态，准备新会话

**算法**：
```
1. 清空消息数组
   - this.messages = []

2. 重置 teamTask
   - this.teamTask = null

3. 重置消息 ID 计数器
   - this.nextMessageId = 1

4. 调用钩子
   - onTeamTaskChanged?.(null)
```

---

### 4.9 exportSnapshot()

**签名**：
```typescript
exportSnapshot(): ContextSnapshot
```

**职责**：导出当前状态的可序列化快照

**算法**：
```
1. return {
     messages: [...this.messages],  // 浅拷贝
     teamTask: this.teamTask,
     timestamp: Date.now(),
     version: 1
   }
```

---

### 4.10 importSnapshot(snapshot)

**签名**：
```typescript
importSnapshot(snapshot: ContextSnapshot): void
```

**职责**：从快照恢复状态

**算法**：
```
1. 验证快照格式
   if (!snapshot || snapshot.version !== 1) {
     throw new Error('Invalid snapshot format');
   }

2. 恢复消息
   - this.messages = [...snapshot.messages]

3. 恢复 teamTask
   - this.teamTask = snapshot.teamTask

4. 重新计算下一个消息 ID
   - this.nextMessageId = this.calculateNextMessageId()

5. 调用钩子
   - onTeamTaskChanged?.(this.teamTask)
```

**辅助方法**：
```typescript
private calculateNextMessageId(): number {
  if (this.messages.length === 0) {
    return 1;
  }
  // 找出现有消息中最大的数字 ID
  const maxId = this.messages
    .map(m => {
      const match = m.id.match(/^msg-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .reduce((max, id) => Math.max(max, id), 0);
  return maxId + 1;
}
```

---

### 4.11 assemblePrompt(agentType, input)

**签名**：
```typescript
assemblePrompt(agentType: AgentType, input: AssemblerInput): AssemblerOutput
```

**职责**：使用对应的 Assembler 组装最终 Prompt

**算法**：
```
1. 归一化 agentType
   - normalizedType = normalizeAgentType(agentType)

2. 查找 Assembler
   - assembler = this.assemblers.get(normalizedType)

3. 如果找不到，使用 PlainTextAssembler
   if (!assembler) {
     console.warn(`[ContextManager] Unknown agentType "${agentType}" (normalized: "${normalizedType}"), using PlainTextAssembler`);
     assembler = new PlainTextAssembler();
   }

4. 调用 Assembler
   - return assembler.assemble(input)
```

---

### 4.12 AgentType 归一化说明

**背景**：
团队配置文件中 `agentType` 常用简写形式（如 `claude`、`codex`、`gemini`），但 Assembler Map 使用完整名称作为 key。

**归一化映射**：
| 输入 | 归一化后 |
|------|----------|
| `'claude'` | `'claude-code'` |
| `'claude-code'` | `'claude-code'` |
| `'codex'` | `'openai-codex'` |
| `'openai-codex'` | `'openai-codex'` |
| `'gemini'` | `'google-gemini'` |
| `'google-gemini'` | `'google-gemini'` |
| 其他 | 原样返回（将触发 PlainTextAssembler） |

**实现**（复用现有 `normalizeAgentType` 函数）：
```typescript
// 来自 src/models/AgentConfig.ts
export function normalizeAgentType(type: string): AgentType {
  const mapping: Record<string, AgentType> = {
    'claude': 'claude-code',
    'claude-code': 'claude-code',
    'codex': 'openai-codex',
    'openai-codex': 'openai-codex',
    'gemini': 'google-gemini',
    'google-gemini': 'google-gemini'
  };
  return mapping[type.toLowerCase()] ?? type as AgentType;
}
```

**调用点**：
- `getContextForAgent()` - 步骤 2
- `assemblePrompt()` - 步骤 1

**设计决策**：归一化在 ContextManager 内部完成，调用者无需预处理。

---

## 5. 与 Coordinator 的集成点

### 5.1 初始化

```typescript
// ConversationCoordinator.ts
class ConversationCoordinator {
  private contextManager: ContextManager;

  constructor(...) {
    this.contextManager = new ContextManager({
      contextWindowSize: 5,
      onMessageAdded: (msg) => this.notifyUI(msg)
    });
  }
}
```

### 5.2 发送消息时

```typescript
// ConversationCoordinator.sendMessage()
async sendMessage(content: string) {
  // 存储用户消息
  const message = this.contextManager.addMessage({
    content,
    speaker: { roleId: userId, roleName: userName, ... },
    ...
  });

  // 路由到下一个 Agent
  await this.routeToNext(message);
}
```

### 5.3 发送给 Agent 时

```typescript
// ConversationCoordinator.sendToAgent()
async sendToAgent(member: Member, message: string) {
  // 获取上下文
  const input = this.contextManager.getContextForAgent(
    member.id,
    member.agentType,
    {
      systemInstruction: member.systemInstruction,
      instructionFileText: member.instructionFileText
    }
  );

  // 组装 Prompt
  const { prompt, systemFlag } = this.contextManager.assemblePrompt(
    member.agentType,
    input
  );

  // 发送给 Agent
  const response = await this.agentManager.send(member, prompt, systemFlag);

  // 存储 Agent 回复
  this.contextManager.addMessage({
    content: response,
    speaker: { roleId: member.id, roleName: member.name, type: 'ai', ... },
    ...
  });
}
```

---

## 6. 错误处理

### 6.1 错误类型

| 错误 | 触发条件 | 处理方式 |
|------|---------|---------|
| `TypeError: Message cannot be null` | addMessage(null) | 抛出，调用方捕获 |
| `TypeError: Message content must be string` | addMessage({content: 123}) | 抛出，调用方捕获 |
| `Error: Invalid snapshot format` | importSnapshot({}) | 抛出，调用方捕获 |

### 6.2 错误恢复

ContextManager 本身不提供错误恢复机制。错误发生时：
- 消息添加失败：调用方决定是否重试
- 快照导入失败：调用方决定是否使用空状态

---

## 7. 日志输出

### 7.1 日志格式

```
[ContextManager] {action}: {details}
```

### 7.2 日志级别

| 场景 | 级别 | 输出 |
|------|------|------|
| TeamTask 截断 | warn | `[ContextManager] TeamTask exceeded 5KB limit...` |
| 未知 agentType | warn | `[ContextManager] Unknown agentType "xxx"...` |
| 消息添加 | debug | `[ContextManager] Message added: {id}` |
| 去重触发 | debug | `[ContextManager] Deduplicated context for AI→AI` |

---

## 8. 单元测试用例

### 8.1 消息管理

```typescript
describe('ContextManager - Message Management', () => {
  it('addMessage stores and returns message with generated id');
  it('addMessage throws on null message');
  it('addMessage throws on non-string content');
  it('addMessage throws on missing speaker');
  it('addMessage calls onMessageAdded hook');
  it('getMessages returns shallow copy');
  it('getMessages returns empty array initially');
  it('getLatestMessage returns null when empty');
  it('getLatestMessage returns last message');
});
```

### 8.2 TeamTask 管理

```typescript
describe('ContextManager - TeamTask Management', () => {
  it('setTeamTask stores task');
  it('setTeamTask truncates at 5KB');
  it('setTeamTask logs warning on truncation');
  it('setTeamTask calls onTeamTaskChanged hook');
  it('getTeamTask returns null initially');
});
```

### 8.3 上下文准备

```typescript
describe('ContextManager - getContextForAgent', () => {
  it('returns empty context when no messages');
  it('applies contextWindowSize limit');
  it('respects windowSizeOverride');
  it('strips markers from context messages');
  it('strips markers from current message');
  it('deduplicates AI→AI context');
  it('does NOT deduplicate human messages');
  it('passes systemInstruction and instructionFileText');
  it('passes maxBytes to output');
});
```

### 8.4 生命周期

```typescript
describe('ContextManager - Lifecycle', () => {
  it('clear removes all messages');
  it('clear resets teamTask');
  it('clear resets message ID counter');
  it('exportSnapshot returns serializable object');
  it('importSnapshot restores messages');
  it('importSnapshot restores teamTask');
  it('importSnapshot throws on invalid format');
});
```

### 8.5 Assembler 集成

```typescript
describe('ContextManager - assemblePrompt', () => {
  it('uses ClaudeContextAssembler for claude-code');
  it('uses CodexContextAssembler for openai-codex');
  it('uses GeminiContextAssembler for google-gemini');
  it('falls back to PlainTextAssembler for unknown type');
  it('logs warning for unknown agent type');
});
```

---

## 9. 性能考虑

### 9.1 内存

- 消息数组无上限，长会话可能占用大量内存
- 考虑未来添加 `maxMessages` 配置项，自动移除最旧消息

### 9.2 时间复杂度

| 操作 | 复杂度 | 说明 |
|------|--------|------|
| addMessage | O(1) | 数组 push |
| getMessages | O(n) | 浅拷贝数组 |
| getLatestMessage | O(1) | 直接索引 |
| getContextForAgent | O(w) | w = contextWindowSize |
| clear | O(1) | 赋值新数组 |

---

## 10. 未来扩展点

1. **Per-Agent Window Size**：支持不同 Agent 使用不同的上下文窗口大小
2. **消息上限**：超过上限时自动归档或删除旧消息
3. **消息索引**：支持按 ID、时间、发送者等查询消息
4. **压缩存储**：长文本消息的压缩存储
5. **流式上下文**：支持流式处理大量消息

---

## 附录 A：完整类型定义

```typescript
// src/context/types.ts

export interface ContextManagerOptions {
  contextWindowSize?: number;
  maxBytes?: number;
  onMessageAdded?: (msg: ConversationMessage) => void;
  onTeamTaskChanged?: (task: string | null) => void;
}

export interface ContextSnapshot {
  messages: ConversationMessage[];
  teamTask: string | null;
  timestamp: number;
  version: 1;
}

export interface AssemblerInput {
  contextMessages: PromptContextMessage[];
  currentMessage: string;
  teamTask: string | null;
  systemInstruction?: string;
  instructionFileText?: string;
  maxBytes: number;
}

export interface AssemblerOutput {
  prompt: string;
  systemFlag?: string;
}
```

---

## 附录 B：依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      ContextManager                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  依赖 (imports)                                             │
│  ├── MessageRouter (stripAllMarkersForContext)              │
│  ├── ConversationMessage (type)                             │
│  ├── PromptContextMessage (type)                            │
│  └── IContextAssembler (interface)                          │
│                                                              │
│  组合 (has-a)                                               │
│  ├── ClaudeContextAssembler                                 │
│  ├── CodexContextAssembler                                  │
│  ├── GeminiContextAssembler                                 │
│  └── PlainTextAssembler (fallback)                          │
│                                                              │
│  被依赖 (used by)                                           │
│  ├── ConversationCoordinator                                │
│  └── SessionUtils (via exportSnapshot/importSnapshot)       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
