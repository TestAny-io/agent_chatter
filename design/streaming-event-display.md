# Streaming Event Display - 流式事件展示系统

**提案日期**: 2025-11-23
**状态**: 待评审
**提案人**: Development Team

## 背景与问题

### 当前痛点
用户在使用 agent-chatter 时无法看到 AI Agent 的实时工作进度，体验类似"黑箱操作"：

1. **无可见性**：Agent 启动后，用户只能看到"Thinking..."，直到整个任务完成才能看到最终输出
2. **无反馈**：长时间任务（如多文件修改、复杂调试）期间用户不知道 Agent 在做什么
3. **无法定位问题**：出错时用户无法追溯中间步骤，只看到最终错误
4. **调试困难**：DEBUG 模式输出到 stderr，与 UI 分离，不友好

### 核心问题
**数据流路径与 UI 展示脱节**：

- **Claude/Gemini/Codex**: 均使用 JSONL 输出（`--output-format stream-json` 或 `--json`），但当前实现全缓冲到进程结束才返回
- **AgentManager**: `sendAndReceive()` 将所有输出缓存为字符串，直到进程退出才返回
- **UI**: 只消费最终字符串，无法订阅中间事件
- **JsonlMessageFormatter**: 已实现 JSONL 解析，但仅在最终阶段调用，无法流式处理
- **ProcessManager**: 设计了 JSONL 解析和事件检测，但 stateless 路径绕过它，成为死代码

## 目标

### 核心目标
1. **实时可见性**: 用户能看到 Agent 的实时工作过程（工具调用、文件操作、思考片段）
2. **统一事件流**: 不同 Agent（Claude/Codex/Gemini）的输出转换为统一的内部事件格式
3. **多消费者支持**: 同一事件流可被 UI、上下文构建、日志记录等多个模块消费
4. **架构清晰**: 关注点分离，解析层与展示层独立演进

### 非目标
- **不改变现有 CLI 调用方式**：仍然使用 stateless 模式，不引入 stateful 复杂性
- **不实现完整的消息协议**：仅处理展示相关的事件，不涉及双向通信
- **不依赖 CLI 版本特性**：设计容错机制应对不同 CLI 版本的字段差异

## 现状分析

### 当前架构（v0.1.1）

```
User Input
    ↓
ConversationCoordinator.sendToAgent()
    ↓
AgentManager.sendAndReceive()
    ↓
spawn() → stdout全缓冲 → 进程退出 → 返回完整字符串
    ↓
ConversationCoordinator.onAgentResponse()
    ↓
formatJsonl() → 格式化为文本
    ↓
UI 展示最终结果
```

**问题**：
- `sendAndReceive()` 用 Promise 封装，直到 `childProcess.on('exit')` 才 resolve
- stdout 的 `data` 事件只用于累积字符串，不发送任何中间事件
- UI 层（Ink components）无法订阅流式更新

### 适配器现状

| Agent Type  | 输出格式         | CLI 参数           | 解析难度 | 备注                          |
|-------------|-----------------|-------------------|---------|-------------------------------|
| Claude Code | stream-json     | `--output-format stream-json` | 中等    | JSONL，每行一个事件对象，已有解析器 |
| Gemini      | stream-json     | `--output-format stream-json` | 中等    | JSONL，字段与 Claude 略有差异，已有解析器 |
| Codex       | JSONL (--json)  | `--json`          | 中等    | JSONL，item.*/turn.* 事件流，已有解析器 |

**注**: 自 v0.0.27 (commit 116050e, 2025-11-21) 起，项目已使用 JSONL 事件检测，`JsonlMessageFormatter` 可解析三种 Agent 的输出。

### ProcessManager 现状
- **设计用途**: 管理 stateful agent，解析 JSONL，检测完成事件
- **实际使用**: stateless 路径绕过它，直接在 AgentManager 中处理
- **结论**: 当前架构下是死代码，需要明确废弃或重新定位

## 架构设计

### 双层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Presentation Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  REPL UI     │  │ Context      │  │  Logger      │       │
│  │  (Ink)       │  │  Builder     │  │  Service     │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                  │                  │               │
│         └──────────────────┼──────────────────┘               │
│                            │                                  │
│                   ┌────────▼────────┐                         │
│                   │  EventEmitter   │                         │
│                   │  (event bus)    │                         │
│                   └────────▲────────┘                         │
└────────────────────────────┼──────────────────────────────────┘
                             │
┌────────────────────────────┼──────────────────────────────────┐
│                    Parsing Layer                              │
│                   ┌────────┴────────┐                         │
│                   │  EventAggregator│                         │
│                   │  (in AgentMgr)  │                         │
│                   └────────┬────────┘                         │
│                            │                                  │
│         ┌──────────────────┼──────────────────┐               │
│         │                  │                  │               │
│  ┌──────▼───────┐  ┌──────▼──────┐  ┌────────▼──────┐        │
│  │ Claude       │  │  Gemini     │  │  Codex        │        │
│  │ Parser       │  │  Parser     │  │  Parser       │        │
│  └──────┬───────┘  └──────┬──────┘  └────────┬──────┘        │
│         │                  │                  │               │
│         │  stream-json     │  stream-json     │  JSONL        │
└─────────┼──────────────────┼──────────────────┼───────────────┘
          │                  │                  │
    ┌─────▼──────────────────▼──────────────────▼─────┐
    │         childProcess stdout (raw bytes)         │
    └─────────────────────────────────────────────────┘
```

### 关键架构决策

**决策**: 彻底废弃"缓冲字符串"模式，改为纯事件流驱动

**理由**:
- 避免"事件流 + Promise返回字符串"的双轨终止冲突
- 统一消费者接口（UI/Context/Logger都订阅事件）
- 简化生命周期管理（completion事件是唯一终止来源）

**影响范围**:
1. ❌ **废弃**: `AgentManager.sendAndReceive()` 不再返回完整字符串
2. ✅ **新增**: 基于事件流的执行模型
3. ✅ **新增**: Promise仅用于生命周期信号（resolve/reject表示完成/失败）
4. ⚠️ **不兼容变更**: 调用者（ConversationCoordinator/REPL）必须改为订阅事件

**执行模型**:
```
1. ConversationCoordinator 调用 sendToAgent(member, prompt)
2. 创建 EventConverter(teamContext, agentType)
3. spawn() 子进程，订阅 stdout
4. stdout.on('data') → 解析JSONL → converter.convert() → emit('agent-event', event)
5. 消费者（UI/Context/Logger）订阅 'agent-event'
6. 检测到 turn.completed 或 error 事件 → resolve/reject Promise
7. Promise返回值仅为 {success: boolean}，不包含内容
```

**生命周期事件序列**:
```
正常流程:
  session.started → text* → tool.started → tool.completed → text* → turn.completed(finishReason='done')

Agent错误流程:
  session.started → text* → turn.completed(finishReason='error')

解析错误流程:
  session.started → text* → error(code='JSONL_PARSE_ERROR') → ... → turn.completed(finishReason='done')
  (注：单行解析失败发error事件但继续，最终仍会收到turn.completed)

取消流程:
  session.started → text* → [用户按ESC] → turn.completed(finishReason='cancelled')

超时流程:
  session.started → text* → [超时] → turn.completed(finishReason='timeout')

进程异常退出流程:
  session.started → text* → [进程crash] → error(code='PROCESS_EXIT') + reject(不等turn.completed)
```

**关键决策**：
- ✅ **所有正常/错误/取消/超时流程都会发送 `turn.completed` 事件**
- ✅ **通过 `finishReason` 字段区分结束原因**（done/error/cancelled/timeout）
- ❌ **只有进程异常退出时不发 `turn.completed`，直接emit error + reject**

**Promise resolve/reject规则**:
- `turn.completed` (finishReason='done') → `resolve({success: true, finishReason: 'done'})`
- `turn.completed` (finishReason='error') → `resolve({success: false, finishReason: 'error'})`
- `turn.completed` (finishReason='cancelled') → `resolve({success: false, finishReason: 'cancelled'})`
- `turn.completed` (finishReason='timeout') → `resolve({success: false, finishReason: 'timeout'})`
- 进程异常退出（无turn.completed） → `reject(new Error('Process exited unexpectedly'))`

**注意**：
- Agent内部错误（如Claude报错）仍会发 `turn.completed(finishReason='error')`，Promise **resolve**而非reject
- 只有进程级异常（crash/spawn失败）才 **reject** Promise
- 调用者通过 `result.success` 判断是否成功，而非依赖 try/catch

### 核心组件

#### 1. 统一事件格式（Internal Event Schema）

**完整Schema定义**: 参见 [`design/agent_chatter_output_jsonl_schema.json`](./agent_chatter_output_jsonl_schema.json)

该文件定义了应用输出的统一JSONL格式，包括：
- 6种事件类型：`session.started`, `text`, `tool.started`, `tool.completed`, `turn.completed`, `error`
- 完整的JSON Schema定义和字段说明
- Team metadata注入规则
- 转换规则和映射示例
- 设计原则和决策记录

以下是TypeScript接口简化版（用于代码实现参考）：

```typescript
// src/events/AgentEvent.ts

/** Base event interface */
interface AgentEventBase {
  eventId: string;           // UUID for event tracking
  agentId: string;           // Member/role ID
  agentType: 'claude-code' | 'openai-codex' | 'google-gemini';
  timestamp: number;         // Unix timestamp (ms)
  teamMetadata: {            // Team context from team config
    teamName: string;
    teamDisplayName: string;
    memberName: string;
    memberDisplayName: string;
    memberRole: string;
    memberDisplayRole: string;
    themeColor: string;      // For UI rendering
  };
}

/** Text chunk event */
interface TextEvent extends AgentEventBase {
  type: 'text';
  text: string;              // Text content (may be partial)
  role?: 'assistant' | 'system';
}

/** Tool use event (function call) */
interface ToolUseEvent extends AgentEventBase {
  type: 'tool_use';
  toolName: string;          // e.g., 'Read', 'Write', 'Bash'
  toolId: string;            // Unique ID for this tool invocation
  input: Record<string, any>; // Tool parameters
}

/** Tool result event */
interface ToolResultEvent extends AgentEventBase {
  type: 'tool_result';
  toolId: string;            // Matches ToolUseEvent.toolId
  output?: string;           // Success output
  error?: string;            // Error message
}

/** Turn completion event */
interface TurnCompletedEvent extends AgentEventBase {
  type: 'turn.completed';
  finishReason: 'done' | 'error' | 'cancelled' | 'timeout';
  errorMessage?: string;
}

/** Error event */
interface ErrorEvent extends AgentEventBase {
  type: 'error';
  error: string;
  stack?: string;
}

type AgentEvent =
  | TextEvent
  | ToolUseEvent
  | ToolResultEvent
  | TurnCompletedEvent
  | ErrorEvent;
```

#### 2. Stream Parser 接口

```typescript
// src/events/StreamParser.ts

interface StreamParser {
  /**
   * Parse a chunk of output and emit events
   * @param chunk - Raw bytes from stdout
   * @returns Array of parsed events (may be empty if incomplete line)
   */
  parseChunk(chunk: Buffer): AgentEvent[];

  /**
   * Flush any remaining buffered data
   * @returns Final events from buffer
   */
  flush(): AgentEvent[];

  /**
   * Reset parser state (for new execution)
   */
  reset(): void;
}
```

#### 3. 各 Agent 解析器实现

**Claude Code Parser**
```typescript
// src/events/parsers/ClaudeCodeParser.ts

export class ClaudeCodeParser implements StreamParser {
  private buffer = '';

  constructor(private agentId: string) {}

  parseChunk(chunk: Buffer): AgentEvent[] {
    this.buffer += chunk.toString('utf-8');
    const events: AgentEvent[] = [];

    // Split by newlines to extract complete JSONL lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);
        const event = this.jsonToEvent(json);
        if (event) events.push(event);
      } catch (err) {
        // Invalid JSON, emit error event
        events.push({
          type: 'error',
          eventId: generateEventId(),
          agentId: this.agentId,
          agentType: 'claude-code',
          timestamp: Date.now(),
          error: `Failed to parse JSONL: ${err.message}`
        });
      }
    }

    return events;
  }

  private jsonToEvent(json: any): AgentEvent | null {
    const base = {
      eventId: generateEventId(),
      agentId: this.agentId,
      agentType: 'claude-code' as const,
      timestamp: Date.now()
    };

    // Map Claude stream-json format to internal events
    switch (json.type) {
      case 'content_block_delta':
        if (json.delta?.type === 'text_delta') {
          return {
            ...base,
            type: 'text',
            text: json.delta.text
          };
        }
        break;

      case 'tool_use':
        return {
          ...base,
          type: 'tool_use',
          toolName: json.name,
          toolId: json.id,
          input: json.input
        };

      case 'tool_result':
        return {
          ...base,
          type: 'tool_result',
          toolId: json.tool_use_id,
          output: json.content,
          error: json.is_error ? json.content : undefined
        };

      case 'message_stop':
        return {
          ...base,
          type: 'turn.completed',
          finishReason: json.stop_reason === 'end_turn' ? 'done' : 'error'
        };
    }

    return null;
  }

  flush(): AgentEvent[] {
    if (this.buffer.trim()) {
      // Incomplete JSON at end - emit as text
      const text = this.buffer;
      this.buffer = '';
      return [{
        type: 'text',
        eventId: generateEventId(),
        agentId: this.agentId,
        agentType: 'claude-code',
        timestamp: Date.now(),
        text
      }];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }
}
```

**Codex Parser**
```typescript
// src/events/parsers/CodexParser.ts

export class CodexParser implements StreamParser {
  private buffer = '';

  constructor(private agentId: string) {}

  parseChunk(chunk: Buffer): AgentEvent[] {
    this.buffer += chunk.toString('utf-8');
    const events: AgentEvent[] = [];

    // Codex outputs JSONL with item.* and turn.* events
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);
        const event = this.jsonToEvent(json);
        if (event) events.push(event);
      } catch (err) {
        // Invalid JSON, emit error event
        events.push({
          type: 'error',
          eventId: generateEventId(),
          agentId: this.agentId,
          agentType: 'openai-codex',
          timestamp: Date.now(),
          error: `Failed to parse JSONL: ${err.message}`
        });
      }
    }

    return events;
  }

  private jsonToEvent(json: any): AgentEvent | null {
    const base = {
      eventId: generateEventId(),
      agentId: this.agentId,
      agentType: 'openai-codex' as const,
      timestamp: Date.now()
    };

    // Map Codex JSONL events to internal format
    switch (json.type) {
      case 'item.started':
        if (json.item?.type === 'command_execution') {
          return {
            ...base,
            type: 'tool_use',
            toolName: 'Bash',
            toolId: json.item.id,
            input: { command: json.item.command }
          };
        }
        break;

      case 'item.completed':
        if (json.item?.type === 'agent_message') {
          return {
            ...base,
            type: 'text',
            text: json.item.text
          };
        }
        if (json.item?.type === 'command_execution') {
          return {
            ...base,
            type: 'tool_result',
            toolId: json.item.id,
            output: json.item.aggregated_output,
            error: json.item.exit_code !== 0 ? `Exit code: ${json.item.exit_code}` : undefined
          };
        }
        if (json.item?.type === 'file_change') {
          return {
            ...base,
            type: 'text',
            text: `Files changed: ${json.item.changes?.map(c => c.path).join(', ')}`
          };
        }
        break;

      case 'turn.completed':
        return {
          ...base,
          type: 'turn.completed',
          finishReason: 'done'
        };
    }

    return null;
  }

  flush(): AgentEvent[] {
    if (this.buffer.trim()) {
      const text = this.buffer;
      this.buffer = '';
      return [{
        type: 'text',
        eventId: generateEventId(),
        agentId: this.agentId,
        agentType: 'openai-codex',
        timestamp: Date.now(),
        text
      }];
    }
    return [];
  }

  reset(): void {
    this.buffer = '';
  }
}
```

**Gemini Parser** (类似 Claude)
```typescript
// src/events/parsers/GeminiParser.ts
// Similar to ClaudeCodeParser but with Gemini-specific JSONL schema mapping
```

#### 4. EventAggregator（在 AgentManager 中）

```typescript
// src/services/AgentManager.ts (modifications)

import { EventEmitter } from 'events';
import { StreamParserFactory } from '../events/StreamParserFactory.js';

export class AgentManager {
  // ... existing fields
  private eventBus: EventEmitter = new EventEmitter();

  /**
   * Get the event bus for subscribing to agent events
   */
  getEventBus(): EventEmitter {
    return this.eventBus;
  }

  async sendAndReceive(
    roleId: string,
    message: string,
    options?: Partial<SendOptions> & { systemFlag?: string }
  ): Promise<string> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Role ${roleId} has no running agent`);
    }

    // ... existing config and spawn logic

    if (agent.adapter.executionMode === 'stateless') {
      // Create parser for this agent type
      const parser = StreamParserFactory.createParser(
        agent.adapter.agentType,
        roleId
      );

      return new Promise<string>((resolve, reject) => {
        const childProcess = spawn(agent.adapter.command, args, {
          cwd: spawnConfig.workDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        agent.currentStatelessProcess = childProcess;

        let stdout = '';
        let stderr = '';

        // NEW: Stream parsing and event emission
        childProcess.stdout!.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();

          // Parse chunk and emit events
          const events = parser.parseChunk(chunk);
          for (const event of events) {
            this.eventBus.emit('agentEvent', event);
          }

          // Keep existing DEBUG logging
          if (debugPrefix) {
            for (const line of chunk.toString().split(/\r?\n/)) {
              if (line.trim()) {
                console.error(`${debugPrefix} stdout ${line}`);
              }
            }
          }
        });

        childProcess.stderr!.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          if (debugPrefix) {
            for (const line of chunk.toString().split(/\r?\n/)) {
              if (line.trim()) {
                console.error(`${debugPrefix} stderr ${line}`);
              }
            }
          }
        });

        childProcess.on('exit', (code, signal) => {
          // Flush any remaining events
          const finalEvents = parser.flush();
          for (const event of finalEvents) {
            this.eventBus.emit('agentEvent', event);
          }

          // Emit completion event
          this.eventBus.emit('agentEvent', {
            type: 'turn.completed',
            eventId: generateEventId(),
            agentId: roleId,
            agentType: agent.adapter.agentType,
            timestamp: Date.now(),
            finishReason: code === 0 ? 'done' : 'error',
            errorMessage: code !== 0 ? stderr : undefined
          } as TurnCompletedEvent);

          // ... existing exit handling
          resolve(stdout);
        });
      });
    }

    // ... existing stateful mode logic
  }
}
```

#### 5. UI 订阅和展示

```typescript
// src/repl/ReplModeInk.tsx (modifications)

export function ReplModeInk({ coordinator, team, initialMessage, firstSpeaker }: Props) {
  // ... existing state
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!agentManager) return;

    const eventBus = agentManager.getEventBus();

    const handleEvent = (event: AgentEvent) => {
      setAgentEvents(prev => [...prev, event]);

      if (event.type === 'turn.completed') {
        setIsStreaming(false);
      }
    };

    eventBus.on('agentEvent', handleEvent);

    return () => {
      eventBus.off('agentEvent', handleEvent);
    };
  }, [agentManager]);

  // Subscribe to agent started/completed
  useEffect(() => {
    if (!coordinator) return;

    const originalOnAgentStarted = coordinator.options.onAgentStarted;
    const originalOnAgentCompleted = coordinator.options.onAgentCompleted;

    coordinator.options.onAgentStarted = (member) => {
      setIsStreaming(true);
      setAgentEvents([]); // Clear previous events
      originalOnAgentStarted?.(member);
    };

    coordinator.options.onAgentCompleted = (member) => {
      setIsStreaming(false);
      originalOnAgentCompleted?.(member);
    };

    return () => {
      coordinator.options.onAgentStarted = originalOnAgentStarted;
      coordinator.options.onAgentCompleted = originalOnAgentCompleted;
    };
  }, [coordinator]);

  return (
    <Box flexDirection="column">
      {/* ... existing UI */}

      {isStreaming && (
        <StreamingDisplay events={agentEvents} />
      )}
    </Box>
  );
}
```

```typescript
// src/repl/components/StreamingDisplay.tsx (new component)

interface Props {
  events: AgentEvent[];
}

export function StreamingDisplay({ events }: Props) {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={2}>
      <Text bold color="cyan">Agent Activity:</Text>
      <Box flexDirection="column" marginTop={1}>
        {events.map((event, idx) => (
          <EventItem key={idx} event={event} />
        ))}
      </Box>
    </Box>
  );
}

function EventItem({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case 'text':
      return <Text dimColor>{event.text}</Text>;

    case 'tool_use':
      return (
        <Box>
          <Text color="yellow">🔧 {event.toolName}</Text>
          <Text dimColor> {JSON.stringify(event.input)}</Text>
        </Box>
      );

    case 'tool_result':
      return (
        <Box>
          <Text color="green">✓ Result</Text>
          {event.output && <Text dimColor> {truncate(event.output, 80)}</Text>}
          {event.error && <Text color="red"> Error: {event.error}</Text>}
        </Box>
      );

    case 'turn.completed':
      return (
        <Text color={event.finishReason === 'done' ? 'green' : 'red'}>
          {event.finishReason === 'done' ? '✓ Completed' : '✗ Failed'}
        </Text>
      );

    case 'error':
      return <Text color="red">Error: {event.error}</Text>;

    default:
      return null;
  }
}
```

## 实施计划

### Phase 1: 最小可行流式展示（3-5 天）

**目标**: 为 Claude Code 实现流式文本展示，验证架构可行性

**任务**:
1. 定义内部事件格式（`AgentEvent` types）
2. 实现 `ClaudeCodeParser`（只处理 text 和 completion 事件）
3. 修改 `AgentManager.sendAndReceive()` 集成 EventEmitter
4. 创建 `StreamingDisplay` 组件订阅事件
5. 端到端测试：用户能看到 Claude 的实时文本输出

**交付物**:
- `src/events/AgentEvent.ts` - 事件类型定义
- `src/events/StreamParser.ts` - 解析器接口
- `src/events/parsers/ClaudeCodeParser.ts` - Claude 解析器
- `src/events/StreamParserFactory.ts` - 解析器工厂
- `src/services/AgentManager.ts` - 集成事件发送
- `src/repl/components/StreamingDisplay.tsx` - UI 组件
- `tests/unit/events/ClaudeCodeParser.test.ts` - 解析器单测

**验收标准**:
- ✅ 用户启动 Claude agent 后能看到实时文本输出
- ✅ 文本逐行显示，不是一次性展示
- ✅ 完成时显示 "✓ Completed"
- ✅ 所有现有测试通过（390 tests）

### Phase 2: 扩展工具调用展示（2-3 天）

**目标**: 展示 Claude 的工具调用（Read/Write/Bash 等）

**任务**:
1. 扩展 `ClaudeCodeParser` 支持 tool_use 和 tool_result 事件
2. 美化 `StreamingDisplay` 展示工具调用详情
3. 实现 Gemini 解析器（复用 Claude 大部分逻辑）
4. 实现 Codex 解析器（解析 item.*/turn.* JSONL 事件）
5. 添加事件过滤和折叠功能（可选）

**交付物**:
- `src/events/parsers/ClaudeCodeParser.ts` - 完整实现
- `src/events/parsers/GeminiParser.ts` - Gemini 解析器
- `src/events/parsers/CodexParser.ts` - Codex 解析器
- `src/repl/components/StreamingDisplay.tsx` - 完整 UI
- `tests/unit/events/*.test.ts` - 所有解析器测试

**验收标准**:
- ✅ 能看到 Read/Write/Bash 等工具调用
- ✅ 工具参数和结果清晰展示
- ✅ Gemini 和 Codex 也有基础流式展示
- ✅ UI 不会因为大量事件卡顿（性能测试）

### Phase 3: Context 服务迁移和日志（3-5 天）

**目标**: Context 服务和日志服务订阅事件流

**任务**:
1. 创建 `ContextBuilder` 订阅事件流，构建上下文
2. 创建 `EventLogger` 将事件写入日志文件
3. 评估是否废弃 ProcessManager（标记 @deprecated）
4. 性能优化：事件节流、内存管理
5. 错误处理增强：CLI 版本变动的容错

**交付物**:
- `src/services/ContextBuilder.ts` - 上下文构建服务
- `src/services/EventLogger.ts` - 事件日志服务
- `src/infrastructure/ProcessManager.ts` - 标记废弃
- 性能测试和优化报告
- 完整集成测试

**验收标准**:
- ✅ Context 从事件流构建，不依赖最终字符串
- ✅ 事件日志可查询、回放
- ✅ ProcessManager 明确标记为 deprecated
- ✅ 长时间运行（30 分钟+）无内存泄漏
- ✅ 所有测试通过（预计 420+ tests）

## 技术选型

### EventEmitter vs RxJS

**选择**: Node.js EventEmitter ✅

**理由**:
- ✅ 轻量级，Node.js 原生，无额外依赖
- ✅ Ink 组件天然支持（useEffect + on/off）
- ✅ 学习曲线低，团队熟悉
- ❌ RxJS 过度设计，增加 bundle size 和复杂度

### 事件格式设计原则

1. **类型安全**: 使用 TypeScript discriminated unions
2. **可扩展**: 新 agent 类型只需添加解析器，不改事件格式
3. **最小化**: 只包含展示必需字段，避免冗余
4. **时间戳**: 统一使用 Unix timestamp（ms），方便排序和回放

### 解析器设计原则

1. **按行解析**: JSONL 格式按换行符分割，保持简单
2. **容错**: 遇到无法解析的行发送 error 事件，不中断流
3. **状态最小化**: 只缓存不完整的行，其他状态不保留
4. **可测试**: 纯函数设计，输入 Buffer 输出 Event[]

## 风险评估与缓解

### 风险 1: CLI 版本变动导致 JSONL schema 变化

**概率**: 中
**影响**: 高
**缓解**:
- 解析器使用防御性编程，字段缺失时跳过而非报错
- 版本检测：启动时记录 CLI 版本，出错时提示版本不兼容
- 降级策略：无法解析 JSONL 时回退到纯文本模式
- 单测覆盖：为每个 CLI 版本准备测试数据

### 风险 2: 大量事件导致内存泄漏

**概率**: 中
**影响**: 中
**缓解**:
- 事件数量限制：UI 只保留最近 N 条事件（默认 100）
- 滑动窗口：旧事件自动移除
- 压力测试：30 分钟长任务 + 内存监控
- 性能指标：订阅者数量、事件频率监控

### 风险 3: 事件分发延迟导致 UI 卡顿

**概率**: 低
**影响**: 中
**缓解**:
- 事件节流：高频事件合并（如 text 事件批量发送）
- 异步渲染：Ink 组件使用 React 虚拟 DOM，天然防抖
- 性能测试：模拟高频事件流（1000 events/sec）

### 风险 4: 多 agent 并发时事件串台

**概率**: 低
**影响**: 高
**缓解**:
- 事件必含 agentId：订阅者按 agentId 过滤
- UI 分离展示：每个 agent 独立的 StreamingDisplay
- 集成测试：同时运行 3 个 agent 验证隔离

## 测试策略

### 单元测试（Parser 层）

```typescript
// tests/unit/events/ClaudeCodeParser.test.ts

describe('ClaudeCodeParser', () => {
  it('should parse text delta event', () => {
    const parser = new ClaudeCodeParser('agent-1');
    const chunk = Buffer.from('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n');
    const events = parser.parseChunk(chunk);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text');
    expect((events[0] as TextEvent).text).toBe('Hello');
  });

  it('should handle incomplete JSON lines', () => {
    const parser = new ClaudeCodeParser('agent-1');
    const chunk1 = Buffer.from('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel');
    const chunk2 = Buffer.from('lo"}}\n');

    expect(parser.parseChunk(chunk1)).toHaveLength(0); // Incomplete
    expect(parser.parseChunk(chunk2)).toHaveLength(1); // Complete
  });

  it('should emit error event for invalid JSON', () => {
    const parser = new ClaudeCodeParser('agent-1');
    const chunk = Buffer.from('invalid json\n');
    const events = parser.parseChunk(chunk);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('should parse tool use event', () => {
    const parser = new ClaudeCodeParser('agent-1');
    const chunk = Buffer.from('{"type":"tool_use","id":"tool_123","name":"Read","input":{"file_path":"test.ts"}}\n');
    const events = parser.parseChunk(chunk);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_use');
    const toolEvent = events[0] as ToolUseEvent;
    expect(toolEvent.toolName).toBe('Read');
    expect(toolEvent.input.file_path).toBe('test.ts');
  });
});
```

### 集成测试（端到端）

```typescript
// tests/integration/streaming.test.ts

describe('Streaming Display Integration', () => {
  it('should display Claude agent events in real-time', async () => {
    const agentManager = new AgentManager(/* ... */);
    const events: AgentEvent[] = [];

    agentManager.getEventBus().on('agentEvent', (event) => {
      events.push(event);
    });

    // Trigger agent execution
    await agentManager.sendAndReceive('claude-1', 'Read test.ts');

    // Verify events were emitted
    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'text')).toBe(true);
    expect(events.some(e => e.type === 'tool_use')).toBe(true);
    expect(events[events.length - 1].type).toBe('completion');
  });

  it('should handle multiple concurrent agents', async () => {
    const agentManager = new AgentManager(/* ... */);
    const eventsByAgent = new Map<string, AgentEvent[]>();

    agentManager.getEventBus().on('agentEvent', (event) => {
      if (!eventsByAgent.has(event.agentId)) {
        eventsByAgent.set(event.agentId, []);
      }
      eventsByAgent.get(event.agentId)!.push(event);
    });

    // Start 3 agents concurrently
    await Promise.all([
      agentManager.sendAndReceive('claude-1', 'task 1'),
      agentManager.sendAndReceive('codex-1', 'task 2'),
      agentManager.sendAndReceive('gemini-1', 'task 3')
    ]);

    // Verify events are isolated by agentId
    expect(eventsByAgent.size).toBe(3);
    expect(eventsByAgent.get('claude-1')).toBeDefined();
    expect(eventsByAgent.get('codex-1')).toBeDefined();
    expect(eventsByAgent.get('gemini-1')).toBeDefined();
  });
});
```

### 性能测试

```typescript
// tests/performance/streaming.perf.test.ts

describe('Streaming Performance', () => {
  it('should handle 1000 events without memory leak', async () => {
    const agentManager = new AgentManager(/* ... */);
    const initialMemory = process.memoryUsage().heapUsed;

    // Subscribe and accumulate events
    const events: AgentEvent[] = [];
    agentManager.getEventBus().on('agentEvent', (event) => {
      events.push(event);

      // Sliding window: keep only last 100 events
      if (events.length > 100) {
        events.shift();
      }
    });

    // Simulate 1000 events
    for (let i = 0; i < 1000; i++) {
      agentManager.getEventBus().emit('agentEvent', {
        type: 'text',
        eventId: `evt-${i}`,
        agentId: 'test',
        agentType: 'claude-code',
        timestamp: Date.now(),
        text: `Event ${i}`
      });
    }

    // Check memory growth
    const finalMemory = process.memoryUsage().heapUsed;
    const growth = finalMemory - initialMemory;
    expect(growth).toBeLessThan(10 * 1024 * 1024); // Less than 10MB

    // Check event count (should be capped at 100)
    expect(events.length).toBe(100);
  });
});
```

## ProcessManager 处理方案

### 决定：标记为 @deprecated，保留代码但不维护

**理由**:
1. 当前所有 agent 都使用 stateless 模式，ProcessManager 未被调用
2. 未来可能支持 stateful agent（如持久化 REPL），保留接口以备不用
3. 删除会破坏现有导入，标记废弃更安全

**实施**:
```typescript
// src/infrastructure/ProcessManager.ts

/**
 * @deprecated ProcessManager is not used in current architecture (stateless agents).
 * All agents use AgentManager.sendAndReceive() with event streaming.
 * This class is kept for potential future stateful agent support.
 */
export class ProcessManager {
  // ... existing implementation unchanged
}
```

**文档更新**:
- README 和架构文档明确说明当前路径：stateless + event streaming
- 添加决策记录（ADR）解释为何保留 ProcessManager

## 成功指标

### 用户体验指标
- ✅ 用户能实时看到 agent 工作进度（100% 覆盖）
- ✅ 工具调用清晰可见（Read/Write/Bash 等）
- ✅ UI 响应流畅，无明显卡顿（< 100ms 延迟）

### 技术指标
- ✅ 所有 Parser 单测覆盖率 > 90%
- ✅ 集成测试覆盖 3 种 agent 类型
- ✅ 性能测试通过（30 分钟无内存泄漏）
- ✅ 总测试数量 > 420（新增 30+ 测试）

### 架构指标
- ✅ 事件格式统一，新 agent 接入成本 < 1 天
- ✅ UI/Context/Logger 三个消费者并存无冲突
- ✅ 代码复杂度可控（每个 Parser < 300 行）

## 转换Function设计

### 概述

**完整Schema定义**: 本章节的详细事件格式定义、转换规则、映射示例，请参见独立文件：
- **[`design/agent_chatter_output_jsonl_schema.json`](./agent_chatter_output_jsonl_schema.json)** - 应用输出的统一JSONL格式完整定义
- **[`design/agents_jsonl_schema.json`](./agents_jsonl_schema.json)** - Claude/Codex/Gemini三种Agent的原生JSONL格式参考

转换function负责将各Agent的原生JSONL事件转换为统一的内部事件格式。这是一个典型的ETL（Extract-Transform-Load）过程，遵循以下核心原则：

1. **完整性原则**: 保留所有源数据，不做截断或删除
2. **自包含原则**: 每个事件包含完整的上下文（team/member metadata）
3. **幂等性原则**: 相同输入产生相同输出，可重复执行
4. **容错性原则**: 解析失败时发出error事件，不中断流程

### 架构设计

**注**: 完整的事件类型定义、字段说明、转换规则见 [`agent_chatter_output_jsonl_schema.json`](./agent_chatter_output_jsonl_schema.json)

```typescript
// src/events/EventConverter.ts

export interface TeamContext {
  teamName: string;
  teamDisplayName: string;
  memberName: string;
  memberDisplayName: string;
  memberRole: string;
  memberDisplayRole: string;
  themeColor: string;          // 从 team config 的 member.themeColor 提取
}

export class EventConverter {
  constructor(
    private teamContext: TeamContext,
    private agentType: 'claude-code' | 'openai-codex' | 'google-gemini'
  ) {}

  /**
   * Convert source JSONL line to unified internal event
   * @param line - Raw JSONL line from agent CLI
   * @returns Unified event or error event if parse fails
   */
  convert(line: string): UnifiedEvent {
    try {
      const json = JSON.parse(line);
      return this.jsonToEvent(json);
    } catch (err) {
      return this.createErrorEvent(`Failed to parse JSONL: ${err.message}`, line);
    }
  }

  private jsonToEvent(json: any): UnifiedEvent {
    const baseEvent = {
      eventId: this.generateEventId(),
      timestamp: this.extractTimestamp(json),
      agentId: this.teamContext.memberName,
      agentType: this.agentType,
      teamMetadata: { ...this.teamContext }
    };

    // Route to agent-specific converter
    switch (this.agentType) {
      case 'claude-code':
        return this.convertClaude(json, baseEvent);
      case 'openai-codex':
        return this.convertCodex(json, baseEvent);
      case 'google-gemini':
        return this.convertGemini(json, baseEvent);
    }
  }

  // ... converter implementations
}
```

### Team Metadata注入

每个事件都必须包含完整的team context，以便UI能够正确渲染（特别是themeColor）。

**数据来源**: Team config文件（例如 `phoenix-prd.json`）

```json
// .agent-chatter/team-config/phoenix-prd.json
{
  "team": {
    "name": "phoenix-prd-team",
    "displayName": "Project Phoenix - PRD & Market Strategy Team",
    "members": [
      {
        "name": "max",
        "displayName": "Max",
        "role": "tech-lead",
        "displayRole": "Tech Lead (Innovative)",
        "agentType": "claude",
        "themeColor": "cyan"  // ← UI渲染用
      }
    ]
  }
}
```

**注入点1**: ConversationCoordinator提取team context

```typescript
// src/services/ConversationCoordinator.ts

class ConversationCoordinator {
  private team: TeamConfig;
  private agentManager: AgentManager;
  private eventEmitter: EventEmitter;

  async sendToAgent(member: Member, prompt: string) {
    // ✅ 从已加载的team config中提取完整上下文
    const teamContext: TeamContext = {
      teamName: this.team.name,                    // "phoenix-prd-team"
      teamDisplayName: this.team.displayName,      // "Project Phoenix - ..."
      memberName: member.name,                     // "max"
      memberDisplayName: member.displayName,       // "Max"
      memberRole: member.role,                     // "tech-lead"
      memberDisplayRole: member.displayRole,       // "Tech Lead (Innovative)"
      themeColor: member.themeColor                // "cyan"
    };

    // 传递给 AgentManager（在 AgentManager.sendAndReceive 中使用）
    await this.agentManager.sendAndReceive(member.name, prompt, { teamContext });
  }
}
```

**注入点2**: AgentManager在创建EventConverter时注入

```typescript
// src/services/AgentManager.ts (sendAndReceive方法内部)

/**
 * 执行agent并通过事件流返回结果
 * @param teamContext - 必须由调用者传入（从team config提取），AgentManager不自行查找
 */
async sendAndReceive(
  roleId: string,
  message: string,
  options: SendOptions & { teamContext: TeamContext }  // teamContext改为必填
): Promise<ExecutionResult> {
  const agent = this.agents.get(roleId);
  if (!agent) {
    throw new Error(`Role ${roleId} has no running agent`);
  }

  const { teamContext } = options;
  if (!teamContext) {
    throw new Error('teamContext is required (caller must extract from team config)');
  }

  // ✅ 使用调用者传入的teamContext创建converter
  const converter = new EventConverter(teamContext, agent.adapter.agentType);

  // ... spawn process and parse events
}
```

**注入点3**: EventConverter将teamMetadata填充到每个事件

```typescript
// src/events/EventConverter.ts

export class EventConverter {
  constructor(
    private teamContext: TeamContext,  // ← 构造时注入
    private agentType: 'claude-code' | 'openai-codex' | 'google-gemini'
  ) {}

  private jsonToEvent(json: any): UnifiedEvent {
    // ✅ 为每个事件创建baseEvent，包含teamMetadata
    const baseEvent = {
      eventId: crypto.randomUUID(),
      timestamp: this.extractTimestamp(json),
      agentId: this.teamContext.memberName,    // "max"
      agentType: this.agentType,               // "claude-code"
      teamMetadata: {
        // ✅ 完整注入所有字段
        teamName: this.teamContext.teamName,
        teamDisplayName: this.teamContext.teamDisplayName,
        memberName: this.teamContext.memberName,
        memberDisplayName: this.teamContext.memberDisplayName,
        memberRole: this.teamContext.memberRole,
        memberDisplayRole: this.teamContext.memberDisplayRole,
        themeColor: this.teamContext.themeColor  // ← UI会用这个渲染颜色
      }
    };

    // 路由到具体agent converter
    switch (this.agentType) {
      case 'claude-code':
        return this.convertClaude(json, baseEvent);
      case 'openai-codex':
        return this.convertCodex(json, baseEvent);
      case 'google-gemini':
        return this.convertGemini(json, baseEvent);
    }
  }

  private convertCodex(json: any, baseEvent: any): UnifiedEvent {
    // baseEvent已包含完整的teamMetadata
    if (json.type === 'item.completed' && json.item.type === 'reasoning') {
      return {
        ...baseEvent,  // ✅ 展开包含teamMetadata
        type: 'text',
        content: json.item.text,
        category: 'reasoning',
        role: 'assistant'
      };
    }
    // ...
  }
}
```

**最终输出示例**（每个事件都包含完整team metadata）:

```json
{
  "type": "text",
  "eventId": "evt_a1b2c3d4",
  "timestamp": 1732345678901,
  "agentId": "max",
  "agentType": "claude-code",
  "teamMetadata": {
    "teamName": "phoenix-prd-team",
    "teamDisplayName": "Project Phoenix - PRD & Market Strategy Team",
    "memberName": "max",
    "memberDisplayName": "Max",
    "memberRole": "tech-lead",
    "memberDisplayRole": "Tech Lead (Innovative)",
    "themeColor": "cyan"
  },
  "content": "Let me analyze the requirements...",
  "role": "assistant",
  "category": "response"
}
```

**UI使用示例**:

```typescript
// src/ui/MessageDisplay.tsx

function MessageDisplay({ event }: { event: TextEvent }) {
  return (
    <Box>
      <Text color={event.teamMetadata.themeColor}>  {/* ← 使用themeColor */}
        [{event.teamMetadata.memberDisplayName}]    {/* ← 显示displayName */}
      </Text>
      <Text>{event.content}</Text>
    </Box>
  );
}
```

### Timestamp处理

不同Agent的时间戳处理策略：

```typescript
class EventConverter {
  private extractTimestamp(json: any): number {
    switch (this.agentType) {
      case 'google-gemini':
        // Gemini provides ISO 8601 timestamp
        if (json.timestamp) {
          return new Date(json.timestamp).getTime();
        }
        return Date.now();

      case 'claude-code':
      case 'openai-codex':
        // Claude and Codex don't provide timestamps
        // Use current time at parse moment
        return Date.now();

      default:
        return Date.now();
    }
  }
}
```

**注意事项**:
- Gemini的timestamp字段格式：`"2025-11-23T05:37:17.496Z"`（ISO 8601）
- Claude和Codex的JSONL中没有timestamp字段
- 使用`Date.now()`确保所有事件都有时间戳，便于UI排序和回放

### 工具名称规范化

统一不同Agent的工具名称，方便UI渲染和分析：

```typescript
class EventConverter {
  private normalizeToolName(rawToolName: string): string {
    const mapping: Record<string, string> = {
      // Bash variants
      'command_execution': 'Bash',
      'list_directory': 'Bash',
      'Bash': 'Bash',

      // Read variants
      'read_file': 'Read',
      'Read': 'Read',

      // Write variants
      'write_file': 'Write',
      'Write': 'Write',

      // Edit variants
      'edit_file': 'Edit',
      'Edit': 'Edit',

      // Glob variants
      'find_files': 'Glob',
      'Glob': 'Glob',

      // Grep variants
      'search_files': 'Grep',
      'Grep': 'Grep'
    };

    return mapping[rawToolName] || 'Other';
  }

  private convertCodexToolUse(json: any, baseEvent: any): ToolStartedEvent {
    return {
      ...baseEvent,
      type: 'tool.started',
      toolName: this.normalizeToolName(json.item.type), // 'command_execution' → 'Bash'
      rawToolName: json.item.type,                      // Preserve original for debugging
      toolId: json.item.id,
      input: {
        command: json.item.command || json.item.path || json.item.content
      }
    };
  }
}
```

### 数据保留原则（ETL Principle）

**关键决策**: 转换器不截断任何数据

```typescript
class EventConverter {
  private convertToolResult(json: any, baseEvent: any): ToolCompletedEvent {
    return {
      ...baseEvent,
      type: 'tool.completed',
      toolId: json.item.id,

      // ✅ Preserve complete output (no truncation)
      output: json.item.aggregated_output || json.content || '',

      // ✅ Preserve all metadata
      exitCode: json.item.exit_code ?? null,
      status: json.item.exit_code === 0 ? 'success' : 'error',
      error: json.item.error || null,

      // ✅ Preserve file changes metadata
      metadata: {
        filePath: json.item.path,
        changes: json.item.changes
      }
    };
  }
}
```

**为什么不截断**:
1. **ETL原则**: 转换器职责是转换格式，不是过滤数据
2. **下游自主**: UI可以截断显示，Logger可以压缩存储，Context可以摘要
3. **可追溯性**: 完整数据便于调试和审计
4. **灵活性**: 不同消费者有不同需求，不应在源头限制

### 错误处理

```typescript
class EventConverter {
  private createErrorEvent(message: string, originalLine?: string): ErrorEvent {
    return {
      type: 'error',
      eventId: this.generateEventId(),
      timestamp: Date.now(),
      agentId: this.teamContext.memberName,
      agentType: this.agentType,
      teamMetadata: { ...this.teamContext },
      error: message,
      code: 'JSONL_PARSE_ERROR',
      stack: originalLine ? `Original line: ${originalLine.substring(0, 200)}` : undefined
    };
  }
}
```

**容错策略**:
- 单行解析失败不中断流程
- 发出error事件通知下游
- 保留原始行片段用于调试
- 继续处理后续行

### Agent转换实现示例

#### Codex转换

**Codex JSONL事件映射表**:

| Codex事件类型 | item.type | 映射到统一事件 | 说明 |
|--------------|-----------|--------------|------|
| `thread.started` | N/A | `session.started` | 会话开始 |
| `turn.started` | N/A | (忽略) | 不映射，仅作日志 |
| `item.started` | `command_execution` | `tool.started` (toolName='Bash') | 命令执行开始 |
| `item.started` | `file_change` | `tool.started` (toolName='Write'/'Edit') | 文件操作开始 |
| `item.completed` | `reasoning` | `text` (category='reasoning') | 推理过程 |
| `item.completed` | `agent_message` | `text` (category='message') | Agent文本输出 |
| `item.completed` | `command_execution` | `tool.completed` (exitCode, output) | 命令执行完成 |
| `item.completed` | `file_change` | `tool.completed` (metadata.changes) | 文件操作完成 |
| `turn.completed` | N/A | `turn.completed` (usage, cost) | 轮次完成 |

**完整转换逻辑**:

```typescript
private convertCodex(json: any, baseEvent: any): UnifiedEvent {
  const { type } = json;

  // Thread started
  if (type === 'thread.started') {
    return {
      ...baseEvent,
      type: 'session.started',
      sessionId: json.thread_id,
      metadata: {
        model: json.model,
        cliVersion: json.cli_version
      }
    };
  }

  // Item started (tool use)
  if (type === 'item.started') {
    const itemType = json.item?.type;
    if (itemType === 'command_execution' || itemType === 'file_change') {
      return {
        ...baseEvent,
        type: 'tool.started',
        toolName: this.normalizeToolName(itemType),
        rawToolName: itemType,
        toolId: json.item.id,
        input: {
          command: json.item.command,
          path: json.item.path,
          content: json.item.content
        }
      };
    }
  }

  // Item completed
  if (type === 'item.completed') {
    const itemType = json.item?.type;

    // Reasoning
    if (itemType === 'reasoning') {
      return {
        ...baseEvent,
        type: 'text',
        content: json.item.text,
        category: 'reasoning',
        role: 'assistant'
      };
    }

    // Agent message
    if (itemType === 'agent_message') {
      return {
        ...baseEvent,
        type: 'text',
        content: json.item.text,
        category: 'message',
        role: 'assistant'
      };
    }

    // Tool result
    if (itemType === 'command_execution' || itemType === 'file_change') {
      return {
        ...baseEvent,
        type: 'tool.completed',
        toolId: json.item.id,
        output: json.item.aggregated_output || '',
        exitCode: json.item.exit_code ?? null,
        status: json.item.status === 'completed' ? 'success' : 'error',
        metadata: {
          changes: json.item.changes
        }
      };
    }
  }

  // Turn completed
  if (type === 'turn.completed') {
    return {
      ...baseEvent,
      type: 'turn.completed',
      finishReason: 'done',
      usage: json.usage
    };
  }

  // Unknown event type - emit as error
  return this.createErrorEvent(`Unknown Codex event type: ${type}`);
}
```

#### Claude转换

```typescript
private convertClaude(json: any, baseEvent: any): UnifiedEvent {
  const { type } = json;

  // System message (session start)
  if (type === 'system') {
    return {
      ...baseEvent,
      type: 'session.started',
      sessionId: json.uuid,
      metadata: {
        model: json.model,
        permissionMode: json.permission_mode
      }
    };
  }

  // Assistant message
  if (type === 'assistant') {
    const content = json.message?.content || [];

    // Claude may have multiple content items in one message
    // We emit one event per content item (preserving "碎嘴子" characteristic)
    for (const item of content) {
      if (item.type === 'text') {
        return {
          ...baseEvent,
          type: 'text',
          content: item.text,
          category: 'response',
          role: 'assistant'
        };
      }

      if (item.type === 'tool_use') {
        return {
          ...baseEvent,
          type: 'tool.started',
          toolName: this.normalizeToolName(item.name),
          rawToolName: item.name,
          toolId: item.id,
          input: item.input
        };
      }
    }
  }

  // User message (tool results)
  if (type === 'user') {
    const content = json.message?.content || [];

    for (const item of content) {
      if (item.type === 'tool_result') {
        return {
          ...baseEvent,
          type: 'tool.completed',
          toolId: item.tool_use_id,
          output: item.content || '',
          status: item.is_error ? 'error' : 'success',
          error: item.is_error ? item.content : null
        };
      }
    }
  }

  // Result (completion)
  if (type === 'result') {
    return {
      ...baseEvent,
      type: 'turn.completed',
      finishReason: json.is_error ? 'error' : 'done',
      usage: json.usage,
      cost: {
        totalUsd: json.total_cost_usd,
        currency: 'USD'
      },
      duration: {
        totalMs: json.duration_ms
      }
    };
  }

  return this.createErrorEvent(`Unknown Claude event type: ${type}`);
}
```

#### Gemini转换

```typescript
private convertGemini(json: any, baseEvent: any): UnifiedEvent {
  const { type } = json;

  // Init (session start)
  if (type === 'init') {
    return {
      ...baseEvent,
      type: 'session.started',
      metadata: {
        model: json.model
      }
    };
  }

  // Streaming message
  if (type === 'message') {
    return {
      ...baseEvent,
      type: 'text',
      content: json.content,
      role: json.role,
      delta: json.delta || false,  // Preserve streaming flag
      category: 'response'
    };
  }

  // Tool use
  if (type === 'tool_use') {
    return {
      ...baseEvent,
      type: 'tool.started',
      toolName: this.normalizeToolName(json.tool_name),
      rawToolName: json.tool_name,
      toolId: json.tool_id,
      input: json.parameters
    };
  }

  // Tool result
  if (type === 'tool_result') {
    return {
      ...baseEvent,
      type: 'tool.completed',
      toolId: json.tool_id,
      output: json.output || '',
      status: json.status || 'success'
    };
  }

  // Result (completion)
  if (type === 'result') {
    return {
      ...baseEvent,
      type: 'turn.completed',
      finishReason: json.status === 'success' ? 'done' : 'error',
      usage: {
        totalTokens: json.stats?.total_tokens
      },
      duration: {
        totalMs: json.stats?.duration_ms
      }
    };
  }

  return this.createErrorEvent(`Unknown Gemini event type: ${type}`);
}
```

### 集成到现有架构

修改`AgentManager.sendAndReceive()`以使用EventConverter，**废弃字符串返回模式**：

```typescript
// src/services/AgentManager.ts

interface ExecutionResult {
  success: boolean;
  finishReason?: 'done' | 'error' | 'cancelled' | 'timeout';
}

async sendAndReceive(
  roleId: string,
  message: string,
  options: SendOptions & { teamContext: TeamContext }  // ✅ teamContext必填
): Promise<ExecutionResult> {
  const agent = this.agents.get(roleId);
  if (!agent) {
    throw new Error(`Role ${roleId} has no running agent`);
  }

  // ✅ 从调用者传入的options中获取teamContext（不从AgentManager内部查找）
  const { teamContext } = options;
  if (!teamContext) {
    throw new Error('teamContext is required (caller must extract from team config)');
  }

  // Create event converter
  const converter = new EventConverter(teamContext, agent.adapter.agentType);

  // Spawn process (stateless mode)
  return new Promise<ExecutionResult>((resolve, reject) => {
    const childProcess = spawn(/* ... */);

    // ❌ 不再缓冲 stdout 字符串
    // let stdout = '';  // REMOVED

    let buffer = '';
    let hasCompleted = false;  // ✅ 防止双重完成

    // Setup timeout
    const timeout = options?.maxTimeout || 300000; // 5min default
    const timeoutHandle = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        childProcess.kill('SIGTERM');

        // ✅ 超时时发出 turn.completed(finishReason='timeout')，而非error事件
        this.eventEmitter.emit('agent-event', {
          type: 'turn.completed',
          eventId: crypto.randomUUID(),
          timestamp: Date.now(),
          agentId: roleId,
          agentType: agent.adapter.agentType,
          teamMetadata: teamContext,
          finishReason: 'timeout'
        });

        // ✅ 超时resolve，而非reject
        resolve({ success: false, finishReason: 'timeout' });
      }
    }, timeout);

    // Listen for completion events to resolve Promise
    const eventHandler = (event: UnifiedEvent) => {
      // Only handle events from this agent
      if (event.agentId !== roleId) return;

      if (event.type === 'turn.completed') {
        if (!hasCompleted) {  // ✅ 双重完成保护
          hasCompleted = true;
          clearTimeout(timeoutHandle);

          // ✅ 所有finishReason都resolve，只有进程crash才reject
          resolve({
            success: event.finishReason === 'done',
            finishReason: event.finishReason
          });
        }
      }
    };

    // Subscribe to events for completion detection
    this.eventEmitter.on('agent-event', eventHandler);

    // Setup cancellation handler (user presses ESC)
    const cancelHandler = () => {
      if (!hasCompleted) {  // ✅ 双重完成保护
        hasCompleted = true;
        clearTimeout(timeoutHandle);
        childProcess.kill('SIGTERM');

        // ✅ 取消时发出 turn.completed(finishReason='cancelled')
        this.eventEmitter.emit('agent-event', {
          type: 'turn.completed',
          eventId: crypto.randomUUID(),
          timestamp: Date.now(),
          agentId: roleId,
          agentType: agent.adapter.agentType,
          teamMetadata: teamContext,
          finishReason: 'cancelled'
        });

        // ✅ 取消resolve，而非reject
        resolve({ success: false, finishReason: 'cancelled' });
      }
    };
    this.eventEmitter.once('cancel-agent', cancelHandler);

    childProcess.stdout.on('data', (chunk: Buffer) => {
      // ❌ 不再累积到 stdout 变量
      // stdout += chunk.toString();  // REMOVED

      buffer += chunk.toString();

      // Extract complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      // Convert each line to unified event
      for (const line of lines) {
        if (!line.trim()) continue;

        const event = converter.convert(line);

        // ✅ 事件流是唯一的内容来源
        this.eventEmitter.emit('agent-event', event);
      }
    });

    childProcess.on('exit', (code, signal) => {
      // Flush remaining buffer
      if (buffer.trim()) {
        const event = converter.convert(buffer);
        this.eventEmitter.emit('agent-event', event);
      }

      // Cleanup
      this.eventEmitter.off('agent-event', eventHandler);
      this.eventEmitter.off('cancel-agent', cancelHandler);
      clearTimeout(timeoutHandle);

      // ✅ 只有在未收到completion时才视为进程异常（双重完成保护）
      if (!hasCompleted) {
        hasCompleted = true;

        this.eventEmitter.emit('agent-event', {
          type: 'error',
          eventId: crypto.randomUUID(),
          timestamp: Date.now(),
          agentId: roleId,
          agentType: agent.adapter.agentType,
          teamMetadata: teamContext,
          error: `Process exited with code ${code}, signal ${signal}`,
          code: 'PROCESS_EXIT'
        });

        // ✅ 只有进程异常才reject
        reject(new Error(`Process exited unexpectedly: code=${code}, signal=${signal}`));
      }
    });

    childProcess.on('error', (err) => {
      if (!hasCompleted) {  // ✅ 双重完成保护
        hasCompleted = true;
        clearTimeout(timeoutHandle);
        this.eventEmitter.off('agent-event', eventHandler);
        this.eventEmitter.off('cancel-agent', cancelHandler);

        this.eventEmitter.emit('agent-event', {
          type: 'error',
          eventId: crypto.randomUUID(),
          timestamp: Date.now(),
          agentId: roleId,
          agentType: agent.adapter.agentType,
          teamMetadata: teamContext,
          error: err.message,
          code: 'SPAWN_ERROR',
          stack: err.stack
        });

        // ✅ spawn错误reject
        reject(err);
      }
    });
  });
}
```

**调用者改造示例**（ConversationCoordinator）：

```typescript
// src/services/ConversationCoordinator.ts

class ConversationCoordinator {
  private eventEmitter: EventEmitter;
  private team: TeamConfig;  // 已加载的team config

  async sendToAgent(member: Member, prompt: string): Promise<void> {
    // ✅ 调用者负责从team config提取teamContext
    const teamContext: TeamContext = {
      teamName: this.team.name,
      teamDisplayName: this.team.displayName,
      memberName: member.name,
      memberDisplayName: member.displayName,
      memberRole: member.role,
      memberDisplayRole: member.displayRole,
      themeColor: member.themeColor
    };

    // Subscribe to events BEFORE calling sendAndReceive
    const eventHandler = (event: UnifiedEvent) => {
      if (event.agentId !== member.name) return;

      // Handle different event types
      switch (event.type) {
        case 'session.started':
          // UI: Show "Agent started"
          break;

        case 'text':
          // UI: Display text (with styling based on category)
          // Context: Accumulate for context window
          // Logger: Write to log file
          this.handleTextEvent(event);
          break;

        case 'tool.started':
          // UI: Show "Running Bash: pwd"
          this.handleToolStarted(event);
          break;

        case 'tool.completed':
          // UI: Show tool result
          // Context: Record tool I/O
          this.handleToolCompleted(event);
          break;

        case 'turn.completed':
          // UI: Show completion stats (tokens, cost, duration)
          this.handleTurnCompleted(event);
          break;

        case 'error':
          // UI: Show error message in red
          // Logger: Log error with stack
          this.handleError(event);
          break;
      }
    };

    this.eventEmitter.on('agent-event', eventHandler);

    try {
      // ✅ 传入teamContext（必填）
      const result = await this.agentManager.sendAndReceive(member.name, prompt, { teamContext });

      // ✅ 根据result.success判断成功/失败，而非依赖try/catch
      if (result.success) {
        console.log('Agent completed successfully');
      } else {
        console.warn(`Agent finished with reason: ${result.finishReason}`);
        // error/cancelled/timeout都会resolve，内容已通过事件消费
      }
    } catch (err) {
      // ❌ 只有进程crash/spawn失败才会走这里
      console.error('Process-level error:', err);
      // 错误事件已emit，UI已显示，这里仅做清理
    } finally {
      this.eventEmitter.off('agent-event', eventHandler);
    }
  }

  private handleTextEvent(event: TextEvent) {
    // UI rendering
    this.ui.appendText(event.content, {
      color: event.teamMetadata.themeColor,
      style: event.category === 'reasoning' ? 'italic' : 'normal'
    });

    // Context building
    this.contextBuilder.addText(event.agentId, event.content);

    // Logging
    this.logger.log('text', event);
  }

  // ... other handlers
}
```

### 测试策略

```typescript
// tests/EventConverter.test.ts

describe('EventConverter', () => {
  const teamContext: TeamContext = {
    teamName: 'test-team',
    teamDisplayName: 'Test Team',
    memberName: 'alice',
    memberDisplayName: 'Alice',
    memberRole: 'developer',
    memberDisplayRole: 'Senior Developer',
    themeColor: 'blue'
  };

  describe('Codex conversion', () => {
    const converter = new EventConverter(teamContext, 'openai-codex');

    it('should convert thread.started to session.started', () => {
      const input = '{"type":"thread.started","thread_id":"123"}';
      const event = converter.convert(input);

      expect(event.type).toBe('session.started');
      expect(event.sessionId).toBe('123');
      expect(event.teamMetadata.memberName).toBe('alice');
      expect(event.teamMetadata.themeColor).toBe('blue');
    });

    it('should preserve complete output without truncation', () => {
      const largeOutput = 'x'.repeat(100000); // 100KB
      const input = JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'command_execution',
          aggregated_output: largeOutput,
          exit_code: 0,
          status: 'completed'
        }
      });

      const event = converter.convert(input) as ToolCompletedEvent;

      expect(event.output.length).toBe(100000); // Not truncated
      expect(event.output).toBe(largeOutput);
    });

    it('should inject team metadata into every event', () => {
      const input = '{"type":"turn.completed","usage":{}}';
      const event = converter.convert(input);

      expect(event.teamMetadata).toEqual(teamContext);
    });

    it('should emit error event for invalid JSON', () => {
      const input = '{invalid json}';
      const event = converter.convert(input);

      expect(event.type).toBe('error');
      expect(event.error).toContain('Failed to parse JSONL');
      expect(event.code).toBe('JSONL_PARSE_ERROR');
    });
  });

  describe('Timestamp handling', () => {
    it('should parse ISO 8601 timestamp from Gemini', () => {
      const converter = new EventConverter(teamContext, 'google-gemini');
      const input = '{"type":"message","timestamp":"2025-11-23T05:37:17.496Z","content":"Hello"}';
      const event = converter.convert(input);

      expect(event.timestamp).toBe(new Date('2025-11-23T05:37:17.496Z').getTime());
    });

    it('should generate timestamp for Claude (no timestamp in source)', () => {
      const converter = new EventConverter(teamContext, 'claude-code');
      const before = Date.now();
      const input = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}';
      const event = converter.convert(input);
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Tool name normalization', () => {
    const converter = new EventConverter(teamContext, 'openai-codex');

    it('should normalize command_execution to Bash', () => {
      const input = '{"type":"item.started","item":{"id":"1","type":"command_execution","command":"pwd"}}';
      const event = converter.convert(input) as ToolStartedEvent;

      expect(event.toolName).toBe('Bash');
      expect(event.rawToolName).toBe('command_execution');
    });

    it('should preserve unknown tool names as Other', () => {
      const input = '{"type":"item.started","item":{"id":"1","type":"custom_tool","data":{}}}';
      const event = converter.convert(input) as ToolStartedEvent;

      expect(event.toolName).toBe('Other');
      expect(event.rawToolName).toBe('custom_tool');
    });
  });
});
```

## 中风险问题解决方案

### 1. UI事件窗口与性能

**问题**: 长时间运行的agent可能产生大量事件，UI需要限制显示数量

**解决方案**:

```typescript
// src/ui/StreamingDisplay.tsx

interface StreamingDisplayProps {
  agentId: string;
  maxEvents?: number;  // Default: 100
  throttleMs?: number;  // Default: 16 (60fps)
}

class StreamingDisplay extends React.Component {
  private events: UnifiedEvent[] = [];
  private throttleTimer?: NodeJS.Timeout;
  private pendingEvents: UnifiedEvent[] = [];

  componentDidMount() {
    this.eventEmitter.on('agent-event', this.handleEvent);
  }

  handleEvent = (event: UnifiedEvent) => {
    if (event.agentId !== this.props.agentId) return;

    // Throttle: batch events for rendering
    this.pendingEvents.push(event);

    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.flushEvents();
        this.throttleTimer = undefined;
      }, this.props.throttleMs || 16);
    }
  };

  flushEvents() {
    // Apply sliding window
    const maxEvents = this.props.maxEvents || 100;
    this.events.push(...this.pendingEvents);
    this.pendingEvents = [];

    if (this.events.length > maxEvents) {
      // Keep most recent events
      this.events = this.events.slice(-maxEvents);
    }

    this.forceUpdate();
  }
}
```

**默认配置**:
- 最大事件数：100（保留最近100个事件）
- 节流间隔：16ms（60fps）
- 内存估算：100事件 × 2KB/事件 ≈ 200KB（可接受）

### 2. 并发隔离（多Agent并行）

**问题**: 多个agent同时运行时，需要确保事件不串台

**解决方案**:

```typescript
// 每个订阅者都必须过滤 agentId
class ConversationCoordinator {
  async sendToAgent(member: Member, prompt: string): Promise<void> {
    const eventHandler = (event: UnifiedEvent) => {
      // ✅ 关键：按 agentId 过滤
      if (event.agentId !== member.name) return;

      // Handle event...
    };

    this.eventEmitter.on('agent-event', eventHandler);

    try {
      await this.agentManager.sendAndReceive(member.name, prompt);
    } finally {
      // ✅ 关键：清理订阅，避免泄漏
      this.eventEmitter.off('agent-event', eventHandler);
    }
  }
}
```

**并发场景示例**:
```
时间线:
  T0: Agent A (alice) 启动
  T1: Agent B (bob) 启动（与A并行）
  T2: Agent A 发出 text 事件 (agentId='alice')
  T3: Agent B 发出 text 事件 (agentId='bob')
  T4: Agent A 完成
  T5: Agent B 完成

事件流（全局 EventEmitter）:
  { agentId: 'alice', type: 'session.started' }  // T0
  { agentId: 'bob', type: 'session.started' }    // T1
  { agentId: 'alice', type: 'text', content: 'A的文本' }  // T2
  { agentId: 'bob', type: 'text', content: 'B的文本' }    // T3
  { agentId: 'alice', type: 'turn.completed' }   // T4
  { agentId: 'bob', type: 'turn.completed' }     // T5

订阅者隔离:
  Alice's handler → 只收到 agentId='alice' 的事件
  Bob's handler → 只收到 agentId='bob' 的事件
  UI (全局) → 收到所有事件，按 agentId 分组显示
```

**强制规范**: 所有订阅者必须过滤 `event.agentId`，否则会收到其他agent的事件

### 3. 错误/异常事件处理

**问题**: 解析失败、stderr输出、进程异常的处理策略

**解决方案**:

```typescript
// 1. JSONL解析失败 → 发出error事件，继续处理后续行
class EventConverter {
  convert(line: string): UnifiedEvent {
    try {
      const json = JSON.parse(line);
      return this.jsonToEvent(json);
    } catch (err) {
      // ✅ 发出error事件，不中断
      return {
        type: 'error',
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
        agentId: this.teamContext.memberName,
        agentType: this.agentType,
        teamMetadata: this.teamContext,
        error: `Failed to parse JSONL: ${err.message}`,
        code: 'JSONL_PARSE_ERROR',
        stack: `Original line: ${line.substring(0, 200)}`
      };
    }
  }
}

// 2. stderr输出 → 转为error事件（可配置）
childProcess.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString();

  // 过滤DEBUG日志（不转为error事件）
  if (text.includes('[DEBUG]') || text.includes('[INFO]')) {
    // 仅记录到日志文件，不发事件
    this.logger.debug(text);
    return;
  }

  // 真正的错误输出 → error事件
  this.eventEmitter.emit('agent-event', {
    type: 'error',
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    agentId: roleId,
    agentType: agent.adapter.agentType,
    teamMetadata: teamContext,
    error: `stderr: ${text}`,
    code: 'STDERR_OUTPUT'
  });
});

// 3. 进程异常退出 → error事件 + reject Promise
childProcess.on('exit', (code, signal) => {
  if (code !== 0 && code !== null) {
    this.eventEmitter.emit('agent-event', {
      type: 'error',
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      agentId: roleId,
      agentType: agent.adapter.agentType,
      teamMetadata: teamContext,
      error: `Process exited with code ${code}`,
      code: 'PROCESS_EXIT',
      metadata: { exitCode: code, signal }
    });

    reject(new Error(`Process exited with code ${code}`));
  }
});
```

**错误事件策略**:
- 单行解析失败：发error事件，继续处理（容错）
- stderr非DEBUG输出：发error事件，继续运行
- 进程异常退出：发error事件，reject Promise（终止）

### 4. DEBUG日志与事件流共存

**问题**: 现有DEBUG模式打印到stderr，可能与事件流冲突

**解决方案**:

```typescript
// 环境变量控制DEBUG行为
const DEBUG_MODE = process.env.DEBUG === 'true';
const DEBUG_TO_EVENTS = process.env.DEBUG_TO_EVENTS === 'true';

childProcess.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString();

  if (DEBUG_MODE) {
    // DEBUG模式：打印到console.error（兼容现有行为）
    console.error(`[Agent:${roleId}] ${text}`);
  }

  if (DEBUG_TO_EVENTS) {
    // 可选：将DEBUG日志也转为事件（用于UI显示）
    this.eventEmitter.emit('agent-event', {
      type: 'text',
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      agentId: roleId,
      agentType: agent.adapter.agentType,
      teamMetadata: teamContext,
      content: `[DEBUG] ${text}`,
      role: 'system',
      category: 'message'
    });
  }
});
```

**配置策略**:
- `DEBUG=true` → stderr打印到console（现有行为）
- `DEBUG_TO_EVENTS=true` → stderr转为text事件（UI可见）
- **默认值**: `DEBUG=false`, `DEBUG_TO_EVENTS=false`（stderr仅记录到日志文件，不影响UI）
- **优先级**: Logger (日志文件) > Events (UI可见) > Console (stderr打印)
  - Logger: 总是记录所有stderr输出
  - Events: 仅当 `DEBUG_TO_EVENTS=true` 时转为事件供UI显示
  - Console: 仅当 `DEBUG=true` 时打印到console.error

**UI过滤**:
```typescript
// UI可以选择是否显示DEBUG事件
<StreamingDisplay
  agentId="alice"
  showDebug={false}  // 默认隐藏DEBUG
  filter={(event) => {
    if (!this.props.showDebug && event.content?.startsWith('[DEBUG]')) {
      return false;
    }
    return true;
  }}
/>
```

## 开放问题

### Q1: 是否需要事件持久化（回放功能）？

**当前决定**: Phase 3 实现 EventLogger 写入日志文件，暂不做结构化存储
**理由**: 优先满足实时展示需求，持久化可后续迭代

### Q2: 是否支持事件过滤和搜索？

**当前决定**: Phase 2 实现基础过滤（按 agentId），搜索留待未来
**理由**: 避免过度设计，先验证核心价值

### Q3: 如何处理超大输出（如 Read 返回 10MB 文件）？

**当前决定**: 转换器不截断output，完整保留所有数据
**理由**: 遵循ETL原则，转换器不代替消费者决定该保留什么数据。UI层自行决定展示策略（如截断、折叠、分页），Logger层决定存储策略，Context层决定上下文窗口策略

## 兼容性与迁移计划

### 破坏性变更清单

**API签名变更**:
```typescript
// Before
class AgentManager {
  async sendAndReceive(roleId: string, message: string): Promise<string>
}

// After
class AgentManager {
  async sendAndReceive(
    roleId: string,
    message: string,
    options: SendOptions & { teamContext: TeamContext }  // ✅ teamContext必填
  ): Promise<ExecutionResult>  // {success: boolean, finishReason?: string}
}
```

### 需要修改的模块

| 模块 | 文件路径 | 修改内容 | 优先级 | 预计工时 |
|------|---------|---------|-------|---------|
| **AgentManager** | `src/services/AgentManager.ts` | 修改`sendAndReceive()`移除字符串缓冲，基于事件resolve/reject | P0 | 1天 |
| **EventConverter** | `src/events/EventConverter.ts` | 新增转换器类，实现Claude/Codex/Gemini解析逻辑 | P0 | 1.5天 |
| **ConversationCoordinator** | `src/services/ConversationCoordinator.ts` | 订阅事件，提取teamContext并传递给AgentManager | P0 | 1天 |
| **REPL UI** | `src/ui/ReplModeInk.tsx` | 订阅事件流，实时渲染文本/工具调用 | P1 | 1.5天 |
| **Context Builder** | `src/services/ContextBuilder.ts` | 订阅text事件构建上下文窗口 | P1 | 0.5天 |
| **Logger** | `src/infrastructure/Logger.ts` | 订阅所有事件写入日志文件 | P2 | 0.5天 |

**总计工时**: 6天（P0必须完成，P1推荐完成，P2可后续迭代）

### 迁移步骤

**Phase 1: 核心重构** (P0, 必须完成, 3天)

1. **Day 1**: 实现EventConverter
   - 创建`src/events/EventConverter.ts`
   - 实现Claude/Codex/Gemini三种解析器
   - 单元测试（>90%覆盖率）
   - ✅ 验证：所有解析器单测通过

2. **Day 2**: 修改AgentManager
   - 移除`let stdout = ''`缓冲逻辑
   - 添加事件监听`turn.completed`/`error`
   - 修改Promise返回类型为`ExecutionResult`
   - 添加超时/取消/异常处理
   - ✅ 验证：集成测试通过（启动agent，收到completion事件）

3. **Day 3**: 修改ConversationCoordinator
   - 订阅`agent-event`
   - 实现`handleTextEvent`/`handleToolStarted`/`handleToolCompleted`等
   - 提取teamContext并传递给AgentManager
   - ✅ 验证：端到端测试通过（启动对话，事件正确流转）

**Phase 2: UI集成** (P1, 推荐完成, 2天)

4. **Day 4**: REPL UI改造
   - 订阅事件流，按agentId过滤
   - 实现滑动窗口（maxEvents=100）
   - 实现节流（16ms）
   - 不同事件类型差异化渲染（thinking用斜体，themeColor着色）
   - ✅ 验证：用户能实时看到agent工作进度

5. **Day 5**: Context Builder订阅事件
   - 监听text事件累积上下文
   - 监听tool事件记录I/O
   - ✅ 验证：上下文窗口正确构建

**Phase 3: 日志与优化** (P2, 可后续迭代, 1天)

6. **Day 6**: Logger持久化
   - 订阅所有事件写入JSONL文件
   - 实现事件回放功能（可选）
   - ✅ 验证：日志文件格式正确，可用于调试

### 过渡策略

**问题**: 是否需要提供临时兼容层？

**决定**: **不提供过渡API**，理由：
1. 项目处于早期阶段，调用者数量有限（仅Coordinator和REPL）
2. 临时兼容层会混淆架构，增加技术债务
3. 一次性切换更彻底，避免遗留问题

**替代方案**（如确需过渡）:
```typescript
// 仅用于紧急情况，不推荐
class AgentManager {
  // 新API（推荐）
  async sendAndReceive(...): Promise<ExecutionResult>

  // 临时兼容API（标记为deprecated）
  @deprecated('Use sendAndReceive with event subscription instead')
  async sendAndReceiveLegacy(roleId: string, message: string): Promise<string> {
    const events: string[] = [];
    const handler = (event: UnifiedEvent) => {
      if (event.type === 'text') events.push(event.content);
    };
    this.eventEmitter.on('agent-event', handler);

    try {
      await this.sendAndReceive(roleId, message);
      return events.join('\n');
    } finally {
      this.eventEmitter.off('agent-event', handler);
    }
  }
}
```

**强烈建议**: 直接迁移到新API，不使用临时兼容层

### 测试策略

**单元测试**:
- EventConverter: 测试每种Agent类型的转换逻辑
- 覆盖率目标: >90%
- 测试用例数: ~30个（每种Agent 10个）

**集成测试**:
- AgentManager + EventConverter: 端到端测试事件流
- 测试用例: 正常流程、错误流程、取消流程、超时流程
- 测试用例数: 12个（3种Agent × 4种场景）

**E2E测试**:
- Coordinator + AgentManager + REPL: 完整对话流程
- 验证UI实时更新、并发隔离、事件过滤
- 测试用例数: 6个（单agent、多agent并行、取消、错误）

**总测试用例数**: ~50个（新增）

### 回滚计划

**风险**: Phase 1重构失败需要回滚

**回滚步骤**:
1. 恢复AgentManager.sendAndReceive原始签名
2. 删除EventConverter相关代码
3. 恢复字符串缓冲逻辑
4. 回滚Coordinator订阅事件部分

**回滚成本**: < 1天（建议在feature分支完成，合并前充分测试）

**降低风险措施**:
- 在feature分支开发
- 每日集成测试
- Code Review每个PR
- Phase 1完成后进行充分测试再开始Phase 2

## 总结

### 核心架构决策

本提案基于架构委员会评审反馈，做出以下关键决策：

1. **彻底废弃双轨模式**: 不再"事件流+字符串返回"并行，改为纯事件流驱动
2. **Promise仅做生命周期信号**: `sendAndReceive()` 返回 `{success: boolean}`，内容通过事件获取
3. **统一消费者接口**: UI/Context/Logger都订阅同一事件总线
4. **事件为唯一事实源**: 避免状态不一致和双重终止

### 阻塞问题解决

| 问题 | 解决方案 | 章节引用 |
|------|---------|---------|
| 事件流与Promise冲突 | Promise只在收到`turn.completed`/`error`事件时resolve/reject，不返回内容 | "关键架构决策" |
| 解析器与调用链未对齐 | 废弃字符串缓冲，`sendAndReceive()`内部基于事件检测completion | "集成到现有架构" |
| teamMetadata未落地 | 在`ConversationCoordinator`创建`EventConverter`时注入完整team context | "Team Metadata注入" |
| 完成/错误检测 | 监听`turn.completed`和`error`事件，明确定义Promise resolve/reject规则 | "关键架构决策" |

### 中风险问题解决

| 问题 | 解决方案 | 章节引用 |
|------|---------|---------|
| UI事件窗口与性能 | 滑动窗口（默认100事件）+ 节流（16ms/60fps） | "中风险问题解决方案 §1" |
| 并发隔离 | 强制要求所有订阅者过滤`event.agentId`，示例展示并发场景 | "中风险问题解决方案 §2" |
| 错误/异常事件 | 解析失败继续处理，stderr过滤DEBUG，进程异常reject Promise | "中风险问题解决方案 §3" |
| DEBUG/log兼容 | 环境变量控制（`DEBUG=true`打印，`DEBUG_TO_EVENTS=true`转事件） | "中风险问题解决方案 §4" |

### 不兼容变更

⚠️ **破坏性变更**（Phase 1即生效）：

1. `AgentManager.sendAndReceive()` 签名变更：
   ```typescript
   // Old
   async sendAndReceive(roleId, message): Promise<string>

   // New
   async sendAndReceive(roleId, message): Promise<ExecutionResult>
   ```

2. 调用者必须改为订阅事件：
   ```typescript
   // Old
   const response = await agentManager.sendAndReceive('alice', prompt);
   console.log(response);  // 完整字符串

   // New
   eventEmitter.on('agent-event', handleEvent);
   await agentManager.sendAndReceive('alice', prompt);
   // 内容已通过事件消费完毕
   ```

3. `ProcessManager` 标记为 `@deprecated`，stateless路径不再使用

### 迁移计划

**Phase 1** (不兼容，必须迁移):
- ✅ 实现EventConverter和事件流
- ✅ 修改AgentManager.sendAndReceive()移除字符串缓冲
- ✅ 修改ConversationCoordinator订阅事件
- ⚠️ **所有现有调用者必须改造**

**Phase 2** (向后兼容):
- 添加Gemini/Codex解析器
- UI订阅事件并实时渲染
- 滑动窗口和节流

**Phase 3** (向后兼容):
- EventLogger持久化
- Context构建器订阅事件

### 实施建议

本提案解决了架构委员会提出的所有阻塞和中风险问题，通过彻底废弃双轨模式，实现了：

- **架构收敛**: 事件流是唯一的内容分发通道
- **关注点分离**: 解析层（EventConverter）与展示层（UI/Context/Logger）独立
- **可扩展性**: 新增消费者只需订阅事件总线
- **可测试性**: EventConverter可独立单测，事件流可录制/回放

**推荐立即开始 Phase 1 实施**，但需注意：
- 这是一次破坏性重构，需要修改所有调用链
- 预计改造工作量：6天（P0核心3天 + P1 UI集成2天 + P2日志1天）
- 建议在feature分支完成，通过集成测试验证后合并
- 详细迁移计划见"兼容性与迁移计划"章节

**成功指标**:
- ✅ 用户能实时看到agent工作进度（100% 覆盖）
- ✅ 无"双重终止"或状态不一致问题
- ✅ 并发多agent时事件正确隔离
- ✅ 所有测试通过（单测+集成测试）
