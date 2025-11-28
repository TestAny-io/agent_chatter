# OpenAI Codex CLI Authentication Research

## 1. Supported Authentication Methods

Codex CLI supports **3 primary authentication methods**:

### 1.1 ChatGPT OAuth Flow (Recommended)

```bash
codex login
```

- **Target**: ChatGPT Plus, Pro, Business, Edu, Enterprise subscribers
- **Flow**: Browser-based OAuth 2.0 with PKCE
- **Port**: Uses localhost:1455 for callback
- **Credential Storage**: `~/.codex/auth.json`

### 1.2 OpenAI API Key

```bash
# Via stdin (recommended - avoids shell history)
printenv OPENAI_API_KEY | codex login --with-api-key

# Or via file
codex login --with-api-key < my_key.txt
```

- **Environment Variable**: `OPENAI_API_KEY`
- **Programmatic Override**: `CODEX_API_KEY` (for single `codex exec` run only)
- **Use Case**: Headless, CI/CD, API-only access

### 1.3 Device Code Flow (Experimental)

```bash
codex login --experimental_use-device-code
```

- Displays 9-digit code for manual entry at `/deviceauth/authorize`
- For remote servers without browser access

## 2. Credential Storage Locations

### Primary Paths

| File | Path | Content |
|------|------|---------|
| Credentials | `~/.codex/auth.json` | OAuth tokens and API keys |
| Config | `~/.codex/config.toml` | CLI and IDE settings |
| Logs | `~/.codex/log/codex-tui.log` | Diagnostic logs |
| Windows | `%USERPROFILE%\.codex\auth.json` | Windows equivalent |

### Environment Variables

| Variable | Usage |
|----------|-------|
| `OPENAI_API_KEY` | API key authentication |
| `CODEX_API_KEY` | Override for single `codex exec` run |
| `$CODEX_HOME` | Custom config directory |

### auth.json Structure

```json
{
  "OPENAI_API_KEY": "sk-...",
  "tokens": {
    "access_token": "...",
    "refresh_token": "..."
  },
  "last_refresh": "2025-01-01T00:00:00Z"
}
```

**Important**: `auth.json` is **portable** - can be copied to other machines without re-authentication.

## 3. Verification Commands

### Check Auth Status

```bash
codex login status
```

- **Exit Code 0**: Authenticated
- **Exit Code non-0**: Not authenticated
- **Output**: Shows auth mode with partial key masking (e.g., `sk-proj-***ABCDE`)

### Programmatic Check

```bash
if codex login status; then
  echo "Authenticated"
else
  echo "Not authenticated"
fi
```

## 4. Error Messages and Diagnosis

### Authentication Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `401 Unauthorized` | Invalid/expired token | `codex logout && codex login` |
| `invalid_grant` | Expired refresh token | Re-authenticate |
| `token endpoint returned status 403 Forbidden` | Corporate proxy intercepting | Use API key or configure proxy |
| `the API key is missing or invalid` | Wrong or conflicting key | Unset OPENAI_API_KEY and re-login |

### Network Errors

| Error Pattern | OSI Layer | Cause |
|---------------|-----------|-------|
| `ERR_CONNECTION_REFUSED` on port 1455 | L4 | OAuth callback can't reach local server |
| `Port 127.0.0.1:1455 is already in use` | L4 | Another process using the port |
| `WebSocket closed: code=1006` | L7 | Network instability, proxy issues |
| `ECONNREFUSED` | L4 | API server unreachable |
| `connection timed out` | L4 | Network timeout |

### Environment Variable Conflicts

**Scenario**: `~/.codex/auth.json` has ChatGPT OAuth, but `OPENAI_API_KEY` is also set.

**Symptom**: `codex login status` shows "ChatGPT" but requests fail with 401.

**Resolution**:
```bash
unset OPENAI_API_KEY
# Or use dedicated var in .env:
APP_OPENAI_API_KEY="sk-..."  # instead of OPENAI_API_KEY
```

## 5. Critical Issues for Agent Chatter

### Issue 1: Auth File Detection

**Current Implementation**:
```typescript
const authPath = path.join(os.homedir(), '.codex', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
const hasAuth = auth.OPENAI_API_KEY || auth.tokens || auth.token;
```

**Problems**:
- Doesn't check `OPENAI_API_KEY` env var first
- Doesn't check `CODEX_API_KEY` env var
- Field names may vary by Codex version

### Issue 2: No Status Command Usage

**Current**: Only checks file existence and content.

**Better**: Use `codex login status` which:
- Returns proper exit code
- Handles OAuth refresh automatically
- More reliable than file parsing

### Issue 3: Expiry Checking

**Current**: Only checks `expiresAt` field.

**Reality**: OAuth tokens are auto-refreshed by Codex. File check may miss valid auth.

## 6. Recommended Verification Strategy

```typescript
async function checkCodexAuth(): Promise<CheckResult> {
  // Step 1: Check environment variables (instant)
  if (process.env.OPENAI_API_KEY?.trim()) {
    return { passed: true, message: 'Authenticated via OPENAI_API_KEY' };
  }
  if (process.env.CODEX_API_KEY?.trim()) {
    return { passed: true, message: 'Authenticated via CODEX_API_KEY' };
  }

  // Step 2: Use codex login status (most reliable)
  try {
    await execAsync('codex login status', { timeout: 5000 });
    // Exit code 0 means authenticated
    return { passed: true, message: 'Authenticated (via codex login status)' };
  } catch (error: any) {
    // Check if it's a network error vs auth error
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      return {
        passed: false,
        message: 'Network error: Cannot reach OpenAI servers',
        errorType: 'NETWORK_ERROR'
      };
    }
    // Non-zero exit = not authenticated
  }

  // Step 3: Fallback - check auth file
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      if (auth.OPENAI_API_KEY || auth.tokens?.access_token) {
        // File exists with tokens, but login status failed
        // This might be a network issue or expired token
        return {
          passed: false,
          message: 'Credentials found but may be expired. Try: codex login',
          errorType: 'AUTH_EXPIRED'
        };
      }
    } catch {
      // Parse error
    }
  }

  return {
    passed: false,
    message: 'Not authenticated. Run: codex login',
    errorType: 'AUTH_MISSING'
  };
}
```

## 7. Log Analysis for Debugging

```bash
# Real-time log monitoring
tail -f ~/.codex/log/codex-tui.log | grep -E "ERROR|401|403|ECONNREFUSED"

# Check for specific failures
grep "Token exchange failed" ~/.codex/log/codex-tui.log   # Auth
grep "connection refused" ~/.codex/log/codex-tui.log       # Network
```

## 8. Known GitHub Issues

| Issue | Problem | Impact |
|-------|---------|--------|
| #5456 | 401 Unauthorized after retry limit | False negative |
| #3927 | Port 1455 already in use on WSL | Login blocked |
| #5283 | Token exchange fails on Linux | Auth fails |
| #2414 | 403 Forbidden with corporate proxy | Auth blocked |
| #2341 | OPENAI_API_KEY from .env conflicts | Confusing auth |
| #5575, #5679 | WebSocket reconnection loops (v0.50.0) | Network issues |

## Sources

- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [Codex Authentication Docs](https://github.com/openai/codex/blob/main/docs/authentication.md)
- [Codex Configuration](https://developers.openai.com/codex/local-config/)
- GitHub Issues: #5456, #3927, #5283, #2414, #2341
