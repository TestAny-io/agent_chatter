# Agent Availability Verification - Research & Design

## Overview

This document series analyzes the current agent verification mechanism and proposes improvements to make it more robust and reliable.

## Problem Statement

Users frequently encounter "verify auth fail" errors when using Agent Chatter, with the error message indicating that the expected "OK" response was not received from Claude Code. This creates poor user experience and blocks legitimate usage.

## Core Requirements

Our verification mechanism must be:

1. **Robust**: Correctly identify when an agent is truly unavailable
2. **Reliable**: Not produce false negatives (blocking valid agents)
3. **Accurate**: Provide precise error messages that help users troubleshoot
4. **Efficient**: Complete quickly without consuming excessive API quota

## Key Investigation Areas

1. **Authentication Methods**: Each CLI supports multiple auth methods (OAuth, API Key, etc.)
2. **Path Resolution**: Global install vs local install, PATH issues
3. **Network vs Auth Errors**: Distinguish between OSI Layer 1-4 issues and Layer 7 (auth) issues

## Document Structure

| Document | Content |
|----------|---------|
| [01-claude-code-auth.md](./01-claude-code-auth.md) | Claude Code CLI authentication research |
| [02-codex-auth.md](./02-codex-auth.md) | OpenAI Codex CLI authentication research |
| [03-gemini-auth.md](./03-gemini-auth.md) | Google Gemini CLI authentication research |
| [04-current-implementation-analysis.md](./04-current-implementation-analysis.md) | Analysis of current AgentValidator.ts |
| [05-improvement-proposal.md](./05-improvement-proposal.md) | Proposed improvements and implementation plan |

## Key Findings Summary

### Authentication Methods by Agent

| Agent | Method 1 | Method 2 | Method 3 | Method 4 |
|-------|----------|----------|----------|----------|
| Claude Code | ANTHROPIC_API_KEY env | OAuth (claude.ai subscription) | AWS Bedrock | Vertex AI |
| Codex | OPENAI_API_KEY env | ChatGPT OAuth | Device Code Flow | - |
| Gemini | GEMINI_API_KEY env | Google OAuth | Vertex AI (ADC) | Service Account |

### Critical Issues in Current Implementation

1. **Missing Auth Methods**: Not all auth methods are properly detected
2. **Poor Error Differentiation**: Network errors misreported as auth failures
3. **Config Path Gaps**: Some credential file paths not checked
4. **No Network Connectivity Test**: Cannot distinguish network vs auth issues

### Recommended Actions

1. Implement comprehensive auth detection for all methods per agent
2. Add explicit network connectivity tests before auth validation
3. Use agent-specific status commands where available
4. Provide actionable error messages with resolution steps
