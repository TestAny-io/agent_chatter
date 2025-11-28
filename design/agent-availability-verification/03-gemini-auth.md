# Google Gemini CLI Authentication Research

## 1. Supported Authentication Methods

Gemini CLI supports **4 primary authentication approaches**:

### 1.1 GEMINI_API_KEY Environment Variable

```bash
export GEMINI_API_KEY="AI..."
```

- **Source**: [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Use Case**: Headless, CI/CD, simple setups
- **Requirement**: Must select "Gemini API Key" mode in settings (does NOT automatically override OAuth)

### 1.2 Google OAuth (Login with Google)

```bash
gemini  # Interactive prompt offers OAuth
```

- **Requirements**: Browser available, Google account
- **Flow**: Browser-based redirect to localhost
- **Credential Storage**: `~/.gemini/oauth_creds.json`

### 1.3 Vertex AI (Google Cloud Platform)

Three sub-options:

**A. Application Default Credentials (ADC)**
```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_GENAI_USE_VERTEXAI=true
```

**B. Service Account JSON Key**
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

**C. Google Cloud API Key**
```bash
export GOOGLE_API_KEY="AI..."
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

### 1.4 Automatic (Google Cloud Environments Only)

- **Google Cloud Shell**: Uses shell credentials automatically
- **Compute Engine VMs**: Uses metadata server
- No configuration required in these environments

## 2. Credential Storage Locations

### Primary Paths

| File | Path | Content |
|------|------|---------|
| OAuth Credentials | `~/.gemini/oauth_creds.json` | OAuth tokens |
| Settings | `~/.gemini/settings.json` | CLI configuration |
| Token Store | `~/.gemini/mcp-oauth-tokens-v2.json` | MCP tokens (encrypted) |
| XDG Alternative | `~/.config/gemini/` | XDG-compliant path |
| Project Settings | `.gemini/settings.json` | Project-specific |

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Gemini API key |
| `GOOGLE_API_KEY` | Google Cloud API key |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (required for Vertex AI) |
| `GOOGLE_CLOUD_LOCATION` | GCP region (optional) |
| `GOOGLE_GENAI_USE_VERTEXAI` | Enable Vertex AI mode |
| `GEMINI_CONFIG_DIR` | Custom config directory |
| `XDG_CONFIG_HOME` | XDG config base |

### .env File Search Order

1. Current directory → upward to root
2. `~/.gemini/.env`
3. `~/.env`

**Note**: Only first found file is loaded (not merged).

### oauth_creds.json Structure

```json
{
  "access_token": "ya29...",
  "refresh_token": "1//...",
  "token_type": "Bearer",
  "expiry_date": 1234567890
}
```

### settings.json Structure

```json
{
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"  // or "google-oauth"
    }
  }
}
```

## 3. Verification Commands

### No Built-in Status Command

**Current State**: Gemini CLI lacks a dedicated `/status` or `auth status` command.

**GitHub Issue**: #1941 requests this feature.

### Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| **41** | Authentication error |
| **42** | Input validation error |
| **44** | Sandbox error |
| **52** | Configuration error |

### Workaround for Verification

```bash
# Try a simple command and check exit code
gemini "test" 2>&1
echo $?  # 41 = auth error, 0 = success
```

## 4. Error Messages and Diagnosis

### Authentication Errors (Exit Code 41)

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| `Failed to login. Message: Precondition check failed` | Google Workspace account issues | Set `GOOGLE_CLOUD_PROJECT` or use API key |
| `Failed to login. Message: Request contains an invalid argument` | Invalid credentials | Try different auth method |
| `No suitable authentication found` | Headless without env vars | Set `GEMINI_API_KEY` |
| `API keys are not supported by this API...` | Org policy restriction | Use Service Account instead |
| `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | Corporate SSL/TLS interception | Set `NODE_EXTRA_CA_CERTS` |

### Network Errors (NOT Exit Code 41)

| Error Pattern | OSI Layer | Cause |
|---------------|-----------|-------|
| `request to https://oauth2.googleapis.com/token failed` | L4-L7 | Network timeout |
| `getaddrinfo ENOTFOUND` | L3 | DNS resolution failure |
| `ETIMEDOUT` | L4 | Connection timeout |
| `ECONNREFUSED` | L4 | Connection refused |
| Hangs during OAuth | L3-L4 | IPv6 issues |

### IPv6 Issues (Common)

**Symptom**: OAuth hangs indefinitely or times out.

**Solution**:
```bash
export NODE_OPTIONS="--dns-result-order=ipv4first"
gemini
```

### Corporate Proxy Issues

```bash
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem
export https_proxy=http://proxy.corp.com:8080
```

## 5. Critical Issues for Agent Chatter

### Issue 1: Auth Type Detection

**Current Implementation**:
```typescript
// Checks settings.json for selectedType
const authType = settings?.security?.auth?.selectedType;
if (authType === 'gemini-api-key' || authType === 'google-oauth') {
  // Check token file
}
```

**Problems**:
- Doesn't check `GEMINI_API_KEY` or `GOOGLE_API_KEY` env vars first
- Doesn't check `GOOGLE_APPLICATION_CREDENTIALS` for service account
- Doesn't check `GOOGLE_GENAI_USE_VERTEXAI` for Vertex mode

### Issue 2: Token File Path Variations

**Current**: Checks limited paths.

**Reality**: Many possible paths depending on:
- `XDG_CONFIG_HOME` setting
- `GEMINI_CONFIG_DIR` custom path
- Platform (Linux vs macOS)

### Issue 3: No Status Command

**Current**: Falls back to checking credential files.

**Problem**: Cannot validate credentials are actually working without making API call.

### Issue 4: Google Workspace Accounts

Many users have Google Workspace accounts that fail OAuth with:
```
Precondition check failed
```

Need to detect this and suggest setting `GOOGLE_CLOUD_PROJECT`.

## 6. Recommended Verification Strategy

```typescript
async function checkGeminiAuth(): Promise<CheckResult> {
  // Step 1: Check environment variables (instant)
  if (process.env.GEMINI_API_KEY?.trim()) {
    return { passed: true, message: 'Authenticated via GEMINI_API_KEY' };
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return { passed: true, message: 'Authenticated via GOOGLE_API_KEY' };
  }

  // Step 2: Check Vertex AI mode
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      if (fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        return { passed: true, message: 'Authenticated via Service Account (Vertex AI)' };
      }
    }
    // ADC - check gcloud auth
    try {
      await execAsync('gcloud auth application-default print-access-token', { timeout: 5000 });
      return { passed: true, message: 'Authenticated via ADC (Vertex AI)' };
    } catch {
      // ADC not configured
    }
  }

  // Step 3: Check OAuth credentials
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const customConfig = process.env.GEMINI_CONFIG_DIR;

  const credPaths = [
    customConfig ? path.join(customConfig, 'oauth_creds.json') : null,
    path.join(home, '.gemini', 'oauth_creds.json'),
    path.join(xdgConfig, 'gemini', 'oauth_creds.json')
  ].filter(Boolean) as string[];

  for (const credPath of credPaths) {
    if (fs.existsSync(credPath)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        if (creds.access_token || creds.refresh_token) {
          return { passed: true, message: 'Authenticated via Google OAuth' };
        }
      } catch {
        // Parse error, continue
      }
    }
  }

  // Step 4: Try running gemini and check exit code
  try {
    await execAsync('gemini --version', { timeout: 5000 });
    // If this works, try a quick test
    const { code } = await execAsync('echo "test" | gemini', { timeout: 10000 });
    if (code === 0) {
      return { passed: true, message: 'Authenticated' };
    }
    if (code === 41) {
      return { passed: false, message: 'Not authenticated. Run: gemini', errorType: 'AUTH_MISSING' };
    }
  } catch (error: any) {
    // Check error type
    if (error.code === 'ETIMEDOUT' || error.message?.includes('ENOTFOUND')) {
      return {
        passed: false,
        message: 'Network error: Cannot reach Google servers. Try: NODE_OPTIONS="--dns-result-order=ipv4first"',
        errorType: 'NETWORK_ERROR'
      };
    }
  }

  return {
    passed: false,
    message: 'Not authenticated. Run: gemini (or set GEMINI_API_KEY)',
    errorType: 'AUTH_MISSING'
  };
}
```

## 7. Configuration Precedence

From lowest to highest priority:

1. Hardcoded defaults
2. System-wide settings
3. User settings (`~/.gemini/settings.json`)
4. Project settings (`.gemini/settings.json`)
5. Environment variables
6. Command-line arguments (highest)

## 8. Known GitHub Issues

| Issue | Problem | Impact |
|-------|---------|--------|
| #1696 | Auth fails on remote/headless servers | OAuth unavailable |
| #4984 | IPv6 causes OAuth hangs | Login blocked |
| #5580 | Auth consistently fails | Various causes |
| #1941 | Missing `/status` command | Can't verify without API call |

## Sources

- [Gemini CLI Authentication Setup](https://geminicli.com/docs/get-started/authentication/)
- [Gemini CLI Troubleshooting](https://google-gemini.github.io/gemini-cli/docs/troubleshooting.html)
- [Google OAuth Quickstart](https://ai.google.dev/gemini-api/docs/oauth)
- GitHub Issues: #1696, #4984, #5580, #1941
