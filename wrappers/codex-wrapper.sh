#!/bin/bash
# Codex wrapper for Agent Chatter
# Reads from stdin and passes to codex exec

# Read all input from stdin
prompt=$(cat)

# Execute codex with the prompt (skip git repo check for scripting)
codex exec --skip-git-repo-check "$prompt" 2>/dev/null

# Add end marker
echo ""
echo "[DONE]"
