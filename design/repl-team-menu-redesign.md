# REPL Team Menu Redesign - User Experience Improvements

**Status:** Proposal
**Date:** 2025-11-20
**Author:** Product Team
**Reviewer:** Architecture Committee

## Executive Summary

This proposal addresses three UX issues in the REPL team configuration menu:

1. **Config discovery logic:** Current filename-based filtering (`*-config.json`) is too restrictive
2. **Menu structure:** `/config` as top-level command doesn't reflect the business logic (deploying a team)
3. **Information architecture:** `/team list` and `/team show` are incorrectly positioned as peer commands
4. **Display names:** Showing JSON filenames instead of human-readable team names

---

## Problem 1: Restrictive Config File Discovery

### Current Behavior

`src/repl/ReplModeInk.tsx:176-177`:
```typescript
const files = fs.readdirSync(configDir).filter(f =>
    f.endsWith('-config.json') || f === 'agent-chatter-config.json'
);
```

**Issue:** Only finds files matching specific naming patterns:
- `*-config.json`
- `agent-chatter-config.json`

**User Impact:**
- User creates `phoenix-prd.json` → Not found ❌
- User creates `my-team.json` → Not found ❌
- Forces users to follow arbitrary naming conventions

### Proposed Solution

**Content-based validation using existing schema validator:**

```typescript
import { validateTeamConfig } from '../schemas/TeamConfigSchema.js';

// New discovery logic - reuse existing validation
const allJsonFiles = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));
const validConfigs = allJsonFiles.filter(filename => {
  try {
    const content = JSON.parse(fs.readFileSync(path.join(configDir, filename), 'utf-8'));
    const validation = validateTeamConfig(content);
    return validation.valid; // Use existing validator
  } catch {
    return false; // Invalid JSON or read error
  }
});
```

**Key Decision: Reuse Existing Validation**

Instead of implementing a new `isValidTeamConfig()`, we reuse `validateTeamConfig()` from `src/schemas/TeamConfigSchema.ts`. This:
- ✅ Avoids duplicate validation logic
- ✅ Ensures REPL and CLI use identical schema rules
- ✅ Single source of truth for schema changes
- ✅ Reduces maintenance burden

**Benefits:**
- ✅ Users can name files arbitrarily (`phoenix-prd.json`, `my-team.json`)
- ✅ Validates actual structure using production schema validator
- ✅ Gracefully ignores invalid/corrupted files

---

## Problem 2: Confusing Menu Structure

### Current Structure

```
/config <filename>          # Top-level: Load a team config
/team
  ├── create                # Create new team
  ├── list                  # List all teams
  └── show <name>           # Show team details
```

### Issues

**Issue 2.1: `/config` doesn't reflect business logic**

From a user perspective:
- Loading a config file = Deploying a team for conversation
- "config" is a technical term; users think in terms of "teams"

**Issue 2.2: `/team list` and `/team show` are poorly organized**

Problems:
- `/team list` and `/team show` are **peer commands** but should be hierarchical
- Users have to remember exact team names to use `/team show`
- No natural discovery flow from list to details

### Proposed Solution

**New Menu Structure:**

```
/team
  ├── create                # Create new team (wizard)
  ├── list                  # List all teams with details
  ├── deploy <filename>     # Deploy a team (previously /config)
  └── delete <filename>     # Delete a team config
```

**Key Changes:**

1. **Move `/config` → `/team deploy`**
   - Reflects business logic: deploying a team for conversation
   - All team operations under one namespace

2. **Enhance `/team list` display**
   - Show team display names (not filenames)
   - Show member counts and composition
   - User sees all info needed to choose which file to deploy

3. **Remove `/team show` as separate command**
   - Details merged into `/team list` output
   - Reduces command surface area

---

## Problem 3: Showing Filenames Instead of Display Names

### Current Behavior

When listing configs, shows:
```
Available configuration files:

  [1] phoenix-prd-config.json
  [2] my-team-config.json
```

**Issue:** Users created `team.displayName` for human readability, but REPL shows technical filenames.

### Proposed Solution

**Parse and show `team.displayName`:**

```
Available Teams:

  [1] Project Phoenix - PRD & Market Strategy Team
      File: phoenix-prd.json
      Members: 3 (2 AI, 1 Human)

  [2] Customer Support Team
      File: my-team.json
      Members: 5 (4 AI, 1 Human)
```

**Benefits:**
- ✅ Users see meaningful names
- ✅ Filename shown as secondary info
- ✅ Member count gives quick overview

---

## Detailed Design

### 1. Config Discovery Implementation

**File:** `src/utils/TeamConfigPaths.ts`

**Import existing validator:**
```typescript
import { validateTeamConfig } from '../schemas/TeamConfigSchema.js';
```

Add new function:
```typescript
export interface TeamConfigInfo {
  filename: string;           // e.g., "phoenix-prd.json"
  filepath: string;           // Full path
  displayName: string;        // team.displayName
  teamName: string;           // team.name
  memberCount: number;
  aiCount: number;
  humanCount: number;
  schemaVersion: string;
}

export function discoverTeamConfigs(): TeamConfigInfo[] {
  const configDir = getTeamConfigDir();

  if (!fs.existsSync(configDir)) {
    return [];
  }

  const allJsonFiles = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));

  const configs: TeamConfigInfo[] = [];

  for (const filename of allJsonFiles) {
    try {
      const filepath = path.join(configDir, filename);
      const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

      // Reuse existing schema validator
      const validation = validateTeamConfig(content);
      if (validation.valid) {
        const aiCount = content.team.members.filter((m: any) => m.type === 'ai').length;
        const humanCount = content.team.members.filter((m: any) => m.type === 'human').length;

        // Display name fallback strategy: displayName → team.name → filename
        const displayName = content.team.displayName
          || content.team.name
          || filename.replace('.json', '');

        configs.push({
          filename,
          filepath,
          displayName,
          teamName: content.team.name,
          memberCount: content.team.members.length,
          aiCount,
          humanCount,
          schemaVersion: content.schemaVersion
        });
      }
    } catch (error) {
      // Silently skip invalid files (malformed JSON or validation failure)
      continue;
    }
  }

  return configs;
}

// Note: No custom isValidTeamConfig() - we reuse validateTeamConfig() from TeamConfigSchema.ts
```

### 2. REPL Command Structure

**File:** `src/repl/ReplModeInk.tsx`

#### 2.1 Remove `/config` from top-level

**Before:**
```typescript
case '/config':
  if (args.length === 0) {
    // Show list
  } else {
    loadConfig(args[0]);
  }
```

**After:**
```typescript
// Remove /config case entirely
// Functionality moved to /team deploy
```

#### 2.2 Update `/team` submenu handler

**New structure:**
```typescript
case '/team':
  const subcommand = args[0];

  switch (subcommand) {
    case 'create':
      // Existing wizard logic
      break;

    case 'list':
      // NEW: Display team list (read-only)
      setOutput(prev => [...prev, <TeamList key={getNextKey()} />]);
      break;

    case 'deploy':
      if (args.length < 2) {
        setOutput(prev => [...prev, <Text color="yellow">Usage: /team deploy &lt;filename&gt;</Text>]);
      } else {
        loadConfig(args[1]); // args[1] is filename
      }
      break;

    case 'delete':
      if (args.length < 2) {
        setOutput(prev => [...prev, <Text color="yellow">Usage: /team delete &lt;filename&gt;</Text>]);
      } else {
        handleDeleteTeam(args[1]);
      }
      break;

    default:
      // Show /team help
      setOutput(prev => [...prev, <TeamMenuHelp key={...} />]);
  }
```

### 3. Enhanced Team List Component

**File:** `src/repl/ReplModeInk.tsx`

**New Component (Display-Only):**
```typescript
function TeamList() {
  const configs = discoverTeamConfigs();

  if (configs.length === 0) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="yellow">No team configurations found</Text>
        <Text dimColor>Use /team create to create a team configuration</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="cyan">Available Teams:</Text>
      <Text dimColor>─────────────────────────────────────────────────</Text>

      {configs.map((config, index) => (
        <Box key={config.filename} flexDirection="column" marginTop={1}>
          <Text bold>{config.displayName}</Text>
          <Text dimColor>    File: {config.filename}</Text>
          <Text dimColor>    Members: {config.memberCount} ({config.aiCount} AI, {config.humanCount} Human)</Text>
        </Box>
      ))}

      <Text dimColor marginTop={1}>─────────────────────────────────────────────────</Text>
      <Text color="yellow">Use /team deploy &lt;filename&gt; to deploy a team</Text>
    </Box>
  );
}
```

**Note:** Interactive number selection removed due to implementation complexity with existing input model.

### 4. Global `/config` Reference Replacement

**All locations that reference `/config` must be updated:**

| File | Lines | Current Reference | New Reference |
|------|-------|-------------------|---------------|
| `src/repl/ReplModeInk.tsx` | 34-52 | Help text shows `/config` | Change to `/team deploy` |
| `src/repl/ReplModeInk.tsx` | 64-120 | `/list` command shows config files | Change to show team display names |
| `src/repl/ReplModeInk.tsx` | 877-910 | `case '/config':` handler | Remove, merge into `/team deploy` |
| `src/repl/ReplModeInk.tsx` | 913-940 | `/start` error message mentions `/config` | Change to `/team deploy` |
| `src/repl/ReplModeInk.tsx` | 100-150 | `ConfigList` component references | Update to use `TeamList` |
| `src/repl/ReplModeInk.tsx` | 1185-1245 | `listTeamConfigurations()` mentions `/config` | Update to `/team deploy` |

**Updated Help Text:**

```typescript
function TeamMenuHelp() {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="cyan">/team Commands:</Text>
      <Text dimColor>───────────────────────────────────────────────</Text>
      <Text>  /team create              Create a new team (wizard)</Text>
      <Text>  /team list                List all team configurations</Text>
      <Text>  /team deploy &lt;filename&gt;   Deploy a team for conversation</Text>
      <Text>  /team delete &lt;filename&gt;   Delete a team configuration</Text>
      <Text dimColor>───────────────────────────────────────────────</Text>
      <Text dimColor>Examples:</Text>
      <Text dimColor>  /team list</Text>
      <Text dimColor>  /team deploy phoenix-prd.json</Text>
    </Box>
  );
}
```

**Updated `/start` Error Message:**
```typescript
if (!currentConfigPath) {
  setOutput(prev => [...prev, <Text color="red">No team deployed. Use /team deploy &lt;filename&gt; first.</Text>]);
  return;
}
```

---

## Migration Path

### Breaking Changes

1. **`/config` command removed** (No backward compatibility)
   - Old: `/config phoenix-prd-config.json`
   - New: `/team deploy phoenix-prd.json`
   - **Decision:** Clean break, no alias support

2. **`/team show` command removed**
   - Old: `/team show my-team`
   - New: `/team list` (interactive)

### User Communication

Add breaking changes notice in v0.0.13 changelog:

```markdown
## Breaking Changes

⚠️ **IMPORTANT:** This release contains breaking changes to REPL commands.

- `/config` command **removed** → Use `/team deploy <filename>` instead
- `/team show` command **removed** → Use `/team list` for interactive team selection

## New Features

- **Flexible filenames:** Team configs can now have any filename (e.g., `my-team.json`)
- **Smart config discovery:** Validates file structure, not filename patterns
- **Display names:** Shows `team.displayName` instead of filenames
- **Member counts:** Quick overview of AI/Human team composition
- **File watching:** Team list auto-refreshes when configs change

## Migration Guide

If you have scripts using old commands:
- Replace `/config <file>` with `/team deploy <file>`
- Replace `/team show <name>` with `/team list` (view details) + `/team deploy <file>` (deploy)
```

---

## User Scenarios

### Scenario 1: List and Deploy a Team

**Before:**
```
agent-chatter> /config
Available configuration files:
  [1] phoenix-prd-config.json

Usage: /config <filename>

agent-chatter> /config phoenix-prd-config.json
✓ Team deployed: phoenix-prd-team
```

**After:**
```
agent-chatter> /team list
Available Teams:

  [1] Project Phoenix - PRD & Market Strategy Team
      File: phoenix-prd.json
      Members: 3 (2 AI, 1 Human)

Type /team deploy <filename> to deploy a team

agent-chatter> /team deploy phoenix-prd.json
✓ Team deployed: Project Phoenix - PRD & Market Strategy Team
```

### Scenario 2: Create and Deploy

**Before:**
```
agent-chatter> /team create
[Wizard creates: my-new-team-config.json]

agent-chatter> /config my-new-team-config.json
✓ Team deployed
```

**After:**
```
agent-chatter> /team create
[Wizard creates: my-new-team.json]

agent-chatter> /team deploy my-new-team.json
✓ Team deployed: My New Team
```

### Scenario 3: View Team Details

**Before:**
```
agent-chatter> /team list
Available teams:
  - my-team-1
  - my-team-2

agent-chatter> /team show my-team-1
[Shows details...]
```

**After:**
```
agent-chatter> /team list
Available Teams:

  [1] Customer Support Team
      File: customer-support.json
      Members: 5 (4 AI, 1 Human)

  [2] Product Development Team
      File: product-dev.json
      Members: 4 (3 AI, 1 Human)

Type /team deploy <filename> to deploy a team
```

---

## Implementation Checklist

### Phase 1: Config Discovery (Backend)
- [ ] Import `validateTeamConfig()` from `TeamConfigSchema.ts`
- [ ] Add `discoverTeamConfigs()` to `TeamConfigPaths.ts` using existing validator
- [ ] Implement display name fallback: `displayName → team.name → filename`
- [ ] Implement error handling in `discoverTeamConfigs()`:
  - Silently skip malformed JSON files (try-catch)
  - Silently skip files failing `validateTeamConfig()` check
  - Add debug logging for skipped files (optional enhancement)
- [ ] Write unit tests for config discovery with edge cases (reuse existing validation tests)

### Phase 2: File Watching
- [ ] Add file system watcher for `.agent-chatter/team-config/` directory
- [ ] Implement auto-refresh logic when JSON files change
- [ ] Debounce rapid file changes (avoid flickering)
- [ ] Handle watcher cleanup on REPL exit

### Phase 3: REPL Commands (Frontend)
- [ ] Remove `/config` command handler completely (line 877-910)
- [ ] Add `/team deploy` subcommand
- [ ] Add `/team delete` subcommand
- [ ] Update `/team list` to use `discoverTeamConfigs()`
- [ ] Remove `/team show` command
- [ ] Update all help text references to `/config` (see table in section 4)
- [ ] Update `/start` error messages (line 913-940)
- [ ] Replace `ConfigList` with new `TeamList` component (line 100-150, 1185-1245)

### Phase 4: Remove Legacy Path Support (Global Change)

**Product Manager Decision:** Remove root directory config support entirely across the entire project. No migration tools, no special error messages.

**Affected Function:** `src/utils/TeamConfigPaths.ts:52` - `resolveTeamConfigPath()`

**Current behavior:**
1. If absolute path → return as-is
2. Try `.agent-chatter/team-config/<filename>`
3. **Fallback to `process.cwd()/<filename>` ← REMOVE THIS**

**New behavior:**
1. If absolute path → return as-is
2. Try `.agent-chatter/team-config/<filename>`
3. **If not found → return error (no fallback)**

**All callers affected:**

| Caller | File | Line | Purpose | Impact |
|--------|------|------|---------|--------|
| `loadConfig()` | `src/cli.ts` | 114 | CLI `start` command loads config | ❌ Root directory configs will fail |
| `loadConfig()` | `src/repl/ReplModeInk.tsx` | 1382 | `/config` command (future `/team deploy`) | ❌ Root directory configs will fail |
| `startTeamEditMenu()` | `src/repl/ReplModeInk.tsx` | 1166 | `/team edit` command | ❌ Root directory configs will fail |
| `showTeamConfiguration()` | `src/repl/ReplModeInk.tsx` | 1266 | `/team show` command | ❌ Root directory configs will fail |
| `deleteTeam()` | `src/repl/ReplModeInk.tsx` | 1342 | `/team delete` command | ❌ Root directory configs will fail |

**Implementation checklist:**
- [ ] Update `resolveTeamConfigPath()` in `TeamConfigPaths.ts`
  - Remove `legacyPath` variable and fallback logic (lines 62-78)
  - Only check: absolute path OR `.agent-chatter/team-config/`
  - Update `searchedPaths` to not include root directory
- [ ] Update `formatMissingConfigError()` message
  - Change from "Searched paths: [list]" to "Expected location: .agent-chatter/team-config/"
  - Remove any mention of root directory fallback
- [ ] Update tests: `tests/unit/teamConfigDirectory.test.ts`
  - Remove test cases for root directory fallback
  - Add test case: root directory file should NOT be found
- [ ] Update error messages (no changes needed - generic "file not found" is sufficient)
- [ ] **No migration code needed** - files in root directory simply won't work

### Phase 5: UI Components and Data Flow
- [ ] Create new `TeamList` component (stateless functional component)
- [ ] Component implementation:
  - Calls `discoverTeamConfigs()` directly on render (no caching needed)
  - Returns JSX with team display names
  - Shows member count (AI/Human breakdown)
- [ ] Create `TeamMenuHelp` component
- [ ] **Data Flow:**
  - `/team list` command appends `<TeamList />` to `output` array via `setOutput()`
  - Each `TeamList` is immutable once rendered
  - File watcher appends notification message (separate component)
  - User re-runs `/team list` to see fresh data
  - No state invalidation or re-rendering of old components needed

### Phase 6: Testing & Documentation
- [ ] Unit tests: `discoverTeamConfigs()` with mixed valid/invalid files
- [ ] Unit tests: Display name fallback chain
- [ ] Unit tests: `resolveTeamConfigPath()` ONLY checks `.agent-chatter/team-config/`
- [ ] Integration tests: `/team list` → `/team deploy` workflow
- [ ] Integration tests: File watcher shows "refresh" hint
- [ ] Update user documentation
- [ ] Add migration guide to CHANGELOG
- [ ] Test with various filename patterns
- [ ] Verify all `/config` references replaced
- [ ] Test error message when file not in team-config directory

### 4. File Watching Implementation

**File:** `src/repl/ReplModeInk.tsx`

**Add file system watcher:**
```typescript
import { watch } from 'fs';

// In main component
useEffect(() => {
  const configDir = getTeamConfigDir();

  if (!fs.existsSync(configDir)) {
    return;
  }

  // Watch for file changes in team-config directory
  const watcher = watch(configDir, { recursive: false }, (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
      // Show notification instead of auto-refreshing
      setOutput(prev => [...prev,
        <Text key={`file-change-${Date.now()}`} color="cyan" dimColor>
          Team config changed. Type /team list to refresh.
        </Text>
      ]);
    }
  });

  return () => {
    watcher.close();
  };
}, []);
```

**Data Flow Decision:**

Instead of trying to re-render existing `TeamList` components in the output history, we:
1. Detect file changes via `fs.watch()`
2. Append a notification message to `output` array
3. User manually runs `/team list` to see updated list
4. Simpler state management, no need to track "which TeamList to update"

**Benefits:**
- ✅ Simple implementation (no complex state invalidation)
- ✅ Users explicitly refresh when ready
- ✅ Multi-window workflow supported (edit in IDE, notification in REPL)

---

## Product Manager Decisions

The following decisions have been made and incorporated into this design:

### Decision 1: No Backward Compatibility
**Question:** Support `/config` alias for transition period?
**Decision:** ❌ No. Clean break in v0.0.13. Remove `/config` entirely.
**Rationale:** Simplifies codebase, clear migration path.

### Decision 2: Interactive Team Selection
**Question:** Allow number selection after `/team list`?
**Decision:** ❌ No. User must use `/team deploy <filename>` explicitly.
**Rationale:** Interactive selection conflicts with existing input model. Introduces unnecessary complexity (state machine for "awaiting selection" mode, handling non-command input). Explicit `/team deploy` is clearer and more consistent with REPL command pattern.

### Decision 3: Error Handling
**Question:** How to handle invalid JSON files?
**Decision:** ✅ Silently skip invalid files.
**Rationale:** Don't clutter UI with errors. Log to debug console only.

### Decision 4: Display Name Fallback
**Question:** Fallback strategy if `displayName` missing?
**Decision:** ✅ `displayName → team.name → filename (without .json)`
**Rationale:** Progressive degradation ensures something always displays.

### Decision 5: File Watching
**Question:** Auto-refresh when configs change?
**Decision:** ✅ Yes. Watch `.agent-chatter/team-config/` directory.
**Rationale:** Supports multi-window workflows, better UX.

---

## Architecture Committee Feedback

### Round 1

#### Issue 1: Duplicate Validation Logic
**Finding:** Design proposed new `isValidTeamConfig()`, but `validateTeamConfig()` already exists in `TeamConfigSchema.ts`.
**Resolution:** ✅ Updated design to reuse existing validator. No new validation logic.

#### Issue 2: Incomplete `/config` Replacement Plan
**Finding:** Design didn't cover all `/config` references (help text, error messages, `ConfigList`, etc.).
**Resolution:** ✅ Added comprehensive table of all replacement locations (Section 4).

#### Issue 3: Interactive Selection Complexity
**Finding:** Number-based selection conflicts with existing input model (requires state machine, special handling for non-command input).
**Resolution:** ✅ Feature removed per Product Manager decision. Users must use explicit `/team deploy` command.

#### Open Question: Legacy Config Files
**Question:** Root directory config files won't appear in `/team list` but still work with `/team deploy`. Document this behavior?
**Product Manager Decision:** ❌ Remove legacy path support entirely. No users have ever used root directory configs.
**Resolution:** Updated Phase 4 to remove `resolveTeamConfigPath()` fallback to root directory. Only `.agent-chatter/team-config/` is supported.

---

### Round 2

#### Finding 1: Residual onSelect References (line 277)
**Finding:** Section 2.2 still shows `<TeamList onSelect={handleTeamSelect} />` and selection flow, contradicting Decision 2.
**Resolution:** ✅ Removed all `onSelect` references. `TeamList` is display-only component.

#### Finding 2: Missing Data Flow Details (line 358)
**Finding:** Phase 5 mentions UI components but doesn't explain React state management, data flow, or how file watcher triggers refresh.
**Resolution:** ✅ Added detailed data flow documentation in Phase 5:
- `TeamList` is stateless functional component
- Calls `discoverTeamConfigs()` on render
- Returns static JSX, appended to `output` array
- File watcher shows notification, user manually re-runs `/team list`
- Avoids complex state invalidation

#### Finding 3: Legacy Path UX Unclear (line 520)
**Finding:** Phase 4 mentioned legacy file support but didn't specify UX for migration warnings. Also, `resolveTeamConfigPath()` is used by CLI, REPL, wizard, and tests - not just REPL `/config`.
**Product Manager Decision:** ❌ Remove legacy path support entirely everywhere. No migration tools, no special error messages. Root directory configs will simply fail with "file not found."
**Resolution:** ✅ Phase 4 expanded to comprehensive global change. Documented all 5 affected call sites (CLI + 4 REPL commands). Updated `resolveTeamConfigPath()` implementation plan and test updates.

---

### Round 3

#### Finding 1: Residual isValidTeamConfig Reference (line 554)
**Finding:** Phase 6 (now merged into Phase 1) mentioned "Silently skip files failing `isValidTeamConfig()`" but we decided to completely remove this function and use `validateTeamConfig()` instead.
**Resolution:** ✅ Fixed. Changed to use `validateTeamConfig()` and merged error handling into Phase 1 (config discovery implementation).

#### Finding 2: Incomplete Legacy Path Removal Plan (line 520)
**Finding:** Phase 4 planned to update `resolveTeamConfigPath()` but didn't document all affected callers. Function is used by:
- CLI `start` command
- REPL `/config` (future `/team deploy`)
- REPL `/team edit`
- REPL `/team show`
- REPL `/team delete`

Removing root directory fallback affects all these callers. Need comprehensive plan for all affected areas.

**Product Manager Decision:** Remove legacy path support everywhere in the project. No migration strategy, no migration tools, no special error messages for legacy paths.

**Resolution:** ✅ Phase 4 completely rewritten with comprehensive change plan:
- Detailed implementation steps for `resolveTeamConfigPath()`
- Table of all 5 affected call sites with impact assessment
- Test update plan
- Error message update plan
- Clear statement: root directory configs will simply fail with generic "file not found"

---

### Round 4

#### Finding: Duplicate Error Handling Logic (Phase 6)
**Finding:** Phase 6 "Error Handling" checklist included items already implemented in `discoverTeamConfigs()` function:
- "Silently skip malformed JSON files" - already in try-catch
- "Silently skip files failing `validateTeamConfig()`" - already in `if (validation.valid)` check
- "Log skipped files to debug console" - should be part of discovery implementation

Keeping Phase 6 separate would mislead implementers into thinking they need to add error handling logic twice.

**Resolution:** ✅ Merged Phase 6 into Phase 1:
- Error handling checklist items moved to Phase 1 where `discoverTeamConfigs()` is implemented
- Clarified that error handling is part of discovery implementation, not a separate phase
- Deleted standalone Phase 6
- Renumbered Phase 7 → Phase 6

---

## Success Metrics

- ✅ Users can create team configs with arbitrary filenames
- ✅ `/team list` shows human-readable team names
- ✅ All team operations unified under `/team` namespace
- ✅ Zero false positives in config discovery (no invalid files shown)
- ✅ Zero false negatives in config discovery (all valid files found)
