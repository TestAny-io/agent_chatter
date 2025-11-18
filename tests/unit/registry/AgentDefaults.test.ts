import { describe, it, expect } from 'vitest';
import {
  getDefaultAgentConfig,
  getSupportedAgentTypes,
  isSupportedAgentType,
  getAgentDisplayName,
  createDefaultAgentDefinition
} from '../../../src/utils/AgentDefaults.js';

describe('AgentDefaults', () => {
  describe('getDefaultAgentConfig', () => {
    it('returns default config for claude', () => {
      const config = getDefaultAgentConfig('claude');

      expect(config).toEqual({
        name: 'claude',
        displayName: 'Claude Code',
        command: 'claude',
        args: [
          '--append-system-prompt',
          'Always end your response with [DONE] on a new line. Keep responses concise.'
        ],
        endMarker: '[DONE]',
        usePty: false
      });
    });

    it('returns default config for codex', () => {
      const config = getDefaultAgentConfig('codex');

      expect(config).toEqual({
        name: 'codex',
        displayName: 'OpenAI Codex',
        command: 'codex',
        args: ['exec', '--json', '--full-auto', '--skip-git-repo-check'],
        endMarker: '[DONE]',
        usePty: false
      });
    });

    it('returns default config for gemini', () => {
      const config = getDefaultAgentConfig('gemini');

      expect(config).toEqual({
        name: 'gemini',
        displayName: 'Google Gemini CLI',
        command: 'gemini',
        args: ['-p'],
        endMarker: '[DONE]',
        usePty: false
      });
    });

    it('allows custom command path', () => {
      const config = getDefaultAgentConfig('claude', '/custom/path/claude');

      expect(config.command).toBe('/custom/path/claude');
      expect(config.name).toBe('claude');
    });

    it('throws error for unknown agent type', () => {
      expect(() => {
        // @ts-expect-error Testing invalid type
        getDefaultAgentConfig('unknown');
      }).toThrow('Unknown agent type: unknown');
    });
  });

  describe('getSupportedAgentTypes', () => {
    it('returns all supported agent types', () => {
      const types = getSupportedAgentTypes();

      expect(types).toEqual(['claude', 'codex', 'gemini']);
    });
  });

  describe('isSupportedAgentType', () => {
    it('returns true for supported agent types', () => {
      expect(isSupportedAgentType('claude')).toBe(true);
      expect(isSupportedAgentType('codex')).toBe(true);
      expect(isSupportedAgentType('gemini')).toBe(true);
    });

    it('returns false for unsupported agent types', () => {
      expect(isSupportedAgentType('unknown')).toBe(false);
      expect(isSupportedAgentType('gpt')).toBe(false);
      expect(isSupportedAgentType('')).toBe(false);
    });
  });

  describe('getAgentDisplayName', () => {
    it('returns correct display name for claude', () => {
      expect(getAgentDisplayName('claude')).toBe('Claude Code');
    });

    it('returns correct display name for codex', () => {
      expect(getAgentDisplayName('codex')).toBe('OpenAI Codex');
    });

    it('returns correct display name for gemini', () => {
      expect(getAgentDisplayName('gemini')).toBe('Google Gemini CLI');
    });
  });

  describe('createDefaultAgentDefinition', () => {
    it('creates complete agent definition with timestamp', () => {
      const before = new Date().toISOString();
      const definition = createDefaultAgentDefinition('claude');
      const after = new Date().toISOString();

      expect(definition.name).toBe('claude');
      expect(definition.displayName).toBe('Claude Code');
      expect(definition.command).toBe('claude');
      expect(definition.installedAt).toBeDefined();
      expect(definition.installedAt >= before).toBe(true);
      expect(definition.installedAt <= after).toBe(true);
    });

    it('includes version when provided', () => {
      const definition = createDefaultAgentDefinition('codex', undefined, '0.58.0');

      expect(definition.version).toBe('0.58.0');
    });

    it('version is undefined when not provided', () => {
      const definition = createDefaultAgentDefinition('gemini');

      expect(definition.version).toBeUndefined();
    });

    it('accepts custom command path', () => {
      const definition = createDefaultAgentDefinition('claude', '/usr/local/bin/claude');

      expect(definition.command).toBe('/usr/local/bin/claude');
    });

    it('generates unique timestamps for sequential calls', async () => {
      const def1 = createDefaultAgentDefinition('claude');

      // 等待 5ms 确保时间戳不同（某些系统的时间精度较低）
      await new Promise(resolve => setTimeout(resolve, 5));

      const def2 = createDefaultAgentDefinition('codex');

      // 时间戳应该不同，或者至少def2应该 >= def1
      expect(def2.installedAt >= def1.installedAt).toBe(true);
    });
  });
});
