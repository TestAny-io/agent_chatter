# Claude Code CLI Authentication Research

## 1. Supported Authentication Methods

Claude Code supports **5 primary authentication methods**:

### 1.1 ANTHROPIC_API_KEY Environment Variable (Highest Priority)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

- **Priority**: Highest (overrides all other methods)
- **Use Case**: CI/CD, headless environments, API-only access
- **Verification**: Check if env var exists and is non-empty

### 1.2 OAuth (Claude.ai Subscription)

- **Requirements**: Claude Pro ($20/mo) or Claude Max ($100/mo) subscription
- **Flow**: Browser-based OAuth 2.0
- **Command**: `claude auth login` or `/login` in interactive mode
- **Credential Storage**:
  - macOS: System Keychain (secure)
  - Linux: `~/.claude/.credentials.json` (plaintext)

### 1.3 AWS Bedrock

```bash
export CLAUDE_CODE_USE_BEDROCK=1
# Requires AWS credentials (via ~/.aws/credentials or env vars)
```

### 1.4 Google Vertex AI

```bash
export CLAUDE_CODE_USE_VERTEX=1
# Requires GCP credentials
```

### 1.5 API Key Helper Script

```bash
claude config set --global apiKeyHelper ~/.claude/anthropic_key_helper.sh
```

- Custom script that outputs API key dynamically
- For organizations with key rotation

## 2. Credential Storage Locations

### Primary Paths (Priority Order)

| Platform | Path | Content |
|----------|------|---------|
| All | `~/.claude.json` | Main global config (highest priority) |
| All | `~/.claude/settings.json` | User global settings |
| All | `~/.claude/settings.local.json` | User local settings |
| Linux | `~/.claude/.credentials.json` | OAuth tokens |
| macOS | System Keychain | OAuth tokens (secure) |
| All | `.claude/settings.json` | Project-specific settings |

### Config File Structure (~/.claude.json)

```json
{
  "customApiKeyResponses": {
    "approved": ["<last-20-chars-of-API-key>"],
    "rejected": []
  },
  "hasCompletedOnboarding": true,
  "apiKeyHelper": "~/.claude/anthropic_key_helper.sh"
}
```

### Credentials File Structure (~/.claude/.credentials.json on Linux)

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

## 3. Verification Commands

### Check Auth Status
```bash
claude auth status
```

### Interactive Status
```
/status
```

### Programmatic Detection

```typescript
// Priority order for auth detection:
// 1. ANTHROPIC_API_KEY env var
// 2. CLAUDE_API_KEY env var (legacy)
// 3. CLAUDE_CODE_USE_BEDROCK=1 + AWS credentials
// 4. CLAUDE_CODE_USE_VERTEX=1 + GCP credentials
// 5. ~/.claude/.credentials.json (Linux) or Keychain (macOS)
// 6. ~/.claude/settings.json with apiKey field
// 7. apiKeyHelper script configured
```

## 4. Error Messages and Diagnosis

### Authentication Errors (HTTP 401)

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| `Invalid API key` | Typo, revoked, or extra whitespace | Verify at console.anthropic.com |
| `Invalid bearer token` | Corrupted OAuth token | `claude auth logout && claude auth login` |
| `OAuth token has expired` | Token TTL exceeded | Re-login to refresh |
| `OAuth account information not found` | Browser succeeded but CLI failed to save | Check file permissions on ~/.claude/ |
| `Auth conflict: Using ANTHROPIC_API_KEY` | Env var overriding subscription | Unset env var or logout |

### Network Errors (NOT Auth Errors)

| Error Pattern | OSI Layer | Cause |
|---------------|-----------|-------|
| `Connection error` | L3-L4 | Network unreachable, DNS failure |
| `Request timeout` | L4-L7 | High latency, dropped connection |
| `ECONNREFUSED` | L4 | API server down, firewall |

## 5. Critical Issues for Agent Chatter

### Issue 1: Config Path Coverage

**Current Implementation** checks:
- `~/.claude/config.json`
- `~/.config/claude/config.json`

**Missing**:
- `~/.claude.json` (main config, highest priority!)
- `~/.claude/.credentials.json` (Linux OAuth)
- `~/.claude/settings.json`
- System Keychain on macOS

### Issue 2: Auth Field Detection

**Current Implementation** checks for:
- `config.apiKey`
- `config.sessionToken`
- `config.session`
- `config.accessToken`

**Reality**:
- API key stored in env var, not config
- OAuth stored in `.credentials.json`, not `config.json`
- Keychain on macOS (cannot read directly)

### Issue 3: Test Command Approach

**Current**: Runs actual prompt which consumes API quota
```bash
echo "Say 'OK'" | claude -p --append-system-prompt "Reply only: OK"
```

**Problem**:
- Consumes API quota every verification
- May timeout on slow networks
- Output parsing unreliable

**Better**: Use `claude auth status` which:
- Doesn't consume quota
- Returns structured exit code
- Faster (no LLM call)

## 6. Recommended Verification Strategy

```typescript
async function checkClaudeAuth(): Promise<CheckResult> {
  // Step 1: Check environment variables (instant, no I/O)
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { passed: true, message: 'Authenticated via ANTHROPIC_API_KEY' };
  }
  if (process.env.CLAUDE_API_KEY?.trim()) {
    return { passed: true, message: 'Authenticated via CLAUDE_API_KEY (legacy)' };
  }

  // Step 2: Check Bedrock/Vertex mode
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    // Check AWS credentials exist
    const awsCredsExist = await checkAWSCredentials();
    if (awsCredsExist) {
      return { passed: true, message: 'Authenticated via AWS Bedrock' };
    }
  }
  if (process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    const gcpCredsExist = await checkGCPCredentials();
    if (gcpCredsExist) {
      return { passed: true, message: 'Authenticated via Vertex AI' };
    }
  }

  // Step 3: Try claude auth status (fastest CLI check)
  try {
    const { stdout, stderr } = await execAsync('claude auth status', { timeout: 5000 });
    if (!stderr.includes('not authenticated') && !stderr.includes('Invalid')) {
      return { passed: true, message: 'Authenticated (via claude auth status)' };
    }
  } catch {
    // Command failed or not available, continue to file checks
  }

  // Step 4: Check credential files (Linux only, macOS uses Keychain)
  if (os.platform() === 'linux') {
    const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (fs.existsSync(credsPath)) {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      if (creds.accessToken || creds.refreshToken) {
        return { passed: true, message: 'Authenticated via credentials file' };
      }
    }
  }

  // Step 5: Fallback - no credentials found
  return {
    passed: false,
    message: 'Not authenticated. Run: claude auth login',
    errorType: 'AUTH_MISSING'
  };
}
```

## 7. Known GitHub Issues

| Issue | Problem | Impact |
|-------|---------|--------|
| #5369 | Auth fails immediately after successful login (v1.0.71) | False negative |
| #1484 | OAuth browser succeeds but CLI fails to save | False negative |
| #5225 | Auth not persisting on macOS SSH remote | False negative |
| #8002 | OAuth succeeds but status shows invalid | Confusing error |
| #1414 | Credential file inconsistency macOS/Linux | Cross-platform issues |

## Sources

- [Claude Code IAM Documentation](https://docs.claude.com/en/docs/claude-code/iam)
- [Claude Code Settings](https://docs.claude.com/en/docs/claude-code/settings)
- [API Errors Reference](https://docs.claude.com/en/api/errors)
- GitHub Issues: #5369, #1484, #5225, #8002, #1414
