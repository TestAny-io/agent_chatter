import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initializeServices } from '../../src/utils/ConversationStarter.js';
import type { CLIConfig } from '../../src/utils/ConversationStarter.js';

vi.mock('../../src/infrastructure/ProcessManager.js', () => {
  const startCalls: Array<{ command: string; args: string[]; env?: Record<string, string>; cwd?: string }> = [];
  const sendCalls: Array<{ processId: string; input: string }> = [];
  const stopCalls: string[] = [];
  let counter = 0;

  class ProcessManager {
    async startProcess(config: { command: string; args: string[]; env?: Record<string, string>; cwd?: string }): Promise<string> {
      startCalls.push(config);
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
      sendCalls,
      stopCalls,
      reset() {
        startCalls.length = 0;
        sendCalls.length = 0;
        stopCalls.length = 0;
        counter = 0;
      }
    }
  };
});

describe('ConversationStarter integration', () => {
  let tempDir: string;
  let processMock: { startCalls: any[]; sendCalls: any[]; stopCalls: any[]; reset: () => void };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chatter-test-'));
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
    const aiWork = path.join(aiRoleDir, 'work');
    const humanWork = path.join(humanRoleDir, 'work');

    fs.mkdirSync(aiRoleDir, { recursive: true });
    fs.mkdirSync(humanRoleDir, { recursive: true });
    fs.writeFileSync(path.join(aiRoleDir, 'AGENTS.md'), 'You are an integration test agent.');
    fs.writeFileSync(path.join(humanRoleDir, 'README.md'), 'Human instructions.');

    const config: CLIConfig = {
      schemaVersion: '1.0',
      agents: [
        {
          name: 'codex',
          command: 'echo',
          args: [],
          endMarker: '[DONE]',
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
            displayName: 'Codex Dev',
            displayRole: 'Developer',
            name: 'codex-dev',
            type: 'ai',
            role: 'developer',
            agentType: 'codex',
            roleDir: aiRoleDir,
            workDir: aiWork,
            instructionFile: path.join(aiRoleDir, 'AGENTS.md'),
            env: { CUSTOM: '1' }
          },
          {
            displayName: 'Human PM',
            displayRole: 'Reviewer',
            name: 'human-bob',
            type: 'human',
            role: 'reviewer',
            roleDir: humanRoleDir,
            workDir: humanWork,
            instructionFile: path.join(humanRoleDir, 'README.md')
          }
        ]
      },
      maxRounds: 5
    };

    const { coordinator, team } = await initializeServices(config);

    expect(team.members).toHaveLength(2);
    expect(team.members[0].systemInstruction).toContain('integration test agent');
    expect(team.members[0].env?.CUSTOM).toBe('1');
    expect(fs.existsSync(aiWork)).toBe(true);
    expect(fs.existsSync(humanWork)).toBe(true);

    const firstSpeaker = team.members[0].id;
    await coordinator.startConversation(team, 'Review the new feature', firstSpeaker);

    expect(processMock.startCalls).toHaveLength(1);
    expect(processMock.sendCalls[0].input).toContain('Review the new feature');
    expect(processMock.sendCalls[0].input).toContain('integration test agent');
    expect(processMock.stopCalls).toEqual(['proc-1']);
    expect(coordinator.getStatus()).toBe('completed');
  });

  it('initializes members even when instruction file is missing', async () => {
    const aiRoleDir = path.join(tempDir, 'dev', 'missing');
    const humanRoleDir = path.join(tempDir, 'pm', 'observer');
    fs.mkdirSync(aiRoleDir, { recursive: true });
    fs.mkdirSync(humanRoleDir, { recursive: true });

    const config: CLIConfig = {
      schemaVersion: '1.0',
      agents: [
        { name: 'codex', command: 'echo', args: [], endMarker: '[DONE]', usePty: false }
      ],
      team: {
        name: 'missing-instruction',
        description: 'Should still initialize',
        members: [
          {
            displayName: 'Codex Dev',
            name: 'codex-dev',
            type: 'ai',
            role: 'developer',
            agentType: 'codex',
            roleDir: aiRoleDir,
            workDir: path.join(aiRoleDir, 'work'),
            instructionFile: path.join(aiRoleDir, 'AGENTS.md')
          },
          {
            displayName: 'Observer',
            name: 'obs',
            type: 'human',
            role: 'observer',
            roleDir: humanRoleDir,
            workDir: path.join(humanRoleDir, 'work'),
            instructionFile: path.join(humanRoleDir, 'README.md')
          }
        ]
      }
    };

    const { team } = await initializeServices(config);
    expect(team.members[0].systemInstruction).toBeUndefined();
  });
});
