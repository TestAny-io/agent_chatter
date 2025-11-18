/**
 * Wizard Flow Integration Tests
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  processWizardStep1Input,
  type WizardStep1Data,
} from '../../src/repl/wizard/wizardStep1Reducer.js';

const runWizardFlow = (inputs: string[]) => {
  let data: WizardStep1Data = {};
  let result = { data, events: [], stepCompleted: false };

  for (const input of inputs) {
    result = processWizardStep1Input(data, input);
    data = result.data;
  }

  return result;
};

describe('Wizard Flow Integration', () => {
  it('completes Step 1 with multiple roles and members', () => {
    const inputs = [
      'Advanced Team',
      'Handles complex reviews',
      '', // default instruction file
      '3', // roles
      'developer',
      'Develops features',
      'security',
      'Reviews security',
      'qa',
      '', // skip description
      '4', // members
      'developer',
      'security',
      'qa',
      'developer',
    ];

    const result = runWizardFlow(inputs);
    expect(result.stepCompleted).toBe(true);
    expect(result.data.roleDefinitions).toHaveLength(3);
    expect(result.data.members).toHaveLength(4);
    expect(result.data.roleDefinitions?.[2].description).toBe('');
  });

  it('uses default instruction file when input is empty', () => {
    const result = runWizardFlow(['Team', 'Desc', '', '1', 'reviewer', '', '1', 'reviewer']);
    expect(result.stepCompleted).toBe(true);
    expect(result.data.teamInstructionFile).toContain(
      path.join('teams', 'Team', 'team_instruction.md')
    );
  });

  it('emits error when role assignment is invalid', () => {
    const start = runWizardFlow(['Team', 'Desc', '', '1', 'reviewer', '', '1']);
    const invalid = processWizardStep1Input(start.data, 'invalid');
    expect(invalid.stepCompleted).toBe(false);
    expect(invalid.events[0]?.type).toBe('error');
    expect(invalid.events[0]?.message).toContain('Invalid role');
  });
});

