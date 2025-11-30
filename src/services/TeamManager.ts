/**
 * TeamManager - 管理团队配置
 *
 * 负责创建、更新、删除和查询团队
 * 使用 StorageService 持久化团队数据
 */

import type { IStorageService } from '../infrastructure/StorageService.js';
import { StorageKeys } from '../infrastructure/StorageService.js';
import type { Team, Member, RoleDefinition } from '../models/Team.js';
import { TeamUtils } from '../models/Team.js';

export interface CreateTeamInput {
  id?: string;
  name: string;
  description: string;
  displayName?: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinition[];
  members: Array<Omit<Member, 'id'> & { id?: string }>;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  displayName?: string;
  instructionFile?: string;
  roleDefinitions?: RoleDefinition[];
  members?: Array<Partial<Member> & { id?: string }>;
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
    // 生成成员 ID（若提供则尊重，否则生成）
    const membersWithIds: Member[] = input.members.map(member =>
      member.id
        ? { ...member } as Member
        : TeamUtils.createMember(member)
    );

    // 创建团队对象
    const team = TeamUtils.createTeam(
      input.name,
      input.description,
      membersWithIds,
      input.instructionFile,
      input.roleDefinitions
    );
    team.displayName = input.displayName;
    // 如果提供了固定的 teamId，则使用之以保证跨进程稳定
    if (input.id) {
      team.id = input.id;
    }

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

    // 处理成员更新
    let updatedMembers = existingTeam.members;
    if (input.members) {
      if (input.replaceMembers) {
        // 完全替换模式：直接使用提供的成员列表
        updatedMembers = input.members.map(memberInput => {
          if (memberInput.id) {
            // 如果提供了ID，查找现有成员以保留ID
            const existingMember = existingTeam.members.find(m => m.id === memberInput.id);
            if (existingMember) {
              // 合并更新
              return {
                ...existingMember,
                ...memberInput,
                id: existingMember.id
              } as Member;
            }
            // ID存在但找不到，视为新成员（保留ID）
            return memberInput as Member;
          }
          // 没有ID，创建新成员
          return TeamUtils.createMember(memberInput as Omit<Member, 'id'>);
        });
      } else {
        // 合并模式（默认）：保留现有成员，只更新提供的成员
        const memberMap = new Map<string, Member>();

        // 首先，添加所有现有成员到Map
        for (const member of existingTeam.members) {
          memberMap.set(member.id, member);
        }

        // 然后，处理input中的成员更新
        for (const memberInput of input.members) {
          if (memberInput.id && memberMap.has(memberInput.id)) {
            // 如果提供了ID且存在，合并更新现有成员
            const existingMember = memberMap.get(memberInput.id)!;
            memberMap.set(memberInput.id, {
              ...existingMember,
              ...memberInput,
              id: existingMember.id  // 确保ID不变
            } as Member);
          } else if (memberInput.id) {
            // 提供了ID但不存在，添加为新成员（保留提供的ID）
            memberMap.set(memberInput.id, memberInput as Member);
          } else {
            // 没有ID，创建新成员（生成新ID）
            const newMember = TeamUtils.createMember(memberInput as Omit<Member, 'id'>);
            memberMap.set(newMember.id, newMember);
          }
        }

        // 转换回数组
        updatedMembers = Array.from(memberMap.values());
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
   * 根据 ID 获取成员
   */
  async getMemberById(teamId: string, memberId: string): Promise<Member | undefined> {
    const team = await this.getTeam(teamId);
    if (!team) {
      return undefined;
    }

    return team.members.find(m => m.id === memberId);
  }

  // Deprecated: Use getMemberById instead
  async getRoleById(teamId: string, memberId: string): Promise<Member | undefined> {
    return this.getMemberById(teamId, memberId);
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
