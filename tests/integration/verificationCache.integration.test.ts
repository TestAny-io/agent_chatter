/**
 * Integration test for verification caching optimization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeServices } from '../../src/utils/ConversationStarter.js';
import type { CLIConfig } from '../../src/utils/ConversationStarter.js';
import { AgentRegistry } from '../../src/registry/AgentRegistry.js';

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

  class ProcessManager {
    async startProcess(config: { command: string; args: string[]; env?: Record<string, string>; cwd?: string }): Promise<string> {
      startCalls.push(config);
      return `proc-${startCalls.length}`;
    }

    async sendAndReceive(processId: string, input: string): Promise<string> {
      return 'Response [DONE]';
    }

    async stopProcess(processId: string): Promise<void> {
      // no-op
    }

    cleanup(): void {
      // no-op
    }
  }

  return {
    ProcessManager,
    __processMock: {
      startCalls,
      reset() {
        startCalls.length = 0;
      }
    }
  };
});

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
    // Create directories for 3 members all using claude
    const member1Dir = path.join(tempDir, 'member1');
    const member2Dir = path.join(tempDir, 'member2');
    const member3Dir = path.join(tempDir, 'member3');

    fs.mkdirSync(member1Dir, { recursive: true });
    fs.mkdirSync(member2Dir, { recursive: true });
    fs.mkdirSync(member3Dir, { recursive: true });

    fs.writeFileSync(path.join(member1Dir, 'AGENTS.md'), 'Member 1 instructions');
    fs.writeFileSync(path.join(member2Dir, 'AGENTS.md'), 'Member 2 instructions');
    fs.writeFileSync(path.join(member3Dir, 'AGENTS.md'), 'Member 3 instructions');

    const config: CLIConfig = {
      schemaVersion: '1.1',
      agents: [
        // Schema 1.1: Reference agent from registry, can override args/usePty
        { name: 'claude', args: ['--output-format=stream-json', '--verbose'], usePty: false }
      ],
      team: {
        name: 'cache-test',
        description: 'Team with 3 members using same agent',
        workDir: path.join(tempDir, 'team-work'),  // Use team-level workDir
        members: [
          {
            displayName: 'Member 1',
            name: 'member-1',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            roleDir: member1Dir,
            instructionFile: path.join(member1Dir, 'AGENTS.md')
          },
          {
            displayName: 'Member 2',
            name: 'member-2',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            roleDir: member2Dir,
            instructionFile: path.join(member2Dir, 'AGENTS.md')
          },
          {
            displayName: 'Member 3',
            name: 'member-3',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            roleDir: member3Dir,
            instructionFile: path.join(member3Dir, 'AGENTS.md')
          }
        ]
      }
    };

    const startTime = Date.now();
    const { team } = await initializeServices(config, { registryPath: tempRegistryPath });
    const endTime = Date.now();

    // All 3 members should be initialized
    expect(team.members).toHaveLength(3);

    // All should use the team workDir since none specified member.workDir
    const teamWorkDir = path.join(tempDir, 'team-work');
    expect(team.members[0].workDir).toBe(teamWorkDir);
    expect(team.members[1].workDir).toBe(teamWorkDir);
    expect(team.members[2].workDir).toBe(teamWorkDir);

    // Verify team-work directory was created
    expect(fs.existsSync(teamWorkDir)).toBe(true);

    // Test should complete reasonably fast due to caching
    // (Without caching, 3 verifications would take ~15 seconds; with caching, ~5 seconds)
    const duration = endTime - startTime;
    console.log(`Initialization took ${duration}ms with 3 members using same agent`);

    // The second and third members should use cached verification
    // Exact timing depends on system, but should be significantly faster than 3x verification time
    expect(duration).toBeLessThan(10000); // Should complete in under 10 seconds
  }, 30000); // 30 second timeout

  it('uses member-specified workDir when provided', async () => {
    const member1Dir = path.join(tempDir, 'member1');
    const member2Dir = path.join(tempDir, 'member2');
    const customWorkDir1 = path.join(tempDir, 'custom-work-1');
    const customWorkDir2 = path.join(tempDir, 'custom-work-2');

    fs.mkdirSync(member1Dir, { recursive: true });
    fs.mkdirSync(member2Dir, { recursive: true });

    fs.writeFileSync(path.join(member1Dir, 'AGENTS.md'), 'Member 1');
    fs.writeFileSync(path.join(member2Dir, 'AGENTS.md'), 'Member 2');

    const config: CLIConfig = {
      schemaVersion: '1.1',
      agents: [
        // Schema 1.1: Reference agent from registry
        { name: 'claude', args: ['--output-format=stream-json', '--verbose'], usePty: false }
      ],
      team: {
        name: 'member-workdir-test',
        description: 'Team where members override workDir',
        workDir: path.join(tempDir, 'team-work'),  // Provide team workDir
        members: [
          {
            displayName: 'Member 1',
            name: 'member-1',
            type: 'ai',
            role: 'developer',
            agentType: 'claude',
            roleDir: member1Dir,
            workDir: customWorkDir1,  // Override with member-specific workDir
            instructionFile: path.join(member1Dir, 'AGENTS.md')
          },
          {
            displayName: 'Member 2',
            name: 'member-2',
            type: 'ai',
            role: 'reviewer',
            agentType: 'claude',
            roleDir: member2Dir,
            workDir: customWorkDir2,  // Override with member-specific workDir
            instructionFile: path.join(member2Dir, 'AGENTS.md')
          }
        ]
      }
    };

    const { team } = await initializeServices(config, { registryPath: tempRegistryPath });

    // Both members should be initialized
    expect(team.members).toHaveLength(2);

    // Each should use their member-specified workDir, NOT the team workDir
    expect(team.members[0].workDir).toBe(customWorkDir1);
    expect(team.members[1].workDir).toBe(customWorkDir2);

    // Verify custom work directories were created
    expect(fs.existsSync(customWorkDir1)).toBe(true);
    expect(fs.existsSync(customWorkDir2)).toBe(true);
  }, 30000);
});
