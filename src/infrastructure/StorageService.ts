/**
 * StorageService - 数据持久化服务
 *
 * 使用 VSCode 的 ExtensionContext.globalState 或 workspaceState
 * - 团队配置：工作区级别（workspaceState）
 * - Agent 配置：全局级别（globalState）
 * - 会话数据：工作区级别（workspaceState）
 */

export interface IStorageService {
  // 保存数据
  save<T>(key: string, value: T): Promise<void>;

  // 读取数据
  load<T>(key: string): Promise<T | undefined>;

  // 删除数据
  delete(key: string): Promise<void>;

  // 列出所有 key
  keys(): Promise<string[]>;
}

/**
 * 存储键常量
 */
export const StorageKeys = {
  TEAMS: 'agent-chatter.teams',
  AGENTS: 'agent-chatter.agents',
  SESSIONS: 'agent-chatter.sessions'
} as const;

/**
 * 模拟的存储服务实现（用于测试）
 */
export class MockStorageService implements IStorageService {
  private storage: Map<string, any> = new Map();

  async save<T>(key: string, value: T): Promise<void> {
    this.storage.set(key, value);
  }

  async load<T>(key: string): Promise<T | undefined> {
    return this.storage.get(key) as T | undefined;
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.storage.keys());
  }

  // 测试辅助方法
  clear(): void {
    this.storage.clear();
  }
}

/**
 * VSCode 存储服务实现
 */
export class VSCodeStorageService implements IStorageService {
  constructor(
    private globalState: any,  // vscode.Memento
    private workspaceState: any  // vscode.Memento
  ) {}

  async save<T>(key: string, value: T): Promise<void> {
    const state = this.getState(key);
    await state.update(key, value);
  }

  async load<T>(key: string): Promise<T | undefined> {
    const state = this.getState(key);
    return state.get(key) as T | undefined;
  }

  async delete(key: string): Promise<void> {
    const state = this.getState(key);
    await state.update(key, undefined);
  }

  async keys(): Promise<string[]> {
    // VSCode Memento 不提供 keys() 方法，所以我们需要维护一个已知的键列表
    // 这里返回我们定义的所有存储键
    return Object.values(StorageKeys);
  }

  private getState(key: string): any {
    // Agent 配置使用全局状态，其他使用工作区状态
    if (key === StorageKeys.AGENTS) {
      return this.globalState;
    }
    return this.workspaceState;
  }
}

/**
 * File-based storage service implementation (for UAT and integration tests)
 */
export class FileStorageService implements IStorageService {
  private fs = require('fs');
  private path = require('path');

  constructor(private storageDir: string) {
    // Ensure storage directory exists
    if (!this.fs.existsSync(storageDir)) {
      this.fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  async save<T>(key: string, value: T): Promise<void> {
    const filePath = this.getFilePath(key);
    const data = JSON.stringify(value, null, 2);
    this.fs.writeFileSync(filePath, data, 'utf-8');
  }

  async load<T>(key: string): Promise<T | undefined> {
    const filePath = this.getFilePath(key);
    if (!this.fs.existsSync(filePath)) {
      return undefined;
    }
    const data = this.fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    if (this.fs.existsSync(filePath)) {
      this.fs.unlinkSync(filePath);
    }
  }

  async keys(): Promise<string[]> {
    if (!this.fs.existsSync(this.storageDir)) {
      return [];
    }
    const files = this.fs.readdirSync(this.storageDir);
    return files.map((file: string) => file.replace('.json', ''));
  }

  private getFilePath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9\-_.]/g, '_');
    return this.path.join(this.storageDir, `${safeKey}.json`);
  }
}
