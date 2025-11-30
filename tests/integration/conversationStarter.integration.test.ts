import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeServices } from '../../src/services/ServiceInitializer.js';
import type { CLIConfig } from '../../src/models/CLIConfig.js';
import { AgentRegistry } from '../../src/registry/AgentRegistry.js';
import type { IOutput } from '../../src/outputs/IOutput.js';
import type { IExecutionEnvironment, IProcess, SpawnOptions } from '../../src/interfaces/IExecutionEnvironment.js';
import type { IAdapterFactory } from '../../src/interfaces/IAdapterFactory.js';
import type { IAgentAdapter, AgentConfig } from '../../src/interfaces/IAgentAdapter.js';
import { EventEmitter } from 'events';

// Mock AgentValidator to avoid calling real CLI commands in CI
vi.mock('../../src/registry/AgentValidator.js', () => {
  return {
    AgentValidator: class {
      async verify() {
        return {
          status: 'verified',
          checks: [
            { name: 'CLI Command Check', passed: true, message: 'Command found (mocked)' },
            { name: 'Version Check', passed: true, message: 'Version check passed (mocked)' },
            { name: 'Authentication Check', passed: true, message: 'Authenticated (mocked)' }
          ]
        };
      }
    }
  };
});

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
function createMockExecutionEnv(): IExecutionEnvironment {
  return {
    spawn(_command: string, _args: string[], _options?: SpawnOptions): IProcess {
      const proc = createMockProcess();
      // Simulate immediate completion with response
      setImmediate(() => {
        proc.stdout!.emit('data', Buffer.from('{"type":"message_stop","stop_reason":"end_turn"}\n'));
        proc.emit('exit', 0);
      });
      return proc;
    },
    kill: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    resize: vi.fn()
  };
}

// Mock adapter
function createMockAdapter(type: string = 'claude-code'): IAgentAdapter {
  return {
    agentType: type,
    command: 'test-command',
    getDefaultArgs: () => ['--output-format=stream-json'],
    execute: vi.fn(async function* () {
      yield { eventId: '1', type: 'text', text: 'mock response [DONE]', role: 'assistant' };
    }),
    cancel: vi.fn()
  };
}

// Mock adapter factory
function createMockAdapterFactory(): IAdapterFactory {
  return {
    createAdapter: vi.fn((_config: AgentConfig) => createMockAdapter())
  };
}

describe.sequential('ServiceInitializer integration', () => {
  let tempDir: string;
  let tempRegistryPath: string;
  let mockExecutionEnv: IExecutionEnvironment;
  let mockAdapterFactory: IAdapterFactory;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));

    // Create temporary registry and register claude agent for tests
    tempRegistryPath = path.join(tempDir, 'test-registry.json');
    const registry = new AgentRegistry(tempRegistryPath);
    await registry.registerAgent('claude', 'echo');

    // Create mock implementations
    mockExecutionEnv = createMockExecutionEnv();
    mockAdapterFactory = createMockAdapterFactory();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads configuration, prepares directories, and completes a simple conversation', async () => {
    const aiRoleDir = path.join(tempDir, 'dev', 'alice');
    const humanRoleDir = path.join(tempDir, 'pm', 'bob');

    fs.mkdirSync(aiRoleDir, { recursive: true });
    fs.mkdirSync(humanRoleDir, { recursive: true });
    fs.writeFileSync(path.join(aiRoleDir, 'AGENTS.md'), 'You are an integration test agent.');
    fs.writeFileSync(path.join(humanRoleDir, 'README.md'), 'Human instructions.');

    const config: CLIConfig = {
      schemaVersion: '1.1',
      agents: [
        // Schema 1.1: Reference registered agent, override args/usePty
        {
          name: 'claude',
          args: ['--output-format=stream-json', '--verbose'],
          usePty: false
        }
      ],
      team: {
        name: 'integration-team',
        description: 'Ensures initializeServices normalizes members',
        instructionFile: path.join(tempDir, 'team.md'),
        roleDefinitions: [
          { name: 'developer', displayName: 'Developer' },
          { name: 'reviewer', displayName: 'Reviewer' }
        ],
        members: [
          {
            displayName: 'Claude Dev',
            displayRole: 'Developer',
            name: 'claude-dev',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            baseDir: aiRoleDir,
            instructionFile: path.join(aiRoleDir, 'AGENTS.md'),
            env: { CUSTOM: '1' }
          },
          {
            displayName: 'Human PM',
            displayRole: 'Reviewer',
            name: 'human-bob',
            type: 'human',
            role: 'reviewer',
            baseDir: humanRoleDir,
            instructionFile: path.join(humanRoleDir, 'README.md')
          }
        ]
      },
      maxRounds: 5
    };

    const { coordinator, team } = await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv: mockExecutionEnv,
      adapterFactory: mockAdapterFactory
    });

    expect(team.members).toHaveLength(2);
    expect(team.members[0].instructionFileText).toContain('integration test agent');
    expect(team.members[0].env?.CUSTOM).toBe('1');

    // New API: setTeam() + sendMessage()
    coordinator.setTeam(team);
    await coordinator.sendMessage('Review the new feature');

    // NEW BEHAVIOR: AI's [DONE] no longer terminates the conversation.
    // Instead, it continues to the next member (human) via round-robin.
    // The conversation is now paused, waiting for the human member's input.
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForMemberId()).toBe(team.members[1].id); // Waiting for human
  }, 30000); // Increased timeout for real-time verification

  it('initializes members even when instruction file is missing', async () => {
    const aiRoleDir = path.join(tempDir, 'dev', 'missing');
    const humanRoleDir = path.join(tempDir, 'pm', 'observer');
    fs.mkdirSync(aiRoleDir, { recursive: true });
    fs.mkdirSync(humanRoleDir, { recursive: true });

    const config: CLIConfig = {
      schemaVersion: '1.1',
      agents: [
        { name: 'claude', args: ['--output-format=stream-json', '--verbose'], usePty: false }
      ],
      team: {
        name: 'missing-instruction',
        description: 'Should still initialize',
        members: [
          {
            displayName: 'Claude Dev',
            name: 'claude-dev',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            baseDir: aiRoleDir,
            instructionFile: path.join(aiRoleDir, 'AGENTS.md')
          },
          {
            displayName: 'Observer',
            name: 'obs',
            type: 'human',
            role: 'observer',
            baseDir: humanRoleDir,
            instructionFile: path.join(humanRoleDir, 'README.md')
          }
        ]
      }
    };

    const { team } = await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv: mockExecutionEnv,
      adapterFactory: mockAdapterFactory
    });
    expect(team.members[0].systemInstruction).toBeUndefined();
  }, 30000); // Increased timeout for real-time verification

  it('accepts output option without error', async () => {
    // Note: Output interface usage moved to CLI layer.
    // This test verifies initializeServices accepts the output option without crashing.
    const aiRoleDir = path.join(tempDir, 'dev', 'alpha');
    const observerDir = path.join(tempDir, 'observer');
    fs.mkdirSync(aiRoleDir, { recursive: true });
    fs.mkdirSync(observerDir, { recursive: true });
    fs.writeFileSync(path.join(aiRoleDir, 'AGENTS.md'), 'Instructions');

    const config: CLIConfig = {
      schemaVersion: '1.1',
      agents: [{ name: 'claude', args: ['--output-format=stream-json'], usePty: false }],
      team: {
        name: 'output-team',
        description: 'output test',
        members: [
          {
            displayName: 'Claude Dev',
            name: 'claude-dev',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            baseDir: aiRoleDir
          },
          {
            displayName: 'Observer',
            name: 'obs',
            type: 'human',
            role: 'observer',
            baseDir: observerDir
          }
        ]
      }
    };

    class MockOutput implements IOutput {
      calls: Array<{ method: string; args: any[] }> = [];
      info(message: string): void { this.calls.push({ method: 'info', args: [message] }); }
      success(message: string): void { this.calls.push({ method: 'success', args: [message] }); }
      warn(message: string): void { this.calls.push({ method: 'warn', args: [message] }); }
      error(message: string): void { this.calls.push({ method: 'error', args: [message] }); }
      progress(message: string): void { this.calls.push({ method: 'progress', args: [message] }); }
      separator(char?: string, length?: number): void { this.calls.push({ method: 'separator', args: [char, length] }); }
      keyValue(key: string, value: string): void { this.calls.push({ method: 'keyValue', args: [key, value] }); }
    }

    const output = new MockOutput();
    const { team, coordinator } = await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv: mockExecutionEnv,
      adapterFactory: mockAdapterFactory,
      output
    });

    // Verify initialization succeeded
    expect(team).toBeDefined();
    expect(team.members).toHaveLength(2);
    expect(coordinator).toBeDefined();
  }, 30000);
});
