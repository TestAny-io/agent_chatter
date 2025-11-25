/**
 * Shared test utilities for ConversationCoordinator tests
 * Extracted to reduce code duplication across split test files
 */

import { vi } from 'vitest';
import type { Team, Role } from '../../../src/models/Team.js';
import type { AgentManager } from '../../../src/services/AgentManager.js';

// Mock heavy dependencies - must be called before importing ConversationCoordinator
export function setupMocks() {
  vi.mock('../../../src/services/AgentManager.js', () => ({
    AgentManager: class MockAgentManager {
      async ensureAgentStarted() { return 'mock-process'; }
      async sendAndReceive() { return { success: true, finishReason: 'done' }; }
      async stopAgent() {}
      cancelAgent() {}
      cleanup() {}
    }
  }));

  vi.mock('../../../src/utils/PromptBuilder.js', () => ({
    buildPrompt: vi.fn(() => ({ prompt: 'mock-prompt', systemFlag: undefined }))
  }));

  vi.mock('../../../src/utils/JsonlMessageFormatter.js', () => ({
    formatJsonl: vi.fn((type: string, raw: string) => ({ text: raw }))
  }));
}

export function createMember(overrides: Partial<Role>): Role {
  return {
    id: overrides.id ?? `member-${Math.random().toString(36).slice(2)}`,
    displayName: overrides.displayName ?? 'Member',
    name: overrides.name ?? 'member',
    role: overrides.role ?? 'reviewer',
    type: overrides.type ?? 'ai',
    order: overrides.order ?? 0,
    agentConfigId: overrides.agentConfigId ?? `${overrides.id}-config`,
    systemInstruction: overrides.systemInstruction ?? 'Follow the plan.',
    ...overrides
  };
}

export function buildTeam(members: Role[]): Team {
  return {
    id: 'team-test',
    name: 'Test Team',
    description: 'Testing round robin routing',
    createdAt: new Date(),
    updatedAt: new Date(),
    members
  };
}

export class StubAgentManager {
  public startCalls: Array<{ roleId: string; configId: string }> = [];
  public sendCalls: Array<{ roleId: string; message: string }> = [];
  public cancelCalls: string[] = [];
  private responses: Record<string, { success: boolean; finishReason?: string }[]> = {};
  private shouldRejectWithCancellation: Record<string, boolean> = {};

  constructor(responseMap: Record<string, { success: boolean; finishReason?: string }[]> = {}) {
    this.responses = responseMap;
  }

  setShouldRejectWithCancellation(roleId: string, shouldReject: boolean) {
    this.shouldRejectWithCancellation[roleId] = shouldReject;
  }

  async ensureAgentStarted(roleId: string, configId: string): Promise<string> {
    this.startCalls.push({ roleId, configId });
    return `process-${roleId}`;
  }

  async sendAndReceive(roleId: string, message: string): Promise<{ success: boolean; finishReason?: string }> {
    this.sendCalls.push({ roleId, message });

    if (this.shouldRejectWithCancellation[roleId]) {
      throw new Error('[CANCELLED_BY_USER]');
    }

    const queue = this.responses[roleId] ?? [];
    if (queue.length === 0) {
      return { success: true, finishReason: 'done' };
    }
    return queue.shift()!;
  }

  async stopAgent(): Promise<void> {}

  cancelAgent(roleId: string): void {
    this.cancelCalls.push(roleId);
  }

  cleanup(): void {}
}

export function createStubAsAgentManager(stub: StubAgentManager): AgentManager {
  return stub as unknown as AgentManager;
}
