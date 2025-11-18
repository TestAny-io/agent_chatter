import path from 'path';
import type { RoleDefinition } from '../../models/Team.js';

export interface MemberAssignment {
  memberIndex: number;
  assignedRole: string;
}

export interface WizardStep1Data {
  teamName?: string;
  teamDescription?: string;
  teamInstructionFile?: string;
  roleDefinitions?: RoleDefinition[];
  members?: MemberAssignment[];
  maxRounds?: number;

  // Temporary fields (wizard runtime state)
  _roleCount?: number;
  _currentRoleIndex?: number;
  _memberCount?: number;
  _currentMemberIndex?: number;
}

export type WizardStep1EventType = 'info' | 'prompt' | 'error' | 'divider';

export interface WizardStep1Event {
  type: WizardStep1EventType;
  message?: string;
  char?: string;
}

export interface WizardStep1ReducerResult {
  data: WizardStep1Data;
  events: WizardStep1Event[];
  stepCompleted: boolean;
}

const divider = (char: string = '═'): WizardStep1Event => ({
  type: 'divider',
  char,
});

const info = (message: string): WizardStep1Event => ({
  type: 'info',
  message,
});

const prompt = (message: string): WizardStep1Event => ({
  type: 'prompt',
  message,
});

const errorEvent = (message: string): WizardStep1Event => ({
  type: 'error',
  message,
});

const cloneRoles = (roles?: RoleDefinition[]): RoleDefinition[] | undefined =>
  roles ? roles.map(role => ({ ...role })) : undefined;

const cloneMembers = (members?: MemberAssignment[]): MemberAssignment[] | undefined =>
  members ? members.map(member => ({ ...member })) : undefined;

const normalizeRoleName = (name: string): string => name.trim().toLowerCase();

const createRolePlaceholder = (): RoleDefinition => ({
  name: '',
  description: undefined,
});

export function processWizardStep1Input(
  data: WizardStep1Data,
  rawInput: string
): WizardStep1ReducerResult {
  const input = rawInput ?? '';
  const trimmedInput = input.trim();
  const events: WizardStep1Event[] = [];

  // Clone data to avoid mutating original reference
  const nextData: WizardStep1Data = {
    ...data,
    roleDefinitions: cloneRoles(data.roleDefinitions),
    members: cloneMembers(data.members),
  };

  const fail = (message: string): WizardStep1ReducerResult => ({
    data,
    events: [errorEvent(message)],
    stepCompleted: false,
  });

  // 1. Team name
  if (!nextData.teamName) {
    if (!trimmedInput) {
      return fail('Team name is required');
    }

    nextData.teamName = input;
    events.push(info(`✓ Team name: ${input}`));
    events.push(prompt('Enter team description:'));

    return { data: nextData, events, stepCompleted: false };
  }

  // 2. Team description
  if (!nextData.teamDescription) {
    if (!trimmedInput) {
      return fail('Team description is required');
    }

    nextData.teamDescription = input;
    events.push(info(`✓ Description: ${input}`));
    events.push(prompt('Enter team instruction file path (or press Enter for default):'));
    return { data: nextData, events, stepCompleted: false };
  }

  // 3. Instruction file
  if (!nextData.teamInstructionFile) {
    const defaultPath = `./teams/${nextData.teamName}/team_instruction.md`;
    const filePath = trimmedInput || defaultPath;
    const absolutePath = path.resolve(filePath);
    nextData.teamInstructionFile = absolutePath;

    events.push(info(`✓ Instruction file: ${absolutePath}`));
    events.push(prompt('How many roles do you need? (e.g., 2)'));
    return { data: nextData, events, stepCompleted: false };
  }

  const roles = nextData.roleDefinitions ?? [];
  const members = nextData.members ?? [];

  // 4. Role count
  const hasStartedRoles =
    Array.isArray(nextData.roleDefinitions) && nextData.roleDefinitions.length > 0;

  if (nextData._roleCount === undefined && !hasStartedRoles) {
    const roleCount = parseInt(trimmedInput, 10);
    if (isNaN(roleCount) || roleCount < 1) {
      return fail('Please enter a valid number (at least 1)');
    }

    nextData._roleCount = roleCount;
    nextData._currentRoleIndex = 0;
    nextData.roleDefinitions = [createRolePlaceholder()];

    events.push(info(`✓ Will define ${roleCount} role(s)`));
    events.push(prompt('Role 1 name (e.g., "reviewer"):'));
    return { data: nextData, events, stepCompleted: false };
  }

  // 4.x Role details
  if (
    nextData._currentRoleIndex !== undefined &&
    nextData._roleCount !== undefined
  ) {
    const currentIndex = nextData._currentRoleIndex;
    const totalRoles = nextData._roleCount;

    if (!nextData.roleDefinitions || !nextData.roleDefinitions[currentIndex]) {
      // Should not happen, but guard and create placeholder
      nextData.roleDefinitions = [
        ...(nextData.roleDefinitions || []),
        createRolePlaceholder(),
      ];
    }

    const currentRole = nextData.roleDefinitions![currentIndex];

    // Collect role name
    if (!currentRole.name) {
      if (!trimmedInput) {
        return fail('Role name is required');
      }

      currentRole.name = input;
      events.push(info(`✓ Role ${currentIndex + 1} name: ${input}`));
      events.push(prompt(`Role ${currentIndex + 1} description (optional, press Enter to skip):`));

      return { data: nextData, events, stepCompleted: false };
    }

    // Collect role description (allow empty string to skip)
    if (currentRole.description === undefined) {
      currentRole.description = input;
      events.push(
        info(
          `✓ Role ${currentIndex + 1} description: ${input ? input : '(none)'}`
        )
      );

      const newIndex = currentIndex + 1;
      if (newIndex < totalRoles) {
        nextData._currentRoleIndex = newIndex;
        nextData.roleDefinitions!.push(createRolePlaceholder());
        events.push(prompt(`Role ${newIndex + 1} name:`));
      } else {
        nextData._currentRoleIndex = undefined;
        nextData._roleCount = undefined;
        events.push(info('✓ All roles defined!'));
        events.push(prompt('How many team members (AI + Human) in total?'));
      }

      return { data: nextData, events, stepCompleted: false };
    }
  }

  // 5. Member count
  if (nextData._memberCount === undefined) {
    const memberCount = parseInt(trimmedInput, 10);
    if (isNaN(memberCount) || memberCount < 1) {
      return fail('Please enter a valid number (at least 1)');
    }

    nextData._memberCount = memberCount;
    nextData._currentMemberIndex = 0;
    nextData.members = [];

    const rolesList = (nextData.roleDefinitions || [])
      .filter(role => role.name)
      .map(role => role.name)
      .join(', ');

    events.push(info(`✓ Will configure ${memberCount} member(s)`));
    if (rolesList) {
      events.push(info(`Available roles: ${rolesList}`));
    }
    events.push(prompt('Member 1 - Which role? (enter role name)'));
    return { data: nextData, events, stepCompleted: false };
  }

  // 5.x Member assignments
  if (
    nextData._currentMemberIndex !== undefined &&
    nextData._memberCount !== undefined
  ) {
    const rolesList = nextData.roleDefinitions || [];
    const roleExists = rolesList.some(
      role => normalizeRoleName(role.name || '') === normalizeRoleName(input)
    );

    if (!roleExists) {
      const availableRoles = rolesList
        .map(role => role.name)
        .filter(Boolean)
        .join(', ');
      return fail(`Invalid role. Available roles: ${availableRoles}`);
    }

    const newMemberIndex = nextData._currentMemberIndex + 1;
    const newMembers = [...(nextData.members || [])];
    newMembers.push({
      memberIndex: newMemberIndex,
      assignedRole: input,
    });
    nextData.members = newMembers;

    events.push(info(`✓ Member ${newMemberIndex} assigned to role: ${input}`));

    if (newMemberIndex < nextData._memberCount) {
      nextData._currentMemberIndex = newMemberIndex;
      events.push(prompt(`Member ${newMemberIndex + 1} - Which role?`));
      return { data: nextData, events, stepCompleted: false };
    }

    // Completed Step 1
    nextData._currentMemberIndex = undefined;
    nextData._memberCount = undefined;
    events.push(divider());
    events.push(info('✓ Step 1 Complete!'));
    events.push(prompt('Moving to Step 2: Detect AI Agents...'));
    events.push(info('(Step 2 full implementation coming in Phase 2)'));

    return { data: nextData, events, stepCompleted: true };
  }

  // Should not reach here
  return {
    data,
    events: [errorEvent('Unexpected input. Please try again.')],
    stepCompleted: false,
  };
}

