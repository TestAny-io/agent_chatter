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
  endMarker: string;      // 响应结束标记
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
    this.registryPath = registryPath || this.getDefaultRegistryPath();
  }

  /**
   * 获取默认的 registry 文件路径
   */
  private getDefaultRegistryPath(): string {
    return path.join(os.homedir(), '.agent-chatter', 'agents', 'config.json');
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
