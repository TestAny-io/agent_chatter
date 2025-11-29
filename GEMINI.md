# Agent Chatter - Project Context

## Project Overview

**Agent Chatter** is a TypeScript-based CLI application designed to orchestrate structured conversations between multiple AI agents (Claude Code, OpenAI Codex, Google Gemini) and human participants. It functions as a multi-agent framework where a "Team" of agents with specific "Roles" collaborate to solve problems, review code, or brainstorm, with intelligent message routing and context management.

### Key Architecture Components

*   **CLI Entry Point (`src/cli.ts`)**: Uses `commander` to handle CLI arguments and commands (`start`, `status`, `agents`, `team`).
*   **Conversation Coordinator (`src/services/ConversationCoordinator.ts`)**: The core engine that manages the conversation loop, routes messages, manages context, and handles session state (active, paused, completed).
*   **Team Manager (`src/services/TeamManager.ts`)**: Manages team configurations, including members, roles, and instructions. Persists data using `StorageService`.
*   **Agent Registry (`src/registry/AgentRegistry.ts`)**: Manages the registration and verification of external AI CLI tools.
*   **Context Manager (`src/context/ContextManager.ts`)**: Handles the assembly of conversation history and prompt generation for agents.
*   **Infrastructure (`src/infrastructure/`)**: Abstractions for storage (`SessionStorageService`, `RegistryStorage`) and process management (`ProcessManager`).

## Building and Running

### Prerequisites
*   Node.js >= 20.0.0

### Key Commands

*   **Install Dependencies**:
    ```bash
    npm install
    ```

*   **Build Project**:
    ```bash
    npm run build
    # or
    npm run compile
    ```

*   **Run Tests**:
    ```bash
    npm test             # Run all tests
    npm run test:unit    # Run unit tests only
    npm run test:watch   # Run tests in watch mode
    ```

*   **Run CLI (Local Development)**:
    After building, you can run the CLI directly:
    ```bash
    node ./out/cli.js [command]
    # Example:
    node ./out/cli.js status
    ```
    
    Or use the `bin` entry if linked:
    ```bash
    agent-chatter [command]
    ```

*   **Package & Install Globally (Local Testing)**:
    ```bash
    npm run install:global
    ```

### Development Conventions

**Documentation Language:**
*   **All documentation MUST be written in Chinese (Simplified).** This applies to design docs, READMEs (unless it's the public facing English README), developer guides, and architectural decisions.

### Code Structure
*   **`src/`**: Source code root.
    *   **`adapters/`**: Adapters for different AI CLI tools.
    *   **`commands/`**: Command handlers for the CLI.
    *   **`context/`**: Context management logic.
    *   **`infrastructure/`**: Low-level services (storage, process execution).
    *   **`models/`**: TypeScript interfaces and types (`CLIConfig`, `Team`, `SessionSnapshot`).
    *   **`registry/`**: Logic for discovering and registering CLI tools.
    *   **`services/`**: Core business logic services.
    *   **`utils/`**: Utility functions.
*   **`tests/`**: Test suite (Vitest).
    *   **`unit/`**: Isolated unit tests.
    *   **`integration/`**: Integration tests covering broader flows.

### Configuration & Schemas
*   **Configuration Files**: The project uses JSON-based configuration.
    *   **Team Config**: Defines roles, members, and working directories.
    *   **Agent Registry**: Stores registered AI CLI tools.
*   **Schema Versions**: Be aware of schema versions (e.g., `schemaVersion: '1.1'`). Ensure backward compatibility or proper migration when modifying models.

### Testing Guidelines
*   **Framework**: Vitest.
*   **Mocking**: Heavily mock external CLI processes (`ProcessManager`, `AgentManager`) in unit tests to avoid spawning actual processes.
*   **File System**: Use temporary directories (`fs.mkdtempSync`) for tests requiring file I/O.
*   **Async/Await**: Use `async/await` for all asynchronous operations.

### Key Concepts
*   **Session Persistence**: Sessions are automatically saved to disk. The `ConversationCoordinator` handles restoration via `restoreSession`.
*   **Message Routing**: Supports explicit routing (`[NEXT: name]`) and fallback mechanisms (e.g., routing to the first human if AI routing fails).
*   **REPL Mode**: The primary interaction mode is an interactive REPL (Read-Eval-Print Loop) built with `ink`.
