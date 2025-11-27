# LLD: REPL & CLI Integration

**Version:** 1.0
**Date:** 2025-11-27
**Reference:** [high-level-design.md](./high-level-design.md) Section 5, 6

---

## 1. Overview

本文档定义 Session Persistence 功能在 REPL（交互模式）和 CLI（命令行）中的集成设计。

## 2. File Locations

```
src/repl/ReplModeInk.tsx    # REPL integration
src/cli.ts                   # CLI integration
```

## 3. REPL Integration

### 3.1 New State

```typescript
// src/repl/ReplModeInk.tsx

interface ReplState {
  // ... existing state ...

  /**
   * Pending restore decision
   * Set when historical session detected, cleared after user choice
   */
  pendingRestore: PendingRestoreInfo | null;
}

interface PendingRestoreInfo {
  team: Team;
  session: SessionSummary;
}
```

### 3.2 Session Detection Flow

```
/team deploy <config>
        │
        ▼
┌─────────────────────────┐
│ 1. Load team config     │
│    TeamManager.load()   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. Check for sessions   │
│    getLatestSession()   │
└───────────┬─────────────┘
            │
     ┌──────┴──────┐
     │ Has session?│
     └──────┬──────┘
            │
     ┌──────┴──────┐
     │ Yes         │ No
     ▼             ▼
┌──────────┐  ┌──────────────┐
│ Show     │  │ Start fresh  │
│ restore  │  │ setTeam()    │
│ prompt   │  └──────────────┘
└────┬─────┘
     │
     ▼
[User chooses R/N]
     │
     ├─── R: setTeam(team, { resumeSessionId })
     │
     └─── N: setTeam(team)
```

### 3.3 Command Handler: /team deploy

```typescript
// src/repl/ReplModeInk.tsx

async function handleTeamDeploy(teamName: string): Promise<void> {
  try {
    // 1. Load team configuration
    const teamConfig = await teamManager.loadTeamConfig(teamName);
    const team = teamManager.buildTeam(teamConfig);

    // 2. Check for existing sessions
    const latestSession = await sessionStorage.getLatestSession(team.id);

    if (latestSession) {
      // 3a. Show restore prompt
      setPendingRestore({
        team,
        session: {
          sessionId: latestSession.sessionId,
          createdAt: latestSession.createdAt,
          updatedAt: latestSession.updatedAt,
          messageCount: latestSession.metadata.messageCount,
          summary: latestSession.metadata.summary,
        },
      });
      setMode('restore-prompt');
    } else {
      // 3b. Start fresh
      await coordinator.setTeam(team);
      setMode('conversation');
    }
  } catch (err) {
    showError(`Failed to deploy team: ${(err as Error).message}`);
  }
}
```

### 3.4 Restore Prompt Component

```tsx
// src/repl/components/RestorePrompt.tsx

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionSummary } from '../../models/SessionSnapshot.js';

interface RestorePromptProps {
  session: SessionSummary;
  teamName: string;
}

/**
 * Format time ago string
 */
function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

export function RestorePrompt({ session, teamName }: RestorePromptProps): JSX.Element {
  const timeAgo = formatTimeAgo(session.updatedAt);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="yellow">Found previous session for team '</Text>
        <Text color="cyan" bold>{teamName}</Text>
        <Text color="yellow">'</Text>
      </Box>

      <Box marginLeft={2} marginTop={1}>
        <Text dimColor>
          {timeAgo}, {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
        </Text>
      </Box>

      {session.summary && (
        <Box marginLeft={2}>
          <Text dimColor italic>"{session.summary}"</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="green">[R]</Text>
        <Text> Resume  </Text>
        <Text color="yellow">[N]</Text>
        <Text> Start New</Text>
      </Box>
    </Box>
  );
}
```

### 3.5 Input Handling

```tsx
// src/repl/ReplModeInk.tsx

import { useInput } from 'ink';

function ReplModeInk() {
  const [pendingRestore, setPendingRestore] = useState<PendingRestoreInfo | null>(null);
  const [mode, setMode] = useState<ReplMode>('command');

  useInput(async (input, key) => {
    // Handle restore prompt
    if (mode === 'restore-prompt' && pendingRestore) {
      const choice = input.toLowerCase();

      if (choice === 'r') {
        // Resume session
        try {
          await coordinator.setTeam(pendingRestore.team, {
            resumeSessionId: pendingRestore.session.sessionId,
          });
          setPendingRestore(null);
          setMode('conversation');

          // Show restored message count
          showInfo(`Restored session with ${pendingRestore.session.messageCount} messages`);
        } catch (err) {
          showError(`Failed to restore: ${(err as Error).message}`);
          setPendingRestore(null);
          setMode('command');
        }
        return;
      }

      if (choice === 'n') {
        // Start new session
        await coordinator.setTeam(pendingRestore.team);
        setPendingRestore(null);
        setMode('conversation');
        return;
      }

      // Invalid input - show hint
      showHint('Press R to resume or N to start new');
      return;
    }

    // ... existing input handling ...
  });

  // Render
  return (
    <Box flexDirection="column">
      {mode === 'restore-prompt' && pendingRestore && (
        <RestorePrompt
          session={pendingRestore.session}
          teamName={pendingRestore.team.name}
        />
      )}
      {/* ... existing render ... */}
    </Box>
  );
}
```

### 3.6 Member Consistency Warning Display

```tsx
// src/repl/ReplModeInk.tsx

// Register callback for consistency warnings
useEffect(() => {
  coordinator.options.onMemberConsistencyWarning = (missingMembers) => {
    const names = missingMembers.map(m => m.name).join(', ');
    showWarning(
      `Some speakers in history are no longer in team: ${names}\n` +
      `Their messages will be shown with original names.`
    );
  };

  return () => {
    coordinator.options.onMemberConsistencyWarning = undefined;
  };
}, [coordinator]);
```

## 4. CLI Integration

### 4.1 New CLI Options

```typescript
// src/cli.ts

import { Command } from 'commander';

const program = new Command();

program
  .name('agent-chatter')
  .option('-t, --team <name>', 'Team configuration name or path')
  .option('--resume [sessionId]', 'Resume a previous session (latest if no ID)')
  .option('--no-resume', 'Force start new session (ignore existing)')
  .action(async (options) => {
    await runCLI(options);
  });
```

### 4.2 CLI Run Logic

```typescript
// src/cli.ts

interface CLIOptions {
  team?: string;
  resume?: boolean | string;  // true (flag only), string (with ID), undefined
  noResume?: boolean;
}

async function runCLI(options: CLIOptions): Promise<void> {
  // Validate options
  if (!options.team) {
    console.error('Error: --team is required');
    process.exit(1);
  }

  // Load team configuration
  const teamConfig = await teamManager.loadTeamConfig(options.team);
  const team = teamManager.buildTeam(teamConfig);

  // Determine restore behavior
  const restoreOptions = await determineRestoreOptions(team.id, options);

  // Set team with optional restore
  try {
    await coordinator.setTeam(team, restoreOptions);

    if (restoreOptions?.resumeSessionId) {
      console.log(`Restored session: ${restoreOptions.resumeSessionId}`);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Start REPL or run non-interactive mode
  // ...
}
```

### 4.3 Restore Options Determination

```typescript
// src/cli.ts

interface SetTeamOptions {
  resumeSessionId?: string;
}

async function determineRestoreOptions(
  teamId: string,
  options: CLIOptions
): Promise<SetTeamOptions | undefined> {
  // --no-resume: force new session
  if (options.noResume) {
    return undefined;
  }

  // --resume not specified: default to new session (CI-safe)
  if (options.resume === undefined) {
    // Check if session exists but don't prompt (non-interactive)
    const latest = await sessionStorage.getLatestSession(teamId);
    if (latest) {
      console.log(
        `Note: Previous session exists. Use --resume to restore, or --no-resume to suppress this message.`
      );
    }
    return undefined;
  }

  // --resume (no ID): use latest session
  if (options.resume === true) {
    const latest = await sessionStorage.getLatestSession(teamId);
    if (!latest) {
      console.error(`Error: No previous sessions found for team '${teamId}'`);
      process.exit(1);
    }
    return { resumeSessionId: latest.sessionId };
  }

  // --resume <sessionId>: use specific session
  return { resumeSessionId: options.resume };
}
```

### 4.4 CLI Help Text

```
Usage: agent-chatter [options]

Options:
  -t, --team <name>        Team configuration name or path (required)
  --resume [sessionId]     Resume a previous session
                           - Without ID: resume most recent session
                           - With ID: resume specific session
  --no-resume              Force start new session (ignore existing)
  -h, --help               Display help

Examples:
  # Start new session (default)
  agent-chatter --team my-team

  # Resume latest session
  agent-chatter --team my-team --resume

  # Resume specific session
  agent-chatter --team my-team --resume abc123

  # Force new session even if previous exists
  agent-chatter --team my-team --no-resume
```

## 5. Behavior Matrix

### 5.1 REPL Mode

| Has Session | User Action | Result |
|-------------|-------------|--------|
| No | Deploy team | Start fresh |
| Yes | Press R | Restore session |
| Yes | Press N | Start fresh |
| Yes | Press other key | Show hint, wait |

### 5.2 CLI Mode

| --resume | Has Session | Result |
|----------|-------------|--------|
| Not specified | No | Start fresh |
| Not specified | Yes | Start fresh + note message |
| `--resume` | No | Error, exit 1 |
| `--resume` | Yes | Restore latest |
| `--resume <id>` | (any) | Restore by ID (or error if not found) |
| `--no-resume` | (any) | Start fresh, no message |

## 6. Error Messages

### 6.1 User-Facing Errors

```typescript
const ERROR_MESSAGES = {
  sessionNotFound: (sessionId: string, teamId: string) =>
    `Session '${sessionId}' not found for team '${teamId}'.\n` +
    `Use --resume without ID to restore the latest session.`,

  noSessionsExist: (teamId: string) =>
    `No previous sessions found for team '${teamId}'.\n` +
    `Start a new session first.`,

  teamIdMismatch: (snapshotTeam: string, currentTeam: string) =>
    `Session belongs to team '${snapshotTeam}', not '${currentTeam}'.\n` +
    `Please use the correct team configuration.`,

  restoreFailed: (error: string) =>
    `Failed to restore session: ${error}`,
};
```

### 6.2 Warning Messages

```typescript
const WARNING_MESSAGES = {
  membersMissing: (names: string) =>
    `Some speakers in history are no longer in team: ${names}\n` +
    `Their messages will be shown with original names.`,

  sessionExists: () =>
    `Note: Previous session exists. Use --resume to restore.`,
};
```

## 7. UI Feedback

### 7.1 Restore Success

```
✓ Restored session with 15 messages
  Last updated: 2 hours ago
```

### 7.2 Restore with Warnings

```
⚠ Some speakers in history are no longer in team: Alice, Bob
  Their messages will be shown with original names.

✓ Restored session with 15 messages
```

### 7.3 New Session Start

```
✓ Started new session for team 'code-review'
```

## 8. Test Cases

### 8.1 REPL Tests

```typescript
describe('REPL - Session Restore', () => {
  describe('/team deploy with existing session', () => {
    it('should show restore prompt');
    it('should display session summary (time ago, message count)');
    it('should restore on R key');
    it('should start fresh on N key');
    it('should show hint on invalid key');
  });

  describe('/team deploy without session', () => {
    it('should start fresh immediately');
    it('should not show restore prompt');
  });

  describe('restore error handling', () => {
    it('should show error and return to command mode on failure');
    it('should display member consistency warnings');
  });
});
```

### 8.2 CLI Tests

```typescript
describe('CLI - Session Restore', () => {
  describe('--resume flag', () => {
    it('should restore latest session when --resume without ID');
    it('should restore specific session when --resume <id>');
    it('should error when --resume but no sessions exist');
    it('should error when --resume <id> but ID not found');
  });

  describe('default behavior', () => {
    it('should start fresh when no --resume flag');
    it('should show note when session exists but not resuming');
  });

  describe('--no-resume flag', () => {
    it('should start fresh and suppress note message');
  });
});
```

## 9. Accessibility

### 9.1 Keyboard Navigation

- **R**: Resume session (case-insensitive)
- **N**: New session (case-insensitive)
- **ESC**: Cancel and return to command mode

### 9.2 Screen Reader Support

Restore prompt includes:
- Clear action labels
- Session summary for context
- Feedback after action

---

**Document Version:** 1.0
**Author:** Claude (Development Agent)
