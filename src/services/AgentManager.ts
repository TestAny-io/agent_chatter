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
import type { TeamContext } from '../models/Team.js';
import { EventEmitter } from 'events';
import { StreamParserFactory } from '../events/StreamParserFactory.js';
import type { AgentEvent, AgentType } from '../events/AgentEvent.js';
import { randomUUID } from 'crypto';

/**
 * Agent 实例信息
 */
interface AgentInstance {
  roleId: string;
  configId: string;
  processId: string;
  cleanup?: () => Promise<void>;  // Adapter cleanup function
  adapter: IAgentAdapter;
  systemInstruction?: string;  // Store for use in sendAndReceive()
  currentStatelessProcess?: import('child_process').ChildProcess;  // For stateless mode cancellation
}

/**
 * Member-specific configuration for spawning agents
 * Extracted from Member model to avoid circular dependencies
 */
export interface MemberSpawnConfig {
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
  // Event bus for streaming events
  private eventEmitter: EventEmitter = new EventEmitter();

  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  /**
   * 确保 Agent 已启动（懒加载）
   *
   * 如果 Agent 已经在运行，返回现有的 process ID
   * 否则启动新的 Agent 进程
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
      workDir: config.cwd || process.cwd(),
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
      adapter: adapter,
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
    options: Partial<SendOptions> & { systemFlag?: string; teamContext: TeamContext }
  ): Promise<{ success: boolean; finishReason?: 'done' | 'error' | 'cancelled' | 'timeout'; accumulatedText?: string }> {
    const agent = this.agents.get(roleId);
    if (!agent) {
      throw new Error(`Role ${roleId} has no running agent`);
    }

    // 获取配置用于追加参数、环境等
    const config = await this.agentConfigManager.getAgentConfig(agent.configId);

    // Stateless-only: stateful agents are not supported in streaming mode
    if (agent.adapter.executionMode !== 'stateless') {
      throw new Error('Stateful agents are not supported in streaming mode');
    }

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

    const teamContext = options.teamContext;

    return new Promise((resolve, reject) => {
      const childProcess = spawn(agent.adapter.command, args, {
        cwd: spawnConfig.workDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const parser = StreamParserFactory.create(agent.adapter.agentType, roleId, teamContext);

      // Store childProcess for cancellation
      agent.currentStatelessProcess = childProcess;

      let stderr = '';
      let hasCompleted = false;
      let accumulatedText = '';  // Accumulate result text for routing queue
      const debugPrefix = process.env.DEBUG ? `[Agent:${agent.adapter.agentType}:${roleId}]` : null;

      const emitEvents = (events: AgentEvent[]) => {
        for (const event of events) {
          this.eventEmitter.emit('agent-event', event);

          // Accumulate text from text events for routing queue
          // Only accumulate from 'result' category (Claude's final result) or 'message' category (Codex/Gemini)
          // Skip 'assistant-message' (streaming chunks) and 'reasoning' (internal thoughts) to avoid duplicates
          if (event.type === 'text' && event.text) {
            const category = event.category;
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

      childProcess.stdout!.on('data', (chunk: Buffer) => {
        const events = parser.parseChunk(chunk);
        emitEvents(events);

        if (debugPrefix) {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) {
              // eslint-disable-next-line no-console
              console.error(`${debugPrefix} stdout ${line}`);
            }
          }
        }
      });

      childProcess.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (debugPrefix) {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) {
              // eslint-disable-next-line no-console
              console.error(`${debugPrefix} stderr ${line}`);
            }
          }
        }
      });

      const timeoutMs = options?.maxTimeout ?? 300000; // default 5min
      const timeoutHandle = setTimeout(() => {
        if (!hasCompleted) {
          hasCompleted = true;
          childProcess.kill('SIGTERM');
          emitSynthetic({ type: 'turn.completed', finishReason: 'timeout' });
          resolve({ success: false, finishReason: 'timeout', accumulatedText });
        }
      }, timeoutMs);

      childProcess.on('error', (error) => {
        agent.currentStatelessProcess = undefined;
        this.statelessCancellations.delete(roleId);
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

      childProcess.on('exit', (code, signal) => {
        agent.currentStatelessProcess = undefined;

        // Check if this process was cancelled by user
        const wasCancelled = this.statelessCancellations.get(roleId);
        this.statelessCancellations.delete(roleId);

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
}
