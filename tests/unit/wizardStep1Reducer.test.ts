/**
 * Wizard Step 1 Reducer Tests
 */

import { describe, it, expect } from 'vitest';
import {
  processWizardStep1Input,
  type WizardStep1Data,
} from '../../src/repl/wizard/wizardStep1Reducer.js';

function runInputs(inputs: string[]) {
  let data: WizardStep1Data = {};
  let result = { data, events: [], stepCompleted: false };

  for (const input of inputs) {
    result = processWizardStep1Input(data, input);
    data = result.data;
  }

  return result;
}

describe('wizardStep1Reducer', () => {
  it('completes full Step 1 flow with valid inputs', () => {
    const inputs = [
      'Code Review Team', // name
      'A team for collaborative reviews', // description
      '', // instruction file (default)
      '2', // role count
      'developer',
      'Develops features',
      'reviewer',
      'Reviews code',
      '3', // member count
      'developer',
      'reviewer',
      'developer',
    ];

    const result = runInputs(inputs);

    expect(result.stepCompleted).toBe(true);
    expect(result.data.teamName).toBe('Code Review Team');
    expect(result.data.roleDefinitions).toHaveLength(2);
    expect(result.data.members).toHaveLength(3);
    expect(result.data._memberCount).toBeUndefined();
    expect(result.data._roleCount).toBeUndefined();
  });

  it('allows skipping role description with empty input', () => {
    const inputs = [
      'Team',
      'Desc',
      '', // default instruction
      '1',
      'reviewer',
      '', // skip description
      '1',
      'reviewer',
    ];

    const result = runInputs(inputs);

    expect(result.stepCompleted).toBe(true);
    expect(result.data.roleDefinitions?.[0].description).toBe('');
    expect(result.data.members?.[0].assignedRole).toBe('reviewer');
  });

  it('rejects invalid role assignment', () => {
    const inputs = ['Team', 'Desc', '', '1', 'developer', '', '1'];
    let state: WizardStep1Data = {};
    let result = { data: state, events: [], stepCompleted: false };
    for (const input of inputs) {
      result = processWizardStep1Input(state, input);
      state = result.data;
    }

    const invalid = processWizardStep1Input(state, 'invalid-role');

    expect(invalid.stepCompleted).toBe(false);
    expect(invalid.events[0]?.type).toBe('error');
    expect(invalid.events[0]?.message).toContain('Invalid role');
  });

  it('enforces mandatory team name', () => {
    const result = processWizardStep1Input({}, '');
    expect(result.stepCompleted).toBe(false);
    expect(result.events[0]?.type).toBe('error');
    expect(result.events[0]?.message).toContain('Team name is required');
  });
});

