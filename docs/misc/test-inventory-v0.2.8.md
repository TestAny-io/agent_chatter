# Test Inventory (v0.2.8) and Core Recovery Plan

Snapshot of all tests in v0.2.8 and whether they belong in the core repo after the split.

## Unit tests

| Path | Scope | Restore in core? | Notes |
| --- | --- | --- | --- |
| unit/context/ContextManager.test.ts | Context | Yes | Core context assembly |
| unit/context/assemblers.test.ts | Context | Yes | Assemblers logic |
| unit/contextEventCollector.test.ts | Context | Yes | |
| unit/conversationStarter.test.ts | Routing | Yes | Message bootstrap logic |
| unit/coordinator/cancellation.test.ts | Routing | Yes | |
| unit/coordinator/routing.test.ts | Routing | Yes | Core routing |
| unit/coordinator/sessionPersistence.test.ts | Routing | Yes | |
| unit/coordinator/testUtils.ts | Test helper | Yes | Needed by coordinator tests |
| unit/jsonlMessageFormatter.test.ts | Utils | Yes | |
| unit/messageRouter.test.ts | Routing | Yes | |
| unit/registry/AgentDefaults.test.ts | Registry | Yes | |
| unit/registry/AgentRegistry.test.ts | Registry | Yes | |
| unit/registry/AgentScanner.test.ts | Registry | Yes | |
| unit/registry/RegistryStorage.test.ts | Registry | Yes | |
| unit/session/InMemorySessionStorage.test.ts | Session | Yes | |
| unit/session/SchemaValidator.test.ts | Schema | Yes | |
| unit/session/SessionStorageService.test.ts | Session | Yes | |
| unit/streamParsers.test.ts | Events | Yes | StreamParserFactory/JSONL parsers |
| unit/teamConfigDirectory.test.ts | Config | Yes | |
| unit/teamConfigSchema.test.ts | Config | Yes | |
| unit/teamUtils.test.ts | Utils | Yes | |
| unit/validation/agentValidator.test.ts | Validation | Yes | |
| unit/validation/authChecker.test.ts | Validation | Yes | |
| unit/validation/claudeAuthChecker.test.ts | Validation | Yes | |
| unit/validation/codexAuthChecker.test.ts | Validation | Yes | |
| unit/validation/connectivityChecker.test.ts | Validation | Yes | |
| unit/validation/geminiAuthChecker.test.ts | Validation | Yes | |
| unit/validation/types.test.ts | Validation | Yes | |
| unit/components/AgentsMenu.test.tsx | CLI/UI | No | Ink component (CLI) |
| unit/components/RestorePrompt.test.tsx | CLI/UI | No | Ink component (CLI) |
| unit/components/StreamingDisplay.test.tsx | CLI/UI | No | Ink component (CLI) |
| unit/components/ThinkingIndicator.test.tsx | CLI/UI | No | Ink component (CLI) |
| unit/cliExitBehavior.test.ts | CLI | No | CLI behavior |
| unit/replComponents.test.tsx | CLI/UI | No | Ink UI |
| unit/replModeInk.test.tsx | CLI/UI | No | Ink UI |
| unit/wizardStep1Reducer.test.ts | CLI/UI | No | Wizard reducer |

## Integration tests

| Path | Scope | Restore in core? | Notes |
| --- | --- | --- | --- |
| integration/agentValidation.integration.test.ts | Validation | Yes | Core validation flow |
| integration/routingPartialFailure.integration.test.ts | Routing | Yes | Core routing |
| integration/routingQueue.integration.test.ts | Routing | Yes | Core routing queue |
| integration/sampleConfigs.integration.test.ts | Config/Schema | Yes | Config validation |
| integration/verificationCache.integration.test.ts | Validation | Yes | |
| integration/cli/AgentsCommand.test.ts | CLI | No | CLI command |
| integration/cli/configLoading.test.ts | CLI | No | CLI config load |
| integration/conversationFlow.integration.test.ts | CLI/REPL | No | Depends on CLI |
| integration/conversationStarter.integration.test.ts | CLI/REPL | No | Depends on CLI |
| integration/sessionRestore.integration.test.ts | CLI/REPL | No | Depends on CLI |
| integration/startCommandNextDirective.integration.test.ts | CLI/REPL | No | Depends on CLI |
| integration/teamCommands.integration.test.ts | CLI | No | CLI commands |
| integration/teamConfigCRUD.integration.test.ts | CLI | No | CLI commands |
| integration/wizardFlow.integration.test.ts | CLI/UI | No | Wizard UI |

## Plan
- Restore all “Yes” tests into the core repo (update imports/paths for flattened `src/`).
- Skip/replace “No” tests; they belong to CLI/UI (hephos) and should live there if needed.

## Current status (after initial restore to core)
- Restored core-scoped unit/integration tests (CLI/Ink/REPL tests removed). Added vitest back; tests run.
- Failing tests (to fix after CLI migration is done):
  1) `tests/unit/agentManager.test.ts`: multiple failures because new architecture requires injected `agentConfigManager`/`executionEnv`, and ProcessManager/stateful assumptions no longer hold. Needs new fakes and adjusted expectations (SIGTERM/SIGKILL, stateful cancel, parser events).
  2) `tests/unit/context/ContextManager.test.ts`: warn assertions for >5KB teamTask and unknown agentType now fail (no warn). Decide whether to emit warn or relax assertions.
  3) `tests/integration/verificationCache.integration.test.ts`: missing `executionEnv/adapterFactory` in initializeServices for tests; add dummy implementations.
  4) `tests/integration/sampleConfigs.integration.test.ts`: looks for `examples/multi-role-demo-config.json` (file absent). Point to existing fixture or add a minimal sample.
- CI/publish: publish workflow already adjusted for core-only package; CI currently runs `vitest` and will fail until above issues are addressed.

## Next steps (per current priority)
1) Move CLI/UI tests (marked “No”) to the CLI/hephos repo and restore their fixtures there; get CLI tests green locally and in CI.
2) Then return to core and fix the failing tests above (update fakes/fixtures/behaviors as needed).
3) Regenerate lockfiles and re-enable `npm ci` in pipelines once both repos are stable.
