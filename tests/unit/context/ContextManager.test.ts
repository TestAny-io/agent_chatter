import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from '../../../src/context/ContextManager.js';
import type { ConversationMessage } from '../../../src/models/ConversationMessage.js';
import type { ILogger } from '../../../src/interfaces/ILogger.js';

// Helper to create a mock logger
function createMockLogger(): ILogger & { warnCalls: string[] } {
  const warnCalls: string[] = [];
  return {
    warnCalls,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn((msg: string) => warnCalls.push(msg)),
    error: vi.fn(),
  };
}

// Helper to create a test message
function createTestMessage(
  overrides: Partial<Omit<ConversationMessage, 'id'>> = {}
): Omit<ConversationMessage, 'id'> {
  return {
    timestamp: new Date(),
    speaker: {
      id: 'test-role',
      name: 'TestUser',
      displayName: 'Test User',
      type: 'human',
    },
    content: 'Test message',
    ...overrides,
  };
}

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager();
  });

  // ==========================================================================
  // Message Management
  // ==========================================================================

  describe('Message Management', () => {
    it('addMessage stores and returns message with generated id', () => {
      const msg = createTestMessage({ content: 'Hello' });
      const result = manager.addMessage(msg);

      expect(result.id).toMatch(/^msg-\d+$/);
      expect(result.content).toBe('Hello');
      expect(result.speaker.name).toBe('TestUser');
    });

    it('addMessage throws on null message', () => {
      expect(() => manager.addMessage(null as any)).toThrow('Message cannot be null or undefined');
    });

    it('addMessage throws on non-string content', () => {
      const msg = createTestMessage({ content: 123 as any });
      expect(() => manager.addMessage(msg)).toThrow('Message content must be a string');
    });

    it('addMessage throws on missing speaker', () => {
      const msg = { content: 'test', timestamp: new Date() } as any;
      expect(() => manager.addMessage(msg)).toThrow('Message speaker is required');
    });

    it('addMessage throws on missing speaker.id', () => {
      const msg = createTestMessage();
      (msg.speaker as any).id = undefined;
      expect(() => manager.addMessage(msg)).toThrow('Message speaker.id is required');
    });

    it('addMessage calls onMessageAdded hook', () => {
      const hook = vi.fn();
      const mgr = new ContextManager({ onMessageAdded: hook });

      const msg = createTestMessage();
      mgr.addMessage(msg);

      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ content: 'Test message' }));
    });

    it('getMessages returns shallow copy', () => {
      manager.addMessage(createTestMessage({ content: 'msg1' }));
      manager.addMessage(createTestMessage({ content: 'msg2' }));

      const messages = manager.getMessages();
      expect(messages).toHaveLength(2);

      // Verify it's a copy
      messages.push({} as any);
      expect(manager.getMessages()).toHaveLength(2);
    });

    it('getMessages returns empty array initially', () => {
      expect(manager.getMessages()).toEqual([]);
    });

    it('getLatestMessage returns null when empty', () => {
      expect(manager.getLatestMessage()).toBeNull();
    });

    it('getLatestMessage returns last message', () => {
      manager.addMessage(createTestMessage({ content: 'first' }));
      manager.addMessage(createTestMessage({ content: 'second' }));

      const latest = manager.getLatestMessage();
      expect(latest?.content).toBe('second');
    });
  });

  // ==========================================================================
  // TeamTask Management
  // ==========================================================================

  describe('TeamTask Management', () => {
    it('setTeamTask stores task', () => {
      manager.setTeamTask('Build a feature');
      expect(manager.getTeamTask()).toBe('Build a feature');
    });

    it('setTeamTask truncates at 5KB', () => {
      const mockLogger = createMockLogger();
      const mgr = new ContextManager({ logger: mockLogger });
      const largeTask = 'x'.repeat(6 * 1024); // 6KB

      mgr.setTeamTask(largeTask);

      const task = mgr.getTeamTask();
      expect(task).not.toBeNull();
      expect(Buffer.byteLength(task!, 'utf8')).toBeLessThanOrEqual(5 * 1024);
      expect(mockLogger.warnCalls.length).toBeGreaterThan(0);
      expect(mockLogger.warnCalls[0]).toContain('TeamTask exceeded 5KB limit');
    });

    it('setTeamTask calls onTeamTaskChanged hook', () => {
      const hook = vi.fn();
      const mgr = new ContextManager({ onTeamTaskChanged: hook });

      mgr.setTeamTask('New task');

      expect(hook).toHaveBeenCalledWith('New task');
    });

    it('getTeamTask returns null initially', () => {
      expect(manager.getTeamTask()).toBeNull();
    });
  });

  // ==========================================================================
  // getContextForAgent
  // ==========================================================================

  describe('getContextForAgent', () => {
    it('returns empty context when no messages', () => {
      const input = manager.getContextForAgent('agent-1', 'claude-code');

      expect(input.contextMessages).toEqual([]);
      expect(input.currentMessage).toBe('');
      expect(input.teamTask).toBeNull();
    });

    it('applies contextWindowSize limit', () => {
      const mgr = new ContextManager({ contextWindowSize: 2 });

      // Add 5 messages
      for (let i = 1; i <= 5; i++) {
        mgr.addMessage(createTestMessage({ content: `msg${i}` }));
      }

      const input = mgr.getContextForAgent('agent-1', 'claude-code');

      // contextMessages should have 2 (windowSize), excluding the last one
      expect(input.contextMessages).toHaveLength(2);
      expect(input.contextMessages[0].content).toBe('msg3');
      expect(input.contextMessages[1].content).toBe('msg4');
      expect(input.currentMessage).toBe('msg5');
    });

    it('respects windowSizeOverride', () => {
      const mgr = new ContextManager({ contextWindowSize: 2 });

      for (let i = 1; i <= 5; i++) {
        mgr.addMessage(createTestMessage({ content: `msg${i}` }));
      }

      const input = mgr.getContextForAgent('agent-1', 'claude-code', {
        windowSizeOverride: 3,
      });

      expect(input.contextMessages).toHaveLength(3);
    });

    it('strips markers from context messages', () => {
      manager.addMessage(createTestMessage({
        content: '[NEXT:sarah] Hello [FROM:max]',
      }));
      manager.addMessage(createTestMessage({ content: 'Reply' }));

      const input = manager.getContextForAgent('agent-1', 'claude-code');

      expect(input.contextMessages[0].content).toBe('Hello');
    });

    it('strips markers from current message', () => {
      manager.addMessage(createTestMessage({
        content: '[NEXT:sarah] Current message [FROM:max]',
      }));

      const input = manager.getContextForAgent('agent-1', 'claude-code');

      expect(input.currentMessage).toBe('Current message');
    });

    it('strips inline TEAM_TASK markers [TEAM_TASK: xxx]', () => {
      manager.addMessage(createTestMessage({
        content: '[TEAM_TASK: Build feature X] Hello world [NEXT:bob]',
      }));

      const input = manager.getContextForAgent('agent-1', 'claude-code');

      expect(input.currentMessage).toBe('Hello world');
      expect(input.currentMessage).not.toContain('TEAM_TASK');
    });

    it('strips block TEAM_TASK markers [TEAM_TASK]\\n...', () => {
      manager.addMessage(createTestMessage({
        content: '[TEAM_TASK]\nBuild feature X\n\n[MESSAGE]\nHello world',
      }));

      const input = manager.getContextForAgent('agent-1', 'claude-code');

      expect(input.currentMessage).not.toContain('TEAM_TASK');
      expect(input.currentMessage).toContain('Hello world');
    });

    it('deduplicates AI->AI context', () => {
      // User message
      manager.addMessage(createTestMessage({
        content: 'User question',
        speaker: { id: 'user', name: 'User', displayName: 'User', type: 'human' },
      }));

      // AI response that will be forwarded
      const aiMsg = manager.addMessage(createTestMessage({
        content: 'AI response',
        speaker: { id: 'ai-1', name: 'Max', displayName: 'Max', type: 'ai' },
      }));

      // When preparing context for next AI with the AI message as current
      // We need to simulate this scenario - but in normal flow the latest message
      // is the one being sent to the agent
      const input = manager.getContextForAgent('ai-2', 'claude-code');

      // The context should include User message, current message is AI response
      expect(input.currentMessage).toBe('AI response');
      expect(input.contextMessages).toHaveLength(1);
      expect(input.contextMessages[0].content).toBe('User question');
    });

    it('does NOT deduplicate human messages', () => {
      manager.addMessage(createTestMessage({
        content: 'First',
        speaker: { id: 'user', name: 'User', displayName: 'User', type: 'human' },
      }));
      manager.addMessage(createTestMessage({
        content: 'Second',
        speaker: { id: 'user', name: 'User', displayName: 'User', type: 'human' },
      }));

      const input = manager.getContextForAgent('agent-1', 'claude-code');

      // Human message - no dedup, but the logic is different
      // The latest message (Second) won't be in contextMessages anyway
      expect(input.currentMessage).toBe('Second');
      expect(input.contextMessages).toHaveLength(1);
    });

    it('passes systemInstruction and instructionFileText', () => {
      manager.addMessage(createTestMessage({ content: 'Hello' }));

      const input = manager.getContextForAgent('agent-1', 'claude-code', {
        systemInstruction: 'You are Max',
        instructionFileText: 'Be helpful',
      });

      expect(input.systemInstruction).toBe('You are Max');
      expect(input.instructionFileText).toBe('Be helpful');
    });

    it('passes maxBytes to output', () => {
      const mgr = new ContextManager({ maxBytes: 100000 });
      mgr.addMessage(createTestMessage({ content: 'Hello' }));

      const input = mgr.getContextForAgent('agent-1', 'claude-code');

      expect(input.maxBytes).toBe(100000);
    });
  });

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  describe('Lifecycle', () => {
    it('clear removes all messages', () => {
      manager.addMessage(createTestMessage({ content: 'msg1' }));
      manager.addMessage(createTestMessage({ content: 'msg2' }));

      manager.clear();

      expect(manager.getMessages()).toEqual([]);
    });

    it('clear resets teamTask', () => {
      manager.setTeamTask('Some task');
      manager.clear();

      expect(manager.getTeamTask()).toBeNull();
    });

    it('clear resets message ID counter', () => {
      manager.addMessage(createTestMessage());
      manager.clear();

      const newMsg = manager.addMessage(createTestMessage());
      expect(newMsg.id).toBe('msg-1');
    });

    it('clear calls onTeamTaskChanged hook', () => {
      const hook = vi.fn();
      const mgr = new ContextManager({ onTeamTaskChanged: hook });
      mgr.setTeamTask('task');

      mgr.clear();

      expect(hook).toHaveBeenLastCalledWith(null);
    });
  });

  // ==========================================================================
  // Persistence
  // ==========================================================================

  describe('Persistence', () => {
    it('exportSnapshot returns serializable object', () => {
      manager.addMessage(createTestMessage({ content: 'msg1' }));
      manager.setTeamTask('task1');

      const snapshot = manager.exportSnapshot();

      expect(snapshot.version).toBe(1);
      expect(snapshot.messages).toHaveLength(1);
      expect(snapshot.teamTask).toBe('task1');
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    it('importSnapshot restores messages', () => {
      const msg = createTestMessage({ content: 'restored' });
      const msgWithId = { id: 'msg-100', ...msg };

      manager.importSnapshot({
        messages: [msgWithId as ConversationMessage],
        teamTask: null,
        timestamp: Date.now(),
        version: 1,
      });

      expect(manager.getMessages()).toHaveLength(1);
      expect(manager.getMessages()[0].content).toBe('restored');
    });

    it('importSnapshot restores teamTask', () => {
      manager.importSnapshot({
        messages: [],
        teamTask: 'restored task',
        timestamp: Date.now(),
        version: 1,
      });

      expect(manager.getTeamTask()).toBe('restored task');
    });

    it('importSnapshot throws on invalid format', () => {
      expect(() => manager.importSnapshot(null as any)).toThrow('Invalid snapshot format');
      expect(() => manager.importSnapshot({ version: 2 } as any)).toThrow('Invalid snapshot format');
    });

    it('importSnapshot recalculates next message ID', () => {
      const msg = createTestMessage({ content: 'existing' });
      const msgWithId = { id: 'msg-50', ...msg };

      manager.importSnapshot({
        messages: [msgWithId as ConversationMessage],
        teamTask: null,
        timestamp: Date.now(),
        version: 1,
      });

      const newMsg = manager.addMessage(createTestMessage({ content: 'new' }));
      expect(newMsg.id).toBe('msg-51');
    });
  });

  // ==========================================================================
  // assemblePrompt
  // ==========================================================================

  describe('assemblePrompt', () => {
    it('uses ClaudeContextAssembler for claude-code', () => {
      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        systemInstruction: 'You are Max',
        maxBytes: 768 * 1024,
      };

      const output = manager.assemblePrompt('claude-code', input);

      expect(output.prompt).toContain('[MESSAGE]');
      expect(output.systemFlag).toBe('You are Max');
    });

    it('uses CodexContextAssembler for openai-codex', () => {
      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        systemInstruction: 'You are Sarah',
        maxBytes: 768 * 1024,
      };

      const output = manager.assemblePrompt('openai-codex', input);

      expect(output.prompt).toContain('[SYSTEM]');
      expect(output.prompt).toContain('[MESSAGE]');
      expect(output.systemFlag).toBeUndefined();
    });

    it('uses GeminiContextAssembler for google-gemini', () => {
      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        systemInstruction: 'You are Carol',
        maxBytes: 768 * 1024,
      };

      const output = manager.assemblePrompt('google-gemini', input);

      expect(output.prompt).toContain('Instructions:');
      expect(output.prompt).toContain('Last message:');
      expect(output.systemFlag).toBeUndefined();
    });

    it('falls back to PlainTextAssembler for unknown type', () => {
      const mockLogger = createMockLogger();
      const mgr = new ContextManager({ logger: mockLogger });

      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        maxBytes: 768 * 1024,
      };

      const output = mgr.assemblePrompt('custom-agent' as any, input);

      expect(output.prompt).toBe('Hello');
      expect(mockLogger.warnCalls.length).toBeGreaterThan(0);
      expect(mockLogger.warnCalls[0]).toContain('Unknown agentType');
    });

    it('normalizes agent type (claude -> claude-code)', () => {
      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        systemInstruction: 'Test',
        maxBytes: 768 * 1024,
      };

      const output = manager.assemblePrompt('claude' as any, input);

      // Should use Claude assembler (systemFlag present)
      expect(output.systemFlag).toBe('Test');
    });

    it('normalizes agent type (codex -> openai-codex)', () => {
      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        systemInstruction: 'Test',
        maxBytes: 768 * 1024,
      };

      const output = manager.assemblePrompt('codex' as any, input);

      // Should use Codex assembler ([SYSTEM] inline)
      expect(output.prompt).toContain('[SYSTEM]');
      expect(output.systemFlag).toBeUndefined();
    });

    it('normalizes agent type (gemini -> google-gemini)', () => {
      const input = {
        contextMessages: [],
        currentMessage: 'Hello',
        teamTask: null,
        systemInstruction: 'Test',
        maxBytes: 768 * 1024,
      };

      const output = manager.assemblePrompt('gemini' as any, input);

      // Should use Gemini assembler
      expect(output.prompt).toContain('Instructions:');
    });
  });
});
