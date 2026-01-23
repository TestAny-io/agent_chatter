/**
 * LogSanitizer - Redacts sensitive fields from log payloads
 */

export interface LogSanitizer {
  /**
   * Redact sensitive fields from an object (deep clone).
   */
  sanitize<T extends object>(obj: T): T;

  /**
   * Redact a single string value.
   */
  sanitizeString(value: string, fieldName: string): string;
}

export const SENSITIVE_FIELDS = [
  'instruction',
  'instructionContent',
  'systemInstruction',
  'systemPrompt',
  'prompt',
] as const;

export class DefaultLogSanitizer implements LogSanitizer {
  private sensitiveFields: Set<string>;

  constructor(additionalFields: string[] = []) {
    this.sensitiveFields = new Set([...SENSITIVE_FIELDS, ...additionalFields]);
  }

  sanitize<T extends object>(obj: T): T {
    return this.deepSanitize(obj) as T;
  }

  sanitizeString(value: string, fieldName: string): string {
    return `[REDACTED:${fieldName}:len=${value.length}]`;
  }

  private deepSanitize(value: unknown, path: string[] = []): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      const fieldName = path[path.length - 1];
      if (fieldName && this.sensitiveFields.has(fieldName)) {
        return this.sanitizeString(value, fieldName);
      }
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => this.deepSanitize(item, [...path, String(index)]));
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(record)) {
        result[key] = this.deepSanitize(item, [...path, key]);
      }
      return result;
    }

    return value;
  }
}
