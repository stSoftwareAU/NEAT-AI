/**
 * Discovery Cache Eviction Module
 *
 * Issue #1701: Provides age-based and size-based eviction for the on-disk
 * discovery success and failure caches. Both caches store small JSON files
 * that accumulate indefinitely without eviction.
 *
 * Eviction strategy:
 * 1. Remove entries older than the configured TTL (age-based).
 * 2. If the entry count still exceeds the configured max, evict oldest
 *    entries until within limits (size-based, oldest-first).
 *
 * @module DiscoveryCacheEviction
 */

import { join } from "@std/path/join";
import { getLogger } from "../utils/Logger.ts";

/** Metadata about a single cached file used for eviction decisions. */
interface CacheFileInfo {
  path: string;
  /** Modified time in milliseconds since epoch. */
  mtimeMs: number;
}

/**
 * Statistics about a cache directory, used for periodic logging.
 */
export interface CacheStatistics {
  /** Total number of JSON entries in the cache. */
  entryCount: number;
  /** Total size of all JSON entries in bytes. */
  totalBytes: number;
  /** Number of entries evicted in the most recent prune operation. */
  evictedCount: number;
}

/**
 * Collects all `.json` files under a directory (one level of subdirectories).
 *
 * The directory structure is `{cacheDir}/{changeType}/{key}.json`.
 */
function collectCacheFiles(cacheDir: string): CacheFileInfo[] {
  const files: CacheFileInfo[] = [];
  try {
    for (const typeDir of Deno.readDirSync(cacheDir)) {
      if (!typeDir.isDirectory) continue;
      const typePath = join(cacheDir, typeDir.name);
      try {
        for (const entry of Deno.readDirSync(typePath)) {
          if (!entry.isFile || !entry.name.endsWith(".json")) continue;
          const filePath = join(typePath, entry.name);
          try {
            const stat = Deno.statSync(filePath);
            files.push({
              path: filePath,
              mtimeMs: stat.mtime?.getTime() ?? 0,
            });
          } catch {
            // Skip files we cannot stat (e.g. deleted between readDir and stat).
          }
        }
      } catch {
        // Skip subdirectories we cannot read.
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
  return files;
}

/**
 * Removes a file, ignoring `NotFound` errors.
 */
function removeFileSync(path: string): boolean {
  try {
    Deno.removeSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    getLogger().warn(
      `[DiscoveryCacheEviction] Failed to remove '${path}': ${error}`,
    );
    return false;
  }
}

/**
 * Prunes a cache directory by TTL and max entry count.
 *
 * @param cacheDir - Root cache directory (e.g. `discovery/success` or `discovery/failure`).
 * @param maxEntries - Maximum number of entries to retain.
 * @param ttlMs - Maximum age of entries in milliseconds.
 * @returns Statistics about the pruning operation.
 */
export function pruneCacheSync(
  cacheDir: string,
  maxEntries: number,
  ttlMs: number,
): CacheStatistics {
  const files = collectCacheFiles(cacheDir);
  const nowMs = Date.now();
  let evictedCount = 0;
  let totalBytes = 0;

  // Phase 1: TTL-based eviction — remove entries older than the threshold.
  const surviving: CacheFileInfo[] = [];
  for (const file of files) {
    const ageMs = nowMs - file.mtimeMs;
    if (ageMs > ttlMs) {
      if (removeFileSync(file.path)) {
        evictedCount++;
      }
    } else {
      surviving.push(file);
    }
  }

  // Phase 2: Size-based eviction — if still over limit, evict oldest first.
  if (surviving.length > maxEntries) {
    // Sort ascending by mtime (oldest first).
    surviving.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const excess = surviving.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      if (removeFileSync(surviving[i].path)) {
        evictedCount++;
      }
    }
    surviving.splice(0, excess);
  }

  // Compute total bytes for statistics.
  for (const file of surviving) {
    try {
      const stat = Deno.statSync(file.path);
      totalBytes += stat.size;
    } catch {
      // File may have been removed between phases.
    }
  }

  return {
    entryCount: surviving.length,
    totalBytes,
    evictedCount,
  };
}

/**
 * Prunes the obsolete (archived) directory using TTL-based eviction.
 *
 * @param obsoleteDir - The obsolete directory path.
 * @param ttlMs - Maximum age of obsolete entries in milliseconds.
 * @returns Number of obsolete entries removed.
 */
export function pruneObsoleteSync(
  obsoleteDir: string,
  ttlMs: number,
): number {
  const files = collectCacheFiles(obsoleteDir);
  const nowMs = Date.now();
  let evictedCount = 0;

  for (const file of files) {
    const ageMs = nowMs - file.mtimeMs;
    if (ageMs > ttlMs) {
      if (removeFileSync(file.path)) {
        evictedCount++;
      }
    }
  }

  return evictedCount;
}

/**
 * Collects statistics about a cache directory without performing eviction.
 *
 * @param cacheDir - Root cache directory.
 * @returns Statistics about the cache.
 */
export function getCacheStatisticsSync(cacheDir: string): CacheStatistics {
  const files = collectCacheFiles(cacheDir);
  let totalBytes = 0;

  for (const file of files) {
    try {
      const stat = Deno.statSync(file.path);
      totalBytes += stat.size;
    } catch {
      // Skip files we cannot stat.
    }
  }

  return {
    entryCount: files.length,
    totalBytes,
    evictedCount: 0,
  };
}

/**
 * Logs cache statistics if there are entries worth reporting.
 *
 * @param label - Human-readable label for the cache (e.g. "Success", "Failure").
 * @param stats - The statistics to log.
 */
export function logCacheStatistics(
  label: string,
  stats: CacheStatistics,
): void {
  if (stats.entryCount === 0 && stats.evictedCount === 0) return;

  const sizeMB = (stats.totalBytes / (1024 * 1024)).toFixed(2);
  const parts = [
    `[DiscoveryCache] ${label}: ${stats.entryCount} entries (${sizeMB} MB)`,
  ];
  if (stats.evictedCount > 0) {
    parts.push(`evicted ${stats.evictedCount}`);
  }

  getLogger().info(parts.join(", "));
}
