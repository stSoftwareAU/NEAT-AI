/**
 * Orphaned discovery temporary directory cleanup.
 *
 * Issue #1702: When a discovery process crashes, is killed, or times out,
 * the temporary directory (`.discovery/{creature-uuid}/`) may be left behind.
 * This module provides utilities to detect and clean up stale directories.
 *
 * Lock files (`.discovery.lock`) are created in each temp directory to
 * distinguish between active and orphaned directories.
 */

import { getLogger } from "@utils/Logger.ts";

/** Name of the lock file placed in each discovery temp directory. */
const LOCK_FILE_NAME = ".discovery.lock";

/** Default maximum age (in milliseconds) before a directory is considered orphaned. 24 hours. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Shape of the lock file content. */
interface DiscoveryLockData {
  pid: number;
  startedAt: string;
}

/**
 * Creates a lock file in the given discovery temp directory.
 * The lock file records the current process PID and start time,
 * allowing cleanup logic to distinguish active from orphaned directories.
 */
export function createDiscoveryLockFile(dir: string): void {
  const lockPath = `${dir}/${LOCK_FILE_NAME}`;
  const data: DiscoveryLockData = {
    pid: Deno.pid,
    startedAt: Temporal.Now.instant().toString(),
  };
  Deno.writeTextFileSync(lockPath, JSON.stringify(data));
}

/**
 * Removes the lock file from a discovery temp directory.
 * Does not throw if the lock file does not exist.
 */
export function removeDiscoveryLockFile(dir: string): void {
  const lockPath = `${dir}/${LOCK_FILE_NAME}`;
  try {
    Deno.removeSync(lockPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/**
 * Checks whether a process with the given PID is currently running.
 * Uses `Deno.kill(pid, null)` — sending signal 0 checks existence without
 * actually sending a signal.
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 checks if the process exists without killing it
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/**
 * Determines whether a discovery temp directory is orphaned.
 *
 * A directory is considered orphaned if:
 * - It has no lock file (process crashed before writing one, or very old directory)
 * - Its lock file is malformed
 * - The PID in its lock file does not correspond to a running process
 *
 * A directory is NOT orphaned if its lock file references a currently running process.
 */
export function isDirectoryOrphaned(dir: string): boolean {
  const lockPath = `${dir}/${LOCK_FILE_NAME}`;
  let lockContent: string;
  try {
    lockContent = Deno.readTextFileSync(lockPath);
  } catch {
    // No lock file — directory is orphaned
    return true;
  }

  let data: DiscoveryLockData;
  try {
    data = JSON.parse(lockContent) as DiscoveryLockData;
  } catch {
    // Malformed lock file — treat as orphaned
    return true;
  }

  if (typeof data.pid !== "number" || !Number.isInteger(data.pid)) {
    return true;
  }

  // If the lock file was created by the current process, it's active
  if (data.pid === Deno.pid) {
    return false;
  }

  // Check if the process that created the lock is still running
  return !isProcessRunning(data.pid);
}

/** Options for orphaned directory cleanup. */
export interface CleanupOptions {
  /**
   * Maximum age in milliseconds before an orphaned directory is removed.
   * Defaults to 24 hours (86,400,000 ms).
   */
  maxAgeMs?: number;
}

/**
 * Scans the discovery base directory for orphaned temp directories and
 * removes any that are both orphaned and older than the configured threshold.
 *
 * @param baseDir - The discovery base directory (e.g., `.discovery`).
 * @param options - Optional configuration for the cleanup threshold.
 * @returns Array of directory names that were removed.
 */
export function cleanOrphanedDiscoveryDirs(
  baseDir: string,
  options?: CleanupOptions,
): string[] {
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const removed: string[] = [];
  const now = Date.now();

  let entries: Deno.DirEntry[];
  try {
    entries = Array.from(Deno.readDirSync(baseDir));
  } catch {
    // Base directory doesn't exist — nothing to clean
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }

    const dirPath = `${baseDir}/${entry.name}`;
    let stat: Deno.FileInfo;
    try {
      stat = Deno.statSync(dirPath);
    } catch {
      continue;
    }

    // Check age using modification time
    const mtime = stat.mtime?.getTime();
    if (mtime === undefined) {
      continue;
    }

    const age = now - mtime;
    if (age < maxAgeMs) {
      continue;
    }

    // Check if the directory is orphaned
    if (!isDirectoryOrphaned(dirPath)) {
      continue;
    }

    // Remove the orphaned directory
    try {
      Deno.removeSync(dirPath, { recursive: true });
      removed.push(entry.name);
      getLogger().info(
        `[DiscoveryCleanup] Removed orphaned discovery directory: ${entry.name} (age: ${
          Math.round(age / (60 * 60 * 1000))
        }h)`,
      );
    } catch (error) {
      getLogger().warn(
        `[DiscoveryCleanup] Failed to remove orphaned directory ${entry.name}: ${error}`,
      );
    }
  }

  if (removed.length > 0) {
    getLogger().info(
      `[DiscoveryCleanup] Cleaned up ${removed.length} orphaned discovery director${
        removed.length === 1 ? "y" : "ies"
      }.`,
    );
  }

  return removed;
}

/**
 * Force-removes ALL subdirectories in the discovery base directory,
 * regardless of lock files or age. Useful for emergency disk space recovery.
 *
 * @param baseDir - The discovery base directory (e.g., `.discovery`).
 * @returns Array of directory names that were removed.
 * @throws Error if baseDir is empty.
 */
export function forceCleanAllDiscoveryDirs(baseDir: string): string[] {
  if (!baseDir || baseDir.trim().length === 0) {
    throw new Error(
      "Base directory path must not be empty for force cleanup.",
    );
  }

  const removed: string[] = [];

  let entries: Deno.DirEntry[];
  try {
    entries = Array.from(Deno.readDirSync(baseDir));
  } catch {
    // Directory doesn't exist — nothing to clean
    return removed;
  }

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }

    const dirPath = `${baseDir}/${entry.name}`;
    try {
      Deno.removeSync(dirPath, { recursive: true });
      removed.push(entry.name);
    } catch (error) {
      getLogger().warn(
        `[DiscoveryCleanup] Failed to force-remove directory ${entry.name}: ${error}`,
      );
    }
  }

  if (removed.length > 0) {
    getLogger().info(
      `[DiscoveryCleanup] Force-cleaned ${removed.length} discovery director${
        removed.length === 1 ? "y" : "ies"
      }.`,
    );
  }

  return removed;
}
