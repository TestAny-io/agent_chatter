// 导出所有数据模型
export type { Team, Member, RoleDefinition } from './Team.js';
export { TeamUtils } from './Team.js';
export type { ValidationResult as TeamValidationResult } from './Team.js';

// Deprecated: Use Member instead
export type { Member as Role } from './Team.js';

export type { AgentConfig, TestResult } from './AgentConfig.js';
export { AgentConfigUtils } from './AgentConfig.js';
export type { ValidationResult as AgentValidationResult } from './AgentConfig.js';

export type * from './ConversationMessage.js';
export type * from './ConversationSession.js';

// v3: RoutingItem and related types
export type {
  RoutingItem,
  RoutingIntent,
  ShortIntent,
} from './RoutingItem.js';
export {
  generateRoutingItemId,
  intentToEnum,
  enumToShortIntent,
  getIntentPriority,
  compareIntents,
} from './RoutingItem.js';

// v3: Queue events with extended types
export type {
  QueueUpdateEvent,
  QueueItemView,
  QueueStats,
  SkipReason,
  QueueProtectionEvent,
} from './QueueEvent.js';

// CLIConfig types (kept for backward compatibility)
export type {
  CLIConfig,
  ConversationConfig,
  TeamConfig,
  AgentDefinition,
  TeamMemberConfig
} from './CLIConfig.js';

// CoreTeamConfig types (LLD-05: separated Core config)
export type {
  CoreTeamConfig,
  CoreConversationConfig
} from './CoreTeamConfig.js';
