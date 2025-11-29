/**
 * UIPreferences - UI 偏好配置
 *
 * @file src/cli/config/UIPreferences.ts
 * @layer CLI
 *
 * @remarks
 * 仅包含 UI 展示相关字段，与 Core 逻辑无关。
 * Core 业务配置在 CoreTeamConfig 中定义。
 */

/**
 * UI 偏好配置
 */
export interface UIPreferences {
  /** 是否显示 Agent 思考计时器 */
  showThinkingTimer: boolean;

  /** 是否允许 ESC 键取消操作 */
  allowEscCancel: boolean;
}

/**
 * 默认 UI 偏好
 */
export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  showThinkingTimer: true,
  allowEscCancel: true,
};
