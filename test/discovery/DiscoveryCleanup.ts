/**
 * Tests for orphaned discovery temporary directory cleanup.
 *
 * Issue #1702: When a discovery process crashes or is killed, its temporary
 * directory (`.discovery/{creature-uuid}/`) may be left behind. These tests
 * verify that orphaned directories are detected and cleaned up correctly,
 * while active directories (with valid lock files) are preserved.
 */

import { assertEquals, assertGreater } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import {
  cleanOrphanedDiscoveryDirs,
  createDiscoveryLockFile,
  forceCleanAllDiscoveryDirs,
  isDirectoryOrphaned,
  removeDiscoveryLockFile,
} from "@discovery/DiscoveryCleanup.ts";

/** Helper to create a temporary base directory for tests. */
function makeTempBase(): string {
  return Deno.makeTempDirSync({ prefix: "discovery-cleanup-test-" });
}

/** Helper to create a fake discovery directory with a specific mtime. */
function createFakeDiscoveryDir(
  baseDir: string,
  name: string,
  ageMs?: number,
): string {
  const dir = `${baseDir}/${name}`;
  ensureDirSync(dir);
  // Write a dummy file so the directory is not empty
  Deno.writeTextFileSync(`${dir}/dummy.txt`, "test");
  if (ageMs !== undefined) {
    const pastTime = new Date(Date.now() - ageMs);
    Deno.utimeSync(dir, pastTime, pastTime);
  }
  return dir;
}

// ── Lock file tests ──────────────────────────────────────────────────

Deno.test("createDiscoveryLockFile writes a lock file with PID", () => {
  const baseDir = makeTempBase();
  const dir = `${baseDir}/creature-abc`;
  ensureDirSync(dir);
  try {
    createDiscoveryLockFile(dir);
    const lockPath = `${dir}/.discovery.lock`;
    const content = JSON.parse(Deno.readTextFileSync(lockPath));
    assertEquals(content.pid, Deno.pid);
    assertEquals(typeof content.startedAt, "string");
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("removeDiscoveryLockFile removes the lock file", () => {
  const baseDir = makeTempBase();
  const dir = `${baseDir}/creature-def`;
  ensureDirSync(dir);
  try {
    createDiscoveryLockFile(dir);
    removeDiscoveryLockFile(dir);
    let exists = true;
    try {
      Deno.statSync(`${dir}/.discovery.lock`);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("removeDiscoveryLockFile does not throw if lock file missing", () => {
  const baseDir = makeTempBase();
  const dir = `${baseDir}/creature-ghi`;
  ensureDirSync(dir);
  try {
    // Should not throw
    removeDiscoveryLockFile(dir);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

// ── Orphan detection tests ───────────────────────────────────────────

Deno.test("isDirectoryOrphaned returns true for directory without lock file", () => {
  const baseDir = makeTempBase();
  const dir = createFakeDiscoveryDir(baseDir, "no-lock");
  try {
    const result = isDirectoryOrphaned(dir);
    assertEquals(result, true);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("isDirectoryOrphaned returns false for directory with lock from current PID", () => {
  const baseDir = makeTempBase();
  const dir = createFakeDiscoveryDir(baseDir, "current-pid");
  try {
    createDiscoveryLockFile(dir);
    const result = isDirectoryOrphaned(dir);
    assertEquals(result, false);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("isDirectoryOrphaned returns true for directory with lock from non-existent PID", () => {
  const baseDir = makeTempBase();
  const dir = createFakeDiscoveryDir(baseDir, "dead-pid");
  try {
    // Write a lock file with a PID that almost certainly doesn't exist
    const lockPath = `${dir}/.discovery.lock`;
    const fakePid = 999999999;
    Deno.writeTextFileSync(
      lockPath,
      JSON.stringify({
        pid: fakePid,
        startedAt: new Date().toISOString(),
      }),
    );
    const result = isDirectoryOrphaned(dir);
    assertEquals(result, true);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("isDirectoryOrphaned returns true for directory with malformed lock file", () => {
  const baseDir = makeTempBase();
  const dir = createFakeDiscoveryDir(baseDir, "bad-lock");
  try {
    Deno.writeTextFileSync(`${dir}/.discovery.lock`, "not-json");
    const result = isDirectoryOrphaned(dir);
    assertEquals(result, true);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

// ── Cleanup tests ────────────────────────────────────────────────────

Deno.test("cleanOrphanedDiscoveryDirs removes old orphaned directories", () => {
  const baseDir = makeTempBase();
  try {
    // Create an old orphaned directory (48 hours old)
    createFakeDiscoveryDir(baseDir, "old-orphan", 48 * 60 * 60 * 1000);
    // Create a recent directory (1 hour old - should not be removed with 24h threshold)
    createFakeDiscoveryDir(baseDir, "recent-dir", 1 * 60 * 60 * 1000);

    const removed = cleanOrphanedDiscoveryDirs(baseDir, {
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    assertEquals(removed.length, 1);
    assertEquals(removed[0], "old-orphan");

    // Verify old directory was removed
    let oldExists = true;
    try {
      Deno.statSync(`${baseDir}/old-orphan`);
    } catch {
      oldExists = false;
    }
    assertEquals(oldExists, false);

    // Verify recent directory still exists
    const recentStat = Deno.statSync(`${baseDir}/recent-dir`);
    assertEquals(recentStat.isDirectory, true);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("cleanOrphanedDiscoveryDirs preserves directories with active lock files", () => {
  const baseDir = makeTempBase();
  try {
    // Create an old directory with a valid lock file from the current process
    const dir = createFakeDiscoveryDir(
      baseDir,
      "active-old",
      48 * 60 * 60 * 1000,
    );
    createDiscoveryLockFile(dir);

    const removed = cleanOrphanedDiscoveryDirs(baseDir, {
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    assertEquals(removed.length, 0);

    // Verify the directory still exists
    const stat = Deno.statSync(dir);
    assertEquals(stat.isDirectory, true);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("cleanOrphanedDiscoveryDirs uses default 24-hour threshold", () => {
  const baseDir = makeTempBase();
  try {
    // Create a very old orphaned directory (72 hours)
    createFakeDiscoveryDir(baseDir, "very-old", 72 * 60 * 60 * 1000);

    const removed = cleanOrphanedDiscoveryDirs(baseDir);
    assertEquals(removed.length, 1);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("cleanOrphanedDiscoveryDirs handles non-existent base directory", () => {
  const removed = cleanOrphanedDiscoveryDirs(
    "/tmp/does-not-exist-cleanup-test",
  );
  assertEquals(removed.length, 0);
});

Deno.test("cleanOrphanedDiscoveryDirs skips non-directory entries", () => {
  const baseDir = makeTempBase();
  try {
    // Create a regular file in the base directory (not a subdirectory)
    Deno.writeTextFileSync(`${baseDir}/some-file.txt`, "hello");
    // Create an old orphaned directory
    createFakeDiscoveryDir(baseDir, "orphan", 48 * 60 * 60 * 1000);

    const removed = cleanOrphanedDiscoveryDirs(baseDir, {
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    // Only the directory should be removed, not the file
    assertEquals(removed.length, 1);
    assertEquals(removed[0], "orphan");
    // File should still exist
    const fileStat = Deno.statSync(`${baseDir}/some-file.txt`);
    assertEquals(fileStat.isFile, true);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

// ── Force cleanup tests ──────────────────────────────────────────────

Deno.test("forceCleanAllDiscoveryDirs removes all subdirectories", () => {
  const baseDir = makeTempBase();
  try {
    createFakeDiscoveryDir(baseDir, "dir-1");
    createFakeDiscoveryDir(baseDir, "dir-2");
    const dir3 = createFakeDiscoveryDir(baseDir, "dir-3");
    // Even directories with lock files are removed in force mode
    createDiscoveryLockFile(dir3);

    const removed = forceCleanAllDiscoveryDirs(baseDir);
    assertGreater(removed.length, 0);
    assertEquals(removed.length, 3);

    // Verify all directories were removed
    const remaining = Array.from(Deno.readDirSync(baseDir));
    assertEquals(remaining.length, 0);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("forceCleanAllDiscoveryDirs handles non-existent directory", () => {
  const removed = forceCleanAllDiscoveryDirs(
    "/tmp/does-not-exist-force-test",
  );
  assertEquals(removed.length, 0);
});

Deno.test("forceCleanAllDiscoveryDirs throws on empty path", () => {
  let threw = false;
  try {
    forceCleanAllDiscoveryDirs("");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ── Configurable threshold tests ─────────────────────────────────────

Deno.test("cleanOrphanedDiscoveryDirs respects custom age threshold", () => {
  const baseDir = makeTempBase();
  try {
    // Create a directory that is 2 hours old
    createFakeDiscoveryDir(baseDir, "two-hours-old", 2 * 60 * 60 * 1000);

    // With a 1-hour threshold, it should be removed
    const removed1h = cleanOrphanedDiscoveryDirs(baseDir, {
      maxAgeMs: 1 * 60 * 60 * 1000,
    });
    assertEquals(removed1h.length, 1);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});

Deno.test("cleanOrphanedDiscoveryDirs with very high threshold removes nothing", () => {
  const baseDir = makeTempBase();
  try {
    createFakeDiscoveryDir(baseDir, "recent", 1 * 60 * 60 * 1000);

    // With a 999-day threshold, nothing should be removed
    const removed = cleanOrphanedDiscoveryDirs(baseDir, {
      maxAgeMs: 999 * 24 * 60 * 60 * 1000,
    });
    assertEquals(removed.length, 0);
  } finally {
    Deno.removeSync(baseDir, { recursive: true });
  }
});
