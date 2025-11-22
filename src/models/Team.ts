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
  instructionFile?: string;
  env?: Record<string, string>;
  systemInstruction?: string;
  instructionFileText?: string; // Resolved content of instructionFile for prompt assembly
  additionalArgs?: string[];  // 成员特定的额外 CLI 参数（用于 Adapter）
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

    for (const member of team.members) {
      // Validate AI members have agentConfigId
      if (member.type === 'ai' && !member.agentConfigId) {
        errors.push(`AI 成员 "${member.name}" 缺少 agentConfigId`);
      }

      // Validate member name pattern
      if (!/^[a-zA-Z0-9_-]+$/.test(member.name)) {
        errors.push(`成员名称 "${member.name}" 包含无效字符。仅允许字母、数字、下划线和连字符`);
      }

      // Validate additionalArgs if present
      if (member.additionalArgs !== undefined) {
        if (!Array.isArray(member.additionalArgs)) {
          errors.push(`成员 "${member.name}" 的 additionalArgs 必须是数组`);
        } else {
          for (const arg of member.additionalArgs) {
            if (typeof arg !== 'string') {
              errors.push(`成员 "${member.name}" 的 additionalArgs 必须包含字符串`);
              break;
            }
          }
        }
      }

      // Validate env if present
      if (member.env !== undefined) {
        if (typeof member.env !== 'object' || member.env === null || Array.isArray(member.env)) {
          errors.push(`成员 "${member.name}" 的 env 必须是对象（不能是 null 或数组）`);
        } else {
          // Validate all env values are strings
          for (const [key, value] of Object.entries(member.env)) {
            if (typeof value !== 'string') {
              errors.push(`成员 "${member.name}" 的 env["${key}"] 必须是字符串，当前类型为 ${typeof value}`);
            }
          }
        }
      }

      // Validate order
      if (typeof member.order !== 'number' || member.order < 0) {
        errors.push(`成员 "${member.name}" 的 order 必须是非负数`);
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
