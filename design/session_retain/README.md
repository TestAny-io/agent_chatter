# Session Persistence & Restoration - Design Documents

## Overview

本目录包含 Session Persistence（会话持久化）功能的完整设计文档。

## Document Structure

```
design/session_retain/
├── README.md                              # 本文档（索引）
├── session-persistence-architecture.md    # 方向性文档（架构决策）
├── high-level-design.md                   # HLD v1.3（高阶设计）
└── LLD Documents:
    ├── lld-session-snapshot.md            # SessionSnapshot 数据模型
    ├── lld-session-storage.md             # ISessionStorage 接口与实现
    ├── lld-coordinator-restore.md         # Coordinator 恢复/保存逻辑
    ├── lld-speaker-migration.md           # Speaker 字段迁移
    ├── lld-schema-validator.md            # JSON Schema 校验器
    └── lld-repl-cli-integration.md        # REPL/CLI 集成
```

## Document Descriptions

| Document | Version | Description |
|----------|---------|-------------|
| `session-persistence-architecture.md` | - | 方向性文档，包含核心原则和架构决策 |
| `high-level-design.md` | 1.3 | 高阶设计，定义整体架构、组件关系、数据流 |
| `lld-session-snapshot.md` | 1.0 | SessionSnapshot 类型定义、字段规范、工厂函数 |
| `lld-session-storage.md` | 1.0 | ISessionStorage 接口、FileSystem/InMemory 实现 |
| `lld-coordinator-restore.md` | 1.0 | setTeam async 改造、restoreSession、save triggers |
| `lld-speaker-migration.md` | 1.0 | roleId→id 迁移策略、migrateMessageSpeaker 函数 |
| `lld-schema-validator.md` | 1.0 | Ajv 校验器、版本检查、错误处理 |
| `lld-repl-cli-integration.md` | 1.0 | REPL 恢复提示、CLI --resume 参数 |

## Key Design Decisions

1. **Context-Only Restore**: 仅恢复上下文（messages, teamTask），不恢复运行时状态
2. **Ready-Idle State**: 恢复后处于 paused 状态，清空 routingQueue
3. **Explicit Control**: 恢复必须用户显式选择，CLI 默认新建会话
4. **No Todos**: Todo 不持久化（UI 层状态）
5. **Speaker Migration**: 写入只用新字段，读取兼容旧字段
6. **Schema Validation**: 加载时强制 JSON Schema 校验

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/models/SessionSnapshot.ts` | SessionSnapshot, SessionSummary, SessionMetadata types |
| `src/models/SpeakerInfo.ts` | SpeakerInfo, LegacySpeakerInfo types |
| `src/infrastructure/ISessionStorage.ts` | Storage interface |
| `src/infrastructure/SessionStorageService.ts` | File-based implementation |
| `src/infrastructure/InMemorySessionStorage.ts` | Test implementation |
| `src/utils/speakerMigration.ts` | Migration utilities |
| `src/utils/SchemaValidator.ts` | Ajv-based validators |

### Modified Files

| File | Changes |
|------|---------|
| `src/services/ConversationCoordinator.ts` | async setTeam, restoreSession, saveCurrentSession |
| `src/models/ConversationMessage.ts` | speaker type → SpeakerInfo |
| `src/repl/ReplModeInk.tsx` | Restore prompt UI |
| `src/cli.ts` | --resume flag |

## Implementation Phases

1. **Phase 1: Infrastructure** - SessionSnapshot types, Storage service
2. **Phase 2: Core Logic** - Coordinator restore/save, Speaker migration
3. **Phase 3: Validation** - Schema validator, version checking
4. **Phase 4: UI** - REPL restore prompt, CLI flags
5. **Phase 5: Testing** - Unit tests, integration tests

## Related Files

- `schemas/cli-config-v1.2.json` - Team configuration schema
- `schemas/agent-registry-v1.1.json` - Agent registry schema
- `schemas/session-snapshot-v1.0.json` - Session snapshot schema
- `schemas/__tests__/valid/` - Valid sample files
- `schemas/__tests__/invalid/` - Invalid sample files for testing

---

**Last Updated:** 2025-11-27
**Status:** Ready for Architecture Review
