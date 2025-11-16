#!/bin/bash
# Gemini wrapper for Agent Chatter
# Reads from stdin and passes to gemini CLI

# Read all input from stdin
prompt=$(cat)

# Execute gemini with the prompt
gemini -p "$prompt" 2>/dev/null

# Add end marker
echo ""
echo "[DONE]"
