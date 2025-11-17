# Test Coverage Analysis Report

**Generated**: 2025-11-17
**Project**: Agent Chatter
**Total Test Files**: 6 (4 unit tests, 2 integration tests)

---

## Executive Summary

### Overall Coverage Estimate

| Category | Coverage | Status |
|----------|----------|--------|
| Core Features | ~65% | 🟡 Moderate |
| Critical Path | ~75% | 🟢 Good |
| Edge Cases | ~30% | 🔴 Low |
| Integration | ~50% | 🟡 Moderate |
| Schema Migration | 0% | 🔴 None |

### Critical Issues Identified

1. **❌ ZERO coverage for schema migration logic** (silent and interactive modes)
2. **❌ Path validation and directory creation logic not tested**
3. **❌ Environment variable merging logic not tested**
4. **❌ Instruction file loading and fallback logic not tested**
5. **❌ Multi-agent process isolation not tested**

---

## Detailed Coverage Analysis

### 1. Team Configuration & Validation (Team.ts, TeamUtils)

#### ✅ **COVERED** by `tests/unit/teamUtils.test.ts`:

- Team creation with metadata (line 31-42)
- Minimum member constraint validation (line 44-48)
- Duplicate member name detection (line 50-57)
- agentConfigId requirement for AI roles (line 59-66)

#### ❌ **NOT COVERED**:

1. **Team name validation** - empty/whitespace name detection (Team.ts:58-60)
   - Missing test for empty team names
   - Missing test for whitespace-only names

2. **RoleDefinition validation**
   - No tests for roleDefinitions structure
   - No tests for role name consistency between roleDefinitions and member.role

3. **Role creation** (Team.ts:104-109)
   - TeamUtils.createRole() never tested
   - No verification of ID generation uniqueness

4. **Team update timestamp** - updatedAt field management
   - No tests for timestamp updates

5. **instructionFile path validation**
   - No tests for absolute vs relative path handling
   - No tests for missing instructionFile scenario

**Priority**: 🟡 Medium
**Recommended Tests**: 8-10 additional test cases

---

### 2. Agent Management (AgentManager.ts)

#### ✅ **COVERED** by `tests/unit/agentManager.test.ts`:

- Lazy agent starting (line 42-49)
- Process reuse for same roleId (line 42-49)
- sendAndReceive with endMarker options (line 51-59)
- stopAgent cleanup (line 61-67)

#### ❌ **NOT COVERED**:

1. **Error handling** (AgentManager.ts:50-53)
   - Missing agent config (config not found scenario)
   - Invalid configId handling

2. **Multiple agents management**
   - Starting multiple different agents concurrently
   - Agent instance tracking across multiple roles

3. **isRunning() method** (AgentManager.ts:118-120)
   - Never tested in isolation

4. **getRunningRoles() method** (AgentManager.ts:133-135)
   - Never tested

5. **getAgentInfo() method** (AgentManager.ts:140-142)
   - Never tested
   - No verification of returned AgentInstance structure

6. **cleanup() behavior** (AgentManager.ts:125-128)
   - Tested indirectly but not thoroughly
   - No verification that all agents are actually stopped

7. **Process-to-role mapping edge cases**
   - What happens when processManager fails?
   - What happens when sendAndReceive times out?

**Priority**: 🟢 High
**Recommended Tests**: 10-12 additional test cases

---

### 3. Message Routing (MessageRouter.ts)

#### ✅ **COVERED** by `tests/unit/messageRouter.test.ts`:

- NEXT marker parsing with multiple addressees (line 5-14)
- DONE marker priority over NEXT (line 16-23)
- Marker stripping from content (line 25-30)

#### ❌ **NOT COVERED**:

1. **Edge cases in parseMessage()**
   - Empty message
   - Message with only markers
   - Multiple NEXT markers in one message
   - Malformed NEXT markers (missing colon, missing bracket)
   - Case insensitivity verification (uppercase NEXT, mixed case)

2. **stripMarkers() edge cases** (MessageRouter.ts:73-88)
   - Markers at different positions (beginning, middle, end)
   - Multiple consecutive markers
   - Markers with extra whitespace

3. **Unicode and special characters**
   - Addressee names with Unicode characters
   - Addressee names with special characters

4. **Performance with large messages**
   - Large message content with many markers

**Priority**: 🟡 Medium
**Recommended Tests**: 8-10 additional test cases

---

### 4. Conversation Coordination (ConversationCoordinator.ts)

#### ✅ **COVERED** by `tests/unit/conversationCoordinator.test.ts`:

- AI → Human → AI routing with round-robin fallback (line 66-97)
- Human message injection (line 90)
- Waiting state management (line 88)
- Conversation completion detection (line 96)

#### ❌ **NOT COVERED**:

1. **Context message management** (ConversationCoordinator.ts:264-275, 386-393)
   - Context message count limiting
   - Recent message retrieval logic
   - prepareDelivery() with different context sizes

2. **buildAgentMessage() logic** (ConversationCoordinator.ts:304-330)
   - NEVER TESTED - critical path!
   - System instruction inclusion
   - Context message formatting
   - Message structure validation

3. **resolveAddressees() fuzzy matching** (ConversationCoordinator.ts:341-372)
   - NEVER TESTED - critical routing logic!
   - ID exact matching
   - Name fuzzy matching
   - displayName fuzzy matching
   - Case insensitivity
   - Space/hyphen/underscore normalization

4. **normalizeIdentifier()** (ConversationCoordinator.ts:377-381)
   - NEVER TESTED
   - Critical for addressee resolution

5. **Multiple addressees handling**
   - Sending to multiple AI agents
   - Sending to multiple humans (waiting state)
   - Mixed AI/human addressees

6. **Status transitions**
   - active → paused → active
   - pause() and resume() methods (lines 447-460)
   - stop() method (line 465-467)

7. **Unresolved addressees callback** (ConversationCoordinator.ts:226-234)
   - onUnresolvedAddressees callback invocation
   - Handling when no addressees resolve

8. **Error scenarios**
   - No active conversation error
   - Role not found error
   - Missing agentConfigId error

9. **Initial conversation setup** (ConversationCoordinator.ts:56-95)
   - System message creation
   - First speaker being human vs AI
   - Invalid firstSpeakerId

**Priority**: 🔴 CRITICAL
**Recommended Tests**: 20-25 additional test cases

---

### 5. Configuration Loading & Initialization (ConversationStarter.ts)

#### ✅ **COVERED** by `tests/integration/conversationStarter.integration.test.ts`:

- Configuration loading and parsing (line 66-144)
- Directory creation (roleDir, workDir, homeDir) (line 133-134)
- Instruction file content loading (line 131)
- Environment variable merging with HOME (line 132)
- Team member normalization (line 130)
- Full conversation flow (line 137-143)

#### ❌ **NOT COVERED**:

1. **normalizeAgentDefinitions()** (ConversationStarter.ts:131-143)
   - Never tested in isolation
   - Agent name mapping
   - Default args handling

2. **resolveInstructionFile()** (ConversationStarter.ts:145-163)
   - CRITICAL PATH - NOT TESTED!
   - agentType-based filename inference:
     - gemini → GEMINI.md
     - claude → CLAUDE.md
     - default → AGENTS.md
     - human → README.md
   - Absolute vs relative path resolution
   - Fallback when instructionFile undefined

3. **ensureDir()** (ConversationStarter.ts:165-171)
   - Error handling when directory creation fails
   - Recursive directory creation
   - Warning message output

4. **normalizeMemberPaths()** (ConversationStarter.ts:173-184)
   - NOT TESTED IN ISOLATION
   - Default path construction (roleDir/work, roleDir/home)
   - Path resolution logic

5. **buildEnv()** (ConversationStarter.ts:186-205)
   - CRITICAL - NOT TESTED!
   - HOME environment variable setting
   - CODEX_HOME calculation for codex agents
   - Environment variable merging priority
   - User-provided env overriding defaults

6. **loadInstructionContent()** (ConversationStarter.ts:207-219)
   - File existence checking
   - Error handling for unreadable files
   - Warning message output
   - Return undefined when file missing

7. **initializeServices() edge cases** (ConversationStarter.ts:224-319)
   - Missing agentType for AI member (line 248-254)
   - AgentType not found in definitions (line 251-254)
   - Multiple members with same name
   - Empty team
   - Invalid schemaVersion

8. **displayMessage() formatting** (ConversationStarter.ts:103-112)
   - Color formatting
   - Timestamp formatting
   - AI vs human color differentiation

9. **waitForUserInput()** (ConversationStarter.ts:117-129)
   - Never tested
   - Input handling

10. **startConversation() flow** (ConversationStarter.ts:324-374)
    - Invalid first speaker name
    - Exit/quit command handling
    - Status polling interval behavior

**Priority**: 🔴 CRITICAL
**Recommended Tests**: 25-30 additional test cases

---

### 6. Sample Configuration Validation (sampleConfigs.integration.test.ts)

#### ✅ **COVERED** by `tests/integration/sampleConfigs.integration.test.ts`:

- JSON parsing for all sample files (line 14-27)
- Required field validation (agents, team.members)
- roleDir/homeDir/instructionFile presence

#### ❌ **NOT COVERED**:

1. **Schema version validation**
   - No check that all samples use schemaVersion "1.0"

2. **RoleDefinitions consistency**
   - No validation that member.role matches a roleDefinition.name

3. **AgentType cross-reference**
   - No validation that member.agentType references an existing agent

4. **Path format validation**
   - No check for absolute vs relative paths
   - No verification of path consistency

5. **Duplicate detection**
   - No check for duplicate member names
   - No check for duplicate agent names

**Priority**: 🟡 Medium
**Recommended Tests**: 5-8 additional test cases

---

### 7. Schema Migration Logic (team-configuration.md)

#### ❌ **ZERO COVERAGE** - Most Critical Gap!

**From design/team-configuration.md lines 1160-1250:**

1. **Silent Migration** (silentMigration function)
   - schemaVersion addition
   - instructionFile defaulting to "./TEAM.md"
   - Default roleDefinitions creation
   - Legacy field fallback (members vs roles)
   - Member role assignment to default "Member"

2. **Interactive Migration** (interactiveMigration function)
   - promptTeamInstructionFile() workflow
   - autoInferRoles() logic:
     - AI → "Assistant" inference
     - Human → "Participant" inference
     - Role deduplication
   - confirmRoleStructure() user interaction
   - Migration cancellation handling
   - Member role assignment from inferred roles

3. **Migration trigger conditions**
   - /config command → silent migration
   - /team show → silent migration
   - /team edit → interactive migration

4. **Error scenarios**
   - Migration cancelled by user
   - Invalid legacy config format
   - Missing required fields

**Priority**: 🔴 **ABSOLUTELY CRITICAL**
**Recommended Tests**: 15-20 test cases

**Suggested Test File**: `tests/unit/schemaMigration.test.ts`

---

## Uncovered Features Summary

### Critical (Must Test Before Production)

1. **Schema Migration Logic** - 0% coverage
   - Silent migration (lines 1160-1182)
   - Interactive migration (lines 1190-1228)
   - autoInferRoles() function (lines 1230-1250)

2. **Environment Variable Logic** (ConversationStarter.ts:186-205)
   - HOME setting
   - CODEX_HOME calculation
   - Environment merging priority

3. **Instruction File Resolution** (ConversationStarter.ts:145-163)
   - Agent type-based filename selection
   - Path resolution logic
   - Fallback handling

4. **Message Building for Agents** (ConversationCoordinator.ts:304-330)
   - System instruction inclusion
   - Context formatting
   - Message structure

5. **Addressee Resolution & Fuzzy Matching** (ConversationCoordinator.ts:341-381)
   - ID/name/displayName matching
   - Normalization logic
   - Case insensitivity

### Important (Should Test Soon)

6. **Path Normalization** (ConversationStarter.ts:173-184)
   - Default path construction
   - Directory creation

7. **Team Validation Edge Cases** (Team.ts:55-82)
   - Empty team name
   - Role consistency checks

8. **Agent Manager Methods** (AgentManager.ts)
   - getRunningRoles()
   - getAgentInfo()
   - isRunning()

9. **ConversationCoordinator Status Management**
   - pause() / resume()
   - stop()
   - Status transitions

10. **Multiple Addressees Handling**
    - Multiple AI agents
    - Multiple humans
    - Mixed scenarios

### Nice to Have (Lower Priority)

11. **MessageRouter Edge Cases**
    - Malformed markers
    - Unicode handling
    - Large messages

12. **Sample Config Validation**
    - Schema version consistency
    - Role definition cross-reference
    - Duplicate detection

13. **Display & Formatting Functions**
    - displayMessage()
    - waitForUserInput()
    - Color formatting

---

## Recommended Test Plan

### Phase 1: Critical Coverage (Immediate)

**Estimated Effort**: 3-5 days

1. Create `tests/unit/schemaMigration.test.ts`
   - Silent migration: 5 tests
   - Interactive migration: 5 tests
   - autoInferRoles: 3 tests
   - Error handling: 2 tests

2. Create `tests/unit/conversationStarter.test.ts`
   - buildEnv(): 4 tests
   - resolveInstructionFile(): 5 tests
   - normalizeMemberPaths(): 3 tests
   - loadInstructionContent(): 3 tests

3. Expand `tests/unit/conversationCoordinator.test.ts`
   - buildAgentMessage(): 4 tests
   - resolveAddressees(): 6 tests
   - normalizeIdentifier(): 2 tests

**Total**: ~42 new test cases

### Phase 2: Important Coverage (Next Sprint)

**Estimated Effort**: 2-3 days

4. Expand `tests/unit/agentManager.test.ts`
   - Error handling: 3 tests
   - Method coverage: 5 tests
   - Multi-agent scenarios: 3 tests

5. Expand `tests/unit/conversationCoordinator.test.ts`
   - Status management: 4 tests
   - Multiple addressees: 4 tests
   - Edge cases: 4 tests

6. Expand `tests/unit/teamUtils.test.ts`
   - Validation edge cases: 4 tests
   - Role creation: 2 tests

**Total**: ~29 new test cases

### Phase 3: Edge Cases & Polish (Future)

**Estimated Effort**: 2-3 days

7. Create `tests/unit/messageRouter.test.ts` expansions
   - Edge cases: 8 tests

8. Expand `tests/integration/sampleConfigs.integration.test.ts`
   - Consistency validation: 5 tests

9. Create `tests/integration/multiAgent.integration.test.ts`
   - Multiple AI agents: 3 tests
   - Process isolation: 2 tests

**Total**: ~18 new test cases

---

## Coverage Metrics After Recommended Tests

| Category | Current | After Phase 1 | After Phase 2 | After Phase 3 |
|----------|---------|---------------|---------------|---------------|
| Core Features | 65% | 85% | 92% | 95% |
| Critical Path | 75% | 95% | 98% | 99% |
| Edge Cases | 30% | 50% | 70% | 85% |
| Integration | 50% | 60% | 75% | 85% |
| Schema Migration | 0% | 80% | 90% | 95% |

---

## Test File Organization Recommendations

### Current Structure ✅
```
tests/
├── unit/
│   ├── agentManager.test.ts
│   ├── conversationCoordinator.test.ts
│   ├── messageRouter.test.ts
│   └── teamUtils.test.ts
└── integration/
    ├── conversationStarter.integration.test.ts
    └── sampleConfigs.integration.test.ts
```

### Recommended Structure After Phase 1-3
```
tests/
├── unit/
│   ├── agentManager.test.ts (expanded)
│   ├── conversationCoordinator.test.ts (expanded)
│   ├── conversationStarter.test.ts (NEW)
│   ├── messageRouter.test.ts (expanded)
│   ├── schemaMigration.test.ts (NEW - CRITICAL)
│   └── teamUtils.test.ts (expanded)
└── integration/
    ├── conversationStarter.integration.test.ts
    ├── multiAgent.integration.test.ts (NEW)
    └── sampleConfigs.integration.test.ts (expanded)
```

---

## Key Risks

### 🔴 **HIGH RISK - No Migration Tests**
The schema migration code (both silent and interactive) has **ZERO test coverage**. This is production-critical code that will run when users upgrade. A bug here could corrupt user configurations.

**Mitigation**: Create `tests/unit/schemaMigration.test.ts` immediately.

### 🔴 **HIGH RISK - Path & Environment Logic Untested**
The path normalization and environment variable building logic is complex and critical for multi-agent isolation. No tests verify:
- Correct HOME/CODEX_HOME setting
- Directory creation success/failure
- Path resolution edge cases

**Mitigation**: Create `tests/unit/conversationStarter.test.ts` covering these functions.

### 🟡 **MEDIUM RISK - Addressee Resolution Untested**
The fuzzy matching logic for addressees is completely untested. Bugs here could cause messages to route incorrectly.

**Mitigation**: Add 6-8 tests for `resolveAddressees()` and `normalizeIdentifier()`.

---

## Conclusion

**Current Test Suite Quality**: 🟡 **Moderate**

The existing test suite covers the happy path well but misses:
1. **Critical migration logic** (0% coverage)
2. **Critical path functions** (buildEnv, resolveInstructionFile, buildAgentMessage, resolveAddressees)
3. **Error handling** across most modules
4. **Edge cases** in routing and parsing

**Recommended Action Plan**:
1. **Immediate**: Implement Phase 1 tests (schema migration, ConversationStarter critical functions)
2. **Next Sprint**: Implement Phase 2 tests (AgentManager expansion, ConversationCoordinator expansion)
3. **Future**: Implement Phase 3 tests (edge cases, integration scenarios)

**Estimated Total Effort**: 7-11 days to achieve 90%+ coverage of critical paths

---

## Appendix: Test Coverage Matrix

| Source File | Current Coverage | Critical Gaps |
|-------------|-----------------|---------------|
| Team.ts | 50% | createRole(), validation edge cases |
| AgentManager.ts | 60% | getRunningRoles(), getAgentInfo(), error handling |
| MessageRouter.ts | 70% | Edge cases, malformed input |
| ConversationCoordinator.ts | 40% | buildAgentMessage(), resolveAddressees(), status mgmt |
| ConversationStarter.ts | 30% | buildEnv(), resolveInstructionFile(), normalizeMemberPaths() |
| Schema Migration | 0% | **ENTIRE MODULE UNTESTED** |

**Legend**:
- 🔴 0-40%: Critical
- 🟡 41-70%: Moderate
- 🟢 71-100%: Good
