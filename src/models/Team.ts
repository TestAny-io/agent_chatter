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
  members: Role[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleDefinition {
  name: string;
  displayName?: string;
  description?: string;
}

/**
 * Role - 团队成员（沿用原有命名以兼容旧代码）
 */
export interface Role {
  id: string;
  displayName: string;
  name: string;
  displayRole?: string;
  role: string;
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
    members: Role[] = [],
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

  static createRole(input: Omit<Role, 'id'>): Role {
    return {
      id: this.generateId(),
      ...input
    };
  }
}
