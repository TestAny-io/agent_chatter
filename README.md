# @testany/agent-chatter-core

Core library for multi-agent conversation orchestration. Contains only business logic, models, validation, and stream parsing. No CLI/REPL code lives here. The CLI/REPL distribution is the separate `hephos` package/repo.

## Scope
- Conversation routing: `ConversationCoordinator`, `MessageRouter`
- Event parsing: `StreamParserFactory` (Claude/Codex/Gemini JSONL -> AgentEvent)
- Validation & probing: `AgentValidator`, `ConnectivityChecker`, `AuthChecker`
- Models/config: `Team`, `Member`, `AgentConfig`, `CoreTeamConfig`
- Utilities: JSON Schema validation, context assembly, session storage abstractions

## Install
```bash
npm install @testany/agent-chatter-core
```

## Develop & Build
Requires Node.js 20+.
```bash
npm ci
npm run build
npm test   # passes with no tests by design
```

## Layout
```
packages/core/
  src/
    context/        context assembly
    events/         AgentEvent definitions & parsers
    infrastructure/ session storage abstraction
    interfaces/     DI interfaces (ILogger, IExecutionEnvironment, IAgentAdapter, ...)
    models/         Team/Member/Config models
    registry/       agent registry/scan/validation
    services/       core services (Coordinator, AgentManager, etc.)
    schemas/        JSON Schemas
    utils/          validation/defaults/color helpers
  package.json
```

## License
MPL-2.0 OR Apache-2.0

## Publish
1) Ensure `npm run build` / `npm test` pass  
2) Tag `vX.Y.Z` and push  
3) `npm publish` (requires `NPM_TOKEN`)  

## Relationship to CLI
- Core: `@testany/agent-chatter-core` (this repo)  
- CLI/REPL: `hephos` (distributed as an npm package; closed-source/private repo). Install via `npm install -g hephos` or add as a dependency; source code is not published.  

## Maintenance notes
- When adding events/models, also update `schemas/` and corresponding parsers/validators.
- Keep external deps minimal (currently ajv/ajv-formats). Evaluate size and license before adding. 
