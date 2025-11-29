/**
 * ConfigAdapter Unit Tests
 *
 * LLD-05: Tests for config splitting and merging
 */

import { describe, it, expect } from 'vitest';
import { ConfigAdapter, splitConfig, mergeConfig, DEFAULT_UI_PREFERENCES } from '../../../src/cli/config/index.js';
import type { CLIConfig } from '../../../src/models/CLIConfig.js';

describe('ConfigAdapter', () => {
  const fullConfig: CLIConfig = {
    schemaVersion: '1.2',
    agents: [{ name: 'claude', args: ['--verbose'] }],
    team: {
      name: 'test-team',
      description: 'Test team',
      members: [
        { name: 'human', type: 'human', displayName: 'Human', role: 'user', baseDir: '/tmp' }
      ]
    },
    maxRounds: 10,
    conversation: {
      maxAgentResponseTime: 30000,
      showThinkingTimer: true,
      allowEscCancel: false,
    },
  };

  describe('split', () => {
    it('should extract Core config correctly', () => {
      const { coreConfig } = splitConfig(fullConfig);

      expect(coreConfig.schemaVersion).toBe('1.2');
      expect(coreConfig.agents).toHaveLength(1);
      expect(coreConfig.agents![0].name).toBe('claude');
      expect(coreConfig.team.name).toBe('test-team');
      expect(coreConfig.maxRounds).toBe(10);
      expect(coreConfig.conversation?.maxAgentResponseTime).toBe(30000);
      // UI fields should NOT exist in Core config
      expect((coreConfig.conversation as any)?.showThinkingTimer).toBeUndefined();
      expect((coreConfig.conversation as any)?.allowEscCancel).toBeUndefined();
    });

    it('should extract UI preferences correctly', () => {
      const { uiPrefs } = splitConfig(fullConfig);

      expect(uiPrefs.showThinkingTimer).toBe(true);
      expect(uiPrefs.allowEscCancel).toBe(false);
    });

    it('should use defaults for missing UI preferences', () => {
      const minimalConfig: CLIConfig = {
        team: { name: 'test', description: 'Test', members: [] },
      };

      const { uiPrefs } = splitConfig(minimalConfig);

      expect(uiPrefs.showThinkingTimer).toBe(DEFAULT_UI_PREFERENCES.showThinkingTimer);
      expect(uiPrefs.allowEscCancel).toBe(DEFAULT_UI_PREFERENCES.allowEscCancel);
    });

    it('should handle missing conversation config', () => {
      const configWithoutConversation: CLIConfig = {
        team: { name: 'test', description: 'Test', members: [] },
      };

      const { coreConfig, uiPrefs } = splitConfig(configWithoutConversation);

      expect(coreConfig.conversation).toBeUndefined();
      expect(uiPrefs.showThinkingTimer).toBe(true);
      expect(uiPrefs.allowEscCancel).toBe(true);
    });

    it('should handle conversation config with only UI fields', () => {
      const configWithOnlyUI: CLIConfig = {
        team: { name: 'test', description: 'Test', members: [] },
        conversation: {
          showThinkingTimer: false,
          allowEscCancel: true,
        },
      };

      const { coreConfig, uiPrefs } = splitConfig(configWithOnlyUI);

      // Core conversation should be undefined since no Core fields
      expect(coreConfig.conversation).toBeUndefined();
      expect(uiPrefs.showThinkingTimer).toBe(false);
      expect(uiPrefs.allowEscCancel).toBe(true);
    });
  });

  describe('merge', () => {
    it('should merge Core config and UI preferences', () => {
      const { coreConfig, uiPrefs } = splitConfig(fullConfig);
      const merged = mergeConfig(coreConfig, uiPrefs);

      expect(merged.schemaVersion).toBe('1.2');
      expect(merged.team.name).toBe('test-team');
      expect(merged.maxRounds).toBe(10);
      expect(merged.conversation?.maxAgentResponseTime).toBe(30000);
      expect(merged.conversation?.showThinkingTimer).toBe(true);
      expect(merged.conversation?.allowEscCancel).toBe(false);
    });

    it('should round-trip correctly', () => {
      const { coreConfig, uiPrefs } = splitConfig(fullConfig);
      const merged = mergeConfig(coreConfig, uiPrefs);

      // Compare key fields (not deep equal due to potential undefined differences)
      expect(merged.schemaVersion).toBe(fullConfig.schemaVersion);
      expect(merged.team.name).toBe(fullConfig.team.name);
      expect(merged.maxRounds).toBe(fullConfig.maxRounds);
      expect(merged.conversation?.maxAgentResponseTime).toBe(fullConfig.conversation?.maxAgentResponseTime);
      expect(merged.conversation?.showThinkingTimer).toBe(fullConfig.conversation?.showThinkingTimer);
      expect(merged.conversation?.allowEscCancel).toBe(fullConfig.conversation?.allowEscCancel);
    });
  });

  describe('class methods', () => {
    it('ConfigAdapter.split should work same as splitConfig', () => {
      const result1 = ConfigAdapter.split(fullConfig);
      const result2 = splitConfig(fullConfig);

      expect(result1.coreConfig.schemaVersion).toBe(result2.coreConfig.schemaVersion);
      expect(result1.uiPrefs.showThinkingTimer).toBe(result2.uiPrefs.showThinkingTimer);
    });

    it('ConfigAdapter.merge should work same as mergeConfig', () => {
      const { coreConfig, uiPrefs } = splitConfig(fullConfig);
      const result1 = ConfigAdapter.merge(coreConfig, uiPrefs);
      const result2 = mergeConfig(coreConfig, uiPrefs);

      expect(result1.schemaVersion).toBe(result2.schemaVersion);
      expect(result1.conversation?.showThinkingTimer).toBe(result2.conversation?.showThinkingTimer);
    });
  });
});
