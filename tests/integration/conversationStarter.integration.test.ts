import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeServices } from '../../src/services/ServiceInitializer.js';
import type { CLIConfig } from '../../src/models/CLIConfig.js';
import { AgentRegistry } from '../../src/registry/AgentRegistry.js';
import type { ILogger } from '../../src/interfaces/ILogger.js';
import { LocalExecutionEnvironment } from '../../src/cli/LocalExecutionEnvironment.js';
import { AdapterFactory } from '../../src/cli/adapters/AdapterFactory.js';

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

// Helper function to create CLI dependencies for tests
function createCliDependencies() {
  const executionEnv = new LocalExecutionEnvironment();
  const adapterFactory = new AdapterFactory(executionEnv);
  return { executionEnv, adapterFactory };
}

describe.sequential('ServiceInitializer integration', () => {
  let tempDir: string;
  let tempRegistryPath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));

    // Create temporary registry and register claude agent for tests
    tempRegistryPath = path.join(tempDir, 'test-registry.json');
    const registry = new AgentRegistry(tempRegistryPath);
    await registry.registerAgent('claude', 'echo');
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

    const { executionEnv, adapterFactory } = createCliDependencies();
    const { coordinator, team } = await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv,
      adapterFactory
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

    const { executionEnv, adapterFactory } = createCliDependencies();
    const { team } = await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv,
      adapterFactory
    });
    expect(team.members[0].systemInstruction).toBeUndefined();
  }, 30000); // Increased timeout for real-time verification

  it('emits logging via provided logger implementation', async () => {
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

    class MockLogger implements ILogger {
      calls: Array<{ method: string; args: any[] }> = [];
      debug(message: string, context?: Record<string, unknown>): void { this.calls.push({ method: 'debug', args: [message, context] }); }
      info(message: string, context?: Record<string, unknown>): void { this.calls.push({ method: 'info', args: [message, context] }); }
      warn(message: string, context?: Record<string, unknown>): void { this.calls.push({ method: 'warn', args: [message, context] }); }
      error(message: string, context?: Record<string, unknown>): void { this.calls.push({ method: 'error', args: [message, context] }); }
    }

    const logger = new MockLogger();
    const { executionEnv, adapterFactory } = createCliDependencies();
    await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv,
      adapterFactory,
      logger
    });

    // Check that logger was called with expected methods
    const verifyingCall = logger.calls.find(c => c.method === 'debug' && String(c.args[0]).includes('Verifying agent'));
    const verifiedCall = logger.calls.find(c => c.method === 'info' && String(c.args[0]).includes('verified'));
    const workingDirCall = logger.calls.find(c => c.method === 'debug' && String(c.args[0]).includes('Working directory'));

    expect(verifyingCall).toBeTruthy();
    expect(verifiedCall).toBeTruthy();
    expect(workingDirCall).toBeTruthy();
  }, 30000);
});
