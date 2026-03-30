/**
 * Tests for disk space monitoring utilities.
 *
 * Issue #1703: Verifies that disk space checks, directory size measurement,
 * estimation functions, and pre-flight checks behave correctly.
 */

import {
  assert,
  assertEquals,
  assertGreater,
  assertGreaterOrEqual,
} from "@std/assert";
import { ensureDirSync } from "@std/fs";
import {
  checkDiskSpace,
  estimateRequiredDiskSpaceMB,
  getAvailableDiskSpaceMB,
  logDiscoveryDiskUsage,
  measureDirectorySize,
  preFlightDiskSpaceCheck,
} from "@discovery/DiskSpaceMonitor.ts";

// ── getAvailableDiskSpaceMB ─────────────────────────────────────────

Deno.test("getAvailableDiskSpaceMB returns a positive number for existing path", () => {
  const result = getAvailableDiskSpaceMB(".");
  // On most systems this should return a value; skip assertion if undefined
  // (e.g., platform without statfs support)
  if (result !== undefined) {
    assertGreater(result, 0, "Available disk space should be positive");
  }
});

Deno.test("getAvailableDiskSpaceMB falls back to cwd for non-existent path", () => {
  const result = getAvailableDiskSpaceMB(
    "/non-existent-path-that-does-not-exist-12345",
  );
  // Implementation falls back to "." when path doesn't exist,
  // so it returns a value on systems where df is available
  if (result !== undefined) {
    assertGreater(result, 0);
  }
});

// ── checkDiskSpace ──────────────────────────────────────────────────

Deno.test("checkDiskSpace passes when threshold is very low", () => {
  const result = checkDiskSpace(".", 0.001);
  assert(result.ok, "Should pass with a very low threshold");
  assertEquals(result.thresholdMB, 0.001);
});

Deno.test("checkDiskSpace fails when threshold is impossibly high", () => {
  const result = checkDiskSpace(".", 999_999_999);
  // If disk space is determinable, it should fail with such a high threshold
  if (result.availableMB !== undefined) {
    assertEquals(result.ok, false);
    assert(
      result.message.includes("Insufficient"),
      "Message should indicate insufficient space",
    );
  }
});

Deno.test("checkDiskSpace includes availableMB when determinable", () => {
  const result = checkDiskSpace(".", 1);
  if (result.availableMB !== undefined) {
    assertGreater(result.availableMB, 0);
  }
});

Deno.test("checkDiskSpace falls back to cwd for non-existent path", () => {
  const result = checkDiskSpace(
    "/non-existent-path-that-does-not-exist-12345",
    0.001,
  );
  // The disk space function falls back to cwd for non-existent paths,
  // so this should still return a meaningful result
  assert(
    result.ok,
    "Should pass with a low threshold even for non-existent path",
  );
});

// ── estimateRequiredDiskSpaceMB ─────────────────────────────────────

Deno.test("estimateRequiredDiskSpaceMB calculates correctly with default multiplier", () => {
  // 1000 bytes/sample * 1000 samples = 1,000,000 bytes raw
  // With 2x safety multiplier: 2,000,000 bytes = ~1.907 MB
  const result = estimateRequiredDiskSpaceMB(1000, 1000);
  const expected = (1000 * 1000 * 2.0) / (1024 * 1024);
  assertEquals(result, expected);
});

Deno.test("estimateRequiredDiskSpaceMB uses custom safety multiplier", () => {
  const result = estimateRequiredDiskSpaceMB(500, 2000, 3.0);
  const expected = (500 * 2000 * 3.0) / (1024 * 1024);
  assertEquals(result, expected);
});

Deno.test("estimateRequiredDiskSpaceMB returns zero for zero samples", () => {
  const result = estimateRequiredDiskSpaceMB(1000, 0);
  assertEquals(result, 0);
});

// ── measureDirectorySize ────────────────────────────────────────────

Deno.test("measureDirectorySize returns zero for non-existent directory", () => {
  const result = measureDirectorySize(
    "/non-existent-path-that-does-not-exist-12345",
  );
  assertEquals(result.totalBytes, 0);
  assertEquals(result.fileCount, 0);
  assertEquals(result.totalMB, 0);
});

Deno.test("measureDirectorySize measures files correctly", () => {
  const tempDir = Deno.makeTempDirSync({ prefix: "disk-space-test-" });
  try {
    // Write some files with known content
    Deno.writeTextFileSync(`${tempDir}/file1.txt`, "hello"); // 5 bytes
    Deno.writeTextFileSync(`${tempDir}/file2.txt`, "world!"); // 6 bytes

    const result = measureDirectorySize(tempDir);
    assertGreaterOrEqual(
      result.totalBytes,
      11,
      "Should count at least the file content bytes",
    );
    assertEquals(result.fileCount, 2);
    assertGreater(result.totalMB, 0);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("measureDirectorySize recurses into subdirectories", () => {
  const tempDir = Deno.makeTempDirSync({ prefix: "disk-space-test-" });
  try {
    const subDir = `${tempDir}/subdir`;
    ensureDirSync(subDir);
    Deno.writeTextFileSync(`${tempDir}/root.txt`, "root");
    Deno.writeTextFileSync(`${subDir}/nested.txt`, "nested");

    const result = measureDirectorySize(tempDir);
    assertEquals(result.fileCount, 2);
    assertGreaterOrEqual(result.totalBytes, 10); // "root" + "nested"
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

// ── preFlightDiskSpaceCheck ─────────────────────────────────────────

Deno.test("preFlightDiskSpaceCheck returns true when space is sufficient", () => {
  // Use very low thresholds to ensure the check passes
  const result = preFlightDiskSpaceCheck(".", 0.001, 0.0001);
  assert(result, "Should return true when disk space is sufficient");
});

Deno.test("preFlightDiskSpaceCheck returns false when critical threshold is impossibly high", () => {
  const available = getAvailableDiskSpaceMB(".");
  if (available === undefined) {
    // Cannot test on this platform — skip
    return;
  }
  // Use a critical threshold higher than available space
  const result = preFlightDiskSpaceCheck(".", 999_999_999, 999_999_999);
  assertEquals(
    result,
    false,
    "Should return false when space is critically low",
  );
});

Deno.test("preFlightDiskSpaceCheck returns true for non-existent path", () => {
  // When space cannot be determined, should proceed (graceful degradation)
  const result = preFlightDiskSpaceCheck(
    "/non-existent-path-12345",
    500,
    100,
  );
  assert(result, "Should return true when space cannot be determined");
});

Deno.test("preFlightDiskSpaceCheck accepts optional estimated required space", () => {
  const result = preFlightDiskSpaceCheck(".", 0.001, 0.0001, 0.001);
  assert(result, "Should return true with small estimated requirement");
});

// ── logDiscoveryDiskUsage ───────────────────────────────────────────

Deno.test("logDiscoveryDiskUsage does not throw for non-existent directory", () => {
  // Should handle gracefully without throwing
  logDiscoveryDiskUsage("/non-existent-path-12345", "test milestone");
});

Deno.test("logDiscoveryDiskUsage does not throw for existing directory", () => {
  const tempDir = Deno.makeTempDirSync({ prefix: "disk-space-log-test-" });
  try {
    Deno.writeTextFileSync(`${tempDir}/test.txt`, "data");
    logDiscoveryDiskUsage(tempDir, "test milestone");
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});
