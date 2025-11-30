/**
 * @testany/agent-chatter-core
 *
 * Core library for multi-agent conversation orchestration.
 * This package contains platform-independent business logic.
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════════════════════════════
// Interfaces (DI boundary)
// ═══════════════════════════════════════════════════════════════
export type { ILogger } from './interfaces/ILogger.js';
export { SilentLogger } from './interfaces/ILogger.js';

export type {
  IExecutionEnvironment,
  IProcess,
  IPty,
  SpawnOptions,
  PtyOptions
} from './interfaces/IExecutionEnvironment.js';

export type {
  IAgentAdapter,
  AgentSpawnConfig,
  AgentSpawnResult,
  AgentExecutionMode
} from './interfaces/IAgentAdapter.js';

export type {
  IAdapterFactory,
  AdapterFactoryFn
} from './interfaces/IAdapterFactory.js';

// ═══════════════════════════════════════════════════════════════
// Services
// ═══════════════════════════════════════════════════════════════
export { ConversationCoordinator } from './services/ConversationCoordinator.js';
export type { ConversationStatus } from './services/ConversationCoordinator.js';

export { AgentManager } from './services/AgentManager.js';
export { MessageRouter } from './services/MessageRouter.js';
export { TeamManager } from './services/TeamManager.js';
export { AgentConfigManager } from './services/AgentConfigManager.js';
export { ContextEventCollector } from './services/ContextEventCollector.js';

export {
  initializeServices,
  type InitializeServicesOptions,
  type InitializeServicesResult,
  hasFlag,
  withBypassArgs
} from './services/ServiceInitializer.js';

// ═══════════════════════════════════════════════════════════════
// Models
// ═══════════════════════════════════════════════════════════════
export type {
  CoreTeamConfig,
  CoreConversationConfig
} from './models/CoreTeamConfig.js';

export type {
  CLIConfig,
  ConversationConfig,
  TeamConfig,
  TeamMemberConfig,
  AgentDefinition as AgentDefinitionConfig,
  RoleDefinitionConfig
} from './models/CLIConfig.js';

export type { Team, Member, RoleDefinition, TeamContext } from './models/Team.js';
export { TeamUtils } from './models/Team.js';

export type { ConversationMessage } from './models/ConversationMessage.js';
export type { SpeakerInfo } from './models/SpeakerInfo.js';
export type { ConversationSession } from './models/ConversationSession.js';
export type { AgentConfig, TestResult } from './models/AgentConfig.js';
export { AgentConfigUtils } from './models/AgentConfig.js';
export type { SessionSnapshot, SessionSummary } from './models/SessionSnapshot.js';

// ═══════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════
export type { QueueUpdateEvent } from './models/QueueEvent.js';
export type {
  AgentEvent,
  TodoItem,
  TodoStatus,
  TodoListEvent
} from './events/AgentEvent.js';

// ═══════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════
export type {
  VerificationResult,
  CheckResult,
  VerificationStatus,
  AuthCheckResult,
  ErrorType
} from './services/validation/types.js';

export { AgentValidator } from './services/validation/AgentValidator.js';

// ═══════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════
export { AgentRegistry } from './registry/AgentRegistry.js';
export type { AgentDefinition, AgentDefinition as RegistryAgentDefinition } from './registry/RegistryStorage.js';
export { RegistryStorage } from './registry/RegistryStorage.js';
export type { ScannedAgent } from './registry/AgentScanner.js';

// ═══════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════
export { ContextManager } from './context/ContextManager.js';

// ═══════════════════════════════════════════════════════════════
// Infrastructure
// ═══════════════════════════════════════════════════════════════
export { MockStorageService } from './infrastructure/StorageService.js';
export { SessionStorageService } from './infrastructure/SessionStorageService.js';

// ═══════════════════════════════════════════════════════════════
// Utils
// ═══════════════════════════════════════════════════════════════
export {
  getTeamConfigDir,
  ensureTeamConfigDir,
  resolveTeamConfigPath,
  formatMissingConfigError,
  discoverTeamConfigs,
  type ConfigResolution,
  type TeamConfigInfo
} from './utils/TeamConfigPaths.js';

export { detectAllTools, type ToolStatus } from './utils/ToolDetector.js';
export { getDefaultAgentConfig, type AgentType } from './utils/AgentDefaults.js';
export { colorize, colors, type ColorName } from './utils/colors.js';

// ═══════════════════════════════════════════════════════════════
// Stream Parsers
// ═══════════════════════════════════════════════════════════════
export type { StreamParser } from './events/StreamParser.js';
export { StreamParserFactory } from './events/StreamParserFactory.js';
