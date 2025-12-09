import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

const GEMINI_TOKEN_FILE = '.gemini/mcp-oauth-tokens-v2.json';
const DEFAULT_ENTRY = 'default-api-key';

/**
 * Best-effort loader for Gemini API Key from the local gemini-cli storage.
 * Matches gemini-cli FileTokenStorage encryption scheme:
 * - file: ~/.gemini/mcp-oauth-tokens-v2.json
 * - encryption: AES-256-GCM with key derived via scryptSync('gemini-cli-oauth', `${hostname}-${username}-gemini-cli`, 32)
 * - format: iv:authTag:ciphertext (hex)
 *
 * Returns null if file missing or decryption fails.
 */
export function loadGeminiApiKeyFromStorage(): string | null {
  try {
    const tokenPath = path.join(os.homedir(), GEMINI_TOKEN_FILE);
    if (!fs.existsSync(tokenPath)) {
      return null;
    }

    const encrypted = fs.readFileSync(tokenPath, 'utf8');
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      return null;
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = parts[2];

    const salt = `${os.hostname()}-${os.userInfo().username}-gemini-cli`;
    const key = crypto.scryptSync('gemini-cli-oauth', salt, 32);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const tokens = JSON.parse(decrypted) as Record<
      string,
      {
        token?: { accessToken?: string; tokenType?: string };
      }
    >;

    const apiKey = tokens[DEFAULT_ENTRY]?.token?.accessToken;
    return apiKey && apiKey.trim() !== '' ? apiKey : null;
  } catch (_err) {
    // Best-effort: any failure -> return null to avoid crashing caller
    return null;
  }
}
