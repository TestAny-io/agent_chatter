# Agent Wrappers

This directory contains reference wrapper scripts for integrating third-party AI CLI tools with Agent Chatter.

## Overview

Agent Chatter's adapter architecture supports any CLI tool that follows the stdin/stdout pattern. For tools that don't natively support this pattern, you can create wrapper scripts.

## Available Wrappers

### 1. Codex Wrapper

Wraps OpenAI Codex CLI (`codex exec`) for use with Agent Chatter.

**Files:**
- `codex-wrapper.sh` - For Linux/macOS
- `codex-wrapper.bat` - For Windows

**Requirements:**
- OpenAI Codex CLI installed and configured
- Command: `codex`

**Usage:**
```bash
# Register with Agent Chatter
chatter agents register codex-wrapper /path/to/codex-wrapper.sh

# Use in team configuration
{
  "name": "codex-agent",
  "type": "openai-codex",
  "command": "/path/to/codex-wrapper.sh",
  "args": [],
  "endMarker": "[DONE]"
}
```

### 2. Gemini Wrapper

Wraps Google Gemini CLI for use with Agent Chatter.

**Files:**
- `gemini-wrapper.sh` - For Linux/macOS
- `gemini-wrapper.bat` - For Windows

**Requirements:**
- Google Gemini CLI installed and configured
- Command: `gemini`

**Usage:**
```bash
# Register with Agent Chatter
chatter agents register gemini-wrapper /path/to/gemini-wrapper.sh

# Use in team configuration
{
  "name": "gemini-agent",
  "type": "google-gemini",
  "command": "/path/to/gemini-wrapper.sh",
  "args": [],
  "endMarker": "[DONE]"
}
```

## How Wrappers Work

All wrappers in this directory follow the same pattern:

1. **Read from stdin**: Receive the prompt/message from Agent Chatter
2. **Handle system instruction**: Check `AGENT_SYSTEM_INSTRUCTION` environment variable
3. **Execute CLI tool**: Call the actual AI tool with the prompt
4. **Add end marker**: Output `[DONE]` to signal completion

### System Instruction Handling

When Agent Chatter sets a system instruction (via `member.systemInstruction` in team config), it passes it through the `AGENT_SYSTEM_INSTRUCTION` environment variable.

Wrappers prepend this to the prompt in the format:
```
[SYSTEM]
<system instruction>

[MESSAGE]
<user message>
```

**Example:**
```bash
export AGENT_SYSTEM_INSTRUCTION="You are a helpful code reviewer."
echo "Review this pull request" | ./codex-wrapper.sh
```

This sends to Codex:
```
[SYSTEM]
You are a helpful code reviewer.

[MESSAGE]
Review this pull request
```

## Creating Custom Wrappers

To create a wrapper for a new AI tool:

### Bash Template (Linux/macOS)

```bash
#!/bin/bash
# Your AI Tool wrapper for Agent Chatter
#
# Environment variables:
#   AGENT_SYSTEM_INSTRUCTION: System prompt to prepend to user message

# Read all input from stdin
prompt=$(cat)

# Prepend system instruction if provided
if [ -n "$AGENT_SYSTEM_INSTRUCTION" ]; then
  prompt="[SYSTEM]
$AGENT_SYSTEM_INSTRUCTION

[MESSAGE]
$prompt"
fi

# Execute your AI tool
your-ai-tool --your-args "$prompt" 2>/dev/null

# Add end marker
echo ""
echo "[DONE]"
```

### Batch Template (Windows)

```batch
@echo off
REM Your AI Tool wrapper for Agent Chatter (Windows)
REM
REM Environment variables:
REM   AGENT_SYSTEM_INSTRUCTION: System prompt to prepend to user message

setlocal enabledelayedexpansion

REM Read all input from stdin
set "prompt="
for /f "delims=" %%i in ('more') do (
    set "prompt=!prompt!%%i"
)

REM Prepend system instruction if provided
if defined AGENT_SYSTEM_INSTRUCTION (
    set "prompt=[SYSTEM]!AGENT_SYSTEM_INSTRUCTION![MESSAGE]!prompt!"
)

REM Execute your AI tool
your-ai-tool --your-args "%prompt%" 2>nul

REM Add end marker
echo.
echo [DONE]

endlocal
```

## Testing Wrappers

Test your wrapper independently:

```bash
# Without system instruction
echo "Hello world" | ./your-wrapper.sh

# With system instruction
export AGENT_SYSTEM_INSTRUCTION="You are helpful."
echo "Hello world" | ./your-wrapper.sh
```

Expected output:
```
<AI response>

[DONE]
```

## Platform Compatibility

| Wrapper | Linux | macOS | Windows | Windows (WSL) |
|---------|-------|-------|---------|---------------|
| `.sh`   | ✅    | ✅    | ❌      | ✅            |
| `.bat`  | ❌    | ❌    | ✅      | ❌            |

**Recommendation for Windows users:**
- Use WSL (Windows Subsystem for Linux) for best compatibility
- Or use Git Bash to run `.sh` scripts
- Or use native `.bat` scripts

## Notes

- Wrappers are **optional** - Claude Code has native adapter support
- Wrappers are **reference implementations** - customize as needed
- The `AGENT_SYSTEM_INSTRUCTION` convention is recommended but not enforced
- Different AI tools may require different argument formats

## See Also

- [Adapter Architecture Design](../design/agent-adapter-architecture-zh.md)
- [Agent Configuration Guide](../docs/agent-configuration.md)
