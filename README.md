# Agent Chatter

A CLI application for orchestrating multi-agent conversations between different AI assistants (Claude, Codex, Gemini) and human participants.

## Overview

Agent Chatter enables structured conversations between multiple AI agents and human observers. Each participant takes turns responding to messages, with automatic routing and context management. The system supports:

- **Multiple AI CLI tools**: Claude Code, OpenAI Codex, Google Gemini
- **Mixed human-AI teams**: Combine AI agents with human participants
- **Conversation flow control**: Automatic turn-taking or explicit addressing with `[NEXT: ...]`
- **Context awareness**: Each agent receives recent conversation history
- **Flexible configuration**: JSON-based team and agent setup

## Installation

```bash
# Clone the repository
git clone https://github.com/TestAny-io/agent_chatter.git
cd agent_chatter

# Install dependencies
npm install

# Build the project
npm run compile

# Link for global CLI usage (optional)
npm link
```

## Prerequisites

Install the AI CLI tools you want to use:

### Claude Code
```bash
# Installation instructions at https://claude.ai/download
```

### OpenAI Codex
```bash
npm install -g @openai/codex
# or
brew install --cask codex
```

### Google Gemini CLI
```bash
npm install -g @google/gemini-cli
# or
brew install gemini-cli
```

## Quick Start

### Basic Usage

Start a conversation with a single AI agent:

```bash
agent-chatter start -c agent-chatter-config.json -m "What is 2+2?"
```

### Configuration File

Create a JSON configuration file defining your team and agents:

```json
{
  "agents": [
    {
      "name": "claude",
      "command": "claude",
      "args": [
        "--append-system-prompt",
        "Always end your response with the exact text [DONE] on a new line. Keep responses concise."
      ],
      "endMarker": "[DONE]"
    }
  ],
  "team": {
    "name": "My Team",
    "description": "A simple team with Claude and human observer",
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

## Examples

### Example 1: Claude + Human Observer

**Configuration**: `agent-chatter-config.json`

```bash
agent-chatter start -c agent-chatter-config.json -m "Explain quantum computing"
```

Claude will respond first, then the conversation pauses for human input.

### Example 2: Testing Codex

**Configuration**: `codex-test-config.json`

Uses the wrapper script at `wrappers/codex-wrapper.sh` to adapt Codex CLI to the standard interface.

```bash
agent-chatter start -c codex-test-config.json -m "Write a function to calculate fibonacci numbers"
```

### Example 3: Multi-Agent Collaboration

**Configuration**: `multi-agent-config.json`

Three AI agents (Claude, Codex, Gemini) discuss a topic with a human observer:

```bash
agent-chatter start -c multi-agent-config.json -m "Discuss the best approach to build a REST API"
```

Agents take turns automatically in round-robin fashion, or can explicitly address each other using `[NEXT: agent-name]`.

## Configuration Reference

### Agent Configuration

Each agent in the `agents` array requires:

- `name` (string): Unique identifier for the agent
- `command` (string): CLI command to execute (e.g., `"claude"`, `"./wrappers/codex-wrapper.sh"`)
- `args` (array): Command-line arguments to pass to the command
- `endMarker` (string): Text marker indicating response completion (e.g., `"[DONE]"`)

### Team Configuration

The `team` object defines:

- `name` (string): Team name
- `description` (string): Team description
- `roles` (array): List of participants in the conversation

### Role Configuration

Each role in `roles` array:

- `title` (string): Display name (e.g., `"Claude"`, `"Observer"`)
- `name` (string): Internal identifier matching agent name or human username
- `type` (string): Either `"ai"` or `"human"`
- `agentName` (string, AI only): References an agent from the `agents` array
- `systemInstruction` (string, AI only): Instructions prepended to each message sent to this agent

### Conversation Control

Agents can control message routing:

- **No marker**: Next role in round-robin order receives the message
- **`[NEXT: role-name]`**: Explicitly route to a specific role
- **`[NEXT: alice, bob]`**: Route to multiple roles
- **`[DONE]`**: End the conversation

## Architecture

```
src/
├── cli.ts                          # CLI entry point (commander.js)
├── models/
│   ├── AgentConfig.ts              # Agent configuration model
│   ├── Team.ts                     # Team and role models
│   ├── ConversationMessage.ts      # Message structure
│   └── ConversationSession.ts      # Session state
├── services/
│   ├── AgentConfigManager.ts       # Load and manage agent configs
│   ├── AgentManager.ts             # Manage agent process lifecycle
│   ├── ConversationCoordinator.ts  # Orchestrate conversation flow
│   ├── MessageRouter.ts            # Parse [NEXT] and [DONE] markers
│   └── TeamManager.ts              # Manage team configurations
└── infrastructure/
    ├── ProcessManager.ts           # Child process management
    └── StorageService.ts           # Persistent storage
```

### Key Components

- **ProcessManager**: Manages child processes for AI CLI tools, handles stdin/stdout communication
- **AgentManager**: High-level agent lifecycle (start, send, receive, stop)
- **ConversationCoordinator**: Routes messages, manages turn-taking, handles context
- **MessageRouter**: Parses conversation control markers (`[NEXT: ...]`, `[DONE]`)

## Wrapper Scripts

AI CLIs have different interfaces. Wrapper scripts in `wrappers/` adapt them to a standard stdin/stdout interface:

### Codex Wrapper (`wrappers/codex-wrapper.sh`)

```bash
#!/bin/bash
prompt=$(cat)
codex exec --skip-git-repo-check "$prompt" 2>/dev/null
echo ""
echo "[DONE]"
```

### Gemini Wrapper (`wrappers/gemini-wrapper.sh`)

```bash
#!/bin/bash
prompt=$(cat)
gemini -p "$prompt" 2>/dev/null
echo ""
echo "[DONE]"
```

Make wrappers executable:
```bash
chmod +x wrappers/*.sh
```

## Development

### Build

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Run Without Installing

```bash
node out/cli.js start -c agent-chatter-config.json -m "Your message here"
```

## Troubleshooting

### Agent not responding

- Verify the CLI tool is installed and accessible in PATH
- Check that the `command` in agent configuration is correct
- Ensure the `endMarker` matches what the agent actually outputs

### Process hangs

- Ensure wrapper scripts close stdin properly
- Verify the agent CLI supports non-interactive mode
- Check that `endMarker` is being sent by the agent

### Context not working

- Verify `contextMessageCount` in ConversationCoordinator (default: 5)
- Check that messages are being added to session history

## License

MIT

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## Repository

https://github.com/TestAny-io/agent_chatter
