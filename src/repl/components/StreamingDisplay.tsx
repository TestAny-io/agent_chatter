import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEvent } from '../../events/AgentEvent.js';

function formatLine(event: AgentEvent): { label: string; color: string } {
  switch (event.type) {
    case 'session.started':
      return { label: `session started (${event.agentId})`, color: 'cyan' };
    case 'text':
      return { label: event.text, color: event.role === 'assistant' ? 'white' : 'gray' };
    case 'tool.started':
      return { label: `[tool:start] ${event.toolName ?? ''}`, color: 'yellow' };
    case 'tool.completed':
      return { label: `[tool:done] ${event.toolId ?? ''} ${event.output ?? ''}`, color: 'green' };
    case 'turn.completed':
      return { label: `turn completed (${event.finishReason})`, color: event.finishReason === 'done' ? 'green' : 'magenta' };
    case 'error':
      return { label: `error: ${event.error}`, color: 'red' };
    default:
      return { label: '', color: 'white' };
  }
}

export function StreamingDisplay({ events }: { events: AgentEvent[] }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} marginY={1}>
      <Text color="cyan">Streaming events</Text>
      {events.slice(-6).map(ev => {
        const line = formatLine(ev);
        return (
          <Text key={ev.eventId} color={line.color}>
            {line.label}
          </Text>
        );
      })}
    </Box>
  );
}
