/**
 * Team 数据结构定义
 */

export interface Team {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinition[];
  members: Member[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleDefinition {
  name: string;
  displayName?: string;
  description?: string;
}

/**
 * Member - 团队成员
 * 每个成员通过 role 字段引用 RoleDefinition
 */
export interface Member {
  id: string;
  displayName: string;
  name: string;
  displayRole?: string;
  role: string;  // 引用 RoleDefinition 的 name
  type: 'ai' | 'human';
  agentType?: string;
  agentConfigId?: string;
  themeColor?: string;
  roleDir?: string;
  workDir?: string;
  instructionFile?: string;
  env?: Record<string, string>;
  systemInstruction?: string;
  order: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class TeamUtils {
  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static validateTeam(team: Team): ValidationResult {
    const errors: string[] = [];

    if (!team.name || team.name.trim().length === 0) {
      errors.push('团队名称不能为空');
    }

    if (!team.members || team.members.length < 2) {
      errors.push('团队至少需要 2 个成员');
    }

    const names = team.members.map(r => r.name);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      errors.push('成员名称不能重复');
    }

    for (const role of team.members) {
      if (role.type === 'ai' && !role.agentConfigId) {
        errors.push(`AI 成员 "${role.name}" 缺少 agentConfigId`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  static createTeam(
    name: string,
    description: string,
    members: Member[] = [],
    instructionFile?: string,
    roleDefinitions?: RoleDefinition[]
  ): Team {
    const now = new Date();
    return {
      id: this.generateId(),
      name,
      description,
      members,
      instructionFile,
      roleDefinitions,
      createdAt: now,
      updatedAt: now
    };
  }

  static createMember(input: Omit<Member, 'id'>): Member {
    return {
      id: this.generateId(),
      ...input
    };
  }

  // Deprecated: Use createMember instead
  static createRole(input: Omit<Member, 'id'>): Member {
    return this.createMember(input);
  }
}
