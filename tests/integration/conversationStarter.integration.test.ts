import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeServices } from '../../src/services/ServiceInitializer.js';
import type { CLIConfig } from '../../src/models/CLIConfig.js';
import { AgentRegistry } from '../../src/registry/AgentRegistry.js';
import type { IOutput } from '../../src/outputs/IOutput.js';

// Mock AgentValidator to avoid calling real CLI commands in CI
vi.mock('../../src/registry/AgentValidator.js', () => {
  return {
    AgentValidator: class {
      async verify() {
        return {
          status: 'verified',
          checks: [
            { name: 'Executable Check', passed: true, message: 'Command found (mocked)' },
            { name: 'Version Check', passed: true, message: 'Version check passed (mocked)' },
            { name: 'Authentication Check', passed: true, message: 'Authenticated (mocked)' }
          ]
        };
      }
    }
  };
});

vi.mock('../../src/infrastructure/ProcessManager.js', () => {
  const startCalls: Array<{ command: string; args: string[]; env?: Record<string, string>; cwd?: string }> = [];
  const registerCalls: Array<{ childProcess: any; config: any }> = [];
  const sendCalls: Array<{ processId: string; input: string }> = [];
  const stopCalls: string[] = [];
  let counter = 0;

  class ProcessManager {
    async startProcess(config: { command: string; args: string[]; env?: Record<string, string>; cwd?: string }): Promise<string> {
      startCalls.push(config);
      counter += 1;
      return `proc-${counter}`;
    }

    registerProcess(childProcess: any, config: { command: string; args: string[]; env?: Record<string, string>; cwd?: string }): string {
      registerCalls.push({ childProcess, config });
      counter += 1;
      return `proc-${counter}`;
    }

    async sendAndReceive(processId: string, input: string): Promise<string> {
      sendCalls.push({ processId, input });
      return 'Automated response [DONE]';
    }

    async stopProcess(processId: string): Promise<void> {
      stopCalls.push(processId);
    }

    cleanup(): void {
      // no-op for tests
    }
  }

  return {
    ProcessManager,
    __processMock: {
      startCalls,
      registerCalls,
      sendCalls,
      stopCalls,
      reset() {
        startCalls.length = 0;
        registerCalls.length = 0;
        sendCalls.length = 0;
        stopCalls.length = 0;
        counter = 0;
      }
    }
  };
});

describe.sequential('ServiceInitializer integration', () => {
  let tempDir: string;
  let tempRegistryPath: string;
  let processMock: { startCalls: any[]; sendCalls: any[]; stopCalls: any[]; reset: () => void };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));

    // Create temporary registry and register claude agent for tests
    tempRegistryPath = path.join(tempDir, 'test-registry.json');
    const registry = new AgentRegistry(tempRegistryPath);
    await registry.registerAgent('claude', 'echo');

    const module = await import('../../src/infrastructure/ProcessManager.js');
    processMock = module.__processMock;
    processMock.reset();
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

    const { coordinator, team } = await initializeServices(config, { registryPath: tempRegistryPath });

    expect(team.members).toHaveLength(2);
    expect(team.members[0].instructionFileText).toContain('integration test agent');
    expect(team.members[0].env?.CUSTOM).toBe('1');

    // New API: setTeam() + sendMessage()
    coordinator.setTeam(team);
    await coordinator.sendMessage('Review the new feature');

    // In stateless mode (Claude), ProcessManager is not used. We still expect the
    // conversation to pause after the AI message is delivered.
    expect(processMock.registerCalls).toHaveLength(0);
    expect(processMock.stopCalls).toEqual([]);

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

    const { team } = await initializeServices(config, { registryPath: tempRegistryPath });
    expect(team.members[0].systemInstruction).toBeUndefined();
  }, 30000); // Increased timeout for real-time verification

  it('emits progress and success via provided output implementation', async () => {
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
    await initializeServices(config, { registryPath: tempRegistryPath, output });

    const progressCall = output.calls.find(c => c.method === 'progress');
    const successCall = output.calls.find(c => c.method === 'success');
    const keyValueCall = output.calls.find(c => c.method === 'keyValue' && String(c.args[0]).includes('Working directory'));

    expect(progressCall).toBeTruthy();
    expect(successCall).toBeTruthy();
    expect(keyValueCall).toBeTruthy();
  }, 30000);
});
