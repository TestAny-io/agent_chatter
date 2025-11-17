/**
 * TeamManager - 管理团队配置
 *
 * 负责创建、更新、删除和查询团队
 * 使用 StorageService 持久化团队数据
 */

import type { IStorageService } from '../infrastructure/StorageService.js';
import { StorageKeys } from '../infrastructure/StorageService.js';
import type { Team, Role, RoleDefinition } from '../models/Team.js';
import { TeamUtils } from '../models/Team.js';

export interface CreateTeamInput {
  name: string;
  description: string;
  displayName?: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinition[];
  members: Array<Omit<Role, 'id'>>;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  displayName?: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinition[];
  members?: Array<Partial<Role> & { id?: string }>;
  replaceMembers?: boolean;
}

/**
 * TeamManager 类
 */
export class TeamManager {
  constructor(private storageService: IStorageService) {}

  /**
   * 创建新团队
   */
  async createTeam(input: CreateTeamInput): Promise<Team> {
    // 生成角色 ID
    const membersWithIds = input.members.map(role => TeamUtils.createRole(role));

    // 创建团队对象
    const team = TeamUtils.createTeam(
      input.name,
      input.description,
      membersWithIds,
      input.instructionFile,
      input.roleDefinitions
    );
    team.displayName = input.displayName;

    // 验证
    const validation = TeamUtils.validateTeam(team);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    // 保存到存储
    await this.saveTeam(team);

    return team;
  }

  /**
   * 获取团队
   */
  async getTeam(teamId: string): Promise<Team | undefined> {
    const teams = await this.loadTeams();
    return teams.find(t => t.id === teamId);
  }

  /**
   * 获取所有团队
   */
  async getAllTeams(): Promise<Team[]> {
    return this.loadTeams();
  }

  /**
   * 更新团队
   */
  async updateTeam(teamId: string, input: UpdateTeamInput): Promise<Team | undefined> {
    const teams = await this.loadTeams();
    const index = teams.findIndex(t => t.id === teamId);

    if (index === -1) {
      return undefined;
    }

    const existingTeam = teams[index];

    // 处理角色更新
    let updatedMembers = existingTeam.members;
    if (input.members) {
      if (input.replaceMembers) {
        // 完全替换模式：直接使用提供的角色列表
        updatedMembers = input.members.map(roleInput => {
          if (roleInput.id) {
            // 如果提供了ID，查找现有角色以保留ID
            const existingRole = existingTeam.members.find(r => r.id === roleInput.id);
            if (existingRole) {
              // 合并更新
              return {
                ...existingRole,
                ...roleInput,
                id: existingRole.id
              } as Role;
            }
            // ID存在但找不到，视为新角色（保留ID）
            return roleInput as Role;
          }
          // 没有ID，创建新角色
          return TeamUtils.createRole(roleInput as Omit<Role, 'id'>);
        });
      } else {
        // 合并模式（默认）：保留现有角色，只更新提供的角色
        const roleMap = new Map<string, Role>();

        // 首先，添加所有现有角色到Map
        for (const role of existingTeam.members) {
          roleMap.set(role.id, role);
        }

        // 然后，处理input中的角色更新
        for (const roleInput of input.members) {
          if (roleInput.id && roleMap.has(roleInput.id)) {
            // 如果提供了ID且存在，合并更新现有角色
            const existingRole = roleMap.get(roleInput.id)!;
            roleMap.set(roleInput.id, {
              ...existingRole,
              ...roleInput,
              id: existingRole.id  // 确保ID不变
            } as Role);
          } else if (roleInput.id) {
            // 提供了ID但不存在，添加为新角色（保留提供的ID）
            roleMap.set(roleInput.id, roleInput as Role);
          } else {
            // 没有ID，创建新角色（生成新ID）
            const newRole = TeamUtils.createRole(roleInput as Omit<Role, 'id'>);
            roleMap.set(newRole.id, newRole);
          }
        }

        // 转换回数组
        updatedMembers = Array.from(roleMap.values());
      }
    }

    // 创建更新后的团队
    const updatedTeam: Team = {
      ...existingTeam,
      name: input.name ?? existingTeam.name,
      description: input.description ?? existingTeam.description,
      displayName: input.displayName ?? existingTeam.displayName,
      instructionFile: input.instructionFile ?? existingTeam.instructionFile,
      roleDefinitions: input.roleDefinitions ?? existingTeam.roleDefinitions,
      members: updatedMembers,
      updatedAt: new Date()
    };

    // 验证
    const validation = TeamUtils.validateTeam(updatedTeam);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    // 更新数组
    teams[index] = updatedTeam;

    // 保存到存储
    await this.storageService.save(StorageKeys.TEAMS, teams);

    return updatedTeam;
  }

  /**
   * 删除团队
   */
  async deleteTeam(teamId: string): Promise<boolean> {
    const teams = await this.loadTeams();
    const index = teams.findIndex(t => t.id === teamId);

    if (index === -1) {
      return false;
    }

    teams.splice(index, 1);
    await this.storageService.save(StorageKeys.TEAMS, teams);

    return true;
  }

  /**
   * 根据 ID 获取角色
   */
  async getRoleById(teamId: string, roleId: string): Promise<Role | undefined> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return undefined;
    }

    return team.members.find(r => r.id === roleId);
  }

  /**
   * 从存储加载所有团队
   */
  private async loadTeams(): Promise<Team[]> {
    const teams = await this.storageService.load<Team[]>(StorageKeys.TEAMS);
    return teams || [];
  }

  /**
   * 保存单个团队到存储
   */
  private async saveTeam(team: Team): Promise<void> {
    const teams = await this.loadTeams();
    teams.push(team);
    await this.storageService.save(StorageKeys.TEAMS, teams);
  }
}
