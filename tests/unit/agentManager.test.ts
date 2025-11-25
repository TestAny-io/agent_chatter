import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from '../../src/services/AgentManager.js';
import type { TeamContext } from '../../src/models/Team.js';
import { EventEmitter } from 'events';

// Create a mockable spawn function that can be controlled by tests
const { mockSpawn } = vi.hoisted(() => {
  return {
    mockSpawn: vi.fn()
  };
});

// Mock child_process module
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: mockSpawn
  };
});

const mockProcessManager = {
  startProcess: vi.fn(),
  registerProcess: vi.fn(),
  sendAndReceive: vi.fn(),
  stopProcess: vi.fn(),
  cleanup: vi.fn(),
  cancelSend: vi.fn()
};

const mockAgentConfigManager = {
  getAgentConfig: vi.fn(),
  createAgentConfig: vi.fn()
};

describe('AgentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create a default fake child process for spawn mock
    const defaultFakeProcess = new EventEmitter() as any;
    defaultFakeProcess.stdout = new EventEmitter();
    defaultFakeProcess.stderr = new EventEmitter();
    defaultFakeProcess.stdin = {
      write: vi.fn(),
      end: vi.fn()
    };
    defaultFakeProcess.kill = vi.fn(() => {
      // Simulate process exit when killed
      setImmediate(() => defaultFakeProcess.emit('exit', 0));
      return true;
    });
    defaultFakeProcess.killed = false;
    defaultFakeProcess.pid = 12345;

    // Set default behavior for mockSpawn
    mockSpawn.mockReturnValue(defaultFakeProcess);
  });

  it('starts agents lazily and reuses running process', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValue({
      id: 'cfg',
      type: 'claude-code',
      command: 'echo',
      args: []
    });

    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    const processId1 = await manager.ensureAgentStarted('role-1', 'cfg');
    const processId2 = await manager.ensureAgentStarted('role-1', 'cfg');

    // Stateless agents return a dummy process id and do not register with ProcessManager
    expect(processId1).toBe('stateless-role-1');
    expect(processId2).toBe('stateless-role-1');
    expect(mockProcessManager.registerProcess).not.toHaveBeenCalled();
  });

  it('sendAndReceive streams stdout and resolves with completion', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValue({
      id: 'cfg',
      type: 'claude-code',
      command: 'echo',
      args: ['--output-format=stream-json', '--verbose']
    });
    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    await manager.ensureAgentStarted('role-2', 'cfg');

    // Create a fresh fake process that exits immediately
    const fake = new EventEmitter() as any;
    fake.stdout = new EventEmitter();
    fake.stderr = new EventEmitter();
    fake.killed = false;
    fake.kill = vi.fn(() => true);
    mockSpawn.mockReturnValueOnce(fake);

    const teamContext: TeamContext = {
      teamName: 'team',
      memberName: 'role-2',
      memberDisplayName: 'Role 2',
      memberRole: 'dev'
    };

    const promise = manager.sendAndReceive('role-2', 'hello', { maxTimeout: 1000, systemFlag: 'SYS', teamContext });

    // Simulate stdout + exit
    setImmediate(() => {
      fake.stdout.emit('data', Buffer.from('result'));
      fake.emit('exit', 0);
    });

    const response = await promise;
    // accumulatedText may have some content depending on parser output
    expect(response).toMatchObject({ success: true, finishReason: 'done' });
    // Spawn should be called with -p and append system prompt
    const spawnArgs = mockSpawn.mock.calls[0][1];
    expect(spawnArgs).toContain('-p');
    expect(spawnArgs).toContain('--append-system-prompt');
    expect(spawnArgs).toContain('SYS');
    expect(spawnArgs[spawnArgs.length - 1]).toBe('hello');
  });

  it('stopAgent stops running process and removes cache', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValue({
      id: 'cfg',
      type: 'claude-code',
      command: 'echo',
      args: []
    });

    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    await manager.ensureAgentStarted('role-3', 'cfg');
    await manager.stopAgent('role-3');

    expect(mockProcessManager.stopProcess).not.toHaveBeenCalled();
    await expect(manager.sendAndReceive('role-3', 'after-stop', {
      teamContext: {
        teamName: 'team',
        memberName: 'role-3',
        memberDisplayName: 'Role 3',
        memberRole: 'dev'
      }
    })).rejects.toThrow(/no running agent/i);
  });

  it('throws when agent config missing', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValueOnce(undefined);
    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    await expect(manager.ensureAgentStarted('role-missing', 'cfg')).rejects.toThrow(/config/);
  });

  it('throws when sending without running agent', async () => {
    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    await expect(manager.sendAndReceive('no-agent', 'hello', {
      teamContext: {
        teamName: 'team',
        memberName: 'no-agent',
        memberDisplayName: 'No Agent',
        memberRole: 'dev'
      }
    })).rejects.toThrow(/no running agent/);
  });

  describe('Stateless agent cancellation', () => {
    it('resolves with cancelled when stateless agent is cancelled', async () => {
      // Create a mock stateless adapter
      const mockAdapter = {
        agentType: 'test-stateless',
        command: 'test-command',
        executionMode: 'stateless' as const,
        getDefaultArgs: () => ['--arg'],
        validate: async () => true,
        spawn: vi.fn()
      };

      // Mock config for stateless agent
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'stateless-cfg',
        type: 'test-stateless',
        command: 'test-command',
        args: [],
        cwd: '/test'
      });

      // Create fake child process
      const fakeChildProcess = new EventEmitter() as any;
      fakeChildProcess.stdout = new EventEmitter();
      fakeChildProcess.stderr = new EventEmitter();
      fakeChildProcess.kill = vi.fn();
      fakeChildProcess.killed = false;

      // Configure mockSpawn to return our fake process
      mockSpawn.mockReturnValue(fakeChildProcess);

      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );

      // Register the agent with stateless adapter
      const agentInfo = manager.getAgentInfo('stateless-role');
      if (!agentInfo) {
        // Manually set up agent instance for testing
        (manager as any).agents.set('stateless-role', {
          roleId: 'stateless-role',
          configId: 'stateless-cfg',
          processId: 'stateless-proc',
          adapter: mockAdapter,
          systemInstruction: undefined
        });
      }

      // Start sending (this will be async)
      const sendPromise = manager.sendAndReceive('stateless-role', 'test message', {
        teamContext: {
          teamName: 'team',
          memberName: 'stateless-role',
          memberDisplayName: 'Stateless',
          memberRole: 'dev'
        }
      });

      // Wait a bit for the spawn to happen
      await new Promise(resolve => setTimeout(resolve, 10));

      // Now cancel the agent
      manager.cancelAgent('stateless-role');

      // Verify kill was called
      expect(fakeChildProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Simulate process exit after being killed
      fakeChildProcess.emit('exit', null, 'SIGTERM');

      // Verify the promise resolves with cancelled (accumulatedText may be empty string)
      await expect(sendPromise).resolves.toMatchObject({ success: false, finishReason: 'cancelled' });
    });

    it('sends SIGKILL after 5 seconds if SIGTERM fails', async () => {
      vi.useFakeTimers();

      const mockAdapter = {
        agentType: 'test-stateless',
        command: 'test-command',
        executionMode: 'stateless' as const,
        getDefaultArgs: () => [],
        validate: async () => true,
        spawn: vi.fn()
      };

      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'stateless-cfg',
        type: 'test-stateless',
        command: 'test-command',
        args: []
      });

      const fakeChildProcess = new EventEmitter() as any;
      fakeChildProcess.stdout = new EventEmitter();
      fakeChildProcess.stderr = new EventEmitter();
      fakeChildProcess.kill = vi.fn();
      fakeChildProcess.killed = false;

      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );

      (manager as any).agents.set('stateless-role', {
        roleId: 'stateless-role',
        configId: 'stateless-cfg',
        processId: 'stateless-proc',
        adapter: mockAdapter,
        currentStatelessProcess: fakeChildProcess
      });

      // Cancel the agent
      manager.cancelAgent('stateless-role');

      // Verify SIGTERM was sent
      expect(fakeChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(fakeChildProcess.kill).toHaveBeenCalledTimes(1);

      // Advance time by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      // Verify SIGKILL was sent
      expect(fakeChildProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(fakeChildProcess.kill).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('Stateful agent cancellation', () => {
    it('calls ProcessManager.cancelSend for stateful agents', async () => {
      const mockAdapter = {
        agentType: 'test-stateful',
        command: 'test-command',
        executionMode: 'stateful' as const,
        getDefaultArgs: () => [],
        validate: async () => true,
        spawn: vi.fn()
      };

      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'stateful-cfg',
        type: 'test-stateful',
        command: 'test-command',
        args: []
      });

      mockProcessManager.registerProcess.mockReturnValue('stateful-proc');

      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );

      // Set up stateful agent instance
      (manager as any).agents.set('stateful-role', {
        roleId: 'stateful-role',
        configId: 'stateful-cfg',
        processId: 'stateful-proc',
        adapter: mockAdapter
      });

      // Cancel the agent
      manager.cancelAgent('stateful-role');

      // Verify cancelSend was called
      expect(mockProcessManager.cancelSend).toHaveBeenCalledWith('stateful-proc');
    });
  });

  describe('Bug fix: Agent restart after cancellation', () => {
    it('removes agent instance from cache after cancellation', () => {
      const mockAdapter = {
        agentType: 'test-stateful',
        command: 'test-command',
        executionMode: 'stateful' as const,
        getDefaultArgs: () => [],
        validate: async () => true,
        spawn: vi.fn()
      };

      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );

      // Manually set up agent instance (simulating ensureAgentStarted)
      (manager as any).agents.set('restart-role', {
        roleId: 'restart-role',
        configId: 'restart-cfg',
        processId: 'proc-1',
        adapter: mockAdapter
      });

      // Verify agent is cached
      expect(manager.isRunning('restart-role')).toBe(true);

      // Cancel the agent
      manager.cancelAgent('restart-role');

      // Verify agent is removed from cache
      // This ensures next ensureAgentStarted() will create new instance
      expect(manager.isRunning('restart-role')).toBe(false);
    });

    it('cancelAgent deletes instance for stateless agents too', () => {
      const mockAdapter = {
        agentType: 'test-stateless',
        command: 'test-command',
        executionMode: 'stateless' as const,
        getDefaultArgs: () => [],
        validate: async () => true,
        spawn: vi.fn()
      };

      const fakeChildProcess = new EventEmitter() as any;
      fakeChildProcess.kill = vi.fn();
      fakeChildProcess.killed = false;

      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );

      // Set up stateless agent instance
      (manager as any).agents.set('stateless-role', {
        roleId: 'stateless-role',
        configId: 'stateless-cfg',
        processId: 'stateless-proc',
        adapter: mockAdapter,
        currentStatelessProcess: fakeChildProcess
      });

      // Verify agent is cached
      expect(manager.isRunning('stateless-role')).toBe(true);

      // Cancel the agent
      manager.cancelAgent('stateless-role');

      // Verify agent is removed from cache
      expect(manager.isRunning('stateless-role')).toBe(false);

      // Verify process was killed
      expect(fakeChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('Event emissions and lifecycle', () => {
    it('emits team metadata and completion via parser events', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--output-format=stream-json']
      });
      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );
      await manager.ensureAgentStarted('role-meta', 'cfg');

      const fake = new EventEmitter() as any;
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      fake.killed = false;
      fake.kill = vi.fn(() => true);
      mockSpawn.mockReturnValueOnce(fake);

      const events: any[] = [];
      manager.getEventEmitter().on('agent-event', (ev) => events.push(ev));

      const teamContext: TeamContext = {
        teamName: 'teamX',
        memberName: 'role-meta',
        memberDisplayName: 'Role Meta',
        memberRole: 'dev'
      };

      const promise = manager.sendAndReceive('role-meta', 'msg', { maxTimeout: 500, teamContext });

      setImmediate(() => {
        fake.stdout.emit('data', Buffer.from('{"type":"system","subtype":"init"}\n{"type":"message_stop","stop_reason":"end_turn"}\n'));
        fake.emit('exit', 0);
      });

      await promise;
      expect(events.some(e => e.teamMetadata?.teamName === 'teamX')).toBe(true);
      expect(events.some(e => e.type === 'turn.completed')).toBe(true);
    });

    it('resolves timeout with turn.completed timeout event', async () => {
      vi.useFakeTimers();
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--output-format=stream-json']
      });
      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );
      await manager.ensureAgentStarted('role-timeout', 'cfg');

      const fake = new EventEmitter() as any;
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      fake.killed = false;
      fake.kill = vi.fn(() => true);
      mockSpawn.mockReturnValueOnce(fake);

      const events: any[] = [];
      manager.getEventEmitter().on('agent-event', (ev) => events.push(ev));

      const promise = manager.sendAndReceive('role-timeout', 'msg', { maxTimeout: 10, teamContext: {
        teamName: 'team',
        memberName: 'role-timeout',
        memberDisplayName: 'Role Timeout',
        memberRole: 'dev'
      }});

      await vi.advanceTimersByTimeAsync(20);
      await promise;

      expect(events.some(e => e.type === 'turn.completed' && e.finishReason === 'timeout')).toBe(true);
      vi.useRealTimers();
    });

    it('rejects when process exits unexpectedly without completion', async () => {
      mockAgentConfigManager.getAgentConfig.mockResolvedValue({
        id: 'cfg',
        type: 'claude-code',
        command: 'echo',
        args: ['--output-format=stream-json']
      });
      const manager = new AgentManager(
        mockProcessManager as any,
        mockAgentConfigManager as any
      );
      await manager.ensureAgentStarted('role-crash', 'cfg');

      const fake = new EventEmitter() as any;
      fake.stdout = new EventEmitter();
      fake.stderr = new EventEmitter();
      fake.killed = false;
      fake.kill = vi.fn(() => true);
      mockSpawn.mockReturnValueOnce(fake);

      const promise = manager.sendAndReceive('role-crash', 'msg', { teamContext: {
        teamName: 'team',
        memberName: 'role-crash',
        memberDisplayName: 'Role Crash',
        memberRole: 'dev'
      }});

      setImmediate(() => {
        fake.emit('exit', 1);
      });

      await expect(promise).rejects.toThrow(/unexpectedly/);
    });
  });
});
