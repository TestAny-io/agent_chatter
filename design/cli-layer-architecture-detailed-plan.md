# CLI Layer Architecture - Detailed Implementation Plan

**Status**: Enhanced Proposal (Post-Review)
**Author**: Claude Code (Reviewer)
**Date**: 2025-11-24
**Parent Doc**: `cli-layer-architecture-gap-analysis.md`

---

## Overview

本文档基于架构委员会评审意见，**补充技术细节和风险缓解措施**，加强原方案的可执行性。

**评审核心反馈**：
- ✅ 方向正确，Gap识别到位
- ⚠️ 需补充：IOutput落地路径、调用方影响、process.exit策略、测试兼容性

---

## Phase 1: Create Abstraction Layer - Enhanced Design

### 1.1 IOutput Interface Design

#### Complete Interface Definition

```typescript
// src/cli/interfaces/IOutput.ts

/**
 * Output abstraction for presentation layer
 * Allows business logic to be presentation-agnostic
 */
export interface IOutput {
  /** Informational message (neutral) */
  info(message: string): void;

  /** Success message (positive feedback) */
  success(message: string): void;

  /** Warning message (caution, non-fatal) */
  warn(message: string): void;

  /** Error message (fatal or severe) */
  error(message: string): void;

  /** Progress indicator (e.g., "Verifying agent...") */
  progress(message: string, options?: { current?: number; total?: number }): void;

  /** Separator line (visual break) */
  separator(char?: string, length?: number): void;

  /** Key-value pair display (e.g., "Team: my-team") */
  keyValue(key: string, value: string, options?: { indent?: number }): void;
}

/**
 * Silent implementation - no output
 * Default for business logic when no output is provided
 */
export class SilentOutput implements IOutput {
  info(_message: string): void {}
  success(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
  progress(_message: string, _options?: { current?: number; total?: number }): void {}
  separator(_char?: string, _length?: number): void {}
  keyValue(_key: string, _value: string, _options?: { indent?: number }): void {}
}
```

#### ConsoleOutput Implementation

```typescript
// src/cli/implementations/ConsoleOutput.ts

import { colorize } from '../utils/colors.js';
import type { IOutput } from '../interfaces/IOutput.js';

export interface ConsoleOutputOptions {
  colors?: boolean; // Enable color output (default: true)
  verbose?: boolean; // Show progress messages (default: true)
}

export class ConsoleOutput implements IOutput {
  constructor(private options: ConsoleOutputOptions = {}) {
    this.options.colors = options.colors ?? true;
    this.options.verbose = options.verbose ?? true;
  }

  info(message: string): void {
    const text = this.options.colors ? colorize(message, 'cyan') : message;
    console.log(text);
  }

  success(message: string): void {
    const text = this.options.colors ? colorize(message, 'green') : message;
    console.log(text);
  }

  warn(message: string): void {
    const text = this.options.colors ? colorize(message, 'yellow') : message;
    console.warn(text);
  }

  error(message: string): void {
    const text = this.options.colors ? colorize(message, 'red') : message;
    console.error(text);
  }

  progress(message: string, options?: { current?: number; total?: number }): void {
    if (!this.options.verbose) return;

    let text = message;
    if (options?.current !== undefined && options?.total !== undefined) {
      text += ` (${options.current}/${options.total})`;
    }

    const colored = this.options.colors ? colorize(text, 'dim') : text;
    console.log(colored);
  }

  separator(char: string = '─', length: number = 60): void {
    const line = char.repeat(length);
    const text = this.options.colors ? colorize(line, 'dim') : line;
    console.log(text);
  }

  keyValue(key: string, value: string, options?: { indent?: number }): void {
    const indent = ' '.repeat(options?.indent ?? 2);
    const text = `${indent}${key}: ${value}`;
    const colored = this.options.colors ? colorize(text, 'dim') : text;
    console.log(colored);
  }
}
```

#### InkOutput Implementation - **Key Addition**

```typescript
// src/cli/implementations/InkOutput.tsx

import React from 'react';
import { Text, Box } from 'ink';
import type { IOutput } from '../interfaces/IOutput.js';

export interface InkOutputOptions {
  /** React setState function to add output */
  setOutput: React.Dispatch<React.SetStateAction<React.ReactNode[]>>;

  /** Key generator for React keys */
  getNextKey: () => string;
}

/**
 * InkOutput - Implements IOutput for Ink/React REPL
 *
 * Maps output methods to React state updates instead of console.*
 * This allows business logic (ConversationStarter) to work in both CLI and REPL
 */
export class InkOutput implements IOutput {
  constructor(private options: InkOutputOptions) {}

  info(message: string): void {
    const { setOutput, getNextKey } = this.options;
    setOutput(prev => [
      ...prev,
      <Text key={`info-${getNextKey()}`} color="cyan">{message}</Text>
    ]);
  }

  success(message: string): void {
    const { setOutput, getNextKey } = this.options;
    setOutput(prev => [
      ...prev,
      <Text key={`success-${getNextKey()}`} color="green">{message}</Text>
    ]);
  }

  warn(message: string): void {
    const { setOutput, getNextKey } = this.options;
    setOutput(prev => [
      ...prev,
      <Text key={`warn-${getNextKey()}`} color="yellow">{message}</Text>
    ]);
  }

  error(message: string): void {
    const { setOutput, getNextKey } = this.options;
    setOutput(prev => [
      ...prev,
      <Text key={`error-${getNextKey()}`} color="red">{message}</Text>
    ]);
  }

  progress(message: string, options?: { current?: number; total?: number }): void {
    const { setOutput, getNextKey } = this.options;
    let text = message;
    if (options?.current !== undefined && options?.total !== undefined) {
      text += ` (${options.current}/${options.total})`;
    }
    setOutput(prev => [
      ...prev,
      <Text key={`progress-${getNextKey()}`} dimColor>{text}</Text>
    ]);
  }

  separator(char: string = '─', length: number = 60): void {
    const { setOutput, getNextKey } = this.options;
    setOutput(prev => [
      ...prev,
      <Text key={`sep-${getNextKey()}`} dimColor>{char.repeat(length)}</Text>
    ]);
  }

  keyValue(key: string, value: string, options?: { indent?: number }): void {
    const { setOutput, getNextKey } = this.options;
    const indent = ' '.repeat(options?.indent ?? 2);
    setOutput(prev => [
      ...prev,
      <Text key={`kv-${getNextKey()}`} dimColor>{indent}{key}: {value}</Text>
    ]);
  }
}
```

---

### 1.2 Unified Color Utilities - **Architecture Fix**

#### Problem: Layering Violation

**Original Plan**: Put `colors.ts` in `src/cli/utils/`
**Issue**: ConversationStarter.ts (business layer) would depend on CLI layer → **Violates layering**

**Solution**: Move to shared utilities layer

#### Create Single Source of Truth in Shared Layer

```typescript
// src/shared/utils/colors.ts  ← NEW LOCATION (not src/cli/utils)

/**
 * ANSI color codes for terminal output
 * Shared utility - used by both CLI layer and business layer (for now)
 *
 * NOTE: Business layer usage is temporary during Phase 1.
 * In Phase 2, business layer will use IOutput interface instead.
 * This module will then only be used by CLI/REPL presentation layers.
 */
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
} as const;

export type ColorName = keyof typeof colors;

/**
 * Apply color to text using ANSI codes
 * @param text - Text to colorize
 * @param color - Color name
 * @returns Colorized text with reset code
 */
export function colorize(text: string, color: ColorName): string {
  return `${colors[color]}${text}${colors.reset}`;
}
```

#### Update File References - Checklist

| File | Current | After | Action |
|------|---------|-------|--------|
| `src/cli.ts` | Lines 39-53: Local `colors` + `colorize` | Import from `shared/utils/colors.ts` | Delete local, add import |
| `src/commands/AgentsCommand.ts` | Lines 13-27: Duplicate | Import from `shared/utils/colors.ts` | Delete duplicate, add import |
| `src/repl/ReplMode.ts` | Lines 15-29: Duplicate | Import from `shared/utils/colors.ts` | Delete duplicate, add import |
| `src/utils/ConversationStarter.ts` | Lines 21-34: Local definition | Import from `shared/utils/colors.ts` | Delete local, add import |

**Example Migration**:
```typescript
// Before (in cli.ts)
const colors = {
  reset: '\x1b[0m',
  // ...
};
function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

// After (in cli.ts)
import { colorize } from '../shared/utils/colors.js';

// Before (in ConversationStarter.ts)
const colors = {
  reset: '\x1b[0m',
  // ...
};
function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

// After (in ConversationStarter.ts)
import { colorize } from '../shared/utils/colors.js';
// NOTE: This import is temporary. In Phase 2, ConversationStarter will use
// IOutput interface instead of direct colorize calls.
```

#### Architecture Rationale

**Why `src/shared/utils/` instead of `src/cli/utils/`?**

1. **Avoid Layering Violation**:
   - Business layer (`ConversationStarter.ts`) should NOT depend on CLI layer
   - `shared/` is accessible to both layers without violating architecture

2. **Temporary Nature**:
   - Phase 1: Business layer uses `colorize()` directly (for now)
   - Phase 2: Business layer uses `IOutput` interface
   - Phase 2+: `colors.ts` is only used by CLI/REPL presentation layers

3. **Clear Dependency Flow**:
   ```
   src/cli/           → src/shared/utils/colors.ts  ✅ OK (presentation → shared)
   src/utils/         → src/shared/utils/colors.ts  ✅ OK (business → shared)
   src/utils/         → src/cli/utils/colors.ts     ❌ BAD (business → CLI)
   ```

#### Alternative Considered: Keep in CLI Layer

**Option**: Put `colors.ts` in `src/cli/utils/` and accept the import
**Rejected Because**:
- Creates tight coupling between layers
- Makes future refactoring harder
- Violates Clean Architecture principles
- Business logic would be CLI-aware (bad for testing, reusability)

---

### 1.3 ConversationStarter Refactoring

#### Signature Change

```typescript
// src/utils/ConversationStarter.ts

export interface InitializeServicesOptions {
  contextMessageCount?: number;
  onMessage?: (message: ConversationMessage) => void;
  onStatusChange?: (status: ConversationStatus) => void;
  onUnresolvedAddressees?: (addressees: string[], message: ConversationMessage) => void;
  registryPath?: string;
  onAgentStarted?: (member: Member) => void;
  onAgentCompleted?: (member: Member) => void;

  // NEW: Output interface for presentation
  output?: IOutput;  // ← Added in Phase 1
}

export async function initializeServices(
  config: CLIConfig,
  options?: InitializeServicesOptions
): Promise<{
  coordinator: ConversationCoordinator;
  team: Team;
  processManager: ProcessManager;
  messageRouter: MessageRouter;
  agentManager: AgentManager;
  eventEmitter: EventEmitter;
  contextCollector: import('../services/ContextEventCollector.js').ContextEventCollector;
}> {
  // Default to silent output (backward compatible)
  const output = options?.output ?? new SilentOutput();

  // Replace console.log with output.* calls
  output.progress('正在验证 agent...');
  // ...
  output.success('✓ Agent 验证成功');
}
```

#### Affected Callers - Complete List

| Caller | File | Line | Required Change |
|--------|------|------|-----------------|
| **CLI start command** | `src/cli.ts` | 178 | Add `output: new ConsoleOutput()` |
| **REPL (Ink)** | `src/repl/ReplModeInk.tsx` | 1615 | Add `output: new InkOutput({ setOutput, getNextKey })` |
| **REPL (Legacy)** | `src/repl/ReplMode.ts` | 368 | Add `output: new ConsoleOutput()` (or delete file) |
| **Integration Test 1** | `tests/integration/conversationStarter.integration.test.ts` | ~50+ | Use `output: new SilentOutput()` (or omit - default) |
| **Integration Test 2** | `tests/integration/verificationCache.integration.test.ts` | ~30+ | Use `output: new SilentOutput()` (or omit - default) |

**CLI Example**:
```typescript
// src/cli.ts:178
const { coordinator, team } = await initializeServices(config, {
  registryPath,
  output: new ConsoleOutput({ colors: true, verbose: true })
});
```

**REPL Example**:
```typescript
// src/repl/ReplModeInk.tsx:1615
const { coordinator, team, messageRouter, eventEmitter } = await initializeServices(currentConfig, {
  onMessage: (message) => { /* ... */ },
  onStatusChange: (status) => { /* ... */ },
  onAgentStarted: (member) => { /* ... */ },
  onAgentCompleted: (member) => { /* ... */ },

  // NEW: Provide InkOutput implementation
  output: new InkOutput({
    setOutput,
    getNextKey
  })
});
```

**Test Example**:
```typescript
// tests/integration/conversationStarter.integration.test.ts
it('should initialize services with valid config', async () => {
  const { coordinator, team } = await initializeServices(config, {
    registryPath: tempRegistryPath,
    output: new SilentOutput() // Or omit - SilentOutput is default
  });

  expect(coordinator).toBeDefined();
  expect(team).toBeDefined();
});
```

#### Console.* Call Migration - Specific Changes

| Location | Current Code | After Phase 1 | After Phase 2 |
|----------|--------------|---------------|---------------|
| `ConversationStarter.ts:412` | `console.log(colorize('正在验证...', 'dim'))` | `output.progress('正在验证...')` | Same |
| `ConversationStarter.ts:427` | `console.log(colorize('✓ Agent 验证成功', 'green'))` | `output.success('✓ Agent 验证成功')` | Same |
| `ConversationStarter.ts:429` | `console.log(colorize('✓ Agent (缓存)', 'dim'))` | `output.progress('✓ Agent (缓存)')` | Same |
| `ConversationStarter.ts:179` | `console.warn(colorize('⚠ 无法创建...', 'yellow'))` | `output.warn('⚠ 无法创建...')` | Same |
| `ConversationStarter.ts:256` | `console.warn(colorize('⚠ 无法读取...', 'yellow'))` | `output.warn('⚠ 无法读取...')` | Same |
| `ConversationStarter.ts:116-119` | `displayMessage()` function | **Phase 2**: Remove or make callback-based | `onMessage` callback already exists |

**Note**: `displayMessage()` (lines 111-119) is used as default `onMessage` callback. In Phase 1, keep it for backward compatibility. In Phase 2, remove it completely.

---

### 1.4 process.exit() Strategy - Detailed Plan

#### Current Exit Points Inventory

| File | Line | Context | Strategy |
|------|------|---------|----------|
| `src/cli.ts` | 126 | Config parsing error | **Phase 1**: Keep, centralize later |
| `src/cli.ts` | 134 | Config file not found | **Phase 1**: Keep, centralize later |
| `src/cli.ts` | 185 | Start command error | **Phase 1**: Keep, centralize later |
| `src/cli.ts` | 275 | Status command error | **Phase 1**: Keep, centralize later |
| `src/repl/ReplMode.ts` | 81 | Ctrl+C handler | **Phase 1**: Delete entire file |
| `src/repl/ReplMode.ts` | 392 | /exit command | **Phase 1**: Delete entire file |
| `src/repl/ReplMode.ts` | 404 | Readline close | **Phase 1**: Delete entire file |

#### Phase 1: No Changes (Defer to Phase 3)

**Rationale**: process.exit() refactoring is high-risk and not critical for Phase 1 goals.

**Phase 1 Action**: Document current behavior, mark as technical debt.

```typescript
// src/cli.ts
// TODO [Phase 3]: Replace process.exit() with throw + centralized error handler
// Current behavior: Exit immediately on error (not testable)
```

#### Phase 3: Centralized Error Handler (Future)

```typescript
// src/cli.ts - Future design

/**
 * Centralized CLI error handler
 * Maps error types to exit codes and user-friendly messages
 */
function handleCLIError(error: unknown, output: IOutput): number {
  if (error instanceof ConfigValidationError) {
    output.error(`Configuration validation failed:`);
    error.errors.forEach(err => output.error(`  - ${err}`));
    return 1;
  }

  if (error instanceof AgentVerificationError) {
    output.error(`Agent verification failed: ${error.message}`);
    return 2;
  }

  // Generic error
  output.error(`Unexpected error: ${String(error)}`);
  return 1;
}

// Main entry point
async function main() {
  const output = new ConsoleOutput();

  try {
    await program.parseAsync();
    process.exit(0);
  } catch (error) {
    const exitCode = handleCLIError(error, output);
    process.exit(exitCode);
  }
}

main();
```

---

### 1.5 Legacy ReplMode.ts Handling

#### Current Status

**File**: `src/repl/ReplMode.ts` (410 lines)
**Status**: Deprecated, superseded by `ReplModeInk.tsx`
**References**: Possibly in design docs or old code comments

#### Phase 1 Action: Soft Deprecation

**Do NOT delete** in Phase 1 (too risky without full audit).

**Actions**:
1. Add deprecation marker:
   ```typescript
   // src/repl/ReplMode.ts (Line 1)
   /**
    * @deprecated This file is deprecated. Use ReplModeInk.tsx instead.
    * Will be removed in v0.3.0.
    *
    * Reason: ReplModeInk.tsx provides superior Ink-based UI
    * Migration: No action needed - not used in production
    */
   ```

2. Check references:
   ```bash
   grep -r "ReplMode\.ts" src/ tests/ design/
   ```

3. Remove imports if any found

4. Schedule for deletion in Phase 2 or v0.3.0

#### Phase 2 Action: Remove File

After confirming no references, delete:
- `src/repl/ReplMode.ts`
- Update design docs that reference it

---

### 1.6 Test Compatibility Strategy

#### Test Files Analysis

| Test File | Purpose | CLI Dependency | Action |
|-----------|---------|----------------|--------|
| `conversationStarter.integration.test.ts` | Tests `initializeServices()` | Uses business logic, not CLI-specific | **KEEP** - Add `output: new SilentOutput()` |
| `startCommandNextDirective.integration.test.ts` | Tests [NEXT:xxx] parsing | Tests MessageRouter, not CLI command | **KEEP** - Rename to clarify scope |
| `conversationFlow.integration.test.ts` | Tests conversation logic | Pure business logic | **KEEP** - No changes needed |

#### Correcting Original Assessment

**Original Plan**: Delete `startCommandNextDirective.integration.test.ts`
**Review Feedback**: ❌ Incorrect - This test is for NEXT parsing, not CLI

**Corrected Action**:
```typescript
// tests/integration/startCommandNextDirective.integration.test.ts
// RENAME to: tests/integration/messageRouting.integration.test.ts

describe('Message Routing with [NEXT:xxx] Directive', () => {
  // Keep all tests - they test MessageRouter.parseMessage(), not CLI

  it('extracts [NEXT:xxx] from initial message', () => {
    // ...
  });

  it('resolves member by name, displayName, or ID', () => {
    // ...
  });
});
```

#### Test Updates for Phase 1

**File**: `tests/integration/conversationStarter.integration.test.ts`

```typescript
// Before
const { coordinator, team } = await initializeServices(config, {
  registryPath: tempRegistryPath
});

// After (Phase 1)
const { coordinator, team } = await initializeServices(config, {
  registryPath: tempRegistryPath,
  output: new SilentOutput() // Explicit (though default)
});
```

**Benefit**: Tests remain green, no breaking changes.

---

## Phase 1 Implementation Checklist - Enhanced

### Step 1: Create Abstraction Layer (2 days)

- [ ] Create `src/cli/interfaces/IOutput.ts`
  - [ ] Define IOutput interface (8 methods)
  - [ ] Implement SilentOutput class

- [ ] Create `src/cli/implementations/ConsoleOutput.ts`
  - [ ] Implement all IOutput methods
  - [ ] Support color/verbose options
  - [ ] Add unit tests

- [ ] Create `src/cli/implementations/InkOutput.tsx`
  - [ ] Implement all IOutput methods
  - [ ] Map to React state updates
  - [ ] Add unit tests (use ink-testing-library)

- [ ] Create `src/cli/utils/colors.ts`
  - [ ] Define colors object
  - [ ] Export colorize function
  - [ ] Add type safety

### Step 2: Consolidate Color Utilities (0.5 days)

- [ ] Update `src/cli.ts`
  - [ ] Remove local colors (lines 39-53)
  - [ ] Import from colors.ts
  - [ ] Verify no regressions

- [ ] Update `src/commands/AgentsCommand.ts`
  - [ ] Remove duplicate colors (lines 13-27)
  - [ ] Import from colors.ts

- [ ] Update `src/repl/ReplMode.ts`
  - [ ] Add deprecation warning
  - [ ] Remove duplicate colors (lines 15-29)
  - [ ] Import from colors.ts

- [ ] Update `src/utils/ConversationStarter.ts`
  - [ ] Check current import
  - [ ] Update to use colors.ts

- [ ] Run tests: `npm test`

### Step 3: Refactor ConversationStarter (1 day)

- [ ] Update signature
  - [ ] Add `output?: IOutput` to InitializeServicesOptions
  - [ ] Default to SilentOutput

- [ ] Replace console.* calls
  - [ ] Line 412: `console.log` → `output.progress`
  - [ ] Line 427: `console.log` → `output.success`
  - [ ] Line 429: `console.log` → `output.progress`
  - [ ] Line 179: `console.warn` → `output.warn`
  - [ ] Line 256: `console.warn` → `output.warn`
  - [ ] Line 434: `console.log` → `output.keyValue`

- [ ] Keep displayMessage() for now
  - [ ] Mark as deprecated with TODO comment
  - [ ] Plan for Phase 2 removal

### Step 4: Update Callers (1 day)

- [ ] Update `src/cli.ts:178`
  - [ ] Add `output: new ConsoleOutput()`
  - [ ] Test: `agent-chatter start -c config.json`

- [ ] Update `src/repl/ReplModeInk.tsx:1615`
  - [ ] Add `output: new InkOutput({ setOutput, getNextKey })`
  - [ ] Test: `agent-chatter` → `/start`

- [ ] Update `tests/integration/conversationStarter.integration.test.ts`
  - [ ] Add `output: new SilentOutput()` (or omit)
  - [ ] Run test: `npm run test:integration`

- [ ] Update `tests/integration/verificationCache.integration.test.ts`
  - [ ] Add `output: new SilentOutput()` (or omit)
  - [ ] Run test: `npm run test:integration`

### Step 5: Documentation & Cleanup (0.5 days)

- [ ] Add deprecation marker to `src/repl/ReplMode.ts`
  - [ ] Add @deprecated JSDoc
  - [ ] Grep for references

- [ ] Update CHANGELOG.md
  - [ ] Document new IOutput interface
  - [ ] Note backward compatibility

- [ ] Run full test suite
  - [ ] Unit tests: `npm run test:unit`
  - [ ] Integration tests: `npm run test:integration`
  - [ ] Full suite: `npm test`

- [ ] Manual testing
  - [ ] CLI mode: `agent-chatter start`
  - [ ] REPL mode: `agent-chatter` → commands
  - [ ] Status command: `agent-chatter status`

---

## Risk Mitigation

### Risk #1: InkOutput Breaks REPL

**Mitigation**:
- Write unit test using `ink-testing-library`
- Test each IOutput method independently
- Fallback: Keep old implementation if InkOutput fails

**Test Example**:
```typescript
// tests/unit/InkOutput.test.tsx
import { render } from 'ink-testing-library';
import { InkOutput } from '../../src/cli/implementations/InkOutput.js';

it('should render info message', () => {
  const output: React.ReactNode[] = [];
  const setOutput = (updater: any) => {
    const newNodes = updater(output);
    output.push(...newNodes);
  };

  const inkOutput = new InkOutput({
    setOutput,
    getNextKey: () => `key-${Date.now()}`
  });

  inkOutput.info('Test message');

  const { lastFrame } = render(<>{output}</>);
  expect(lastFrame()).toContain('Test message');
});
```

### Risk #2: Caller Updates Break Tests

**Mitigation**:
- SilentOutput is default → No change needed for most callers
- Explicit `output` is optional
- Tests can omit `output` parameter and work unchanged

**Example**:
```typescript
// This works in Phase 1 (no change needed)
const { coordinator } = await initializeServices(config, {
  registryPath: tempPath
  // output is optional, defaults to SilentOutput
});
```

### Risk #3: Color Utils Break Existing Code

**Mitigation**:
- Test each file independently after updating import
- Keep old constants as fallback
- Use TypeScript to catch import errors at compile time

---

## Success Criteria - Measurable

| Criterion | Metric | Target |
|-----------|--------|--------|
| **All tests pass** | Test suite exit code | 0 (green) |
| **No console.* in ConversationStarter** | Grep count | 0 matches (except displayMessage) |
| **Single colors.ts** | Duplicate count | 0 (consolidated) |
| **CLI works** | Manual test | `agent-chatter start` succeeds |
| **REPL works** | Manual test | `agent-chatter` → `/start` succeeds |
| **Code reduction** | Lines deleted | ~60 lines (duplicates) |

---

## Phase 2/3 Preview (Not in Scope for Phase 1)

### Phase 2: Complete displayMessage() Migration
- Remove displayMessage() function
- All output via callbacks or IOutput

### Phase 3: Error Handling
- Replace process.exit() with throw
- Centralized error handler in CLI layer
- Custom error classes

**Timeline**: Phase 2 in Q1 2025, Phase 3 in Q2 2025

---

## Appendix: File Change Summary

### New Files (+5)
- `src/cli/interfaces/IOutput.ts` (~70 lines)
- `src/cli/implementations/ConsoleOutput.ts` (~80 lines)
- `src/cli/implementations/InkOutput.tsx` (~100 lines)
- `src/cli/utils/colors.ts` (~20 lines)
- `tests/unit/InkOutput.test.tsx` (~50 lines)

### Modified Files (~8)
- `src/utils/ConversationStarter.ts` (+20 lines, -0)
- `src/cli.ts` (-40 lines duplicates, +5 imports)
- `src/commands/AgentsCommand.ts` (-15 lines duplicates, +2 imports)
- `src/repl/ReplMode.ts` (+5 deprecation, -15 duplicates, +2 imports)
- `src/repl/ReplModeInk.tsx` (+15 lines for InkOutput)
- `tests/integration/conversationStarter.integration.test.ts` (+5 lines)
- `tests/integration/verificationCache.integration.test.ts` (+5 lines)
- `CHANGELOG.md` (+10 lines)

### Net Change
- **Added**: ~320 lines (new abstractions)
- **Removed**: ~70 lines (duplicates)
- **Modified**: ~50 lines (caller updates)
- **Total delta**: +300 lines (mostly interfaces & tests)

---

## Architecture Committee Approval

**Phase 1 Scope**:
- ✅ Create IOutput abstraction with 3 implementations
- ✅ Consolidate color utilities
- ✅ Refactor ConversationStarter with output parameter
- ✅ Update all callers with backward compatibility
- ✅ Soft-deprecate ReplMode.ts
- ✅ Keep all existing tests (no deletions)

**Estimated Effort**: 5 days (1 week)
**Risk Level**: Low-Medium
**Backward Compatibility**: 100% (SilentOutput default)

**Committee Decision**: [ ] APPROVE  [ ] NEEDS REVISION  [ ] REJECT

**Feedback**:
