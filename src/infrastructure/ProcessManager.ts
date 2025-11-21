/**
 * ProcessManager - 管理子进程的生命周期
 *
 * 负责启动、停止和管理 CLI Agent 进程
 * 提供进程间通信的封装
 *
 * 简化版：仅支持普通 child_process，不支持 PTY
 */

import { spawn, ChildProcess } from 'child_process';

export interface ProcessConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface SendOptions {
  timeout?: number;  // 总超时时间（毫秒），默认 30000ms (30秒)
  endMarker?: string;  // 响应结束标记，例如 "[END]"
  idleTimeout?: number;  // 空闲超时（毫秒），默认 3000ms (3秒)。仅在没有 endMarker 时使用
  useEndOfMessageMarker?: boolean;  // 是否添加 [END_OF_MESSAGE] 标记（仅用于自定义测试 agents）
}

interface ManagedProcess {
  id: string;
  process: ChildProcess;
  config: ProcessConfig;
  running: boolean;
  outputBuffer: string;  // 缓冲启动时的输出
}

/**
 * ProcessManager 类
 */
export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private outputCallbacks: Map<string, (data: string) => void> = new Map();

  /**
   * 启动一个新进程
   */
  async startProcess(config: ProcessConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      const processId = this.generateProcessId();


      const childProcess = spawn(config.command, config.args, {
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });


      const managed: ManagedProcess = {
        id: processId,
        process: childProcess,
        config,
        running: true,
        outputBuffer: ''  // 初始化输出缓冲区
      };

      // 处理进程错误
      childProcess.on('error', (error) => {
        managed.running = false;
        this.processes.delete(processId);
        reject(error);
      });

      // 处理进程退出
      childProcess.on('exit', (_code, _signal) => {
        managed.running = false;
        this.outputCallbacks.delete(processId);
      });

      // 处理 stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        const callback = this.outputCallbacks.get(processId);
        if (callback) {
          callback(output);
        } else {
          // 如果还没有设置回调，缓冲输出
          managed.outputBuffer += output;
        }
      });

      // 处理 stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const error = data.toString();
        const callback = this.outputCallbacks.get(processId);
        if (callback) {
          callback(error);
        } else {
          // 如果还没有设置回调，缓冲输出
          managed.outputBuffer += error;
        }
      });

      // 进程启动成功
      this.processes.set(processId, managed);
      resolve(processId);
    });
  }

  /**
   * Register an already-spawned process
   * This is used when the process is spawned by an adapter
   *
   * @param childProcess - The spawned child process
   * @param config - Process configuration (for reference)
   * @param customStreams - Optional custom streams to monitor instead of process stdout/stderr
   * @returns Process ID
   */
  registerProcess(
    childProcess: ChildProcess,
    config: ProcessConfig,
    customStreams?: { stdout?: NodeJS.ReadableStream; stderr?: NodeJS.ReadableStream }
  ): string {
    const processId = this.generateProcessId();

    const managed: ManagedProcess = {
      id: processId,
      process: childProcess,
      config,
      running: true,
      outputBuffer: ''
    };

    // Set up event handlers
    childProcess.on('error', () => {
      managed.running = false;
      this.processes.delete(processId);
    });

    childProcess.on('exit', () => {
      managed.running = false;
      this.outputCallbacks.delete(processId);
    });

    // Use custom streams if provided, otherwise use process streams
    const stdoutStream = customStreams?.stdout || childProcess.stdout;
    const stderrStream = customStreams?.stderr || childProcess.stderr;

    // Handle stdout
    stdoutStream?.on('data', (data: Buffer) => {
      const output = data.toString();
      const callback = this.outputCallbacks.get(processId);
      if (callback) {
        callback(output);
      } else {
        managed.outputBuffer += output;
      }
    });

    // Handle stderr
    stderrStream?.on('data', (data: Buffer) => {
      const error = data.toString();
      const callback = this.outputCallbacks.get(processId);
      if (callback) {
        callback(error);
      } else {
        managed.outputBuffer += error;
      }
    });

    this.processes.set(processId, managed);
    return processId;
  }

  /**
   * 向进程发送输入并等待响应
   */
  async sendAndReceive(
    processId: string,
    input: string,
    options?: SendOptions
  ): Promise<string> {
    const managed = this.processes.get(processId);
    if (!managed) {
      throw new Error(`Process not found: ${processId}`);
    }

    if (!managed.running) {
      throw new Error(`Process not running: ${processId}`);
    }

    const timeout = options?.timeout ?? 30000;
    const idleTimeout = options?.idleTimeout ?? 3000;
    const endMarker = options?.endMarker;
    const useEndOfMessageMarker = options?.useEndOfMessageMarker ?? false;

    return new Promise((resolve, reject) => {
      // 先将缓冲区的内容加入到输出
      let output = managed.outputBuffer;
      managed.outputBuffer = '';  // 清空缓冲区

      let timeoutTimer: NodeJS.Timeout | null = null;
      let idleTimer: NodeJS.Timeout | null = null;

      // 清理函数
      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        this.outputCallbacks.delete(processId);
      };

      // 检查缓冲区中是否已经包含结束标记
      if (endMarker && output.includes(endMarker)) {
        const result = output.substring(0, output.indexOf(endMarker));
        cleanup();
        resolve(result);
        return;
      }

      // 设置总超时
      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for response from process ${processId}`));
      }, timeout);

      // 重置空闲计时器的函数
      const resetIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }

        // 如果有 endMarker，不使用空闲超时
        if (endMarker) {
          return;
        }

        // 设置空闲超时
        idleTimer = setTimeout(() => {
          cleanup();
          resolve(output);
        }, idleTimeout);
      };

      // 设置输出回调
      this.outputCallbacks.set(processId, (data: string) => {
        output += data;

        // 检查是否包含结束标记
        if (endMarker && output.includes(endMarker)) {
          // 去除结束标记
          output = output.substring(0, output.indexOf(endMarker));
          cleanup();
          resolve(output);
          return;
        }

        // 重置空闲计时器
        resetIdleTimer();
      });

      // 启动空闲计时器
      resetIdleTimer();

      // 发送输入
      let content = input;

      // 添加 [END_OF_MESSAGE] 标记（仅用于自定义测试 agents）
      if (useEndOfMessageMarker) {
        content += '\n[END_OF_MESSAGE]';
      }

      // 添加换行符
      content += '\n';


      const childProcess = managed.process;
      if (!childProcess.stdin) {
        cleanup();
        reject(new Error(`Process stdin not available: ${processId}`));
        return;
      }

      childProcess.stdin.write(content, (error) => {
        if (error) {
          cleanup();
          reject(error);
        } else {
          // 关闭 stdin 以通知进程输入已完成
          // 注意：这会导致进程在响应后退出，这是我们想要的行为
          childProcess.stdin?.end();
        }
      });
    });
  }

  /**
   * 停止进程
   */
  async stopProcess(processId: string): Promise<void> {
    const managed = this.processes.get(processId);
    if (!managed) {
      return;
    }

    return new Promise((resolve) => {
      if (!managed.running) {
        this.processes.delete(processId);
        resolve();
        return;
      }

      // 监听进程退出
      managed.process.once('exit', () => {
        this.processes.delete(processId);
        resolve();
      });

      // 发送终止信号
      managed.process.kill();

      // 设置超时（如果5秒后还没退出，强制杀死）
      setTimeout(() => {
        if (managed.running) {
          managed.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  /**
   * 清理所有进程
   */
  cleanup(): void {
    for (const [processId, _] of this.processes) {
      this.stopProcess(processId);
    }
  }

  /**
   * 生成进程 ID
   */
  private generateProcessId(): string {
    return `proc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
