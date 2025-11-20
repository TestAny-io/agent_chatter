/**
 * Team Config Paths - Helper functions for managing team configuration file paths
 *
 * This module provides utilities for:
 * - Getting the team config directory path (.agent-chatter/team-config/)
 * - Ensuring the directory exists
 * - Resolving config filenames to full paths with fallback to legacy locations
 * - Formatting error messages for missing configs
 */

import * as fs from 'fs';
import * as path from 'path';

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
 * 2. Check .agent-chatter/team-config/ directory (new location)
 * 3. Check current working directory (legacy location)
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
    const legacyPath = path.join(process.cwd(), filename);

    if (fs.existsSync(teamConfigPath)) {
        return {
            path: teamConfigPath,
            exists: true,
            searchedPaths: [teamConfigPath]
        };
    }

    if (fs.existsSync(legacyPath)) {
        return {
            path: legacyPath,
            exists: true,
            warning: `Configuration "${filename}" was not found in ${teamConfigPath}. Using ${legacyPath}.`,
            searchedPaths: [teamConfigPath, legacyPath]
        };
    }

    return {
        path: teamConfigPath,
        exists: false,
        searchedPaths: [teamConfigPath, legacyPath]
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
    if (resolution.searchedPaths.length > 1) {
        return [
            `Error: Configuration "${filename}" was not found.`,
            'Checked:',
            ...resolution.searchedPaths.map(p => `  - ${p}`)
        ].join('\n');
    }
    return `Error: Configuration file not found: ${resolution.searchedPaths[0]}`;
}
