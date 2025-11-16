/**
 * Team - 团队配置
 */
export interface Team {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role - 团队中的角色
 */
export interface Role {
  id: string;
  title: string;        // "产品经理"
  name: string;         // "Alice"
  type: 'ai' | 'human';
  agentConfigId?: string;  // AI 角色映射的 agent 配置 ID
  systemInstruction?: string;  // AI 角色的 system instruction
  order: number;        // 显示顺序
}

/**
 * 团队验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 团队工具函数
 */
export class TeamUtils {
  /**
   * 生成唯一 ID
   */
  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 验证团队配置
   */
  static validateTeam(team: Team): ValidationResult {
    const errors: string[] = [];

    // 检查基本字段
    if (!team.name || team.name.trim().length === 0) {
      errors.push('团队名称不能为空');
    }

    if (!team.roles || team.roles.length < 2) {
      errors.push('团队至少需要 2 个角色');
    }

    // 检查角色名称重复
    const names = team.roles.map(r => r.name);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      errors.push('角色名称不能重复');
    }

    // 检查 AI 角色配置完整性
    for (const role of team.roles) {
      if (role.type === 'ai') {
        if (!role.agentConfigId) {
          errors.push(`AI 角色 "${role.name}" 缺少 agentConfigId`);
        }
        if (!role.systemInstruction) {
          errors.push(`AI 角色 "${role.name}" 缺少 systemInstruction`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 创建新团队
   */
  static createTeam(
    name: string,
    description: string,
    roles: Role[] = []
  ): Team {
    const now = new Date();
    return {
      id: this.generateId(),
      name,
      description,
      roles,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * 创建新角色（接受对象参数）
   */
  static createRole(input: Omit<Role, 'id'>): Role {
    return {
      id: this.generateId(),
      ...input
    };
  }
}
