/**
 * Disk space monitoring utilities for discovery.
 *
 * Issue #1703: Provides pre-flight and runtime disk space checks
 * so that discovery can warn or abort gracefully when disk space
 * is insufficient, rather than failing with opaque I/O errors.
 */

import { getLogger } from "../utils/Logger.ts";

/** Result of a disk space check. */
export interface DiskSpaceCheckResult {
  /** Whether the check passed (sufficient space available). */
  ok: boolean;

  /** Available free disk space in megabytes, or undefined if unavailable. */
  availableMB?: number;

  /** The threshold that was checked against, in megabytes. */
  thresholdMB: number;

  /** Human-readable message describing the result. */
  message: string;
}

/** Result of a directory size measurement. */
export interface DirectorySizeResult {
  /** Total size in bytes. */
  totalBytes: number;

  /** Total size in megabytes. */
  totalMB: number;

  /** Number of files counted. */
  fileCount: number;
}

/**
 * Gets the available free disk space for the given path in megabytes.
 *
 * Uses the POSIX `df` command to query filesystem statistics.
 * Falls back to undefined if the command is not available or fails.
 * Works cross-platform on macOS, Linux, and other POSIX systems.
 */
export function getAvailableDiskSpaceMB(path: string): number | undefined {
  try {
    // Resolve to an existing path for df to work with
    let targetPath = path;
    try {
      Deno.statSync(targetPath);
    } catch {
      // Path doesn't exist — try parent directory or fall back to "."
      targetPath = ".";
    }

    // Use `df -k` for POSIX-compatible output in 1K blocks
    const cmd = new Deno.Command("df", {
      args: ["-k", targetPath],
      stdout: "piped",
      stderr: "null",
    });
    const output = cmd.outputSync();
    if (!output.success) return undefined;

    const text = new TextDecoder().decode(output.stdout);
    const lines = text.trim().split("\n");
    if (lines.length < 2) return undefined;

    // Parse the last line (the actual filesystem data)
    // df -k output: Filesystem 1K-blocks Used Available Use% Mounted
    const dataLine = lines[lines.length - 1];
    const fields = dataLine.split(/\s+/);

    // Available is typically the 4th field (index 3)
    const availableKB = parseInt(fields[3], 10);
    if (isNaN(availableKB)) return undefined;

    return availableKB / 1024; // Convert KB to MB
  } catch {
    return undefined;
  }
}

/**
 * Checks whether there is sufficient disk space for discovery operations.
 *
 * @param path - The path to check disk space for (typically the discovery base directory).
 * @param thresholdMB - Minimum required free disk space in megabytes.
 * @returns A DiskSpaceCheckResult indicating whether the check passed.
 */
export function checkDiskSpace(
  path: string,
  thresholdMB: number,
): DiskSpaceCheckResult {
  const availableMB = getAvailableDiskSpaceMB(path);

  if (availableMB === undefined) {
    return {
      ok: true,
      availableMB: undefined,
      thresholdMB,
      message:
        `Disk space check skipped: unable to determine available space for '${path}'.`,
    };
  }

  if (availableMB < thresholdMB) {
    return {
      ok: false,
      availableMB,
      thresholdMB,
      message: `Insufficient disk space: ${
        availableMB.toFixed(1)
      } MB available, ${thresholdMB} MB required.`,
    };
  }

  return {
    ok: true,
    availableMB,
    thresholdMB,
    message: `Disk space check passed: ${
      availableMB.toFixed(1)
    } MB available (threshold: ${thresholdMB} MB).`,
  };
}

/**
 * Estimates the disk space required for a discovery recording phase.
 *
 * @param estimatedBytesPerSample - Estimated bytes per recording sample.
 * @param sampleCount - Expected number of samples to record.
 * @param safetyMultiplier - Multiplier to account for overhead (default: 2.0).
 * @returns Estimated required disk space in megabytes.
 */
export function estimateRequiredDiskSpaceMB(
  estimatedBytesPerSample: number,
  sampleCount: number,
  safetyMultiplier = 2.0,
): number {
  const rawBytes = estimatedBytesPerSample * sampleCount;
  return (rawBytes * safetyMultiplier) / (1024 * 1024);
}

/**
 * Performs a pre-flight disk space check before starting discovery.
 *
 * Checks against both the warning threshold (logs a warning) and
 * the critical threshold (returns false to abort discovery).
 *
 * @param path - The path to check disk space for.
 * @param minFreeDiskMB - Warning threshold in megabytes.
 * @param criticalFreeDiskMB - Critical threshold in megabytes (abort if below).
 * @param estimatedRequiredMB - Optional estimated required space in megabytes.
 * @returns true if discovery should proceed, false if it should abort.
 */
export function preFlightDiskSpaceCheck(
  path: string,
  minFreeDiskMB: number,
  criticalFreeDiskMB: number,
  estimatedRequiredMB?: number,
): boolean {
  const logger = getLogger();
  const availableMB = getAvailableDiskSpaceMB(path);

  if (availableMB === undefined) {
    logger.debug(
      `[DiskSpace] Unable to determine available disk space for '${path}'; proceeding without check.`,
    );
    return true;
  }

  // Log estimated vs available
  if (estimatedRequiredMB !== undefined) {
    logger.info(
      `[DiskSpace] Discovery disk usage estimate: ${
        estimatedRequiredMB.toFixed(1)
      } MB required, ${availableMB.toFixed(1)} MB available.`,
    );
  }

  // Critical check — abort discovery
  if (availableMB < criticalFreeDiskMB) {
    logger.error(
      `[DiskSpace] CRITICAL: Only ${
        availableMB.toFixed(1)
      } MB free disk space available ` +
        `(critical threshold: ${criticalFreeDiskMB} MB). Discovery will be skipped to prevent I/O failures.`,
    );
    return false;
  }

  // Warning check — log but continue
  if (availableMB < minFreeDiskMB) {
    logger.warn(
      `[DiskSpace] Low disk space warning: ${
        availableMB.toFixed(1)
      } MB available ` +
        `(warning threshold: ${minFreeDiskMB} MB). Discovery may fail if disk fills up.`,
    );
  }

  // Estimated space check — warn if tight
  if (
    estimatedRequiredMB !== undefined && availableMB < estimatedRequiredMB * 1.5
  ) {
    logger.warn(
      `[DiskSpace] Available disk space (${
        availableMB.toFixed(1)
      } MB) is close to ` +
        `estimated requirement (${
          estimatedRequiredMB.toFixed(1)
        } MB). Consider freeing disk space.`,
    );
  }

  return true;
}

/**
 * Measures the total size of a directory and its contents.
 *
 * @param dirPath - The directory to measure.
 * @returns DirectorySizeResult with total bytes, MB, and file count.
 */
export function measureDirectorySize(dirPath: string): DirectorySizeResult {
  let totalBytes = 0;
  let fileCount = 0;

  try {
    for (const entry of Deno.readDirSync(dirPath)) {
      const entryPath = `${dirPath}/${entry.name}`;
      try {
        if (entry.isFile) {
          const stat = Deno.statSync(entryPath);
          totalBytes += stat.size;
          fileCount++;
        } else if (entry.isDirectory) {
          const subResult = measureDirectorySize(entryPath);
          totalBytes += subResult.totalBytes;
          fileCount += subResult.fileCount;
        }
      } catch {
        // Skip entries we cannot stat
      }
    }
  } catch {
    // Directory doesn't exist or is unreadable
  }

  return {
    totalBytes,
    totalMB: totalBytes / (1024 * 1024),
    fileCount,
  };
}

/**
 * Logs the disk usage of a discovery directory at a key milestone.
 *
 * @param dirPath - The directory to report on.
 * @param milestone - A label for the current milestone (e.g., "start", "after recording", "after cleanup").
 */
export function logDiscoveryDiskUsage(
  dirPath: string,
  milestone: string,
): void {
  const logger = getLogger();
  const sizeResult = measureDirectorySize(dirPath);

  if (sizeResult.fileCount === 0 && sizeResult.totalBytes === 0) {
    logger.debug(
      `[DiskSpace] Discovery directory usage at ${milestone}: empty or does not exist (${dirPath}).`,
    );
    return;
  }

  logger.info(
    `[DiskSpace] Discovery directory usage at ${milestone}: ` +
      `${sizeResult.totalMB.toFixed(2)} MB across ${sizeResult.fileCount} file${
        sizeResult.fileCount === 1 ? "" : "s"
      } (${dirPath}).`,
  );
}
