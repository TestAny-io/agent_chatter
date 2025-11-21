/**
 * RegistryStorage - 负责读写全局 Agent Registry 配置文件
 *
 * 文件路径: ~/.agent-chatter/agents/config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * AgentDefinition - 单个 Agent 的完整配置
 */
export interface AgentDefinition {
  name: string;           // "claude", "codex", "gemini"
  displayName: string;    // "Claude Code", "OpenAI Codex"
  command: string;        // CLI 命令路径或名称
  args: string[];         // 默认参数
  usePty: boolean;        // 是否使用 PTY
  version?: string;       // 检测到的版本
  installedAt: string;    // 注册时间 (ISO 8601)
  lastVerified?: string;  // 最后验证时间 (ISO 8601) - 仅记录，不用于判断
}

/**
 * AgentRegistryData - Registry 配置文件的完整结构
 */
export interface AgentRegistryData {
  schemaVersion: string;  // Registry schema version: "1.1"
  agents: {
    [agentName: string]: AgentDefinition;
  };
}

/**
 * RegistryStorage 类 - 负责读写 registry 配置文件
 */
export class RegistryStorage {
  private registryPath: string;

  constructor(registryPath?: string) {
    if (registryPath) {
      // Validate user-provided path to prevent directory traversal attacks
      this.registryPath = this.validateRegistryPath(registryPath);
    } else {
      this.registryPath = this.getDefaultRegistryPath();
    }
  }

  /**
   * 获取默认的 registry 文件路径
   */
  private getDefaultRegistryPath(): string {
    return path.join(os.homedir(), '.agent-chatter', 'agents', 'config.json');
  }

  /**
   * 验证并规范化 registry 路径
   *
   * SECURITY: 防止路径遍历攻击
   *
   * ❌ 错误方案：使用 startsWith() 检查
   *    - 安全漏洞：'/Users/al' 会错误允许 '/Users/alex/file.json'（路径逃逸）
   *    - 可用性 bug：Windows 上大小写敏感，'c:\users\me' 不匹配 'C:\Users\me'
   *
   * ✅ 正确方案：使用 path.relative() 检查相对路径是否向上逃逸
   */
  private validateRegistryPath(userPath: string): string {
    // 1. 规范化路径，解析 .. 和 .
    const normalized = path.normalize(userPath);

    // 2. 转换为绝对路径
    const absolute = path.resolve(normalized);

    // 3. 防止路径遍历攻击
    // 确保路径在安全目录内（主目录、当前目录或系统临时目录）
    const homeDir = os.homedir();
    const cwd = process.cwd();
    const tmpDir = os.tmpdir();

    // Helper function to check if a path is inside a directory
    const isInsideDirectory = (dir: string, target: string): boolean => {
      const relativePath = path.relative(dir, target);
      return relativePath.length > 0 &&
             !relativePath.startsWith('..') &&
             !relativePath.startsWith(path.sep) &&
             !path.isAbsolute(relativePath);
    };

    // Check if path is inside one of the allowed directories
    const isInsideHome = isInsideDirectory(homeDir, absolute);
    const isInsideCwd = isInsideDirectory(cwd, absolute);
    const isInsideTmp = isInsideDirectory(tmpDir, absolute);

    if (!isInsideHome && !isInsideCwd && !isInsideTmp) {
      throw new Error(
        `Invalid registry path: ${userPath}\n` +
        `Registry path must be within:\n` +
        `  - Home directory: ${homeDir}\n` +
        `  - Current directory: ${cwd}\n` +
        `  - Temp directory: ${tmpDir}\n` +
        `Resolved to: ${absolute}`
      );
    }

    // 4. 确保路径以 .json 结尾
    if (!absolute.endsWith('.json')) {
      throw new Error(
        `Invalid registry path: ${userPath}\n` +
        `Registry path must end with .json`
      );
    }

    return absolute;
  }

  /**
   * 确保目录存在
   */
  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * 检查 registry 文件是否存在
   */
  exists(): boolean {
    return fs.existsSync(this.registryPath);
  }

  /**
   * 加载 registry 配置
   * 如果文件不存在，返回空配置
   */
  async load(): Promise<AgentRegistryData> {
    if (!this.exists()) {
      return {
        schemaVersion: '1.1',
        agents: {}
      };
    }

    try {
      const content = fs.readFileSync(this.registryPath, 'utf-8');
      const data = JSON.parse(content) as AgentRegistryData;

      // 验证 schema 版本
      if (data.schemaVersion !== '1.1') {
        throw new Error(
          `Unsupported registry schema version: ${data.schemaVersion}\n` +
          `Expected: 1.1`
        );
      }

      return data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 文件不存在，返回空配置
        return {
          schemaVersion: '1.1',
          agents: {}
        };
      }

      // JSON 解析错误或其他错误
      throw new Error(
        `Failed to load agent registry from ${this.registryPath}: ${error.message}`
      );
    }
  }

  /**
   * 保存 registry 配置
   */
  async save(data: AgentRegistryData): Promise<void> {
    try {
      // 确保目录存在
      this.ensureDirectoryExists();

      // 写入文件，设置权限为 0600 (仅用户可读写)
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.registryPath, content, {
        encoding: 'utf-8',
        mode: 0o600
      });
    } catch (error: any) {
      throw new Error(
        `Failed to save agent registry to ${this.registryPath}: ${error.message}`
      );
    }
  }

  /**
   * 获取 registry 文件路径
   */
  getPath(): string {
    return this.registryPath;
  }

  /**
   * 删除 registry 文件（主要用于测试）
   */
  async delete(): Promise<void> {
    if (this.exists()) {
      fs.unlinkSync(this.registryPath);
    }
  }
}
