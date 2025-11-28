# Current Implementation Analysis

## Overview

This document analyzes the current `AgentValidator.ts` implementation, identifying gaps and issues based on the research findings.

## Current Architecture

```
AgentRegistry.verifyAgent(name)
    └── AgentValidator.verify(agent)
            ├── checkExecutable(command)
            ├── checkVersion(command)
            └── checkAuthentication(agent)
                    ├── checkClaudeAuth()
                    ├── checkCodexAuth()
                    └── checkGeminiAuth()
```

## Issue 1: Claude Code Auth Detection Gaps

### Current Code (Lines 196-290)

```typescript
private async checkClaudeAuth(command: string): Promise<CheckResult> {
  // 1. Check env vars
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (envKey && envKey.trim()) {
    return { passed: true, message: 'Authenticated via environment variable' };
  }

  // 2. Check config files
  const possibleConfigPaths = [
    path.join(os.homedir(), '.claude', 'config.json'),
    path.join(os.homedir(), '.config', 'claude', 'config.json')  // ✓ XDG path supported
  ];
  // ... check for apiKey, sessionToken, session, accessToken

  // 3. Execute test command (consumes API quota)
  const testPrompt = "Say 'OK' and nothing else";
  const { stdout, stderr } = await execAsync(
    `echo "${testPrompt}" | "${command}" -p --append-system-prompt "Reply only: OK"`
  );
}
```

### What's Already Supported

- ✓ `ANTHROPIC_API_KEY` and `CLAUDE_API_KEY` environment variables
- ✓ `~/.claude/config.json` config path
- ✓ `~/.config/claude/config.json` XDG-compliant path

### Problems Found

| Issue | Description | Severity |
|-------|-------------|----------|
| **Missing Paths** | Doesn't check `~/.claude.json` (main config) or `~/.claude/.credentials.json` (OAuth) | High |
| **Missing Auth Methods** | Doesn't detect AWS Bedrock (`CLAUDE_CODE_USE_BEDROCK`) or Vertex AI (`CLAUDE_CODE_USE_VERTEX`) | Medium |
| **Consumes API Quota** | Test command makes real API call every verification | Medium |
| **No Status Command** | Doesn't use `claude auth status` which is free and reliable | High |
| **macOS Keychain** | Cannot detect OAuth on macOS (stored in Keychain, not file) | High |
| **Wrong Config Fields** | Checks fields that don't exist in actual config files | Medium |

### Impact

- **False Negatives**: Users with valid OAuth on macOS are blocked
- **False Negatives**: Users with Bedrock/Vertex credentials are blocked
- **Wasted Resources**: API quota consumed on every team deploy

## Issue 2: Codex Auth Detection Gaps

### Current Code (Lines 295-366)

```typescript
private async checkCodexAuth(command: string): Promise<CheckResult> {
  // 1. Check env vars
  const envKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;

  // 2. Check auth file
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  const hasAuth = auth.OPENAI_API_KEY || auth.tokens || auth.token;

  // 3. Check expiry
  if (auth.expiresAt) {
    const expiryDate = new Date(auth.expiresAt);
    if (expiryDate < new Date()) {
      return { passed: false, message: 'Token expired' };
    }
  }
}
```

### Problems Found

| Issue | Description | Severity |
|-------|-------------|----------|
| **No Status Command** | Doesn't use `codex login status` which handles refresh automatically | High |
| **Expiry Confusion** | OAuth tokens auto-refresh; file expiry check may be wrong | Medium |
| **Field Variations** | Codex version updates may change auth.json structure | Medium |

**Note**: The `os.homedir()` approach works correctly on Windows; the previous concern was overstated.

### Impact

- **False Negatives**: Valid OAuth that needs refresh appears expired
- **Unnecessary Failures**: Relying on file when CLI can validate directly

## Issue 3: Gemini Auth Detection Gaps

### Current Code (Lines 371-475)

```typescript
private async checkGeminiAuth(command: string): Promise<CheckResult> {
  // 1. Check env vars
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  // 2. Check settings.json for auth type
  const authType = settings?.security?.auth?.selectedType;

  // 3. Check OAuth creds
  const credPath = path.join(home, '.gemini', 'oauth_creds.json');
}
```

### Problems Found

| Issue | Description | Severity |
|-------|-------------|----------|
| **Missing Vertex AI** | Doesn't detect `GOOGLE_GENAI_USE_VERTEXAI` or `GOOGLE_APPLICATION_CREDENTIALS` | High |
| **Missing ADC** | Doesn't check Application Default Credentials | High |
| **No Exit Code Check** | Gemini returns exit code 41 for auth errors; not used | Medium |
| **IPv6 Not Detected** | Common network issue (IPv6 hangs) not identified or reported | Medium |

### Impact

- **False Negatives**: Enterprise users with Vertex AI/Service Accounts blocked
- **Confusing Errors**: Network issues (IPv6) reported as auth failures

## Issue 4: Network vs Auth Error Differentiation

### Current Behavior

All errors are reported as "Auth check failed: {error.message}"

```typescript
} catch (error: any) {
  return {
    name: 'Authentication Check',
    passed: false,
    message: `Auth check failed: ${error.message}`  // Generic!
  };
}
```

### Problems

| Error Type | OSI Layer | Current Message | Should Be |
|------------|-----------|-----------------|-----------|
| DNS failure | L3 | "Auth check failed: getaddrinfo ENOTFOUND" | "Network Error: DNS resolution failed" |
| Timeout | L4 | "Auth check failed: ETIMEDOUT" | "Network Error: Connection timed out" |
| Connection refused | L4 | "Auth check failed: ECONNREFUSED" | "Network Error: Cannot connect to server" |
| API key invalid | L7 | "Auth check failed: 401" | "Auth Error: Invalid API key" |
| Token expired | L7 | "Auth check failed: invalid_grant" | "Auth Error: Token expired, please re-login" |

### Impact

- Users cannot troubleshoot effectively
- Network issues are misdiagnosed as auth problems
- Support burden increases

## Issue 5: Command Execution Approach

### Current: Execute Full Prompt

```typescript
const { stdout, stderr } = await execAsync(
  `echo "${testPrompt}" | "${command}" -p --append-system-prompt "Reply only: OK"`,
  { timeout: 15000 }
);
```

### Problems

| Issue | Impact |
|-------|--------|
| Consumes API quota | Cost per verification |
| Slow (15s timeout) | Poor UX |
| Output parsing unreliable | May fail on different CLI versions |
| May trigger rate limits | Blocked on frequent deploys |

### Better Approach

Use dedicated status/auth commands:
- Claude: `claude auth status`
- Codex: `codex login status`
- Gemini: Check exit code of simple command

## Issue 6: Missing Connectivity Pre-Check

### Current Flow

```
checkExecutable → checkVersion → checkAuthentication
```

### Recommended Flow

```
checkExecutable → checkConnectivity → checkAuthentication
```

### Connectivity Check Implementation

```typescript
async checkConnectivity(agentType: string): Promise<CheckResult> {
  const endpoints: Record<string, string> = {
    claude: 'api.anthropic.com',
    codex: 'api.openai.com',
    gemini: 'generativelanguage.googleapis.com'
  };

  const host = endpoints[agentType];
  if (!host) {
    return { passed: true, message: 'Connectivity check skipped' };
  }

  try {
    // DNS resolution check
    await dns.promises.resolve4(host);

    // TCP connection check (port 443)
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(443, host);
      socket.setTimeout(3000);
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
      socket.on('error', reject);
    });

    return { passed: true, message: `Connected to ${host}` };
  } catch (error: any) {
    if (error.code === 'ENOTFOUND') {
      return { passed: false, message: `DNS error: Cannot resolve ${host}`, errorType: 'NETWORK_DNS' };
    }
    if (error.code === 'ETIMEDOUT' || error.message === 'Timeout') {
      return { passed: false, message: `Timeout: Cannot reach ${host}`, errorType: 'NETWORK_TIMEOUT' };
    }
    if (error.code === 'ECONNREFUSED') {
      return { passed: false, message: `Connection refused: ${host}`, errorType: 'NETWORK_REFUSED' };
    }
    return { passed: false, message: `Network error: ${error.message}`, errorType: 'NETWORK_UNKNOWN' };
  }
}
```

## Summary of Gaps

| Area | Current | Gap | Priority |
|------|---------|-----|----------|
| Claude Auth Paths | 2 paths | Missing 4+ paths | High |
| Claude Keychain | Not supported | macOS users blocked | High |
| Codex Status Command | Not used | Unreliable expiry check | High |
| Gemini Vertex AI | Not detected | Enterprise users blocked | High |
| Network Pre-Check | None | Auth/network confusion | High |
| Error Messages | Generic | Not actionable | Medium |
| API Quota Usage | Uses quota | Unnecessary cost | Medium |
| IPv6 Detection | None | Common Linux issue | Medium |

## File Changes Required

```
src/registry/AgentValidator.ts
  - Restructure verification flow
  - Add connectivity check
  - Update auth detection per agent
  - Improve error categorization

src/registry/AgentRegistry.ts
  - Export error types for UI
  - Pass error type to UI layer

src/services/ServiceInitializer.ts
  - Display improved error messages
  - Suggest specific resolutions
```
