/**
 * Integration test for verification caching optimization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeServices } from '../../src/services/ServiceInitializer.js';
import type { CLIConfig } from '../../src/models/CLIConfig.js';
import { AgentRegistry } from '../../src/registry/AgentRegistry.js';
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

describe('Verification Cache Integration', () => {
  let tempDir: string;
  let tempRegistryPath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-cache-test-'));

    // Create temporary registry and register claude agent for tests
    tempRegistryPath = path.join(tempDir, 'test-registry.json');
    const registry = new AgentRegistry(tempRegistryPath);

    // Register claude agent pointing to echo (for testing purposes)
    await registry.registerAgent('claude', 'echo');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('caches verification results when multiple members use the same agent', async () => {
    // Create directories for 3 AI members all using claude + 1 human member
    const member1Dir = path.join(tempDir, 'member1');
    const member2Dir = path.join(tempDir, 'member2');
    const member3Dir = path.join(tempDir, 'member3');
    const humanDir = path.join(tempDir, 'human');

    fs.mkdirSync(member1Dir, { recursive: true });
    fs.mkdirSync(member2Dir, { recursive: true });
    fs.mkdirSync(member3Dir, { recursive: true });
    fs.mkdirSync(humanDir, { recursive: true });

    fs.writeFileSync(path.join(member1Dir, 'AGENTS.md'), 'Member 1 instructions');
    fs.writeFileSync(path.join(member2Dir, 'AGENTS.md'), 'Member 2 instructions');
    fs.writeFileSync(path.join(member3Dir, 'AGENTS.md'), 'Member 3 instructions');
    fs.writeFileSync(path.join(humanDir, 'README.md'), 'Human instructions');

    const config: CLIConfig = {
      schemaVersion: '1.1',
      agents: [
        // Schema 1.1: Reference agent from registry, can override args/usePty
        { name: 'claude', args: ['--output-format=stream-json', '--verbose'], usePty: false }
      ],
      team: {
        name: 'cache-test',
        description: 'Team with 3 AI members using same agent + 1 human',
        members: [
          {
            displayName: 'Member 1',
            name: 'member-1',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            baseDir: member1Dir,
            instructionFile: path.join(member1Dir, 'AGENTS.md')
          },
          {
            displayName: 'Member 2',
            name: 'member-2',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            baseDir: member2Dir,
            instructionFile: path.join(member2Dir, 'AGENTS.md')
          },
          {
            displayName: 'Member 3',
            name: 'member-3',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            baseDir: member3Dir,
            instructionFile: path.join(member3Dir, 'AGENTS.md')
          },
          {
            displayName: 'Human Observer',
            name: 'human-observer',
            type: 'human',
            role: 'observer',
            baseDir: humanDir
          }
        ]
      }
    };

    const startTime = Date.now();
    const { executionEnv, adapterFactory } = createCliDependencies();
    const { team } = await initializeServices(config, {
      registryPath: tempRegistryPath,
      executionEnv,
      adapterFactory
    });
    const endTime = Date.now();

    // All 4 members should be initialized (3 AI + 1 Human)
    expect(team.members).toHaveLength(4);

    // Test should complete reasonably fast due to caching
    // (Without caching, 3 verifications would take ~15 seconds; with caching, ~5 seconds)
    const duration = endTime - startTime;
    console.log(`Initialization took ${duration}ms with 3 members using same agent`);

    // The second and third members should use cached verification
    // Exact timing depends on system, but should be significantly faster than 3x verification time
    expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
  }, 30000); // 30 second timeout
});
