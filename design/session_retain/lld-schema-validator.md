# LLD: Schema Validator

**Version:** 1.0
**Date:** 2025-11-27
**Reference:** [high-level-design.md](./high-level-design.md) Section 14

---

## 1. Overview

本文档定义 JSON Schema 校验器的详细设计，用于在加载配置文件时强制校验数据格式。

## 2. File Location

```
src/utils/SchemaValidator.ts
```

## 3. Dependencies

### 3.1 npm Packages

```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1"
  }
}
```

### 3.2 Schema Files

```
schemas/
├── cli-config-v1.2.json
├── agent-registry-v1.1.json
└── session-snapshot-v1.0.json
```

### 3.3 npm 打包配置

**关键要求**：`schemas/*.json` 必须包含在 npm 发布产物中。

```json
// package.json
{
  "files": [
    "dist",
    "schemas"
  ]
}
```

运行时路径解析策略：
1. **开发环境**：`path.join(__dirname, '../../schemas')` (从 `src/utils/` 到 `schemas/`)
2. **npm 安装后**：`path.join(__dirname, '../../schemas')` (从 `dist/utils/` 到 `schemas/`)

两种场景路径一致，因为 `schemas/` 在包根目录，与 `dist/` 同级。

## 4. Implementation

### 4.1 Module Setup

```typescript
// src/utils/SchemaValidator.ts

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

// Schema file paths (relative to package root)
const SCHEMA_DIR = path.join(__dirname, '../../schemas');

// Load schemas
const cliConfigSchema = JSON.parse(
  fs.readFileSync(path.join(SCHEMA_DIR, 'cli-config-v1.2.json'), 'utf-8')
);
const agentRegistrySchema = JSON.parse(
  fs.readFileSync(path.join(SCHEMA_DIR, 'agent-registry-v1.1.json'), 'utf-8')
);
const sessionSnapshotSchema = JSON.parse(
  fs.readFileSync(path.join(SCHEMA_DIR, 'session-snapshot-v1.0.json'), 'utf-8')
);

// Create Ajv instance
const ajv = new Ajv({
  allErrors: true,           // Collect all errors, not just first
  verbose: true,             // Include data in error messages
  strict: false,             // Allow draft-07 features
});

// Add format validators (date-time, uri, etc.)
addFormats(ajv);

// Compile validators
const validators = {
  cliConfig: ajv.compile(cliConfigSchema),
  agentRegistry: ajv.compile(agentRegistrySchema),
  sessionSnapshot: ajv.compile(sessionSnapshotSchema),
};
```

### 4.2 Validation Error Class

```typescript
/**
 * Custom error for schema validation failures
 */
export class SchemaValidationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly errors: Ajv.ErrorObject[],
    public readonly data: unknown
  ) {
    const message = SchemaValidationError.formatErrors(schemaName, errors);
    super(message);
    this.name = 'SchemaValidationError';
  }

  /**
   * Format validation errors for user-friendly display
   */
  static formatErrors(schemaName: string, errors: Ajv.ErrorObject[]): string {
    const lines = errors.map(e => {
      const path = e.instancePath || '/';
      const msg = e.message ?? 'Unknown error';
      const allowed = e.params?.allowedValues
        ? ` (allowed: ${JSON.stringify(e.params.allowedValues)})`
        : '';
      return `  - ${path}: ${msg}${allowed}`;
    });

    return (
      `Invalid ${schemaName}:\n` +
      lines.join('\n') +
      `\n\nPlease check the schema: schemas/${schemaName}.json`
    );
  }
}
```

### 4.3 Generic Validation Function

```typescript
/**
 * Validate data against a compiled schema
 *
 * @param data - Data to validate
 * @param validator - Compiled Ajv validator
 * @param schemaName - Schema name for error messages
 * @returns Validated and typed data
 * @throws SchemaValidationError if validation fails
 */
function validateWithSchema<T>(
  data: unknown,
  validator: Ajv.ValidateFunction,
  schemaName: string
): T {
  if (!validator(data)) {
    throw new SchemaValidationError(
      schemaName,
      validator.errors ?? [],
      data
    );
  }
  return data as T;
}
```

### 4.4 Exported Validators

```typescript
import type { CLIConfig } from '../models/CLIConfig.js';
import type { AgentRegistryData } from '../registry/RegistryStorage.js';
import type { SessionSnapshot } from '../models/SessionSnapshot.js';

/**
 * Validate CLI/Team configuration
 *
 * @param content - Parsed JSON content
 * @returns Validated CLIConfig
 * @throws SchemaValidationError if invalid
 */
export function validateTeamConfig(content: unknown): CLIConfig {
  return validateWithSchema<CLIConfig>(
    content,
    validators.cliConfig,
    'cli-config-v1.2'
  );
}

/**
 * Validate Agent Registry
 *
 * @param content - Parsed JSON content
 * @returns Validated AgentRegistryData
 * @throws SchemaValidationError if invalid
 */
export function validateAgentRegistry(content: unknown): AgentRegistryData {
  return validateWithSchema<AgentRegistryData>(
    content,
    validators.agentRegistry,
    'agent-registry-v1.1'
  );
}

/**
 * Validate Session Snapshot
 *
 * @param content - Parsed JSON content
 * @returns Validated SessionSnapshot
 * @throws SchemaValidationError if invalid
 */
export function validateSessionSnapshot(content: unknown): SessionSnapshot {
  return validateWithSchema<SessionSnapshot>(
    content,
    validators.sessionSnapshot,
    'session-snapshot-v1.0'
  );
}
```

### 4.5 Version Checking

```typescript
/**
 * Schema version configuration
 */
interface VersionConfig {
  name: string;
  min: string;  // Minimum supported version
  max: string;  // Maximum supported version (current)
}

const VERSION_CONFIGS: Record<string, VersionConfig> = {
  cliConfig: { name: 'team-config', min: '1.1', max: '1.2' },
  agentRegistry: { name: 'agent-registry', min: '1.1', max: '1.1' },
  sessionSnapshot: { name: 'session-snapshot', min: '1.0', max: '1.0' },
};

/**
 * Compare version strings (simple major.minor comparison)
 */
function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);

  if (aMajor !== bMajor) return aMajor - bMajor;
  return aMinor - bMinor;
}

/**
 * Check schema version compatibility
 *
 * @param version - Version from file
 * @param configKey - Key in VERSION_CONFIGS
 * @throws Error if version incompatible
 */
export function checkSchemaVersion(version: string, configKey: keyof typeof VERSION_CONFIGS): void {
  const config = VERSION_CONFIGS[configKey];

  // Version too new (future version)
  if (compareVersions(version, config.max) > 0) {
    throw new Error(
      `Schema version ${version} for ${config.name} is not supported.\n` +
      `Maximum supported version is ${config.max}.\n` +
      `Please upgrade agent-chatter to the latest version.`
    );
  }

  // Version too old (deprecated)
  if (compareVersions(version, config.min) < 0) {
    throw new Error(
      `Schema version ${version} for ${config.name} is deprecated.\n` +
      `Minimum supported version is ${config.min}.\n` +
      `Please migrate your configuration to version ${config.max}.`
    );
  }
}

/**
 * Validate and check version in one step
 */
export function validateTeamConfigWithVersion(content: unknown): CLIConfig {
  const config = validateTeamConfig(content);
  checkSchemaVersion(config.schemaVersion, 'cliConfig');
  return config;
}

export function validateSessionSnapshotWithVersion(content: unknown): SessionSnapshot {
  const snapshot = validateSessionSnapshot(content);
  checkSchemaVersion(snapshot.schemaVersion, 'sessionSnapshot');
  return snapshot;
}
```

## 5. Integration Points

### 5.1 TeamManager

```typescript
// src/services/TeamManager.ts

import { validateTeamConfigWithVersion } from '../utils/SchemaValidator.js';

export class TeamManager {
  async loadTeamConfig(filePath: string): Promise<CLIConfig> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const rawData = JSON.parse(content);

    // ✅ Validate against schema
    return validateTeamConfigWithVersion(rawData);
  }
}
```

### 5.2 RegistryStorage

```typescript
// src/registry/RegistryStorage.ts

import { validateAgentRegistry, checkSchemaVersion } from '../utils/SchemaValidator.js';

export class RegistryStorage {
  async loadRegistry(): Promise<AgentRegistryData> {
    const content = await fs.promises.readFile(this.registryPath, 'utf-8');
    const rawData = JSON.parse(content);

    // ✅ Validate against schema
    const registry = validateAgentRegistry(rawData);
    checkSchemaVersion(registry.schemaVersion, 'agentRegistry');
    return registry;
  }
}
```

### 5.3 SessionStorageService

```typescript
// src/infrastructure/SessionStorageService.ts

import { validateSessionSnapshotWithVersion } from '../utils/SchemaValidator.js';

export class SessionStorageService implements ISessionStorage {
  async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const rawData = JSON.parse(content);

      // ✅ Validate against schema
      return validateSessionSnapshotWithVersion(rawData);
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        console.warn(`⚠️  Session ${sessionId} has invalid format: ${err.message}`);
        return null;
      }
      throw err;
    }
  }
}
```

## 6. Error Handling

### 6.1 Error Types

| Error Type | Cause | Handling |
|------------|-------|----------|
| `SchemaValidationError` | Data doesn't match schema | Throw (or return null for sessions) |
| `SyntaxError` | Invalid JSON | Let propagate (JSON.parse error) |
| Version too new | Schema version > max | Throw with upgrade suggestion |
| Version too old | Schema version < min | Throw with migration suggestion |

### 6.2 Error Messages

**Schema Validation Error:**
```
Invalid cli-config-v1.2:
  - /team/members/0: must have required property 'roleDir'
  - /schemaVersion: must be equal to one of the allowed values (allowed: ["1.1","1.2"])

Please check the schema: schemas/cli-config-v1.2.json
```

**Version Too New:**
```
Schema version 2.0 for team-config is not supported.
Maximum supported version is 1.2.
Please upgrade agent-chatter to the latest version.
```

**Version Too Old:**
```
Schema version 1.0 for team-config is deprecated.
Minimum supported version is 1.1.
Please migrate your configuration to version 1.2.
```

## 7. Schema Loading

### 7.1 Build-time Bundling

For bundled distributions, schemas should be included in the build:

```typescript
// Option 1: Import as JSON (requires bundler config)
import cliConfigSchema from '../../schemas/cli-config-v1.2.json';

// Option 2: Inline during build (for edge cases)
const cliConfigSchema = { /* ... schema content ... */ };
```

### 7.2 Runtime Loading

For development and npm package:

```typescript
const SCHEMA_DIR = path.join(__dirname, '../../schemas');

function loadSchema(filename: string): object {
  const filePath = path.join(SCHEMA_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
```

## 8. Test Strategy

### 8.1 Test File Structure

```
tests/unit/schemaValidator.test.ts
```

### 8.2 Test Cases

```typescript
import { validateTeamConfig, validateSessionSnapshot, SchemaValidationError } from '../../src/utils/SchemaValidator.js';

describe('SchemaValidator', () => {
  describe('validateTeamConfig', () => {
    describe('valid samples', () => {
      it('should accept cli-config-minimal.json', () => {
        const content = require('../../schemas/__tests__/valid/cli-config-minimal.json');
        expect(() => validateTeamConfig(content)).not.toThrow();
      });

      it('should accept cli-config-full.json', () => {
        const content = require('../../schemas/__tests__/valid/cli-config-full.json');
        expect(() => validateTeamConfig(content)).not.toThrow();
      });
    });

    describe('invalid samples', () => {
      it('should reject cli-config-missing-team.json', () => {
        const content = require('../../schemas/__tests__/invalid/cli-config-missing-team.json');
        expect(() => validateTeamConfig(content)).toThrow(SchemaValidationError);
      });

      it('should reject cli-config-wrong-schema-version.json', () => {
        const content = require('../../schemas/__tests__/invalid/cli-config-wrong-schema-version.json');
        expect(() => validateTeamConfig(content)).toThrow(/schemaVersion/);
      });

      it('should reject cli-config-ai-missing-agentType.json', () => {
        const content = require('../../schemas/__tests__/invalid/cli-config-ai-missing-agentType.json');
        expect(() => validateTeamConfig(content)).toThrow(/agentType/);
      });

      it('should reject cli-config-single-member.json', () => {
        const content = require('../../schemas/__tests__/invalid/cli-config-single-member.json');
        expect(() => validateTeamConfig(content)).toThrow(/minItems/);
      });
    });
  });

  describe('validateSessionSnapshot', () => {
    describe('valid samples', () => {
      it('should accept session-snapshot-legacy.json (roleId format)', () => {
        const content = require('../../schemas/__tests__/valid/session-snapshot-legacy.json');
        expect(() => validateSessionSnapshot(content)).not.toThrow();
      });

      it('should accept session-snapshot-new-format.json (id format)', () => {
        const content = require('../../schemas/__tests__/valid/session-snapshot-new-format.json');
        expect(() => validateSessionSnapshot(content)).not.toThrow();
      });
    });

    describe('invalid samples', () => {
      it('should reject session-snapshot-missing-context.json', () => {
        const content = require('../../schemas/__tests__/invalid/session-snapshot-missing-context.json');
        expect(() => validateSessionSnapshot(content)).toThrow(/context/);
      });

      it('should reject session-snapshot-invalid-speaker.json', () => {
        const content = require('../../schemas/__tests__/invalid/session-snapshot-invalid-speaker.json');
        expect(() => validateSessionSnapshot(content)).toThrow(SchemaValidationError);
      });
    });
  });

  describe('validateAgentRegistry', () => {
    it('should accept valid agent-registry.json', () => {
      const content = require('../../schemas/__tests__/valid/agent-registry.json');
      expect(() => validateAgentRegistry(content)).not.toThrow();
    });

    it('should reject agent-registry-wrong-version.json', () => {
      const content = require('../../schemas/__tests__/invalid/agent-registry-wrong-version.json');
      expect(() => validateAgentRegistry(content)).toThrow(/schemaVersion/);
    });

    it('should reject agent-registry-missing-required.json', () => {
      const content = require('../../schemas/__tests__/invalid/agent-registry-missing-required.json');
      expect(() => validateAgentRegistry(content)).toThrow(SchemaValidationError);
    });
  });

  describe('checkSchemaVersion', () => {
    it('should accept current version', () => {
      expect(() => checkSchemaVersion('1.2', 'cliConfig')).not.toThrow();
    });

    it('should accept minimum version', () => {
      expect(() => checkSchemaVersion('1.1', 'cliConfig')).not.toThrow();
    });

    it('should reject future version', () => {
      expect(() => checkSchemaVersion('2.0', 'cliConfig'))
        .toThrow(/not supported.*upgrade/);
    });

    it('should reject deprecated version', () => {
      expect(() => checkSchemaVersion('1.0', 'cliConfig'))
        .toThrow(/deprecated.*migrate/);
    });
  });

  describe('SchemaValidationError', () => {
    it('should format multiple errors', () => {
      const errors: Ajv.ErrorObject[] = [
        { instancePath: '/team', message: 'is required', keyword: 'required', params: {}, schemaPath: '' },
        { instancePath: '/schemaVersion', message: 'must be string', keyword: 'type', params: {}, schemaPath: '' },
      ];
      const error = new SchemaValidationError('test-schema', errors, {});
      expect(error.message).toContain('/team: is required');
      expect(error.message).toContain('/schemaVersion: must be string');
    });
  });
});
```

## 9. Performance Considerations

### 9.1 Schema Compilation

Schemas are compiled once at module load time, not on every validation call:

```typescript
// ✅ Good: compile once
const validators = {
  cliConfig: ajv.compile(cliConfigSchema),
};

// ❌ Bad: compile on every call
function validate(data) {
  const validator = ajv.compile(schema);  // Slow!
  return validator(data);
}
```

### 9.2 Validation Cost

- Schema validation adds ~1-5ms per file
- Acceptable for config files (loaded once at startup)
- Session files validated on load (not hot path)

---

**Document Version:** 1.0
**Author:** Claude (Development Agent)
