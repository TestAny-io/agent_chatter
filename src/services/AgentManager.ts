/**
 * AgentManager - 管理 Agent 实例
 *
 * 负责启动、停止和管理 Agent 进程
 * 实现懒加载（按需启动 Agent）
 * 维护 Role ID 到 Process ID 的映射
 *
 * 简化版：适配简化的 ProcessManager
 */

import { spawn } from 'child_process';
import { ProcessManager } from '../infrastructure/ProcessManager.js';
import type { SendOptions } from '../infrastructure/ProcessManager.js';
import { AgentConfigManager } from './AgentConfigManager.js';
import { AdapterFactory } from '../adapters/AdapterFactory.js';
import type { AgentSpawnConfig, IAgentAdapter } from '../adapters/IAgentAdapter.js';
import type { AgentConfig } from '../models/AgentConfig.js';

/**
 * Agent 实例信息
 */
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  cleanup?: () => Promise<void>;  // Adapter cleanup function
  adapter: IAgentAdapter;  // Store adapter for prepareMessage()
  systemInstruction?: string;  // Store for use in sendAndReceive()
  currentStatelessProcess?: import('child_process').ChildProcess;  // For stateless mode cancellation
}

/**
 * Member-specific configuration for spawning agents
 * Extracted from Member model to avoid circular dependencies
 */
export interface MemberSpawnConfig {
  workDir?: string;
  env?: Record<string, string>;
  additionalArgs?: string[];
  systemInstruction?: string;
}

/**
 * AgentManager 类
 */
export class AgentManager {
  // Role ID -> Agent Instance 的映射
  private agents: Map<string, AgentInstance> = new Map();
  // Track cancellation flags for stateless agents
  private statelessCancellations: Map<string, boolean> = new Map();

  constructor(
    private processManager: ProcessManager,
    private agentConfigManager: AgentConfigManager
  ) {}

  /**
   * 确保 Agent 已启动（懒加载）
   *
   * 如果 Agent 已经在运行，返回现有的 process ID
   * 否则启动新的 Agent 进程
   *
   * @param roleId - Role/Member ID
   * @param configId - Agent config ID
   * @param memberConfig - Optional member-specific configuration (workDir, env, additionalArgs, systemInstruction)
   */
  async ensureAgentStarted(
    roleId: string,
    configId: string,
    memberConfig?: MemberSpawnConfig
  ): Promise<string> {
    // 检查是否已经启动
    const existing = this.agents.get(roleId);
    if (existing) {
      return existing.processId;
    }

    // 获取配置
    const config = await this.agentConfigManager.getAgentConfig(configId);
    if (!config) {
      throw new Error(`Agent config ${configId} not found`);
    }

    // 创建适配器
    const adapter = AdapterFactory.createAdapter(config);

    // Check execution mode
    if (adapter.executionMode === 'stateless') {
      // Stateless mode: Don't spawn persistent process
      // Just store adapter and configuration for later use
      const agentInstance: AgentInstance = {
        roleId,
        configId,
        processId: `stateless-${roleId}`,  // Dummy process ID
        adapter: adapter,
        systemInstruction: memberConfig?.systemInstruction
      };

      this.agents.set(roleId, agentInstance);
      return agentInstance.processId;
    }

    // Stateful mode: Spawn persistent process
    // 准备 spawn 配置
    const spawnConfig: AgentSpawnConfig = {
      workDir: memberConfig?.workDir || config.cwd || process.cwd(),
      env: {
        ...config.env,
        ...memberConfig?.env
      },
      additionalArgs: [
        ...(config.args || []),
        ...(memberConfig?.additionalArgs || [])
      ],
      systemInstruction: memberConfig?.systemInstruction
    };

    // 使用适配器启动进程
    const spawnResult = await adapter.spawn(spawnConfig);

    // 将进程注册到 ProcessManager
    // Pass customStreams to ProcessManager if adapter provides them
    const processId = this.processManager.registerProcess(
      spawnResult.process,
      {
        command: config.command,
        args: config.args || [],
        env: config.env,
        cwd: spawnConfig.workDir
      },
      spawnResult.customStreams  // Pass custom streams for [DONE] marker injection
    );

    // 记录实例
    // CRITICAL: systemInstruction MUST be stored here, NOT on childProcess!
    // AgentManager.sendAndReceive() will access it from agent.systemInstruction
    this.agents.set(roleId, {
      roleId,
      configId,
      processId,
      cleanup: spawnResult.cleanup,
      adapter: adapter,  // Store adapter for prepareMessage()
      systemInstruction: memberConfig?.systemInstruction  // Store for use in sendAndReceive()
    });

    return processId;
  }

  /**
   * 发送消息并等待响应
   */
  async sendAndReceive(
    roleId: string,
    message: string,
    options?: Partial<SendOptions>
  ): Promise<string> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Role ${roleId} has no running agent`);
    }

    // 获取配置用于追加参数、环境等
    const config = await this.agentConfigManager.getAgentConfig(agent.configId);
    const producesJsonOutput = this.producesJsonOutput(config);

    // Prepare message using adapter (handles system instruction prepending)
    const preparedMessage = agent.adapter.prepareMessage(message, agent.systemInstruction);

    // Check execution mode and route accordingly
    if (agent.adapter.executionMode === 'stateless') {
      // Stateless mode: Execute one-shot command with message as CLI argument
      // We manually implement the execution logic here (instead of calling executeOneShot)
      // so we can track the childProcess for cancellation support

      const args = [...agent.adapter.getDefaultArgs()];

      // Add additional arguments from config
      if (config?.args && config.args.length > 0) {
        args.push(...config.args);
      }

      // For Claude Code CLI, ensure prompt is passed via -p to avoid launching the interactive TUI
      if (agent.adapter.agentType === 'claude-code') {
        args.push('-p');
      }

      // Add the prepared message as the final argument
      args.push(preparedMessage);

      // Merge environment variables
      const env = {
        ...process.env,
        ...config?.env
      };

      const spawnConfig: AgentSpawnConfig = {
        workDir: config?.cwd || process.cwd(),
        env: config?.env,
        additionalArgs: config?.args,
        systemInstruction: agent.systemInstruction
      };

      // Clear any previous cancellation flag
      this.statelessCancellations.delete(roleId);

      return new Promise<string>((resolve, reject) => {
        const childProcess = spawn(agent.adapter.command, args, {
          cwd: spawnConfig.workDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        });

        // Store childProcess for cancellation
        agent.currentStatelessProcess = childProcess;

        let stdout = '';
        let stderr = '';

        childProcess.stdout!.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });

        childProcess.stderr!.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        childProcess.on('error', (error) => {
          agent.currentStatelessProcess = undefined;
          this.statelessCancellations.delete(roleId);
          reject(new Error(`Failed to spawn ${agent.adapter.agentType} process: ${error.message}`));
        });

        childProcess.on('exit', (code, signal) => {
          agent.currentStatelessProcess = undefined;

          // Check if this process was cancelled by user
          const wasCancelled = this.statelessCancellations.get(roleId);
          this.statelessCancellations.delete(roleId);

          if (wasCancelled) {
            // User cancelled via ESC - reject with cancellation error
            reject(new Error('[CANCELLED_BY_USER]'));
            return;
          }

          if (code !== 0 && code !== null) {
            reject(new Error(`${agent.adapter.agentType} process exited with code ${code}. stderr: ${stderr}`));
            return;
          }

          resolve(stdout);
        });
      });
    } else {
      // Stateful mode: Use ProcessManager to send via stdin/stdout
      const sendOptions: SendOptions = {
        maxTimeout: options?.maxTimeout,
        endMarker: producesJsonOutput ? undefined : options?.endMarker,
        idleTimeout: producesJsonOutput ? 10000 : options?.idleTimeout,
        useEndOfMessageMarker: false
      };

      return this.processManager.sendAndReceive(
        agent.processId,
        preparedMessage,  // Send prepared message with [SYSTEM] if needed
        sendOptions
      );
    }
  }

  /**
   * 停止 Agent
   */
  async stopAgent(roleId: string): Promise<void> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      return;  // 静默返回
    }

    // Call adapter cleanup if available
    if (agent.cleanup) {
      await agent.cleanup();
    }

    // Only stop managed process for stateful agents
    if (agent.adapter.executionMode === 'stateful') {
      await this.processManager.stopProcess(agent.processId);
    }

    this.agents.delete(roleId);
  }

  /**
   * Cancel currently executing agent (user cancellation via ESC)
   * This will cancel the pending sendAndReceive operation
   */
  cancelAgent(roleId: string): void {
    const agent = this.agents.get(roleId);
    if (!agent) {
      return;
    }

    // For stateful mode, cancel via ProcessManager
    if (agent.adapter.executionMode === 'stateful') {
      this.processManager.cancelSend(agent.processId);
    } else if (agent.adapter.executionMode === 'stateless') {
      // For stateless mode, set cancellation flag before killing process
      // This ensures the exit handler will reject with [CANCELLED_BY_USER]
      this.statelessCancellations.set(roleId, true);

      // Kill the currently executing process
      if (agent.currentStatelessProcess) {
        agent.currentStatelessProcess.kill('SIGTERM');
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (agent.currentStatelessProcess && !agent.currentStatelessProcess.killed) {
            agent.currentStatelessProcess.kill('SIGKILL');
          }
        }, 5000);
      }
    }

    // CRITICAL: Remove agent instance from cache after cancellation
    // This ensures the next sendAndReceive() will restart the agent via ensureAgentStarted()
    // Fixes bug: "Process not found: proc-xxx" when reusing agent after cancellation
    this.agents.delete(roleId);
  }

  /**
   * 检查 Agent 是否在运行
   */
  isRunning(roleId: string): boolean {
    return this.agents.has(roleId);
  }

  /**
   * 清理所有 Agent
   */
  cleanup(): void {
    this.processManager.cleanup();
    this.agents.clear();
  }

  /**
   * 获取所有运行中的 Agent 角色 ID
   */
  getRunningRoles(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * 获取 Agent 实例信息
   */
  getAgentInfo(roleId: string): AgentInstance | undefined {
    return this.agents.get(roleId);
  }

  /**
   * Detect whether an agent configuration is set to emit JSONL output.
   * Used to avoid endMarker waiting (stream-json / --json flows emit completion events instead).
   */
  private producesJsonOutput(config?: AgentConfig): boolean {
    const args = config?.args || [];
    return args.some(arg =>
      typeof arg === 'string' &&
      (arg.includes('stream-json') || arg === '--json' || arg === '--output-format=stream-json')
    );
  }
}
