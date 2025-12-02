/**
 * Utility function for normalizing systemInstruction field
 *
 * @file src/utils/normalizeSystemInstruction.ts
 */

/**
 * Normalize systemInstruction to string
 *
 * @param input - string | string[] | undefined
 * @returns string | undefined
 *
 * @remarks
 * - Empty array returns undefined
 * - Array elements are trimmed and empty strings filtered out
 * - Array elements are joined with newline
 * - String is trimmed; returns undefined if empty after trim
 */
export function normalizeSystemInstruction(
  input: string | string[] | undefined
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (Array.isArray(input)) {
    // Filter empty strings, join with newlines
    const filtered = input
      .map(s => s.trim())
      .filter(s => s.length > 0);
    return filtered.length > 0 ? filtered.join('\n') : undefined;
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
