/**
 * ThinkingIndicator - Displays agent execution status with timer
 *
 * Shows:
 * - Agent name and status
 * - Elapsed time in seconds
 * - ESC cancellation hint (if enabled)
 * - Maximum timeout warning
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Member } from '../../models/Team.js';

interface ThinkingIndicatorProps {
  member: Member;
  maxTimeoutMs: number;
  allowEscCancel: boolean;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  member,
  maxTimeoutMs,
  allowEscCancel
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const maxMinutes = Math.floor(maxTimeoutMs / 60000);
  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="cyan">⏳ </Text>
        <Text bold>{member.displayName}</Text>
        <Text color="dim"> is thinking... </Text>
        <Text color="yellow">{formatTime(elapsedSeconds)}</Text>
      </Box>
      <Box marginLeft={2}>
        {allowEscCancel && (
          <Text color="dim">Press ESC to cancel | </Text>
        )}
        <Text color="dim">Max timeout: {maxMinutes} minutes</Text>
      </Box>
    </Box>
  );
};
