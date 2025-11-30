/**
 * SchemaValidator - JSON Schema validation utilities
 *
 * Uses ajv for runtime validation of configuration files.
 * Schemas are loaded from the schemas/ directory.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { CLIConfig } from '../models/CLIConfig.js';
import type { SessionSnapshot } from '../models/SessionSnapshot.js';

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find schema directory from multiple possible locations
 * Works in both development and npm-installed scenarios
 */
function findSchemaDir(): string {
  // Possible locations relative to this file:
  // Dev: src/utils/SchemaValidator.ts -> schemas (../../schemas)
  // Build: out/utils/SchemaValidator.js -> schemas (../../schemas)
  // npm: node_modules/agent-chatter/out/utils -> node_modules/agent-chatter/schemas (../../schemas)
  const candidates = [
    path.join(__dirname, '../../schemas'),           // Standard: relative to utils folder
    path.join(__dirname, '../../../schemas'),        // Alternative: one level deeper
    path.join(process.cwd(), 'schemas'),             // CWD fallback for tests
    path.join(process.cwd(), 'node_modules/testany-agent-chatter/schemas'), // npm installed
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'session-snapshot-v1.0.json'))) {
      return dir;
    }
  }

  // Default to first candidate (will throw helpful error on first use)
  return candidates[0];
}

// Lazy-initialized schema directory
let _schemaDir: string | null = null;

function getSchemaDir(): string {
  if (!_schemaDir) {
    _schemaDir = findSchemaDir();
  }
  return _schemaDir;
}

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
      const pathStr = e.instancePath || '/';
      const msg = e.message ?? 'Unknown error';
      const allowed = e.params && 'allowedValues' in e.params
        ? ` (allowed: ${JSON.stringify(e.params.allowedValues)})`
        : '';
      return `  - ${pathStr}: ${msg}${allowed}`;
    });

    return (
      `Invalid ${schemaName}:\n` +
      lines.join('\n') +
      `\n\nPlease check the schema: schemas/${schemaName}.json`
    );
  }
}

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
 * Load and compile schema validators
 * Lazy initialization to avoid loading schemas until needed
 */
let _ajv: Ajv.default | null = null;
let _validators: {
  cliConfig: Ajv.ValidateFunction | null;
  agentRegistry: Ajv.ValidateFunction | null;
  sessionSnapshot: Ajv.ValidateFunction | null;
} = {
  cliConfig: null,
  agentRegistry: null,
  sessionSnapshot: null,
};

function getAjv(): Ajv.default {
  if (!_ajv) {
    _ajv = new Ajv.default({
      allErrors: true,           // Collect all errors, not just first
      verbose: true,             // Include data in error messages
      strict: false,             // Allow draft-07 features
    });
    addFormats.default(_ajv);
  }
  return _ajv;
}

function loadSchema(filename: string): object {
  const schemaDir = getSchemaDir();
  const filePath = path.join(schemaDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Schema file not found: ${filePath}\n` +
      `Searched in: ${schemaDir}\n` +
      `Please ensure the schemas directory is properly installed.`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getCliConfigValidator(): Ajv.ValidateFunction {
  if (!_validators.cliConfig) {
    const schema = loadSchema('cli-config-v1.2.json');
    _validators.cliConfig = getAjv().compile(schema);
  }
  return _validators.cliConfig;
}

function getAgentRegistryValidator(): Ajv.ValidateFunction {
  if (!_validators.agentRegistry) {
    const schema = loadSchema('agent-registry-v1.1.json');
    _validators.agentRegistry = getAjv().compile(schema);
  }
  return _validators.agentRegistry;
}

function getSessionSnapshotValidator(): Ajv.ValidateFunction {
  if (!_validators.sessionSnapshot) {
    const schema = loadSchema('session-snapshot-v1.0.json');
    _validators.sessionSnapshot = getAjv().compile(schema);
  }
  return _validators.sessionSnapshot;
}

/**
 * Validate data against a compiled schema
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
 * Validate CLI/Team configuration
 *
 * @param content - Parsed JSON content
 * @returns Validated CLIConfig
 * @throws SchemaValidationError if invalid
 */
export function validateTeamConfig(content: unknown): CLIConfig {
  return validateWithSchema<CLIConfig>(
    content,
    getCliConfigValidator(),
    'cli-config-v1.2'
  );
}

/**
 * Validate and check version in one step
 */
export function validateTeamConfigWithVersion(content: unknown): CLIConfig {
  const config = validateTeamConfig(content);
  if (config.schemaVersion) {
    checkSchemaVersion(config.schemaVersion, 'cliConfig');
  }
  return config;
}

/**
 * Validate Agent Registry
 *
 * @param content - Parsed JSON content
 * @returns Validated registry data
 * @throws SchemaValidationError if invalid
 */
export function validateAgentRegistry(content: unknown): unknown {
  return validateWithSchema(
    content,
    getAgentRegistryValidator(),
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
    getSessionSnapshotValidator(),
    'session-snapshot-v1.0'
  );
}

/**
 * Validate session snapshot and check version
 */
export function validateSessionSnapshotWithVersion(content: unknown): SessionSnapshot {
  const snapshot = validateSessionSnapshot(content);
  checkSchemaVersion(snapshot.schemaVersion, 'sessionSnapshot');
  return snapshot;
}

/**
 * Check if schema files exist
 * Useful for debugging deployment issues
 */
export function checkSchemaFilesExist(): { exists: boolean; missing: string[]; schemaDir: string } {
  const schemaDir = getSchemaDir();
  const schemaFiles = [
    'cli-config-v1.2.json',
    'agent-registry-v1.1.json',
    'session-snapshot-v1.0.json',
  ];

  const missing: string[] = [];
  for (const file of schemaFiles) {
    const filePath = path.join(schemaDir, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
    }
  }

  return {
    exists: missing.length === 0,
    missing,
    schemaDir,
  };
}
