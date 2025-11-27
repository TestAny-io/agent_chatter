/**
 * RestorePrompt - Session restore prompt component
 *
 * Displays when a previous session is detected and asks user
 * whether to resume or start fresh.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionSummary } from '../../models/SessionSnapshot.js';

export interface RestorePromptProps {
  session: SessionSummary;
  teamName: string;
}

/**
 * Format time ago string
 */
export function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * RestorePrompt component
 *
 * Shows session info and prompts user to choose:
 * - [R] Resume the previous session
 * - [N] Start a new session
 */
export function RestorePrompt({ session, teamName }: RestorePromptProps): React.ReactElement {
  const timeAgo = formatTimeAgo(session.updatedAt);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="yellow">Found previous session for team '</Text>
        <Text color="cyan" bold>{teamName}</Text>
        <Text color="yellow">'</Text>
      </Box>

      <Box marginLeft={2} marginTop={1}>
        <Text dimColor>
          {timeAgo}, {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
        </Text>
      </Box>

      {session.summary && (
        <Box marginLeft={2}>
          <Text dimColor italic>"{session.summary}"</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="green">[R]</Text>
        <Text> Resume  </Text>
        <Text color="yellow">[N]</Text>
        <Text> Start New</Text>
      </Box>
    </Box>
  );
}
