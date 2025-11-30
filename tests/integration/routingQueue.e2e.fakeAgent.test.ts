/**
 * End-to-End Fake Agent Tests (v3)
 *
 * Tests the complete routing flow with fake agent responses:
 * 1. Full conversation flow with v3 routing
 * 2. Intent-based priority scheduling in action
 * 3. Parent message context preservation
 * 4. Multiple agent coordination with NEXT markers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationCoordinator } from '../../src/services/ConversationCoordinator.js';
import { MessageRouter } from '../../src/services/MessageRouter.js';
import { AgentManager } from '../../src/services/AgentManager.js';
import { SessionUtils } from '../../src/models/ConversationSession.js';
import type { Team, Member } from '../../src/models/Team.js';
import type { ConversationMessage } from '../../src/models/ConversationMessage.js';
import type { QueueUpdateEvent } from '../../src/models/QueueEvent.js';

// ============================================================================
// Fake Agent Manager
// ============================================================================

/**
 * Fake agent response generator
 * Simulates AI agent responses with controllable output
 */
class FakeAgentManager {
  private responseGenerators: Map<string, (prompt: string) => string> = new Map();
  private callLog: Array<{ memberId: string; prompt: string }> = [];
  public onAgentStarted: ((memberId: string) => void) | null = null;
  public onAgentCompleted: ((memberId: string) => void) | null = null;

  setResponseGenerator(memberId: string, generator: (prompt: string) => string) {
    this.responseGenerators.set(memberId, generator);
  }

  setDefaultResponse(memberId: string, response: string) {
    this.responseGenerators.set(memberId, () => response);
  }

  getCallLog() {
    return this.callLog;
  }

  clearCallLog() {
    this.callLog = [];
  }

  // AgentManager interface methods
  async ensureAgentStarted(memberId: string, configId: string, config?: any): Promise<void> {
    this.onAgentStarted?.(memberId);
  }

  async sendAndReceive(
    memberId: string,
    prompt: string,
    options?: any
  ): Promise<{ success: boolean; accumulatedText: string; finishReason?: string }> {
    this.callLog.push({ memberId, prompt });

    const generator = this.responseGenerators.get(memberId);
    const response = generator ? generator(prompt) : `Response from ${memberId}`;

    return {
      success: true,
      accumulatedText: response,
      finishReason: 'end_turn',
    };
  }

  async stopAgent(memberId: string): Promise<void> {
    this.onAgentCompleted?.(memberId);
  }

  cancelAgent(memberId: string): void {
    // No-op for fake
  }

  cleanup(): void {
    this.responseGenerators.clear();
    this.callLog = [];
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function makeMember(
  id: string,
  name: string,
  displayName: string,
  type: 'ai' | 'human',
  order: number
): Member {
  return {
    id,
    name,
    displayName,
    displayRole: name,
    role: name,
    type,
    baseDir: '/tmp',
    order,
    agentConfigId: type === 'ai' ? `${id}-config` : undefined,
    agentType: type === 'ai' ? 'claude-code' : undefined,
  };
}

function makeTeam(members: Member[]): Team {
  return {
    id: 'e2e-team',
    name: 'E2E Test Team',
    displayName: 'E2E Test Team',
    description: 'Team for end-to-end tests',
    members,
  };
}

function buildE2ECoordinator(
  team: Team,
  fakeAgentManager: FakeAgentManager,
  options?: {
    onMessage?: (msg: ConversationMessage) => void;
    onQueueUpdate?: (event: QueueUpdateEvent) => void;
  }
) {
  const router = new MessageRouter();
  const coordinator = new ConversationCoordinator(
    fakeAgentManager as unknown as AgentManager,
    router,
    {
      onMessage: options?.onMessage ?? vi.fn(),
      onStatusChange: vi.fn(),
      onQueueUpdate: options?.onQueueUpdate,
      routingQueueConfig: {
        maxQueueSize: 50,
        maxBranchSize: 10,
        maxLocalSeq: 5,
      },
    }
  );

  // Set team
  (coordinator as any).team = team;
  (coordinator as any).session = SessionUtils.createSession(team.id, team.name);

  return coordinator;
}

// ============================================================================
// Test Suite 1: Full Conversation Flow
// ============================================================================

describe('E2E: Full Conversation Flow', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('routes human message to AI and receives response', async () => {
    const claude = makeMember('claude', 'claude', 'Claude Code', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const messages: ConversationMessage[] = [];
    const coordinator = buildE2ECoordinator(team, fakeAgentManager, {
      onMessage: (msg) => messages.push(msg),
    });

    fakeAgentManager.setDefaultResponse('claude', 'Hello! I can help with that.');

    // Human sends message with NEXT marker
    await coordinator.sendMessage('Hello Claude! [NEXT: claude]');

    // Should have 2 messages: human message and AI response
    expect(messages.length).toBe(2);
    expect(messages[0].speaker.id).toBe('human');
    expect(messages[0].content).toBe('Hello Claude!');
    expect(messages[1].speaker.id).toBe('claude');
    expect(messages[1].content).toBe('Hello! I can help with that.');
  });

  it('chains multiple AI agents via NEXT markers', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const codex = makeMember('codex', 'codex', 'Codex', 'ai', 1);
    const human = makeMember('human', 'kai', 'Kai', 'human', 2);
    const team = makeTeam([claude, codex, human]);

    const messages: ConversationMessage[] = [];
    const coordinator = buildE2ECoordinator(team, fakeAgentManager, {
      onMessage: (msg) => messages.push(msg),
    });

    // Claude responds with NEXT to Codex
    fakeAgentManager.setDefaultResponse('claude', 'Analyzed. [NEXT: codex]');
    fakeAgentManager.setDefaultResponse('codex', 'Implemented based on analysis.');

    await coordinator.sendMessage('Analyze and implement [NEXT: claude]');

    // Should have 3 messages
    expect(messages.length).toBe(3);
    expect(messages[0].speaker.id).toBe('human');
    expect(messages[1].speaker.id).toBe('claude');
    expect(messages[2].speaker.id).toBe('codex');
  });

  it('falls back to first human when no NEXT marker', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    // Claude responds without NEXT
    fakeAgentManager.setDefaultResponse('claude', 'Done! Anything else?');

    await coordinator.sendMessage('Do something [NEXT: claude]');

    // Should be paused waiting for human
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForMemberId()).toBe('human');
  });
});

// ============================================================================
// Test Suite 2: Intent-Based Priority Scheduling
// ============================================================================

describe('E2E: Intent-Based Priority Scheduling', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('P1 interrupt takes priority over P2 reply', async () => {
    const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
    const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
    const aiC = makeMember('ai-c', 'ai-c', 'AI C', 'ai', 2);
    const human = makeMember('human', 'kai', 'Kai', 'human', 3);
    const team = makeTeam([aiA, aiB, aiC, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    // Set up responses
    fakeAgentManager.setDefaultResponse('ai-a', 'Response A');
    fakeAgentManager.setDefaultResponse('ai-b', 'Response B (interrupt)');
    fakeAgentManager.setDefaultResponse('ai-c', 'Response C');

    // Send with P1 for ai-b (should be processed first despite order)
    await coordinator.sendMessage('Task [NEXT: ai-a!P2, ai-b!P1, ai-c!P3]');

    const callLog = fakeAgentManager.getCallLog();

    // ai-b (P1) should be first, then ai-a (P2), then ai-c (P3)
    expect(callLog.length).toBe(3);
    expect(callLog[0].memberId).toBe('ai-b');
    expect(callLog[1].memberId).toBe('ai-a');
    expect(callLog[2].memberId).toBe('ai-c');
  });

  it('multiple P1 items are all processed before moving to human', async () => {
    const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
    const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
    const human = makeMember('human', 'kai', 'Kai', 'human', 2);
    const team = makeTeam([aiA, aiB, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('ai-a', 'Interrupt A');
    fakeAgentManager.setDefaultResponse('ai-b', 'Interrupt B');

    // Both are P1, both should be processed
    await coordinator.sendMessage('Emergency! [NEXT: ai-a!P1, ai-b!P1]');

    const callLog = fakeAgentManager.getCallLog();
    // Both P1s should be called
    expect(callLog.length).toBe(2);
    // Both ai-a and ai-b should be in the call log (order may vary due to same timestamp)
    const memberIds = callLog.map(c => c.memberId);
    expect(memberIds).toContain('ai-a');
    expect(memberIds).toContain('ai-b');
  });

  it('P3 extend is processed after P2 reply', async () => {
    const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
    const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
    const human = makeMember('human', 'kai', 'Kai', 'human', 2);
    const team = makeTeam([aiA, aiB, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('ai-a', 'Extended topic');
    fakeAgentManager.setDefaultResponse('ai-b', 'Direct reply');

    // P3 first in list, P2 second, but P2 should execute first
    await coordinator.sendMessage('Topic [NEXT: ai-a!P3, ai-b!P2]');

    const callLog = fakeAgentManager.getCallLog();
    expect(callLog[0].memberId).toBe('ai-b'); // P2 first
    expect(callLog[1].memberId).toBe('ai-a'); // P3 second
  });
});

// ============================================================================
// Test Suite 3: Parent Message Context Preservation
// ============================================================================

describe('E2E: Parent Message Context', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('passes parent message ID through routing chain', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const messages: ConversationMessage[] = [];
    const coordinator = buildE2ECoordinator(team, fakeAgentManager, {
      onMessage: (msg) => messages.push(msg),
    });

    fakeAgentManager.setDefaultResponse('claude', 'Processed the task');

    await coordinator.sendMessage('Original task [NEXT: claude]');

    // AI response should have parentMessageId pointing to human message
    const aiMessage = messages[1];
    expect(aiMessage.routing?.parentMessageId).toBeDefined();
  });

  it('sibling messages share the same parentMessageId', async () => {
    const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
    const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
    const human = makeMember('human', 'kai', 'Kai', 'human', 2);
    const team = makeTeam([aiA, aiB, human]);

    const messages: ConversationMessage[] = [];
    const coordinator = buildE2ECoordinator(team, fakeAgentManager, {
      onMessage: (msg) => messages.push(msg),
    });

    fakeAgentManager.setDefaultResponse('ai-a', 'Response A');
    fakeAgentManager.setDefaultResponse('ai-b', 'Response B');

    // Both AIs should receive same parent
    await coordinator.sendMessage('Task for both [NEXT: ai-a, ai-b]');

    const humanMsgId = messages[0].id;
    const aiAMsg = messages[1];
    const aiBMsg = messages[2];

    // Both should have the same parent (human message)
    expect(aiAMsg.routing?.parentMessageId).toBe(humanMsgId);
    expect(aiBMsg.routing?.parentMessageId).toBe(humanMsgId);
  });
});

// ============================================================================
// Test Suite 4: Queue Update Events
// ============================================================================

describe('E2E: Queue Update Events', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('emits queue updates during routing', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const queueEvents: QueueUpdateEvent[] = [];
    const coordinator = buildE2ECoordinator(team, fakeAgentManager, {
      onQueueUpdate: (event) => queueEvents.push({ ...event }),
    });

    fakeAgentManager.setDefaultResponse('claude', 'Done');

    await coordinator.sendMessage('Task [NEXT: claude]');

    // Should have received queue update events
    expect(queueEvents.length).toBeGreaterThan(0);

    // At least one event should show claude as executing
    const executingEvent = queueEvents.find(e => e.executing?.id === 'claude');
    expect(executingEvent).toBeDefined();
  });

  it('queue shows correct stats during multi-agent routing', async () => {
    const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
    const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
    const aiC = makeMember('ai-c', 'ai-c', 'AI C', 'ai', 2);
    const human = makeMember('human', 'kai', 'Kai', 'human', 3);
    const team = makeTeam([aiA, aiB, aiC, human]);

    const queueEvents: QueueUpdateEvent[] = [];
    const coordinator = buildE2ECoordinator(team, fakeAgentManager, {
      onQueueUpdate: (event) => queueEvents.push({ ...event }),
    });

    fakeAgentManager.setDefaultResponse('ai-a', 'A done');
    fakeAgentManager.setDefaultResponse('ai-b', 'B done');
    fakeAgentManager.setDefaultResponse('ai-c', 'C done');

    await coordinator.sendMessage('Multi-task [NEXT: ai-a!P1, ai-b!P2, ai-c!P3]');

    // Find event with all 3 items pending
    const initialEvent = queueEvents.find(e => e.stats.totalPending === 3);
    expect(initialEvent).toBeDefined();
    expect(initialEvent?.stats.byIntent.P1_INTERRUPT).toBe(1);
    expect(initialEvent?.stats.byIntent.P2_REPLY).toBe(1);
    expect(initialEvent?.stats.byIntent.P3_EXTEND).toBe(1);

    // Final event should show empty queue
    const finalEvent = queueEvents[queueEvents.length - 1];
    expect(finalEvent.isEmpty).toBe(true);
  });
});

// ============================================================================
// Test Suite 5: Error Handling and Edge Cases
// ============================================================================

describe('E2E: Error Handling', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('handles unresolved NEXT markers gracefully', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('claude', 'Done');

    // NEXT to non-existent member
    await coordinator.sendMessage('Task [NEXT: nonexistent]');

    // Should pause and wait for human (fallback)
    expect(coordinator.getStatus()).toBe('paused');
    expect(coordinator.getWaitingForMemberId()).toBe('human');
  });

  it('continues routing after partial NEXT resolution', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('claude', 'Done');

    // One valid, one invalid NEXT
    await coordinator.sendMessage('Task [NEXT: claude, nonexistent]');

    const callLog = fakeAgentManager.getCallLog();

    // Claude should have been called
    expect(callLog.length).toBe(1);
    expect(callLog[0].memberId).toBe('claude');
  });

  it('handles empty conversation start', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    // First message must be from human - no explicit sender defaults to human
    fakeAgentManager.setDefaultResponse('claude', 'Hello!');

    await coordinator.sendMessage('Hi [NEXT: claude]');

    expect(fakeAgentManager.getCallLog().length).toBe(1);
  });
});

// ============================================================================
// Test Suite 6: Dynamic Message Content
// ============================================================================

describe('E2E: Dynamic Message Content', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('subsequent agents receive previous agent response', async () => {
    const aiA = makeMember('ai-a', 'ai-a', 'AI A', 'ai', 0);
    const aiB = makeMember('ai-b', 'ai-b', 'AI B', 'ai', 1);
    const human = makeMember('human', 'kai', 'Kai', 'human', 2);
    const team = makeTeam([aiA, aiB, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('ai-a', 'Step 1 complete: prepared data');
    fakeAgentManager.setDefaultResponse('ai-b', 'Step 2 complete: processed data');

    await coordinator.sendMessage('Process data [NEXT: ai-a, ai-b]');

    const callLog = fakeAgentManager.getCallLog();

    // ai-b should receive ai-a's response in its prompt context
    expect(callLog[1].prompt).toContain('Step 1 complete');
  });

  it('agent response generator can access prompt', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    // Generator that includes part of prompt in response
    fakeAgentManager.setResponseGenerator('claude', (prompt) => {
      if (prompt.includes('calculate')) {
        return 'The result is 42';
      }
      return 'I need more information';
    });

    const messages: ConversationMessage[] = [];
    const coordinatorWithMessages = buildE2ECoordinator(team, fakeAgentManager, {
      onMessage: (msg) => messages.push(msg),
    });

    await coordinatorWithMessages.sendMessage('Please calculate 6*7 [NEXT: claude]');

    expect(messages[1].content).toBe('The result is 42');
  });
});

// ============================================================================
// Test Suite 7: Conversation State Management
// ============================================================================

describe('E2E: Conversation State', () => {
  let fakeAgentManager: FakeAgentManager;

  beforeEach(() => {
    fakeAgentManager = new FakeAgentManager();
  });

  afterEach(() => {
    fakeAgentManager.cleanup();
  });

  it('maintains session messages throughout routing', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const codex = makeMember('codex', 'codex', 'Codex', 'ai', 1);
    const human = makeMember('human', 'kai', 'Kai', 'human', 2);
    const team = makeTeam([claude, codex, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('claude', 'Analyzed [NEXT: codex]');
    fakeAgentManager.setDefaultResponse('codex', 'Implemented');

    await coordinator.sendMessage('Analyze and implement [NEXT: claude]');

    const session = coordinator.getSession();
    expect(session?.messages.length).toBe(3);
    expect(session?.messages[0].speaker.type).toBe('human');
    expect(session?.messages[1].speaker.id).toBe('claude');
    expect(session?.messages[2].speaker.id).toBe('codex');
  });

  it('human can inject message after AI completes', async () => {
    const claude = makeMember('claude', 'claude', 'Claude', 'ai', 0);
    const human = makeMember('human', 'kai', 'Kai', 'human', 1);
    const team = makeTeam([claude, human]);

    const coordinator = buildE2ECoordinator(team, fakeAgentManager);

    fakeAgentManager.setDefaultResponse('claude', 'Task done');

    // First exchange
    await coordinator.sendMessage('Task 1 [NEXT: claude]');

    // Reset for new response
    fakeAgentManager.clearCallLog();
    fakeAgentManager.setDefaultResponse('claude', 'Task 2 done');

    // Human sends another message
    await coordinator.sendMessage('Task 2 [NEXT: claude]');

    const session = coordinator.getSession();
    expect(session?.messages.length).toBe(4); // Human, AI, Human, AI
  });
});
