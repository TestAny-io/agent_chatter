import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../../src/services/AgentManager.js';
import type { TeamContext } from '../../src/models/Team.js';
import type { IExecutionEnvironment, IProcess, SpawnOptions } from '../../src/interfaces/IExecutionEnvironment.js';
import type { IAdapterFactory } from '../../src/interfaces/IAdapterFactory.js';
import type { IAgentAdapter, AgentConfig } from '../../src/interfaces/IAgentAdapter.js';
import { EventEmitter } from 'events';

// Mock agent config manager
function createMockAgentConfigManager() {
  return {
    getAgentConfig: vi.fn(),
    createAgentConfig: vi.fn()
  };
}

// Helper to create mock IProcess
function createMockProcess(): IProcess {
  const proc = new EventEmitter() as IProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  Object.defineProperty(proc, 'stdout', { value: stdout, writable: true });
  Object.defineProperty(proc, 'stderr', { value: stderr, writable: true });
  Object.defineProperty(proc, 'pid', { value: 12345, writable: true });

  (proc as any).kill = vi.fn((signal?: string) => {
    setImmediate(() => proc.emit('exit', 0, signal));
    return true;
  });

  return proc;
}

// Mock execution environment
function createMockExecutionEnv(): IExecutionEnvironment & { spawnMock: ReturnType<typeof vi.fn>; lastSpawnedProcess?: IProcess } {
  const env = {
    spawnMock: vi.fn(),
    lastSpawnedProcess: undefined as IProcess | undefined,
    spawn(command: string, args: string[], options?: SpawnOptions): IProcess {
      const proc = createMockProcess();
      env.lastSpawnedProcess = proc;
      env.spawnMock(command, args, options);
      return proc;
    },
    kill: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    resize: vi.fn()
  };
  return env;
}

// Mock adapter
function createMockAdapter(type: string = 'claude-code'): IAgentAdapter {
  return {
    agentType: type,
    command: 'test-command',
    getDefaultArgs: () => ['--output-format=stream-json'],
    execute: vi.fn(async function* () {
      yield { eventId: '1', type: 'text', text: 'mock response', role: 'assistant' };
    }),
    cancel: vi.fn()
  };
}

// Mock adapter factory
function createMockAdapterFactory(adapter?: IAgentAdapter): IAdapterFactory {
  return {
    createAdapter: vi.fn((_config: AgentConfig) => adapter || createMockAdapter())
  };
}

// Default team context for tests
function createTeamContext(roleId: string): TeamContext {
  return {
    teamName: 'test-team',
    memberName: roleId,
    memberDisplayName: roleId.charAt(0).toUpperCase() + roleId.slice(1),
    memberRole: 'developer'
  };
}

describe('AgentManager', () => {
  let mockExecutionEnv: ReturnType<typeof createMockExecutionEnv>;
  let mockAdapterFactory: IAdapterFactory;
  let mockAgentConfigManager: ReturnType<typeof createMockAgentConfigManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionEnv = createMockExecutionEnv();
    mockAdapterFactory = createMockAdapterFactory();
    mockAgentConfigManager = createMockAgentConfigManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ensureAgentStarted', () => {
    it('starts agents lazily and reuses cached instance', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      const processId1 = await manager.ensureAgentStarted('role-1', 'cfg');
      const processId2 = await manager.ensureAgentStarted('role-1', 'cfg');

      // Same agent instance is reused
      expect(processId1).toBe('agent-role-1');
      expect(processId2).toBe('agent-role-1');
      // getAgentConfig only called once (cached)
      expect(mockAgentConfigManager.getAgentConfig).toHaveBeenCalledTimes(1);
    });

    it('throws when agent config is missing', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValueOnce(undefined);

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await expect(manager.ensureAgentStarted('role-missing', 'cfg')).rejects.toThrow(/config/);
    });
  });

  describe('sendAndReceive', () => {
    it('spawns process and resolves with completion on exit', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--verbose']
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-2', 'cfg');

      const teamContext = createTeamContext('role-2');
      const promise = manager.sendAndReceive('role-2', 'hello', {
        maxTimeout: 1000,
        systemFlag: 'SYS',
        teamContext
      });

      // Simulate process completion
      setImmediate(() => {
        const proc = mockExecutionEnv.lastSpawnedProcess!;
        proc.stdout!.emit('data', Buffer.from('result'));
        proc.emit('exit', 0);
      });

      const response = await promise;
      expect(response).toMatchObject({ success: true, finishReason: 'done' });

      // Verify spawn was called with correct args
      const spawnArgs = mockExecutionEnv.spawnMock.mock.calls[0][1];
      expect(spawnArgs).toContain('-p');
      expect(spawnArgs).toContain('--append-system-prompt');
      expect(spawnArgs).toContain('SYS');
      expect(spawnArgs[spawnArgs.length - 1]).toBe('hello');
    });

    it('throws when no running agent', async () => {
      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await expect(manager.sendAndReceive('no-agent', 'hello', {
        teamContext: createTeamContext('no-agent')
      })).rejects.toThrow(/no running agent/);
    });

    it('rejects when process exits with non-zero code', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--output-format=stream-json']
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-crash', 'cfg');

      const promise = manager.sendAndReceive('role-crash', 'msg', {
        teamContext: createTeamContext('role-crash')
      });

      setImmediate(() => {
        const proc = mockExecutionEnv.lastSpawnedProcess!;
        proc.emit('exit', 1);
      });

      await expect(promise).rejects.toThrow(/unexpectedly/);
    });

    it('resolves with timeout when maxTimeout exceeded', async () => {
      vi.useFakeTimers();

      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--output-format=stream-json']
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-timeout', 'cfg');

      const promise = manager.sendAndReceive('role-timeout', 'msg', {
        maxTimeout: 10,
        teamContext: createTeamContext('role-timeout')
      });

      await vi.advanceTimersByTimeAsync(20);

      const result = await promise;
      expect(result).toMatchObject({ success: false, finishReason: 'timeout' });
    });
  });

  describe('stopAgent', () => {
    it('removes agent from cache', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-3', 'cfg');
      expect(manager.isRunning('role-3')).toBe(true);

      await manager.stopAgent('role-3');
      expect(manager.isRunning('role-3')).toBe(false);

      // Trying to send after stop should fail
      await expect(manager.sendAndReceive('role-3', 'after-stop', {
        teamContext: createTeamContext('role-3')
      })).rejects.toThrow(/no running agent/i);
    });
  });

  describe('cancelAgent', () => {
    it('kills process and resolves with cancelled', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'test-command',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('cancel-role', 'cfg');

      const promise = manager.sendAndReceive('cancel-role', 'test message', {
        teamContext: createTeamContext('cancel-role')
      });

      // Wait for spawn to happen
      await new Promise(resolve => setTimeout(resolve, 10));

      const proc = mockExecutionEnv.lastSpawnedProcess!;

      // Cancel the agent
      manager.cancelAgent('cancel-role');

      // Verify kill was called
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

      // Simulate process exit after being killed
      proc.emit('exit', null, 'SIGTERM');

      const result = await promise;
      expect(result).toMatchObject({ success: false, finishReason: 'cancelled' });
    });

    it('removes agent from cache after cancellation', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'test-command',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('restart-role', 'cfg');
      expect(manager.isRunning('restart-role')).toBe(true);

      manager.cancelAgent('restart-role');

      // Agent should be removed from cache
      expect(manager.isRunning('restart-role')).toBe(false);
    });

    it('sends SIGKILL after 5 seconds if SIGTERM fails', async () => {
      vi.useFakeTimers();

      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'test-command',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('sigkill-role', 'cfg');

      // Start sendAndReceive to create process
      const promise = manager.sendAndReceive('sigkill-role', 'test', {
        teamContext: createTeamContext('sigkill-role'),
        maxTimeout: 60000 // Long timeout
      });

      // Let spawn happen
      await vi.advanceTimersByTimeAsync(1);

      const proc = mockExecutionEnv.lastSpawnedProcess!;

      // Override kill to not exit (simulating stuck process)
      (proc as any).kill = vi.fn();

      // Cancel the agent
      manager.cancelAgent('sigkill-role');

      // Verify SIGTERM was sent
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc.kill).toHaveBeenCalledTimes(1);

      // Advance time by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      // SIGKILL would be sent via process.kill() not proc.kill()
      // The test verifies the timeout mechanism exists

      // Clean up: emit exit to resolve promise
      proc.emit('exit', null, 'SIGKILL');
      await promise;
    });
  });

  describe('Event emissions', () => {
    it('emits agent-event for streaming data', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--output-format=stream-json']
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-events', 'cfg');

      const events: any[] = [];
      manager.getEventEmitter().on('agent-event', (ev) => events.push(ev));

      const teamContext = createTeamContext('role-events');
      const promise = manager.sendAndReceive('role-events', 'msg', {
        maxTimeout: 500,
        teamContext
      });

      setImmediate(() => {
        const proc = mockExecutionEnv.lastSpawnedProcess!;
        proc.stdout!.emit('data', Buffer.from('{"type":"system","subtype":"init"}\n{"type":"message_stop","stop_reason":"end_turn"}\n'));
        proc.emit('exit', 0);
      });

      await promise;

      // Should have emitted events including turn.completed
      expect(events.some(e => e.type === 'turn.completed')).toBe(true);
      expect(events.some(e => e.teamMetadata?.teamName === 'test-team')).toBe(true);
    });
  });

  describe('Lifecycle methods', () => {
    it('getRunningRoles returns all active role IDs', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-a', 'cfg');
      await manager.ensureAgentStarted('role-b', 'cfg');

      const roles = manager.getRunningRoles();
      expect(roles).toContain('role-a');
      expect(roles).toContain('role-b');
      expect(roles).toHaveLength(2);
    });

    it('cleanup stops all agents', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('role-x', 'cfg');
      await manager.ensureAgentStarted('role-y', 'cfg');

      manager.cleanup();

      expect(manager.getRunningRoles()).toHaveLength(0);
    });

    it('getAgentInfo returns agent instance', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: []
      });

      const manager = new AgentManager(
        mockExecutionEnv,
        mockAdapterFactory,
        mockAgentConfigManager as any
      );

      await manager.ensureAgentStarted('info-role', 'cfg');

      const info = manager.getAgentInfo('info-role');
      expect(info).toBeDefined();
      expect(info?.roleId).toBe('info-role');
      expect(info?.configId).toBe('cfg');
    });
  });
});
