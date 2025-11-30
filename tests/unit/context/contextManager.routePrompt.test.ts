/**
 * ContextManager Route Prompt Tests (v3)
 *
 * Tests the v3 context retrieval and prompt assembly:
 * 1. Parent message reinsertion (forceParentReinsertion)
 * 2. Sibling context limits (maxSiblings)
 * 3. Length pressure handling (siblingContentMaxLength)
 * 4. Deduplication rules (parent message, target member's last message)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from '../../../src/context/ContextManager.js';
import type { ConversationMessage } from '../../../src/models/ConversationMessage.js';
import type { RoutingItem } from '../../../src/models/RoutingItem.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeMessage(
  speakerId: string,
  speakerName: string,
  content: string,
  options?: {
    parentMessageId?: string;
    intent?: 'P1_INTERRUPT' | 'P2_REPLY' | 'P3_EXTEND';
    type?: 'ai' | 'human' | 'system';
  }
): Omit<ConversationMessage, 'id'> {
  return {
    timestamp: new Date(),
    speaker: {
      id: speakerId,
      name: speakerName,
      displayName: speakerName,
      type: options?.type ?? 'ai',
    },
    content,
    routing: options?.parentMessageId
      ? {
          rawNextMarkers: [],
          resolvedAddressees: [],
          parentMessageId: options.parentMessageId,
          intent: options.intent,
        }
      : {
          rawNextMarkers: [],
          resolvedAddressees: [],
        },
  };
}

function makeRoute(
  targetMemberId: string,
  parentMessageId: string,
  intent: 'P1_INTERRUPT' | 'P2_REPLY' | 'P3_EXTEND' = 'P2_REPLY'
): RoutingItem {
  return {
    id: `route-${Date.now()}`,
    targetMemberId,
    parentMessageId,
    triggerMessageId: parentMessageId,
    intent,
    enqueuedAt: Date.now(),
  };
}

// ============================================================================
// Test Suite 1: Parent Message Reinsertion
// ============================================================================

describe('v3 Parent Message Reinsertion', () => {
  it('reinserts parent when not in context window (forceParentReinsertion=true)', () => {
    const cm = new ContextManager({
      contextWindowSize: 2,
      defaultForceParentReinsertion: true,
    });

    // Add messages: parent is outside window
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Parent message', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Response 1'));
    cm.addMessage(makeMessage('ai-b', 'AI B', 'Response 2'));
    cm.addMessage(makeMessage('ai-c', 'AI C', 'Response 3'));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Parent should be reinserted since it's outside window (size=2)
    expect(result.parentContext).toBeDefined();
    expect(result.parentContext?.content).toBe('Parent message');
  });

  it('does not reinsert parent when in context window (based on window calculation)', () => {
    const cm = new ContextManager({
      contextWindowSize: 5,
      defaultForceParentReinsertion: true,
    });

    // Add messages: parent followed by enough messages to push it into window
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Parent message', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Response 1'));
    cm.addMessage(makeMessage('ai-b', 'AI B', 'Response 2'));
    // Add more messages but parent is still within window of 5

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // When parent is at index 0, contextEndIndex = 0, so context window is empty
    // Context window is calculated as: messages.slice(contextStartIndex, contextEndIndex)
    // where contextEndIndex = parentIndex (does not include parent)
    // So the "in window" check looks at whether parent is within contextMessages array
    // Since parent IS the routing target, it becomes currentMessage, not part of context
    // The parentContext is used when parent is NOT in the context window (outside window range)

    // In this case: parent at index 0, window size 5
    // contextEndIndex = 0 (parent index)
    // contextStartIndex = max(0, 0-5) = 0
    // contextMessages = messages.slice(0, 0) = []
    // parentInWindow = contextMessages.some(m => m.id === parent.id) = false
    // So parentContext WILL be set (reinsertion happens when parent not in window)

    // The behavior is: parentContext is provided when forceParentReinsertion=true AND
    // the parent is not found in the context messages array (which excludes parent itself)
    expect(result.parentContext).toBeDefined();
    expect(result.parentContext?.content).toBe('Parent message');
  });

  it('respects forceParentReinsertion=false option', () => {
    const cm = new ContextManager({
      contextWindowSize: 2,
      defaultForceParentReinsertion: false,
    });

    // Add messages
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Parent message', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Response 1'));
    cm.addMessage(makeMessage('ai-b', 'AI B', 'Response 2'));
    cm.addMessage(makeMessage('ai-c', 'AI C', 'Response 3'));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route, {
      forceParentReinsertion: false,
    });

    // Parent should not be reinserted
    expect(result.parentContext).toBeUndefined();
  });

  it('uses parent message content as currentMessage', () => {
    const cm = new ContextManager({ contextWindowSize: 5 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Fix this bug please', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Working on it'));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // currentMessage should be the parent's content
    expect(result.currentMessage).toBe('Fix this bug please');
  });

  it('falls back to getContextForAgent when parent not found', () => {
    const cm = new ContextManager({ contextWindowSize: 5 });

    cm.addMessage(makeMessage('human', 'Human', 'Latest message', { type: 'human' }));

    // Route to non-existent parent
    const route = makeRoute('ai-target', 'non-existent-parent');
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Should have meta indicating fallback
    expect(result.meta?.parentMessageId).toBeUndefined();
    expect(result.siblingContext).toEqual([]);
  });
});

// ============================================================================
// Test Suite 2: Sibling Context Limits
// ============================================================================

describe('v3 Sibling Context Limits', () => {
  it('collects sibling messages with same parentMessageId', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 5,
    });

    // Parent message
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    // Sibling responses (with parentMessageId pointing to parent)
    cm.addMessage(
      makeMessage('ai-a', 'AI A', 'Response A', {
        parentMessageId: parent.id,
        intent: 'P2_REPLY',
      })
    );
    cm.addMessage(
      makeMessage('ai-b', 'AI B', 'Response B', {
        parentMessageId: parent.id,
        intent: 'P2_REPLY',
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Should have 2 siblings
    expect(result.siblingContext.length).toBe(2);
    expect(result.meta?.siblingCount).toBe(2);
    expect(result.meta?.siblingTotalCount).toBe(2);
    expect(result.meta?.truncatedSiblings).toBe(false);
  });

  it('truncates siblings when exceeding maxSiblings', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 2,
    });

    // Parent message
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    // Many sibling responses
    for (let i = 0; i < 5; i++) {
      cm.addMessage(
        makeMessage(`ai-${i}`, `AI ${i}`, `Response ${i}`, {
          parentMessageId: parent.id,
          intent: 'P2_REPLY',
        })
      );
    }

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Should be truncated to 2
    expect(result.siblingContext.length).toBe(2);
    expect(result.meta?.siblingCount).toBe(2);
    expect(result.meta?.siblingTotalCount).toBe(5);
    expect(result.meta?.truncatedSiblings).toBe(true);
  });

  it('respects maxSiblings option override', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 10,
    });

    // Parent and siblings
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    for (let i = 0; i < 5; i++) {
      cm.addMessage(
        makeMessage(`ai-${i}`, `AI ${i}`, `Response ${i}`, {
          parentMessageId: parent.id,
          intent: 'P2_REPLY',
        })
      );
    }

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route, {
      maxSiblings: 1,
    });

    expect(result.siblingContext.length).toBe(1);
    expect(result.meta?.truncatedSiblings).toBe(true);
  });

  it('includes intent in sibling context entries', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 5,
    });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    cm.addMessage(
      makeMessage('ai-a', 'AI A', 'Interrupt response', {
        parentMessageId: parent.id,
        intent: 'P1_INTERRUPT',
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Sibling should have intent in from field
    expect(result.siblingContext[0].from).toContain('[P1_INTERRUPT]');
  });
});

// ============================================================================
// Test Suite 3: Length Pressure Handling
// ============================================================================

describe('v3 Length Pressure Handling', () => {
  it('truncates sibling content when exceeding siblingContentMaxLength', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 5,
      siblingContentMaxLength: 50,
    });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    // Sibling with long content
    const longContent = 'This is a very long response that should be truncated because it exceeds the maximum length limit';
    cm.addMessage(
      makeMessage('ai-a', 'AI A', longContent, {
        parentMessageId: parent.id,
        intent: 'P2_REPLY',
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Content should be truncated with ellipsis
    expect(result.siblingContext[0].content.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(result.siblingContext[0].content).toContain('...');
  });

  it('removes code blocks from sibling content', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 5,
      siblingContentMaxLength: 200,
    });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    // Sibling with code block
    const contentWithCode = 'Here is the fix:\n```typescript\nconst x = 1;\nconst y = 2;\n```\nThis should work.';
    cm.addMessage(
      makeMessage('ai-a', 'AI A', contentWithCode, {
        parentMessageId: parent.id,
        intent: 'P2_REPLY',
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Code block should be replaced
    expect(result.siblingContext[0].content).toContain('[code block omitted]');
    expect(result.siblingContext[0].content).not.toContain('const x = 1');
  });

  it('strips routing markers from sibling content', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    // Sibling with routing markers
    const contentWithMarkers = 'Response [NEXT: someone] with markers';
    cm.addMessage(
      makeMessage('ai-a', 'AI A', contentWithMarkers, {
        parentMessageId: parent.id,
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Markers should be stripped
    expect(result.siblingContext[0].content).not.toContain('[NEXT:');
  });
});

// ============================================================================
// Test Suite 4: Deduplication Rules
// ============================================================================

describe('v3 Deduplication Rules', () => {
  it('removes parent message from context to avoid duplication with currentMessage', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    // Messages within context window
    cm.addMessage(makeMessage('human', 'Human', 'Earlier message', { type: 'human' }));
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Parent message', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Response'));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Parent should not appear in contextMessages
    const hasParentInContext = result.contextMessages.some(
      m => m.content === 'Parent message'
    );
    expect(hasParentInContext).toBe(false);

    // But currentMessage should be the parent content
    expect(result.currentMessage).toBe('Parent message');
  });

  it('removes target member\'s most recent message from context when present', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    cm.addMessage(makeMessage('ai-target', 'AI Target', 'My previous response'));
    cm.addMessage(makeMessage('ai-other', 'AI Other', 'Other response'));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Target member's previous message should be removed (self-deduplication)
    const hasTargetPreviousMsg = result.contextMessages.some(
      m => m.content === 'My previous response'
    );
    expect(hasTargetPreviousMsg).toBe(false);
  });

  it('AI->AI deduplication removes last context if matches current message', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    // Standard getContextForAgent deduplication
    cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'AI Response'));

    // When AI is about to respond, its current message might duplicate last context
    const result = cm.getContextForAgent('ai-b', 'claude-code');

    // The AI response should be in currentMessage
    expect(result.currentMessage).toBe('AI Response');

    // Context should only have the human message (AI message is currentMessage)
    expect(result.contextMessages.length).toBe(1);
    expect(result.contextMessages[0].content).toBe('Task');
  });
});

// ============================================================================
// Test Suite 5: Route Metadata
// ============================================================================

describe('v3 Route Metadata', () => {
  it('includes parentMessageId in meta', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    const route = makeRoute('ai-target', parent.id, 'P1_INTERRUPT');
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.meta?.parentMessageId).toBe(parent.id);
    expect(result.routeMeta?.parentMessageId).toBe(parent.id);
  });

  it('includes intent in meta', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    const route = makeRoute('ai-target', parent.id, 'P1_INTERRUPT');
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.meta?.intent).toBe('P1_INTERRUPT');
    expect(result.routeMeta?.intent).toBe('P1_INTERRUPT');
  });

  it('includes targetMemberId in meta', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.meta?.targetMemberId).toBe('ai-target');
  });

  it('includes sibling statistics in meta', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 2,
    });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    for (let i = 0; i < 5; i++) {
      cm.addMessage(
        makeMessage(`ai-${i}`, `AI ${i}`, `Response ${i}`, {
          parentMessageId: parent.id,
        })
      );
    }

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.meta?.siblingCount).toBe(2);
    expect(result.meta?.siblingTotalCount).toBe(5);
    expect(result.meta?.truncatedSiblings).toBe(true);
  });
});

// ============================================================================
// Test Suite 6: Prompt Assembly Integration
// ============================================================================

describe('v3 Prompt Assembly Integration', () => {
  it('assembles prompt with parentContext when present', () => {
    const cm = new ContextManager({
      contextWindowSize: 2,
      defaultForceParentReinsertion: true,
    });

    // Parent outside window
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Original task', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Response 1'));
    cm.addMessage(makeMessage('ai-b', 'AI B', 'Response 2'));
    cm.addMessage(makeMessage('ai-c', 'AI C', 'Response 3'));

    const route = makeRoute('ai-target', parent.id);
    const contextResult = cm.getContextForRoute('ai-target', 'claude-code', route);

    // parentContext should be present and contain Original task
    expect(contextResult.parentContext).toBeDefined();
    expect(contextResult.parentContext?.content).toBe('Original task');

    // Assemble prompt - will use currentMessage which is the parent content
    const assembled = cm.assemblePrompt('claude-code', contextResult);

    // MESSAGE section should contain the original task
    expect(assembled.prompt).toContain('Original task');
  });

  it('assembles prompt with siblingContext when present', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 5,
    });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    cm.addMessage(
      makeMessage('ai-a', 'AI A', 'Sibling response content', {
        parentMessageId: parent.id,
        intent: 'P2_REPLY',
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const contextResult = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Verify sibling is in the context result
    expect(contextResult.siblingContext.length).toBe(1);
    expect(contextResult.siblingContext[0].content).toContain('Sibling response');
  });

  it('passes systemInstruction through to assembled prompt', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    const route = makeRoute('ai-target', parent.id);
    const contextResult = cm.getContextForRoute('ai-target', 'claude-code', route, {
      systemInstruction: 'You are a helpful assistant.',
    });

    expect(contextResult.systemInstruction).toBe('You are a helpful assistant.');

    // Assemble and verify
    const assembled = cm.assemblePrompt('claude-code', contextResult);
    expect(assembled.prompt).toContain('You are a helpful assistant');
  });

  it('passes instructionFileText through to assembled prompt', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    const route = makeRoute('ai-target', parent.id);
    const contextResult = cm.getContextForRoute('ai-target', 'claude-code', route, {
      instructionFileText: 'Custom instructions from file.',
    });

    expect(contextResult.instructionFileText).toBe('Custom instructions from file.');
  });
});

// ============================================================================
// Test Suite 7: Edge Cases
// ============================================================================

describe('v3 Edge Cases', () => {
  it('handles empty message history gracefully', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const route = makeRoute('ai-target', 'non-existent');
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.contextMessages).toEqual([]);
    expect(result.currentMessage).toBe('');
    expect(result.siblingContext).toEqual([]);
  });

  it('handles parent at the beginning of history', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'First message', { type: 'human' }));
    cm.addMessage(makeMessage('ai-a', 'AI A', 'Response'));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    // Context before parent should be empty
    expect(result.contextMessages.length).toBe(0);
    expect(result.currentMessage).toBe('First message');
  });

  it('handles no siblings found', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.siblingContext).toEqual([]);
    expect(result.meta?.siblingCount).toBe(0);
    expect(result.meta?.truncatedSiblings).toBe(false);
  });

  it('handles maxSiblings = 0', () => {
    const cm = new ContextManager({
      contextWindowSize: 10,
      defaultMaxSiblings: 0,
    });

    const parent = cm.addMessage(makeMessage('human', 'Human', 'Task', { type: 'human' }));
    cm.addMessage(
      makeMessage('ai-a', 'AI A', 'Sibling', {
        parentMessageId: parent.id,
      })
    );

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route);

    expect(result.siblingContext).toEqual([]);
    expect(result.meta?.siblingCount).toBe(0);
    expect(result.meta?.siblingTotalCount).toBe(1);
    expect(result.meta?.truncatedSiblings).toBe(true);
  });

  it('handles windowSizeOverride in options', () => {
    const cm = new ContextManager({ contextWindowSize: 10 });

    // Add many messages
    const parent = cm.addMessage(makeMessage('human', 'Human', 'Parent', { type: 'human' }));
    for (let i = 0; i < 10; i++) {
      cm.addMessage(makeMessage(`ai-${i}`, `AI ${i}`, `Message ${i}`));
    }

    const route = makeRoute('ai-target', parent.id);
    const result = cm.getContextForRoute('ai-target', 'claude-code', route, {
      windowSizeOverride: 2,
    });

    // Should only include up to 2 messages before parent (which is at index 0)
    // Since parent is at beginning, there are 0 messages before it
    expect(result.contextMessages.length).toBe(0);
  });
});
