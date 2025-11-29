import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export interface LoadingIndicatorProps {
  message: string;
}

export function LoadingIndicator({ message }: LoadingIndicatorProps) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box marginY={1}>
      <Text color="cyan">{message}{dots}</Text>
    </Box>
  );
}
