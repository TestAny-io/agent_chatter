/**
 * Unit tests for normalizeSystemInstruction utility function
 *
 * @file tests/unit/utils/normalizeSystemInstruction.test.ts
 */

import { describe, it, expect } from 'vitest';
import { normalizeSystemInstruction } from '../../../src/utils/normalizeSystemInstruction.js';

describe('normalizeSystemInstruction', () => {
  describe('undefined input', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeSystemInstruction(undefined)).toBeUndefined();
    });
  });

  describe('string input', () => {
    it('returns undefined for empty string', () => {
      expect(normalizeSystemInstruction('')).toBeUndefined();
    });

    it('returns undefined for whitespace-only string', () => {
      expect(normalizeSystemInstruction('   ')).toBeUndefined();
      expect(normalizeSystemInstruction('\t\n')).toBeUndefined();
    });

    it('trims and returns string', () => {
      expect(normalizeSystemInstruction('  hello  ')).toBe('hello');
    });

    it('preserves internal whitespace and newlines', () => {
      expect(normalizeSystemInstruction('  hello\nworld  ')).toBe('hello\nworld');
    });

    it('returns non-empty string as-is after trim', () => {
      expect(normalizeSystemInstruction('single line')).toBe('single line');
    });
  });

  describe('array input', () => {
    it('returns undefined for empty array', () => {
      expect(normalizeSystemInstruction([])).toBeUndefined();
    });

    it('returns undefined for array of empty strings or whitespace', () => {
      expect(normalizeSystemInstruction(['', '  ', '\n'])).toBeUndefined();
      expect(normalizeSystemInstruction(['   ', '\t', '\n'])).toBeUndefined();
    });

    it('joins array with newlines', () => {
      expect(normalizeSystemInstruction(['line1', 'line2', 'line3']))
        .toBe('line1\nline2\nline3');
    });

    it('filters empty strings from array', () => {
      expect(normalizeSystemInstruction(['line1', '', '  ', 'line2']))
        .toBe('line1\nline2');
    });

    it('trims each array element', () => {
      expect(normalizeSystemInstruction(['  line1  ', '  line2  ']))
        .toBe('line1\nline2');
    });

    it('handles array with single element', () => {
      expect(normalizeSystemInstruction(['single'])).toBe('single');
    });

    it('handles array with single empty element', () => {
      expect(normalizeSystemInstruction([''])).toBeUndefined();
    });

    it('preserves internal newlines in array elements', () => {
      expect(normalizeSystemInstruction(['line1\nline1b', 'line2']))
        .toBe('line1\nline1b\nline2');
    });
  });

  describe('real-world examples', () => {
    it('handles typical system instruction array', () => {
      const input = [
        'You are a senior developer.',
        'Follow coding best practices.',
        'Always write tests.',
      ];
      expect(normalizeSystemInstruction(input))
        .toBe('You are a senior developer.\nFollow coding best practices.\nAlways write tests.');
    });

    it('handles array with accidental empty lines', () => {
      const input = [
        'First instruction.',
        '',
        'Second instruction.',
        '   ',
        'Third instruction.',
      ];
      expect(normalizeSystemInstruction(input))
        .toBe('First instruction.\nSecond instruction.\nThird instruction.');
    });
  });
});
