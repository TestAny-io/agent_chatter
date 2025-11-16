# Agent Chatter

**Orchestrate multi-agent AI conversations effortlessly.**

Agent Chatter is a powerful CLI application that enables structured conversations between multiple AI assistants (Claude, Codex, Gemini) and human participants. Let your AI agents collaborate, discuss, and solve problems together while you observe and guide the conversation.

## Why Agent Chatter?

- 🤖 **Multi-AI Collaboration**: Run Claude Code, OpenAI Codex, and Google Gemini in coordinated conversations
- 💬 **Intelligent Routing**: Automatic turn-taking or explicit addressing with `[NEXT: ...]` markers
- 🧠 **Context Awareness**: Each agent receives recent conversation history for coherent discussions
- 👥 **Human-in-the-loop**: Mix AI agents with human participants seamlessly
- ⚙️ **Flexible Configuration**: JSON-based team and agent setup for any workflow
- 🎯 **Production Ready**: Clean architecture designed for reliability and extensibility

## Key Features

### Automatic Conversation Flow
Agents take turns responding in round-robin fashion, or explicitly address each other by name. No manual copy-pasting between different AI tools.

### Context Management
Every agent receives the recent conversation history, ensuring coherent multi-turn discussions with full context awareness.

### Extensible Architecture
Add support for any AI CLI tool through simple wrapper scripts. Standard stdin/stdout interface makes integration straightforward.

### Mixed Teams
Combine multiple AI agents with human observers or participants. Perfect for AI-assisted brainstorming, code review, or complex problem-solving.

## Installation

### Prerequisites

You'll need at least one of these AI CLI tools installed:

- **Claude Code**: Download from https://claude.ai/download
- **OpenAI Codex**: `npm install -g @openai/codex` or `brew install --cask codex`
- **Google Gemini CLI**: `npm install -g @google/gemini-cli` or `brew install gemini-cli`

### Install Agent Chatter

```bash
npm install -g agent-chatter
```

Or install locally:

```bash
npm install agent-chatter
npx agent-chatter start -c config.json -m "Your message"
```

## Quick Start

### 1. Create a Configuration File

Create `my-team.json`:

```json
{
  "agents": [
    {
      "name": "claude",
      "command": "claude",
      "args": [
        "--append-system-prompt",
        "Always end your response with [DONE] on a new line. Keep responses concise."
      ],
      "endMarker": "[DONE]"
    }
  ],
  "team": {
    "name": "My AI Team",
    "description": "Claude with human observer",
    "roles": [
      {
        "title": "Claude",
        "name": "claude",
        "type": "ai",
        "agentName": "claude",
        "systemInstruction": "You are Claude, a helpful AI assistant. Be concise."
      },
      {
        "title": "Observer",
        "name": "observer",
        "type": "human"
      }
    ]
  },
  "maxRounds": 10
}
```

### 2. Start a Conversation

```bash
agent-chatter start -c my-team.json -m "Explain quantum computing in simple terms"
```

Claude will respond, then pause for your input. The conversation continues with full context awareness.

## Use Cases

### AI-Assisted Code Review
Multiple AI agents review code from different perspectives (security, performance, maintainability), with a human making final decisions.

### Brainstorming Sessions
Agents with different "personalities" or specializations discuss ideas, generating diverse perspectives on complex problems.

### Multi-Step Problem Solving
Break down complex tasks into steps, with different agents specializing in different aspects (research, implementation, testing).

### Knowledge Synthesis
Agents discuss a topic from different angles, synthesizing information from their different training approaches and capabilities.

## Configuration Reference

### Agent Configuration

Each agent in the `agents` array:

```json
{
  "name": "unique-id",
  "command": "cli-command",
  "args": ["--arg1", "--arg2"],
  "endMarker": "[DONE]"
}
```

- `name`: Unique identifier
- `command`: CLI executable path
- `args`: Command-line arguments (optional)
- `endMarker`: Text marking response completion

### Team Configuration

Define your team structure:

```json
{
  "team": {
    "name": "Team Name",
    "description": "Team description",
    "roles": [...]
  },
  "maxRounds": 10
}
```

### Role Configuration

Each participant in the conversation:

```json
{
  "title": "Display Name",
  "name": "internal-id",
  "type": "ai" | "human",
  "agentName": "agent-id",
  "systemInstruction": "Custom instructions for this agent"
}
```

### Conversation Control

Agents control the conversation flow:

- **No marker**: Automatic round-robin to next role
- **`[NEXT: role-name]`**: Route to specific participant
- **`[NEXT: alice, bob]`**: Route to multiple participants
- **`[DONE]`**: End the conversation

## Examples

### Example 1: Single AI + Human

Start a conversation with Claude, then interact as needed:

```bash
agent-chatter start -c claude-config.json -m "Help me design a REST API"
```

### Example 2: Multiple AI Agents

Three agents (Claude, Codex, Gemini) discuss technical architecture:

```bash
agent-chatter start -c multi-agent.json -m "Design a distributed caching system"
```

Agents automatically take turns, building on each other's responses.

### Example 3: Code Review Team

Configure agents with different specializations:
- Agent 1: Security focus
- Agent 2: Performance focus
- Agent 3: Code quality focus
- Human: Final reviewer

## Advanced Configuration

### Custom AI Wrapper Scripts

Integrate any CLI tool by creating a wrapper script:

```bash
#!/bin/bash
# my-ai-wrapper.sh
prompt=$(cat)
my-ai-tool --prompt "$prompt" 2>/dev/null
echo ""
echo "[DONE]"
```

Reference it in your config:

```json
{
  "name": "my-ai",
  "command": "./wrappers/my-ai-wrapper.sh",
  "args": [],
  "endMarker": "[DONE]"
}
```

### Context Window Control

Adjust how much conversation history agents receive by modifying `contextMessageCount` in the coordinator (default: 5 messages).

## Troubleshooting

**Agent not responding?**
- Verify the CLI tool is installed and in PATH
- Check the `command` path in your configuration
- Ensure `endMarker` matches the agent's actual output

**Process hangs?**
- Verify wrapper scripts properly close stdin
- Check that the agent CLI supports non-interactive mode
- Confirm the `endMarker` is being sent

**Context issues?**
- Verify messages are being logged in the session
- Check that `contextMessageCount` is appropriate for your use case

## System Requirements

- Node.js 18 or higher
- macOS, Linux, or Windows WSL
- At least one supported AI CLI tool

## Support

For technical support and inquiries:
- Email: support@testany.io
- Documentation: https://github.com/TestAny-io/agent_chatter

## License

Copyright © 2024 TestAny.io. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, distribution, or use of this software, via any medium, is strictly prohibited.

---

**Built by TestAny.io** - Bringing AI agents together.
