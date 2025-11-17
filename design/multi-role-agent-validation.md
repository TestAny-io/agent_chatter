# 多角色Agent验证实验方案

## 实验目标

验证一个AI agent（如Claude Code）能否在同一团队对话中扮演多个不同角色，以及是否会出现上下文混淆或"人格分裂"。

## 研究背景

### 关键假设
1. **假设1**：同一agent可以作为同一role的不同team member被多次assign
2. **假设2**：同一agent可以作为不同role的不同team member被多次assign

### 技术问题
1. **角色切换能力**：通过传入不同的system instruction，能否让同一agent"变成另外一个人"？
2. **上下文隔离**：每次调用时是否需要启动独立进程？
3. **上下文污染**：由于agent有上下文记忆，会不会导致角色混淆？

### 文献研究总结

**Claude Code官方机制**：
- 每个subagent有独立的context window和工具权限
- `/clear`清除对话历史但保留项目指令
- 重启进程才完全重置上下文
- `--append-system-prompt`可能有实现bug（作为user message而非真正append）

**业界最佳实践**：
- Thread-based隔离：每个对话session有独立的thread ID
- 独立进程：每个agent运行在独立的进程中
- 中央协调器：控制哪个agent何时行动

**潜在风险**：
- 上下文累积导致角色混淆
- System prompt无法完全覆盖对话历史
- 同一会话中，新agent会获得完整的历史上下文

---

## 实验方案

### 实验1：同一进程，同一角色，多次调用

**目标**：验证同一个Claude Code进程能否稳定扮演同一角色

**设置**：
- 启动1个Claude Code进程
- Role: "Code Reviewer"
- System instruction: "You are a strict code reviewer focusing on security."
- 连续3轮对话

**测试步骤**：
```bash
# 启动Claude Code
claude --append-system-prompt "You are a strict code reviewer focusing on security. Always end with [DONE]"

# Round 1: 发送代码片段1
User: "Review this code: function login(user, pass) { return user + pass; }"
Expected: 安全审查视角的回复

# Round 2: 发送代码片段2
User: "Review this code: const api = fetch(url + input);"
Expected: 继续保持安全审查视角

# Round 3: 测试角色一致性
User: "What is your role?"
Expected: 应该回答是code reviewer focusing on security
```

**成功标准**：
- ✅ 所有回复都保持严格的安全审查视角
- ✅ 第3轮能正确描述自己的角色
- ❌ 如果出现偏离安全视角的回复，则失败

**预期结果**：应该成功，因为是同一角色

---

### 实验2：同一进程，不同角色，顺序切换

**目标**：验证同一进程能否通过system prompt切换角色

**设置**：
- 启动1个Claude Code进程
- Round 1-2: Role A "Security Reviewer"
- Round 3-4: 尝试切换到Role B "Performance Optimizer"

**测试步骤**：
```bash
# 启动Claude Code with Role A
claude --append-system-prompt "You are a security reviewer. Focus on vulnerabilities. End with [DONE]"

# Round 1-2: Security Reviewer
User: "Review: const query = 'SELECT * FROM users WHERE id=' + userId"
Expected: 指出SQL injection风险

User: "Review: localStorage.setItem('token', userToken)"
Expected: 指出token存储安全问题

# 现在尝试切换角色（重新启动with new system prompt）
# 问题：如果不重启进程，无法改变system prompt！

# 测试A：不重启，直接在user message中改变指令
User: "From now on, you are a performance optimizer. Review: for(let i=0; i<arr.length; i++)"
Expected: ？会继续安全视角？还是转换为性能视角？

# 测试B：重启进程，使用新的system prompt
# 重启
claude --append-system-prompt "You are a performance optimizer. Focus on efficiency. End with [DONE]"

User: "Review: for(let i=0; i<arr.length; i++)"
Expected: 应该指出性能优化建议
```

**成功标准（测试A - 不重启）**：
- ❌ 预期失败：agent会混淆角色或保持原角色
- 如果成功切换角色，说明user message能覆盖system prompt（不太可能）

**成功标准（测试B - 重启）**：
- ✅ 应该成功切换到新角色
- ✅ 完全忘记之前作为security reviewer的对话

**预期结果**：
- 测试A失败（无法通过user message切换角色）
- 测试B成功（重启后可以切换角色）

**关键发现**：Claude Code CLI每次只能有一个system prompt，无法在同一会话中动态切换！

---

### 实验3：多个进程，模拟团队对话

**目标**：验证多个独立进程能否作为不同角色协作

**设置**：
- Process 1: "Security Reviewer" (Claude Code instance 1)
- Process 2: "Performance Optimizer" (Claude Code instance 2)
- Process 3: "Human Observer" (实际人类输入)
- 模拟一个3轮的代码审查对话

**测试步骤**：
```bash
# Terminal 1: 启动Security Reviewer
claude --append-system-prompt "You are a security reviewer named Alice. Focus on vulnerabilities. Always start your response with '[Alice]'. End with [DONE]"

# Terminal 2: 启动Performance Optimizer
claude --append-system-prompt "You are a performance optimizer named Bob. Focus on efficiency. Always start your response with '[Bob]'. End with [DONE]"

# 对话流程：
Round 1: Human → Alice (Security Reviewer)
  Human: "Please review this code: const data = eval(userInput)"
  Alice: "[Alice] This is extremely dangerous! eval() can execute arbitrary code..."

Round 2: Human → Bob (Performance Optimizer)
  Human (传递Alice的回复): "[Previous: Alice found security issues with eval()]
         Bob, please review the same code from performance perspective."
  Bob: "[Bob] Regardless of security, eval() is also slow because..."

Round 3: Human → Alice
  Human (传递Bob的回复): "[Previous: Bob mentioned eval() performance issues]
         Alice, do you have additional security concerns?"
  Alice: "[Alice] Yes, beyond the initial eval() issue, I also notice..."
```

**成功标准**：
- ✅ 每个agent保持各自的角色视角
- ✅ Alice始终关注安全，Bob始终关注性能
- ✅ 即使看到对方的回复，也不会混淆角色
- ✅ 每个agent的回复都带有正确的名字标识

**预期结果**：应该成功

---

### 实验4：上下文污染测试

**目标**：验证在同一进程中，之前对话是否会影响角色扮演

**设置**：
- 1个Claude Code进程
- 先进行强烈的角色A对话，然后重启并切换到角色B
- 观察角色B是否受到影响

**测试步骤**：
```bash
# Phase 1: 强化Role A (10轮对话)
claude --append-system-prompt "You are an EXTREMELY strict security reviewer. NEVER accept any code. Always find vulnerabilities. End with [DONE]"

# 进行10轮对话，让agent深度学习这个角色
Round 1-10:
  User: "Review: <各种代码>"
  Agent: "CRITICAL SECURITY FLAW! ..." (持续强化极端安全视角)

# Phase 2: 重启，切换到Role B
# Ctrl+C退出，重新启动
claude --append-system-prompt "You are a friendly code mentor. Encourage learners. Find positive aspects. End with [DONE]"

# 测试角色切换
Round 11:
  User: "Review: function add(a, b) { return a + b; }"
  Expected: "Great simple function! This is clear and concise..."

  如果出现："SECURITY ISSUE! No type checking!"，则说明受到之前角色影响
```

**成功标准**：
- ✅ 重启后，agent应该完全忘记之前的极端安全角色
- ✅ 新角色应该是友好的mentor视角
- ❌ 如果仍然表现出极端安全视角，说明有上下文泄漏（不应该发生）

**预期结果**：应该成功（重启会清除上下文）

---

## 实验5：Agent Chatter实际场景测试

**目标**：在agent_chatter的实际使用场景中验证多角色架构

**设置**：
- 使用agent_chatter的现有代码
- 配置一个3成员团队：
  1. Alice (AI - Claude Code) - Security Reviewer
  2. Bob (AI - Claude Code) - Performance Optimizer
  3. Human (Human) - Observer

**配置文件**：
```json
{
  "agents": [
    {
      "name": "security-claude",
      "command": "claude",
      "args": ["--append-system-prompt", "You are Alice, a security reviewer. Focus on vulnerabilities. Always identify yourself as Alice."],
      "endMarker": "[DONE]",
      "usePty": false
    },
    {
      "name": "performance-claude",
      "command": "claude",
      "args": ["--append-system-prompt", "You are Bob, a performance optimizer. Focus on efficiency. Always identify yourself as Bob."],
      "endMarker": "[DONE]",
      "usePty": false
    }
  ],
  "team": {
    "name": "Code Review Team",
    "description": "Multi-perspective code review",
    "teamGoal": "Comprehensive code review from security and performance angles",
    "roleDefinitions": [
      {"name": "SecurityReviewer", "description": "Reviews code for security issues"},
      {"name": "PerformanceOptimizer", "description": "Reviews code for performance"},
      {"name": "Observer", "description": "Human observer"}
    ],
    "roles": [
      {
        "title": "Alice - Security",
        "name": "alice",
        "type": "ai",
        "role": "SecurityReviewer",
        "agentName": "security-claude",
        "systemInstruction": "You are Alice, a security-focused code reviewer.",
        "themeColor": "red"
      },
      {
        "title": "Bob - Performance",
        "name": "bob",
        "type": "ai",
        "role": "PerformanceOptimizer",
        "agentName": "performance-claude",
        "systemInstruction": "You are Bob, a performance-focused code reviewer.",
        "themeColor": "yellow"
      },
      {
        "title": "Observer",
        "name": "observer",
        "type": "human",
        "role": "Observer"
      }
    ]
  },
  "maxRounds": 5
}
```

**测试场景**：
```
Initial message: "Please review this code:
function processUsers(users) {
  for(var i=0; i<users.length; i++) {
    const query = 'DELETE FROM users WHERE id=' + users[i].id;
    db.execute(query);
  }
}"

Expected flow:
Round 1: Alice (security-claude)
  - 应该识别SQL injection漏洞
  - 应该指出没有输入验证

Round 2: Bob (performance-claude)
  - 应该指出var vs let/const性能问题
  - 应该建议批量删除而非循环
  - 不应该混淆安全问题（这是Alice的工作）

Round 3: Human Observer
  - 人类输入观察意见

Round 4: Alice
  - 应该仍然保持安全视角
  - 不应该突然谈论性能问题

Round 5: Bob
  - 应该仍然保持性能视角
  - 不应该突然谈论安全问题
```

**成功标准**：
- ✅ Alice和Bob全程保持各自的专业视角
- ✅ 没有角色混淆或"人格分裂"
- ✅ 每个agent的回复都符合其system instruction
- ✅ 即使看到对方的回复，也不会越界到对方的领域

**失败标准**：
- ❌ Alice突然开始谈论性能优化
- ❌ Bob突然开始谈论安全漏洞
- ❌ Agent忘记自己的名字或角色
- ❌ 回复内容混杂两种视角

---

## 实验结论评估标准

### 场景A：同一Agent，同一Role，多个Member

**是否可行**：取决于实验1结果
- 如果实验1成功 → **可行**，但需要确保每次调用都重申system instruction
- 如果实验1失败 → **不可行**

**风险**：
- 低风险（同一角色，不会混淆）
- 但仍需注意上下文累积

### 场景B：同一Agent，不同Role，多个Member

**是否可行**：取决于实验2和实验4结果
- 如果实验2测试A成功 → **可行**（user message能切换角色）
- 如果实验2测试A失败但测试B成功 → **需要重启进程才能切换**
- 如果实验4失败 → **不可行**（上下文泄漏）

**风险**：
- **高风险**（极易混淆角色）
- **不推荐**除非实验证明完全隔离

### 场景C：不同Agent进程，不同Role

**是否可行**：取决于实验3和实验5结果
- 预期**完全可行**
- 这是业界标准做法

**风险**：
- 低风险（完全隔离）
- 唯一成本是资源消耗

---

## 推荐架构决策

基于文献研究和实验设计，**提前推荐**（实验前预判）：

### 推荐方案：每个AI角色 = 独立进程

**理由**：
1. ✅ **完全隔离上下文**：符合Claude Code的subagent设计
2. ✅ **避免角色混淆**：每个进程有独立的system prompt和对话历史
3. ✅ **符合业界最佳实践**：Thread-based隔离、独立进程是主流
4. ✅ **可靠性高**：不依赖于agent的角色切换能力
5. ⚠️ **唯一缺点**：资源消耗较大（但对于本项目规模可接受）

### Agent Chatter实现建议：

```typescript
class AgentManager {
  private processes: Map<string, ChildProcess> = new Map();

  async startAgent(agentConfigId: string, roleId: string): Promise<void> {
    // 每个角色启动独立的Claude Code进程
    const key = `${agentConfigId}-${roleId}`;

    if (this.processes.has(key)) {
      // 进程已存在，复用（同一角色）
      return;
    }

    // 启动新进程（不同角色）
    const process = spawn('claude', [
      '--append-system-prompt',
      role.systemInstruction
    ]);

    this.processes.set(key, process);
  }

  async stopAgent(agentConfigId: string, roleId: string): Promise<void> {
    const key = `${agentConfigId}-${roleId}`;
    const process = this.processes.get(key);

    if (process) {
      process.kill();
      this.processes.delete(key);
    }
  }
}
```

**关键设计**：
- `agentConfigId` + `roleId` 作为唯一键
- 同一agent同一role → 复用进程
- 同一agent不同role → 启动新进程
- 确保上下文完全隔离

---

## 下一步行动

1. **执行实验1-4**：验证基本假设
2. **执行实验5**：在agent_chatter中实际测试
3. **根据实验结果调整架构**：
   - 如果实验证明同一进程多角色可行 → 可以优化资源使用
   - 如果实验证明必须独立进程 → 确认推荐方案
4. **更新team-configuration.md**：添加多角色agent的设计决策
5. **实现AgentManager的进程隔离机制**

---

**文档版本**: v1.0
**创建日期**: 2025-11-16
**作者**: Claude Code
**状态**: 待验证
