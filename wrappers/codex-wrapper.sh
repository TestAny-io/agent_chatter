#!/bin/bash
# Codex wrapper for Agent Chatter
# Reads from stdin and passes to codex exec
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

# Execute codex with the prompt (skip git repo check for scripting)
codex exec --skip-git-repo-check "$prompt" 2>/dev/null

# Add end marker
echo ""
echo "[DONE]"
