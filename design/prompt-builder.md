# Prompt Builder 设计提案（多 Agent 提示词组装层）

**目标**  
将“提示词拼装”从协调器/适配器中解耦，按 Agent 类型封装最佳实践，保证：
- 系统指令必达（配置 + 指令文件合并，缺一补一）
- 上下文结构清晰（系统/任务/上下文/当前消息 分段）
- Agent 特定注入方式可独立演进（Claude system flag vs Codex/Gemini 内联）
- 调试可观测（DEBUG 下输出最终发送内容）

## 背景问题
- 现状：`systemInstruction` 被指令文件覆盖，读取失败时变空，导致发给 Agent 只有 `[MESSAGE]`。
- Claude/Codex/Gemini 都只接受字符串 Prompt，但 Claude 有专用 system flag；缺少统一的拼装策略。
- 无差别上下文导致串台，需按收件人筛选/标注。

## 设计概览

新增组件：`PromptBuilder`

```ts
interface PromptInput {
  agentType: 'claude-code' | 'openai-codex' | 'google-gemini' | string;
  systemInstructionText?: string;      // 配置字段
  instructionFileText?: string;        // 指令文件内容
  contextMessages: Array<{
    from: string;
    to?: string;
    content: string;
    timestamp?: Date;
  }>;
  message: string;                     // 当前要发送的消息
}

interface PromptOutput {
  prompt: string;                      // 最终发给 CLI 的大字符串
  systemFlag?: string;                 // 仅 Claude 用，传给 --append-system-prompt
}

function buildPrompt(input: PromptInput): PromptOutput;
```

### 通用拼装模板（按优先级）
1. `[SYSTEM]`  
   - `systemInstructionText` + `instructionFileText` 合并；缺一补一。  
   - 可选加“短角色摘要”防截断。
2. `[CONTEXT]` 最近 N 条消息（默认 5），格式 `FROM -> TO: content`。
3. `[MESSAGE]` 当前输入。

### Agent 特定策略
- **Claude Code**：  
  - 推荐 `systemFlag = [SYSTEM]...` 传 `--append-system-prompt`，`prompt = [CONTEXT][MESSAGE]` 传 `-p`。Stateless 分支需显式支持该 flag；若无法支持可退回全内联。
- **Codex**：  
  - 全部内联成一个字符串 `prompt = [SYSTEM][CONTEXT][MESSAGE]`。  
  - `--json` 只影响输出。
- **Gemini**：  
  - 同 Codex，内联字符串；CLI 会转为 parts。

## 集成改动
- `ConversationStarter`：构造成员时不再用指令文件覆盖配置字段；传递两者文本给 PromptBuilder。
- `ConversationCoordinator.sendToAgent`：收集材料 → 调 `buildPrompt` → 将 `prompt` / `systemFlag` 传给 AgentManager/Adapter。
- Adapter：仅关注 CLI 参数；Claude Adapter 接受 `systemFlag` 并注入 `--append-system-prompt`。已采纳方案 A：由 PromptBuilder 产出最终字符串/flag，适配器不再承担 `prepareMessage` 类逻辑，职责单一。

## 调试与可观测
- DEBUG=1 时输出：  
  - `[Debug][Send]`：最终 prompt（及 systemFlag 如有）。  
  - 现有 JSONL / 路由日志保留，用于对照。

## 兼容性与渐进
- 默认行为对用户透明（只是确保 system 段必达、结构更清晰）。  
- 分步落地：先引入 PromptBuilder + 合并 system 段；再优化上下文过滤（按收件人）。

## 统一长度限制与截断策略
- 统一硬上限（适用于三种 Agent）：最终发送的字符串总长 < **768 KB**（UTF-8 字节），低于 macOS `ARG_MAX` 1 MB，避免“上一轮正常、下一轮爆掉”的不一致体验。
- 优先级分段截断（在 PromptBuilder 内执行）：
  1. `[SYSTEM]`：必保留；如过长，先摘要/截断指令文件部分，保住配置字段和关键规则。
  2. `[CONTEXT]`：如超预算，按时间顺序整条消息从最旧开始删除，直到满足长度（无需更细粒度）。
  3. `[MESSAGE]`：当前输入。
- 流程：拼装 → 计算 UTF-8 长度 → 若超 768 KB，按优先级裁剪；无法满足最小必要段时返回错误/提示（而非静默截断）。
- 调试：DEBUG 模式下输出裁剪决策（如 `[SYSTEM] 摘要至 2 KB；CONTEXT 裁剪至 3 条`），便于诊断。

## 待定点
- 短角色摘要的长度/格式（避免超长 system）。  
- SYSTEM 段摘要算法：可先采用简单截断（保头尾、标记已截断），后续可引入模型摘要。  
- 截断策略：如需控制 token，可按段落优先级截断（当前仅长度裁剪）。
