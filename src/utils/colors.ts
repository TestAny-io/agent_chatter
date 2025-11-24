/**
 * ANSI color utilities - single source of truth.
 */
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
} as const;

export type ColorName = keyof typeof colors;

export function colorize(text: string, color: ColorName): string {
  return `${colors[color]}${text}${colors.reset}`;
}
