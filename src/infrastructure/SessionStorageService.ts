/**
 * SessionStorageService - File-based session storage implementation
 *
 * Storage path: ~/.agent-chatter/sessions/<teamId>/<timestamp>-<sessionId>.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ISessionStorage } from './ISessionStorage.js';
import type { SessionSnapshot, SessionSummary } from '../models/SessionSnapshot.js';
import { SESSION_SNAPSHOT_SCHEMA_VERSION, extractSessionSummary } from '../models/SessionSnapshot.js';

/**
 * File-based session storage service
 */
export class SessionStorageService implements ISessionStorage {
  private readonly baseDir: string;

  /**
   * @param baseDir - Override base directory (default: ~/.agent-chatter/sessions)
   */
  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(os.homedir(), '.agent-chatter', 'sessions');
  }

  /**
   * Save a session snapshot to disk
   */
  async saveSession(teamId: string, snapshot: SessionSnapshot): Promise<void> {
    const teamDir = this.getTeamDir(teamId);
    await this.ensureDir(teamDir);

    // Filename: <timestamp>-<sessionId>.json
    const timestamp = Date.now();
    const filename = `${timestamp}-${snapshot.sessionId}.json`;
    const filePath = path.join(teamDir, filename);

    // Update timestamp before save
    const snapshotToSave: SessionSnapshot = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
    };

    // Write atomically (write to temp, then rename)
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(
      tempPath,
      JSON.stringify(snapshotToSave, null, 2),
      'utf-8'
    );
    await fs.promises.rename(tempPath, filePath);
  }

  /**
   * Load a specific session by ID
   */
  async loadSession(teamId: string, sessionId: string): Promise<SessionSnapshot | null> {
    const teamDir = this.getTeamDir(teamId);

    if (!fs.existsSync(teamDir)) {
      return null;
    }

    // Find file matching sessionId
    const files = await fs.promises.readdir(teamDir);
    const matchingFile = files.find(f =>
      f.includes(sessionId) && f.endsWith('.json') && !f.endsWith('.tmp')
    );

    if (!matchingFile) {
      return null;
    }

    const filePath = path.join(teamDir, matchingFile);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const rawData = JSON.parse(content);

      // Check schema version compatibility
      if (!this.isSchemaVersionCompatible(rawData.schemaVersion)) {
        console.warn(
          `Session ${sessionId} has incompatible schema version: ${rawData.schemaVersion}`
        );
        return null;
      }

      return rawData as SessionSnapshot;
    } catch (err) {
      // JSON parse error or validation error
      console.warn(`Failed to load session ${sessionId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Get the most recent session for a team
   */
  async getLatestSession(teamId: string): Promise<SessionSnapshot | null> {
    const teamDir = this.getTeamDir(teamId);

    if (!fs.existsSync(teamDir)) {
      return null;
    }

    const files = await fs.promises.readdir(teamDir);

    // Sort by timestamp prefix (descending = newest first)
    const jsonFiles = files
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .sort()
      .reverse();

    // Try files in order until we find a valid one
    for (const file of jsonFiles) {
      const filePath = path.join(teamDir, file);

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(content);

        if (this.isSchemaVersionCompatible(rawData.schemaVersion)) {
          return rawData as SessionSnapshot;
        }
        // Incompatible version, try next file
      } catch {
        // Corrupted file, try next
        continue;
      }
    }

    return null;
  }

  /**
   * List all sessions for a team (summaries only)
   */
  async listSessions(teamId: string): Promise<SessionSummary[]> {
    const teamDir = this.getTeamDir(teamId);

    if (!fs.existsSync(teamDir)) {
      return [];
    }

    const files = await fs.promises.readdir(teamDir);
    const summaries: SessionSummary[] = [];

    for (const file of files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))) {
      const filePath = path.join(teamDir, file);

      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const rawData = JSON.parse(content);

        // Skip incompatible versions
        if (!this.isSchemaVersionCompatible(rawData.schemaVersion)) {
          continue;
        }

        summaries.push(extractSessionSummary(rawData as SessionSnapshot));
      } catch {
        // Skip corrupted files silently
        continue;
      }
    }

    // Sort by updatedAt descending (newest first)
    return summaries.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Delete a session
   */
  async deleteSession(teamId: string, sessionId: string): Promise<void> {
    const teamDir = this.getTeamDir(teamId);

    if (!fs.existsSync(teamDir)) {
      return; // Nothing to delete
    }

    const files = await fs.promises.readdir(teamDir);
    const matchingFile = files.find(f =>
      f.includes(sessionId) && f.endsWith('.json')
    );

    if (matchingFile) {
      await fs.promises.unlink(path.join(teamDir, matchingFile));
    }
  }

  /**
   * Check if schema version is compatible with current version
   * Currently: exact match only
   * Future: semver comparison for backwards compatibility
   */
  private isSchemaVersionCompatible(version: string): boolean {
    return version === SESSION_SNAPSHOT_SCHEMA_VERSION;
  }

  /**
   * Get team directory path
   * Sanitizes teamId for filesystem safety
   */
  private getTeamDir(teamId: string): string {
    // Replace unsafe characters with underscores
    const safeTeamId = teamId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return path.join(this.baseDir, safeTeamId);
  }

  /**
   * Ensure directory exists (mkdir -p equivalent)
   */
  private async ensureDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }
}
