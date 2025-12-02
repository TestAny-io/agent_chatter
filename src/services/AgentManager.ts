/**
 * AgentManager - 管理 Agent 实例
 *
 * 负责启动、停止和管理 Agent 进程
 * 实现懒加载（按需启动 Agent）
 * 维护 Role ID 到 Agent Instance 的映射
 *
 * Core 层实现：仅依赖接口，不依赖具体执行实现
 */

import { AgentConfigManager } from './AgentConfigManager.js';
import type { IAdapterFactory } from '../interfaces/IAdapterFactory.js';
import type { IExecutionEnvironment, IProcess } from '../interfaces/IExecutionEnvironment.js';
import type { AgentSpawnConfig, IAgentAdapter } from '../interfaces/IAgentAdapter.js';
import type { TeamContext } from '../models/Team.js';
import { EventEmitter } from 'events';
import { StreamParserFactory } from '../events/StreamParserFactory.js';
import type { AgentEvent, AgentType } from '../events/AgentEvent.js';
import { randomUUID } from 'crypto';
import type { ILogger } from '../interfaces/ILogger.js';
import { SilentLogger } from '../interfaces/ILogger.js';

/**
 * Agent 实例信息
 */
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  cleanup?: () => Promise<void>;  // Adapter cleanup function
  adapter: IAgentAdapter;
  systemInstruction?: string | string[];  // Store for use in sendAndReceive()
  currentStatelessProcess?: IProcess;  // For cancellation
}

/**
 * Member-specific configuration for spawning agents
 * Extracted from Member model to avoid circular dependencies
 */
export interface MemberSpawnConfig {
  env?: Record<string, string>;
  additionalArgs?: string[];
  systemInstruction?: string | string[];
}

/**
 * Options for sendAndReceive
 */
export interface SendOptions {
  maxTimeout?: number;  // Maximum response timeout (ms), default 300000ms (5min)
  systemFlag?: string;  // System prompt flag for Claude
  teamContext: TeamContext;
}

/**
 * AgentManager options
 */
export interface AgentManagerOptions {
  /**
   * Proxy URL to use for Agent CLI processes
   *
   * @remarks
   * - Will be injected as https_proxy environment variable when spawning agents
   * - Takes precedence over existing https_proxy in the environment
   * - Supports http:// and https:// protocols
   * - Authentication format: http://user:pass@proxy:8080
   */
  proxyUrl?: string;

  /**
   * Logger for diagnostic messages
   */
  logger?: ILogger;
}

/**
 * AgentManager 类
 *
 * Core 层：仅依赖 IExecutionEnvironment 和 IAdapterFactory 接口
 * 所有 Agent 都是 stateless（每次 sendAndReceive 启动新进程）
 */
export class AgentManager {
  // Role ID -> Agent Instance 的映射
  private agents: Map<string, AgentInstance> = new Map();
  // Track cancellation flags for agents
  private cancellations: Map<string, boolean> = new Map();
  private logger: ILogger;
  private proxyUrl?: string;
  // Event bus for streaming events
  private eventEmitter: EventEmitter = new EventEmitter();

  constructor(
    private executionEnv: IExecutionEnvironment,
    private adapterFactory: IAdapterFactory,
    private agentConfigManager: AgentConfigManager,
    options?: AgentManagerOptions
  ) {
    this.logger = options?.logger ?? new SilentLogger();
    this.proxyUrl = options?.proxyUrl;
  }

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  /**
   * 确保 Agent 已启动（懒加载）
   *
   * 如果 Agent 已经在运行，返回现有的 process ID
   * 否则创建新的 Agent 实例（stateless 模式，不启动持久进程）
   *
   * @param roleId - Role/Member ID
   * @param configId - Agent config ID
   * @param memberConfig - Optional member-specific configuration (env, additionalArgs, systemInstruction)
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

    // 创建适配器 (using injected IAdapterFactory)
    const adapter = this.adapterFactory.createAdapter(config);

    // All agents are stateless: Don't spawn persistent process
    // Just store adapter and configuration for later use in sendAndReceive
    const agentInstance: AgentInstance = {
      roleId,
      configId,
      processId: `agent-${roleId}`,
      adapter: adapter,
      systemInstruction: memberConfig?.systemInstruction
    };

    this.agents.set(roleId, agentInstance);
    return agentInstance.processId;
  }

  /**
   * 发送消息并等待响应
   *
   * Stateless 模式：每次调用启动新进程执行命令
   */
  async sendAndReceive(
    roleId: string,
    message: string,
    options: SendOptions
  ): Promise<{ success: boolean; finishReason?: 'done' | 'error' | 'cancelled' | 'timeout'; accumulatedText?: string }> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Role ${roleId} has no running agent`);
    }

    // 获取配置用于追加参数、环境等
    const config = await this.agentConfigManager.getAgentConfig(agent.configId);

    const args = [...agent.adapter.getDefaultArgs()];

    // Add additional arguments from config
    if (config?.args && config.args.length > 0) {
      args.push(...config.args);
    }

    // For Claude Code CLI, ensure prompt is passed via -p to avoid launching the interactive TUI
    if (agent.adapter.agentType === 'claude-code') {
      args.push('-p');
    }

    // Add system prompt flag when provided (Claude)
    if (options?.systemFlag && agent.adapter.agentType === 'claude-code') {
      args.push('--append-system-prompt', options.systemFlag);
    }

    // Add the message as the final argument
    args.push(message);

    const spawnConfig: AgentSpawnConfig = {
      workDir: config?.cwd || process.cwd(),
      env: config?.env,
      additionalArgs: config?.args,
      systemInstruction: agent.systemInstruction
    };

    // Inject proxy URL as environment variables if configured
    // This ensures Agent CLI processes use the same proxy as the connectivity check
    // Set all standard proxy environment variables for maximum compatibility
    let envWithProxy = spawnConfig.env;
    if (this.proxyUrl) {
      envWithProxy = {
        ...spawnConfig.env,
        https_proxy: this.proxyUrl,
        HTTPS_PROXY: this.proxyUrl,
        http_proxy: this.proxyUrl,
        HTTP_PROXY: this.proxyUrl,
      };
      this.logger.debug(`[AgentManager] Injecting proxy for ${roleId}: ${this.proxyUrl}`);
    }

    // Clear any previous cancellation flag
    this.cancellations.delete(roleId);

    const teamContext = options.teamContext;

    return new Promise((resolve, reject) => {
      // Use IExecutionEnvironment for spawning process
      const iProcess = this.executionEnv.spawn(agent.adapter.command, args, {
        cwd: spawnConfig.workDir,
        env: envWithProxy,
        inheritEnv: true
      });
      const parser = StreamParserFactory.create(agent.adapter.agentType, roleId, teamContext);

      // Store process for cancellation
      agent.currentStatelessProcess = iProcess;

      let stderr = '';
      let hasCompleted = false;
      let accumulatedText = '';  // Accumulate result text for routing queue
      const logPrefix = `[Agent:${agent.adapter.agentType}:${roleId}]`;

      const emitEvents = (events: AgentEvent[]) => {
        for (const event of events) {
          this.eventEmitter.emit('agent-event', event);

          // Accumulate text from text events for routing queue
          // Only accumulate from 'result' category (Claude's final result) or 'message' category (Codex/Gemini)
          // Skip 'assistant-message' (streaming chunks) and 'reasoning' (internal thoughts) to avoid duplicates
          if (event.type === 'text' && event.text) {
            const category = event.category;
            // For Claude, ignore category-less text (typically fallback raw JSON) to avoid leaking raw JSON
            const isClaude = event.agentType === 'claude-code';
            if (isClaude && category === undefined) {
              continue;
            }
            // Claude: use 'result' (final complete response from result event)
            // Codex/Gemini: use 'message' or undefined (their text events are final)
            if (category === 'result' || category === 'message' || category === undefined) {
              accumulatedText += event.text;
            }
          }

          if (event.type === 'turn.completed' && !hasCompleted) {
            hasCompleted = true;
            clearTimeout(timeoutHandle);
            resolve({ success: event.finishReason === 'done', finishReason: event.finishReason, accumulatedText });
          }
        }
      };

      const emitSynthetic = (event: any) => {
        emitEvents([{
          ...event,
          eventId: randomUUID(),
          agentId: roleId,
          agentType: agent.adapter.agentType as AgentType,
          teamMetadata: teamContext,
          timestamp: Date.now()
        } as AgentEvent]);
      };

      iProcess.stdout?.on('data', (chunk: Buffer) => {
        const events = parser.parseChunk(chunk);
        emitEvents(events);

        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) {
            this.logger.debug(`${logPrefix} stdout ${line}`);
          }
        }
      });

      iProcess.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) {
            this.logger.debug(`${logPrefix} stderr ${line}`);
          }
        }
      });

      const timeoutMs = options?.maxTimeout ?? 300000; // default 5min
      const timeoutHandle = setTimeout(() => {
        if (!hasCompleted) {
          hasCompleted = true;
          iProcess.kill('SIGTERM');
          emitSynthetic({ type: 'turn.completed', finishReason: 'timeout' });
          resolve({ success: false, finishReason: 'timeout', accumulatedText });
        }
      }, timeoutMs);

      iProcess.on('error', (error) => {
        agent.currentStatelessProcess = undefined;
        this.cancellations.delete(roleId);
        if (!hasCompleted) {
          hasCompleted = true;
          clearTimeout(timeoutHandle);
          emitSynthetic({
            type: 'error',
            error: `Failed to spawn ${agent.adapter.agentType} process: ${error.message}`,
            code: 'PROCESS_SPAWN_ERROR'
          });
          reject(new Error(`Failed to spawn ${agent.adapter.agentType} process: ${error.message}`));
        }
      });

      iProcess.on('exit', (code, signal) => {
        agent.currentStatelessProcess = undefined;

        // Check if this process was cancelled by user
        const wasCancelled = this.cancellations.get(roleId);
        this.cancellations.delete(roleId);

        // Flush remaining buffer
        const remaining = parser.flush();
        emitEvents(remaining);

        if (wasCancelled) {
          if (!hasCompleted) {
            hasCompleted = true;
            clearTimeout(timeoutHandle);
            emitSynthetic({ type: 'turn.completed', finishReason: 'cancelled' });
            resolve({ success: false, finishReason: 'cancelled', accumulatedText });
          }
          return;
        }

        if (!hasCompleted) {
          hasCompleted = true;
          clearTimeout(timeoutHandle);

          // If the agent never emitted completion and exited with error, treat as crash
          if (code !== 0 && code !== null) {
            emitSynthetic({
              type: 'error',
              error: `${agent.adapter.agentType} process exited unexpectedly with code ${code}. stderr: ${stderr}`,
              code: 'PROCESS_EXIT'
            });
            reject(new Error(`${agent.adapter.agentType} process exited unexpectedly with code ${code}. stderr: ${stderr}`));
            return;
          }

          // code is 0/null but no turn.completed observed — emit a fallback completion
          emitSynthetic({ type: 'turn.completed', finishReason: 'done' });
          resolve({ success: true, finishReason: 'done', accumulatedText });
        }
      });
    });
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

    // Kill current process if running
    if (agent.currentStatelessProcess) {
      agent.currentStatelessProcess.kill('SIGTERM');
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

    // Set cancellation flag before killing process
    // This ensures the exit handler will resolve with 'cancelled'
    this.cancellations.set(roleId, true);

    // Kill the currently executing process
    if (agent.currentStatelessProcess) {
      const proc = agent.currentStatelessProcess;
      proc.kill('SIGTERM');
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (proc.pid !== undefined) {
          try {
            process.kill(proc.pid, 0); // Check if still alive
            proc.kill('SIGKILL');
          } catch {
            // Process already dead
          }
        }
      }, 5000);
    }

    // CRITICAL: Remove agent instance from cache after cancellation
    // This ensures the next sendAndReceive() will restart the agent via ensureAgentStarted()
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
    // Kill all running processes
    for (const agent of this.agents.values()) {
      if (agent.currentStatelessProcess) {
        agent.currentStatelessProcess.kill('SIGTERM');
      }
    }
    this.agents.clear();
    this.cancellations.clear();
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
}
