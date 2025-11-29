# @testany/agent-chatter-core

Core library for multi-agent conversation orchestration. This package contains platform-independent business logic.

## License

This package is dual-licensed under **MPL-2.0** or **Apache-2.0** at your option.

- **MPL-2.0**: [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/)
- **Apache-2.0**: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

You may choose either license depending on your project's needs.

## Installation

```bash
npm install @testany/agent-chatter-core
```

## Usage

```typescript
import {
  ConversationCoordinator,
  AgentManager,
  initializeServices
} from '@testany/agent-chatter-core';

// Initialize services with your configuration
const { coordinator, agentManager } = await initializeServices({
  config: yourTeamConfig,
  adapterFactory: yourAdapterFactory,
  executionEnvironment: yourExecutionEnvironment
});
```

## API Overview

### Services

- `ConversationCoordinator` - Orchestrates multi-agent conversations
- `AgentManager` - Manages agent lifecycle
- `MessageRouter` - Routes messages between agents
- `TeamManager` - Manages team configurations
- `AgentValidator` - Validates agent availability

### Registry

- `AgentRegistry` - Global agent registry management
- `RegistryStorage` - Persistent storage for agent definitions

### Interfaces

- `IExecutionEnvironment` - Abstraction for process spawning
- `IAgentAdapter` - Agent communication adapter interface
- `IAdapterFactory` - Factory for creating adapters
- `ILogger` - Logging interface

## Related Packages

- `@testany/agent-chatter` - CLI application (proprietary, UNLICENSED)

## Support

For licensing inquiries: support@testany.io
