/**
 * Team Config Paths - Helper functions for managing team configuration file paths
 *
 * This module provides utilities for:
 * - Getting the team config directory path (.agent-chatter/team-config/)
 * - Ensuring the directory exists
 * - Resolving config filenames to full paths with fallback to legacy locations
 * - Formatting error messages for missing configs
 * - Discovering and validating team configuration files
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateTeamConfig } from '../schemas/TeamConfigSchema.js';

/**
 * Get the team configuration directory path (.agent-chatter/team-config/)
 */
export function getTeamConfigDir(): string {
    return path.join(process.cwd(), '.agent-chatter', 'team-config');
}

/**
 * Ensure the team configuration directory exists
 */
export function ensureTeamConfigDir(): void {
    const dir = getTeamConfigDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Configuration resolution result
 */
export interface ConfigResolution {
    path: string;
    exists: boolean;
    warning?: string;
    searchedPaths: string[];
}

/**
 * Resolve a config filename to its full path in the team config directory
 *
 * Resolution order:
 * 1. If absolute path, use as-is
 * 2. Check .agent-chatter/team-config/ directory
 *
 * @param filename - The config filename or path
 * @returns ConfigResolution with path, exists status, optional warning, and searched paths
 */
export function resolveTeamConfigPath(filename: string): ConfigResolution {
    if (path.isAbsolute(filename)) {
        return {
            path: filename,
            exists: fs.existsSync(filename),
            searchedPaths: [filename]
        };
    }

    const teamConfigPath = path.join(getTeamConfigDir(), filename);

    return {
        path: teamConfigPath,
        exists: fs.existsSync(teamConfigPath),
        searchedPaths: [teamConfigPath]
    };
}

/**
 * Format error message for missing configuration file
 *
 * @param filename - The config filename
 * @param resolution - The resolution result from resolveTeamConfigPath
 * @returns Formatted error message
 */
export function formatMissingConfigError(filename: string, resolution: ConfigResolution): string {
    return `Error: Configuration file not found: ${resolution.searchedPaths[0]}\n` +
           `Expected location: ${getTeamConfigDir()}/`;
}

/**
 * Team configuration information for discovery
 */
export interface TeamConfigInfo {
    /** Config filename (e.g., "phoenix-prd.json") */
    filename: string;
    /** Full file path */
    filepath: string;
    /** Display name for UI (team.displayName or team.name or filename without .json) */
    displayName: string;
    /** Team internal name (team.name) */
    teamName: string;
    /** Total number of members */
    memberCount: number;
    /** Number of AI members */
    aiCount: number;
    /** Number of human members */
    humanCount: number;
    /** Schema version */
    schemaVersion?: string;
}

/**
 * Discover and validate all team configuration files in the team-config directory
 *
 * This function:
 * - Scans .agent-chatter/team-config/ for all .json files
 * - Validates each file using validateTeamConfig()
 * - Silently skips malformed JSON or invalid configs
 * - Implements display name fallback: team.displayName → team.name → filename
 * - Returns array of valid team configurations with metadata
 *
 * @returns Array of TeamConfigInfo objects for valid configurations
 */
export function discoverTeamConfigs(): TeamConfigInfo[] {
    const configDir = getTeamConfigDir();

    // If directory doesn't exist, return empty array
    if (!fs.existsSync(configDir)) {
        return [];
    }

    // Get all JSON files
    const allJsonFiles = fs.readdirSync(configDir).filter(f => f.endsWith('.json'));

    const configs: TeamConfigInfo[] = [];

    for (const filename of allJsonFiles) {
        try {
            const filepath = path.join(configDir, filename);
            const content = fs.readFileSync(filepath, 'utf-8');
            const config = JSON.parse(content);

            // Validate using existing schema validator
            const validation = validateTeamConfig(config);

            if (validation.valid) {
                // Display name fallback chain: displayName → team.name → filename (without .json)
                const displayName = config.team.displayName
                    || config.team.name
                    || filename.replace('.json', '');

                // Count AI and human members
                const aiCount = config.team.members.filter((m: any) => m.type === 'ai').length;
                const humanCount = config.team.members.filter((m: any) => m.type === 'human').length;

                configs.push({
                    filename,
                    filepath,
                    displayName,
                    teamName: config.team.name,
                    memberCount: config.team.members.length,
                    aiCount,
                    humanCount,
                    schemaVersion: config.schemaVersion
                });
            } else {
                // Debug logging for invalid files (optional)
                if (process.env.DEBUG) {
                    console.debug(`[TeamConfigPaths] Skipped invalid config: ${filename}`, validation.errors);
                }
            }
        } catch (error) {
            // Silently skip malformed JSON or unreadable files
            if (process.env.DEBUG) {
                console.debug(`[TeamConfigPaths] Skipped malformed file: ${filename}`, error);
            }
        }
    }

    return configs;
}
