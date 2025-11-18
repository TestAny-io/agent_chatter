/**
 * AgentScanner - 自动扫描系统中已安装的 AI CLI agents
 *
 * 负责扫描系统路径，检测 Claude Code, OpenAI Codex, Google Gemini CLI
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDefaultAgentConfig } from '../utils/AgentDefaults.js';
import type { AgentType } from '../utils/AgentDefaults.js';
import type { AgentDefinition } from './RegistryStorage.js';

const execAsync = promisify(exec);

/**
 * ScannedAgent - 扫描到的 agent 信息
 */
export interface ScannedAgent {
  name: AgentType;
  displayName: string;
  command: string;
  version?: string;
  found: boolean;
}

/**
 * AgentScanner 类
 */
export class AgentScanner {
  /**
   * 扫描所有支持的 agents
   */
  async scanAll(): Promise<ScannedAgent[]> {
    const types: AgentType[] = ['claude', 'codex', 'gemini'];
    const results: ScannedAgent[] = [];

    for (const type of types) {
      const result = await this.scan(type);
      results.push(result);
    }

    return results;
  }

  /**
   * 扫描特定类型的 agent
   */
  async scan(agentType: AgentType): Promise<ScannedAgent> {
    const searchPaths = this.getSearchPaths(agentType);
    const defaultConfig = getDefaultAgentConfig(agentType);

    // 按优先级顺序扫描
    for (const searchPath of searchPaths) {
      try {
        const resolved = await this.resolveCommand(searchPath);
        if (resolved && await this.isExecutable(resolved)) {
          const version = await this.detectVersion(resolved, agentType);
          return {
            name: agentType,
            displayName: defaultConfig.displayName,
            command: resolved,
            version,
            found: true
          };
        }
      } catch (error) {
        // 继续尝试下一个路径
        continue;
      }
    }

    // 未找到
    return {
      name: agentType,
      displayName: defaultConfig.displayName,
      command: agentType,
      found: false
    };
  }

  /**
   * 获取扫描路径（按优先级排序）
   */
  private getSearchPaths(agentType: AgentType): string[] {
    const platform = os.platform();

    switch (agentType) {
      case 'claude':
        return this.getClaudePaths(platform);
      case 'codex':
        return this.getCodexPaths(platform);
      case 'gemini':
        return this.getGeminiPaths(platform);
      default:
        return [];
    }
  }

  /**
   * Claude Code 搜索路径
   */
  private getClaudePaths(platform: string): string[] {
    const paths: string[] = [
      'claude', // PATH 中
    ];

    if (platform === 'darwin') {
      paths.push('/Applications/Claude.app/Contents/MacOS/claude');
      paths.push(path.join(os.homedir(), 'Applications/Claude.app/Contents/MacOS/claude'));
    } else if (platform === 'linux') {
      paths.push('/usr/local/bin/claude');
      paths.push(path.join(os.homedir(), '.local/bin/claude'));
    } else if (platform === 'win32') {
      paths.push(path.join(os.homedir(), 'AppData/Local/Programs/Claude/claude.exe'));
    }

    return paths;
  }

  /**
   * Codex 搜索路径
   */
  private getCodexPaths(platform: string): string[] {
    const paths: string[] = [
      'codex', // PATH 中
    ];

    if (platform === 'darwin' || platform === 'linux') {
      // nvm 路径 (glob pattern)
      const homeDir = os.homedir();
      paths.push('/usr/local/bin/codex');
      paths.push('/opt/homebrew/bin/codex');
      paths.push(path.join(homeDir, '.nvm/versions/node/*/bin/codex'));
    } else if (platform === 'win32') {
      paths.push(path.join(os.homedir(), 'AppData/Roaming/npm/codex.cmd'));
    }

    return paths;
  }

  /**
   * Gemini 搜索路径
   */
  private getGeminiPaths(platform: string): string[] {
    const paths: string[] = [
      'gemini', // PATH 中
    ];

    if (platform === 'darwin' || platform === 'linux') {
      paths.push('/usr/local/bin/gemini');
      paths.push('/opt/homebrew/bin/gemini');
      const homeDir = os.homedir();
      paths.push(path.join(homeDir, '.nvm/versions/node/*/bin/gemini'));
    } else if (platform === 'win32') {
      paths.push(path.join(os.homedir(), 'AppData/Roaming/npm/gemini.cmd'));
    }

    return paths;
  }

  /**
   * 解析命令路径
   */
  private async resolveCommand(command: string): Promise<string | null> {
    // 如果包含通配符，展开路径
    if (command.includes('*')) {
      return this.expandGlobPath(command);
    }

    // 如果是绝对路径，直接返回
    if (path.isAbsolute(command)) {
      return fs.existsSync(command) ? command : null;
    }

    // 如果是命令名称，在 PATH 中查找
    try {
      const platform = os.platform();
      const whichCommand = platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execAsync(`${whichCommand} ${command}`, {
        timeout: 3000
      });
      const resolved = stdout.trim().split('\n')[0];
      return resolved || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 展开 glob 路径（如 nvm 路径）
   */
  private expandGlobPath(pattern: string): string | null {
    const parts = pattern.split('*');
    if (parts.length !== 2) {
      return null;
    }

    const [prefix, suffix] = parts;
    const dir = path.dirname(prefix);

    if (!fs.existsSync(dir)) {
      return null;
    }

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(prefix + entry + suffix);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  /**
   * 检查文件是否可执行
   */
  private async isExecutable(filePath: string): Promise<boolean> {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        return false;
      }

      // Windows 上不需要检查执行权限
      if (os.platform() === 'win32') {
        return true;
      }

      // Unix 系统检查执行权限
      const stats = fs.statSync(filePath);
      // 检查是否有执行权限 (owner, group, or other)
      return (stats.mode & 0o111) !== 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检测版本号
   */
  private async detectVersion(command: string, agentType: AgentType): Promise<string | undefined> {
    try {
      // 尝试执行 --version
      const { stdout, stderr } = await execAsync(`"${command}" --version`, {
        timeout: 5000
      });

      const output = stdout || stderr;

      // 尝试多种正则模式
      const patterns = [
        /(\d+\.\d+\.\d+)/,                    // 标准 x.y.z
        /version[:\s]+(\d+\.\d+\.\d+)/i,      // "version: x.y.z"
        /v(\d+\.\d+\.\d+)/,                   // "vx.y.z"
        /(\d+\.\d+)/                          // 回退到 x.y
      ];

      for (const pattern of patterns) {
        const match = output.match(pattern);
        if (match) {
          return match[1];
        }
      }

      return 'unknown';
    } catch (error) {
      // 某些 CLI 可能不支持 --version
      return undefined;
    }
  }

  /**
   * 验证指定路径的命令是否有效
   */
  async validateCommand(command: string): Promise<{
    valid: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      // 检查命令是否存在且可执行
      const resolved = await this.resolveCommand(command);
      if (!resolved || !(await this.isExecutable(resolved))) {
        return {
          valid: false,
          error: 'Command not found or not executable'
        };
      }

      // 尝试检测版本
      const version = await this.detectVersion(resolved, 'claude'); // 使用通用检测

      return {
        valid: true,
        version
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * 从扫描结果创建 AgentDefinition
   */
  createAgentDefinition(scanned: ScannedAgent): AgentDefinition {
    const defaultConfig = getDefaultAgentConfig(scanned.name, scanned.command);

    return {
      ...defaultConfig,
      version: scanned.version,
      installedAt: new Date().toISOString()
    };
  }
}
