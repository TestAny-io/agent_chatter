/**
 * AgentValidator - 验证 agent 的可用性和认证状态
 *
 * 执行真实的 CLI 命令来验证 agent 是否可用，是否已登录
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentDefinition } from './RegistryStorage.js';
import type { VerificationResult, CheckResult } from './AgentRegistry.js';

const execAsync = promisify(exec);

/**
 * AgentValidator 类
 */
export class AgentValidator {
  /**
   * 验证 agent 是否可用
   * 根据设计文档要求：必须执行真实 CLI 验证，不使用缓存
   */
  async verify(agent: AgentDefinition): Promise<VerificationResult> {
    const checks: CheckResult[] = [];
    const result: VerificationResult = {
      name: agent.name,
      status: 'verified',
      checks
    };

    try {
      // 1. 检查命令可执行性
      const executableCheck = await this.checkExecutable(agent.command);
      checks.push(executableCheck);

      if (!executableCheck.passed) {
        result.status = 'failed';
        result.error = executableCheck.message;
        return result;
      }

      // 2. 检查版本信息（可选，不影响验证结果）
      const versionCheck = await this.checkVersion(agent.command);
      checks.push(versionCheck);

      // 3. 检查认证状态（关键！）
      const authCheck = await this.checkAuthentication(agent);
      checks.push(authCheck);

      if (!authCheck.passed) {
        result.status = 'failed';
        result.error = authCheck.message;
        return result;
      }

      result.status = 'verified';
    } catch (error: any) {
      result.status = 'failed';
      result.error = error.message || 'Verification failed';
    }

    return result;
  }

  /**
   * 检查命令是否可执行
   */
  private async checkExecutable(command: string): Promise<CheckResult> {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(command)) {
        // 如果不是绝对路径，尝试在 PATH 中查找
        if (!path.isAbsolute(command)) {
          try {
            const platform = os.platform();
            const whichCommand = platform === 'win32' ? 'where' : 'which';
            const { stdout } = await execAsync(`${whichCommand} ${command}`, {
              timeout: 3000
            });

            if (!stdout.trim()) {
              return {
                name: 'Executable Check',
                passed: false,
                message: `Command '${command}' not found in PATH`
              };
            }

            return {
              name: 'Executable Check',
              passed: true,
              message: `Command found: ${stdout.trim().split('\n')[0]}`
            };
          } catch (error) {
            return {
              name: 'Executable Check',
              passed: false,
              message: `Command '${command}' not found`
            };
          }
        }

        return {
          name: 'Executable Check',
          passed: false,
          message: `File not found: ${command}`
        };
      }

      // 检查是否可执行
      if (os.platform() !== 'win32') {
        const stats = fs.statSync(command);
        if ((stats.mode & 0o111) === 0) {
          return {
            name: 'Executable Check',
            passed: false,
            message: 'File is not executable (missing execute permission)'
          };
        }
      }

      return {
        name: 'Executable Check',
        passed: true,
        message: `Command found: ${command}`
      };
    } catch (error: any) {
      return {
        name: 'Executable Check',
        passed: false,
        message: `Error: ${error.message}`
      };
    }
  }

  /**
   * 检查版本信息
   */
  private async checkVersion(command: string): Promise<CheckResult> {
    try {
      const { stdout, stderr } = await execAsync(`"${command}" --version`, {
        timeout: 5000
      });

      const output = stdout || stderr;
      const versionMatch = output.match(/(\d+\.\d+\.\d+)/);

      if (versionMatch) {
        return {
          name: 'Version Check',
          passed: true,
          message: `Version: ${versionMatch[1]}`
        };
      }

      return {
        name: 'Version Check',
        passed: true,
        message: 'Version detected (format unknown)'
      };
    } catch (error) {
      // 版本检查失败不影响整体验证
      return {
        name: 'Version Check',
        passed: true,
        message: 'Version check skipped (command does not support --version)'
      };
    }
  }

  /**
   * 检查认证状态（根据 agent 类型）
   */
  private async checkAuthentication(agent: AgentDefinition): Promise<CheckResult> {
    switch (agent.name) {
      case 'claude':
        return this.checkClaudeAuth(agent.command);
      case 'codex':
        return this.checkCodexAuth(agent.command);
      case 'gemini':
        return this.checkGeminiAuth(agent.command);
      default:
        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authentication check not implemented for this agent type'
        };
    }
  }

  /**
   * 检查 Claude Code 认证状态
   */
  private async checkClaudeAuth(command: string): Promise<CheckResult> {
    try {
      // 优先支持环境变量（API Key 模式）
      const envKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      if (envKey && envKey.trim()) {
        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authenticated via environment variable'
        };
      }

      // 方法1：检查配置文件（新老路径）
      const possibleConfigPaths = [
        path.join(os.homedir(), '.claude', 'config.json'),
        path.join(os.homedir(), '.config', 'claude', 'config.json')
      ];

      for (const configPath of possibleConfigPaths) {
        if (!fs.existsSync(configPath)) continue;

        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          // Claude CLI 不同版本字段可能不同，尽量兼容
          if (config.apiKey || config.sessionToken || config.session || config.accessToken) {
            return {
              name: 'Authentication Check',
              passed: true,
              message: `Authenticated (config file: ${configPath})`
            };
          }
        } catch {
          // 配置文件解析失败，继续尝试后续路径或命令校验
        }
      }

      // 方法2：执行测试命令
      // 注意：这会消耗少量 API 配额，但根据产品决策这是必须的
      const testPrompt = "Say 'OK' and nothing else";
      try {
        const { stdout, stderr } = await execAsync(
          `echo "${testPrompt}" | "${command}" -p --append-system-prompt "Reply only: OK"`,
          { timeout: 15000 }
        );

        const output = stdout + stderr;

        // 检查是否包含未登录的提示
        if (output.includes('Please run') && output.includes('login')) {
          return {
            name: 'Authentication Check',
            passed: false,
            message: 'Not authenticated. Please run: claude --login'
          };
        }

        if (output.includes('Invalid API key') || output.includes('Authentication failed')) {
          return {
            name: 'Authentication Check',
            passed: false,
            message: 'Authentication failed. Please run: claude --login'
          };
        }

        // 如果没有错误，认为已认证
        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authenticated'
        };
      } catch (error: any) {
        // 执行错误可能是未认证
        if (error.message?.includes('login') || error.message?.includes('auth')) {
          return {
            name: 'Authentication Check',
            passed: false,
            message: 'Not authenticated. Please run: claude --login'
          };
        }

        // 其他错误
        return {
          name: 'Authentication Check',
          passed: false,
          message: `Auth check failed: ${error.message}`
        };
      }
    } catch (error: any) {
      return {
        name: 'Authentication Check',
        passed: false,
        message: `Auth check failed: ${error.message}`
      };
    }
  }

  /**
   * 检查 Codex 认证状态
   */
  private async checkCodexAuth(command: string): Promise<CheckResult> {
    try {
      // 支持环境变量（API Key 模式）
      const envKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
      if (envKey && envKey.trim()) {
        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authenticated via environment variable'
        };
      }

      // Codex 使用认证文件
      const authPath = path.join(os.homedir(), '.codex', 'auth.json');

      if (!fs.existsSync(authPath)) {
        return {
          name: 'Authentication Check',
          passed: false,
          message: 'Not authenticated. Please run: codex login'
        };
      }

      // 读取认证文件
      try {
        const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));

        // Codex 支持多种认证方式：
        // 1. ChatGPT OAuth: { OPENAI_API_KEY, tokens, last_refresh }
        // 2. API Key: { token, expiresAt }
        const hasAuth = auth.OPENAI_API_KEY || auth.tokens || auth.token;

        if (!hasAuth) {
          return {
            name: 'Authentication Check',
            passed: false,
            message: 'Invalid authentication. Please run: codex login'
          };
        }

        // 检查 token 是否过期（仅对 API key 方式）
        if (auth.expiresAt) {
          const expiryDate = new Date(auth.expiresAt);
          if (expiryDate < new Date()) {
            return {
              name: 'Authentication Check',
              passed: false,
              message: 'Token expired. Please run: codex login'
            };
          }
        }

        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authenticated'
        };
      } catch (error) {
        return {
          name: 'Authentication Check',
          passed: false,
          message: 'Failed to read authentication file. Please run: codex login'
        };
      }
    } catch (error: any) {
      return {
        name: 'Authentication Check',
        passed: false,
        message: `Auth check failed: ${error.message}`
      };
    }
  }

  /**
   * 检查 Gemini 认证状态
   */
  private async checkGeminiAuth(command: string): Promise<CheckResult> {
    try {
      // 支持环境变量（API Key 模式）
      const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (envKey && envKey.trim()) {
        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authenticated via environment variable'
        };
      }

      const home = os.homedir();
      const xdgConfig = process.env.XDG_CONFIG_HOME ? path.resolve(process.env.XDG_CONFIG_HOME) : path.join(home, '.config');
      const customConfig = process.env.GEMINI_CONFIG_DIR;

      // 检查 settings.json 确定认证类型
      const settingsCandidates = [
        customConfig ? path.join(customConfig, 'settings.json') : null,
        path.join(home, '.gemini', 'settings.json'),
        path.join(xdgConfig, 'gemini', 'settings.json')
      ].filter(Boolean) as string[];

      const settingsPath = settingsCandidates.find(p => fs.existsSync(p));

      if (settingsPath) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const authType = settings?.security?.auth?.selectedType;

          // 如果使用 API Key 或 OAuth 认证，检查 token 文件是否存在
          if (authType === 'gemini-api-key' || authType === 'google-oauth') {
            const tokenCandidates = [
              customConfig ? path.join(customConfig, 'mcp-oauth-tokens-v2.json') : null,
              path.join(home, '.gemini', 'mcp-oauth-tokens-v2.json'),
              path.join(xdgConfig, 'gemini', 'mcp-oauth-tokens-v2.json')
            ].filter(Boolean) as string[];

            const tokenPath = tokenCandidates.find(p => fs.existsSync(p));
            if (tokenPath) {
              // Token 文件存在且有内容即视为已认证（内容是加密的）
              const stat = fs.statSync(tokenPath);
              if (stat.size > 0) {
                return {
                  name: 'Authentication Check',
                  passed: true,
                  message: `Authenticated via ${authType === 'gemini-api-key' ? 'API Key' : 'Google OAuth'}`
                };
              }
            }
          }
        } catch {
          // settings.json 解析失败，继续检查其他方式
        }
      }

      // 回退：检查传统 OAuth 凭证文件
      const credCandidates = [
        customConfig ? path.join(customConfig, 'oauth_creds.json') : null,
        path.join(home, '.gemini', 'oauth_creds.json'),
        path.join(xdgConfig, 'gemini', 'oauth_creds.json')
      ].filter(Boolean) as string[];

      const credPath = credCandidates.find(p => fs.existsSync(p));

      if (!credPath) {
        return {
          name: 'Authentication Check',
          passed: false,
          message: 'Not authenticated. Please run: gemini auth login'
        };
      }

      // 验证凭证文件格式
      try {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

        if (!creds.access_token && !creds.refresh_token) {
          return {
            name: 'Authentication Check',
            passed: false,
            message: 'Invalid credentials. Please run: gemini auth login'
          };
        }

        return {
          name: 'Authentication Check',
          passed: true,
          message: 'Authenticated'
        };
      } catch (error) {
        return {
          name: 'Authentication Check',
          passed: false,
          message: 'Failed to read credentials file. Please run: gemini auth login'
        };
      }
    } catch (error: any) {
      return {
        name: 'Authentication Check',
        passed: false,
        message: `Auth check failed: ${error.message}`
      };
    }
  }

  /**
   * 带超时的验证
   */
  async verifyWithTimeout(
    agent: AgentDefinition,
    timeoutMs: number = 30000
  ): Promise<VerificationResult> {
    return Promise.race([
      this.verify(agent),
      new Promise<VerificationResult>((_, reject) =>
        setTimeout(
          () => reject(new Error('Verification timeout')),
          timeoutMs
        )
      )
    ]).catch((error) => ({
      name: agent.name,
      status: 'failed' as const,
      error: error.message || 'Verification timeout',
      checks: []
    }));
  }
}
