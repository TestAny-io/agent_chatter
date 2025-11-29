# @testany/agent-chatter

Multi-agent conversation orchestration CLI for AI assistants.

## License

**UNLICENSED** - Proprietary software. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, distribution, modification, or use of this software is strictly prohibited.

For licensing inquiries: support@testany.io

## Installation

```bash
npm install -g @testany/agent-chatter
```

## Quick Start

```bash
# Check installed AI CLI tools
agent-chatter status

# Manage registered agents
agent-chatter agents list
agent-chatter agents scan
agent-chatter agents verify

# Start interactive REPL
agent-chatter

# Generate example configuration
agent-chatter config-example
```

## Features

- Multi-agent conversation orchestration
- Support for Claude Code, OpenAI Codex, Google Gemini CLI
- Interactive REPL with Ink-based UI
- Team configuration and management
- Session persistence and restoration

## Debug Mode

Enable debug logging to troubleshoot issues:

```bash
# Using CLI flag
agent-chatter --debug

# Using environment variable
AGENT_CHATTER_DEBUG=1 agent-chatter

# Redirect debug logs to file (debug goes to stderr)
agent-chatter --debug 2>debug.log
```

Debug logs show Core service activities including:
- Agent verification process
- Message routing decisions
- Process spawning details

## Requirements

- Node.js >= 20.0.0
- At least one supported AI CLI installed:
  - Claude Code (`claude`)
  - OpenAI Codex (`codex`)
  - Google Gemini CLI (`gemini`)

## Related Packages

- `@testany/agent-chatter-core` - Core library (MPL-2.0 OR Apache-2.0)

## Support

For support and licensing: support@testany.io
