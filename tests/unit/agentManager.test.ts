import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from '../../src/services/AgentManager.js';

const mockProcessManager = {
  startProcess: vi.fn(),
  sendAndReceive: vi.fn(),
  stopProcess: vi.fn(),
  cleanup: vi.fn()
};

const mockAgentConfigManager = {
  getAgentConfig: vi.fn(),
  createAgentConfig: vi.fn()
};

describe('AgentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts agents lazily and reuses running process', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValue({
      id: 'cfg',
      command: 'echo',
      args: []
    });
    mockProcessManager.startProcess.mockResolvedValue('proc-1');

    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    const processId1 = await manager.ensureAgentStarted('role-1', 'cfg');
    const processId2 = await manager.ensureAgentStarted('role-1', 'cfg');

    expect(processId1).toBe('proc-1');
    expect(processId2).toBe('proc-1');
    expect(mockProcessManager.startProcess).toHaveBeenCalledTimes(1);
  });

  it('sendAndReceive applies endMarker and options', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValue({
      id: 'cfg',
      command: 'echo',
      args: [],
      endMarker: '[DONE]',
      useEndOfMessageMarker: false
    });
    mockProcessManager.startProcess.mockResolvedValue('proc-2');
    mockProcessManager.sendAndReceive.mockResolvedValue('result');

    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    await manager.ensureAgentStarted('role-2', 'cfg');
    const response = await manager.sendAndReceive('role-2', 'hello', { timeout: 1000 });

    expect(response).toBe('result');
    expect(mockProcessManager.sendAndReceive).toHaveBeenCalledWith(
      'proc-2',
      'hello',
      expect.objectContaining({ endMarker: '[DONE]', timeout: 1000 })
    );
  });

  it('stopAgent stops running process and removes cache', async () => {
    mockAgentConfigManager.getAgentConfig.mockResolvedValue({
      id: 'cfg',
      command: 'echo',
      args: []
    });
    mockProcessManager.startProcess.mockResolvedValue('proc-3');

    const manager = new AgentManager(
      mockProcessManager as any,
      mockAgentConfigManager as any
    );

    await manager.ensureAgentStarted('role-3', 'cfg');
    await manager.stopAgent('role-3');

    expect(mockProcessManager.stopProcess).toHaveBeenCalledWith('proc-3');
    await expect(
      manager.sendAndReceive('role-3', 'after-stop')
    ).rejects.toThrow(/no running agent/i);
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

    await expect(manager.sendAndReceive('no-agent', 'hello')).rejects.toThrow(/no running agent/);
  });
});
