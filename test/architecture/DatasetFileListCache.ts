/**
 * Tests for DatasetFileListCache (Issue #2260).
 *
 * Verifies that the cache correctly returns file lists and avoids
 * repeated directory scans.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { DatasetFileListCache } from "@architecture/DatasetFileListCache.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";

/** Helper: create a small binary dataset directory with known files. */
function createTestDataDir(recordCount: number): string {
  const dataSet: DataRecordInterface[] = [];
  for (let i = 0; i < recordCount; i++) {
    dataSet.push({
      input: new Float32Array([i * 0.1, i * 0.2]),
      output: new Float32Array([i * 0.3]),
    });
  }
  return makeDataDir(dataSet, Math.max(1, Math.ceil(recordCount / 3)));
}

Deno.test({
  name: "Issue #2260: DatasetFileListCache returns correct files",
  fn() {
    const dataDir = createTestDataDir(9);
    try {
      const cache = new DatasetFileListCache();
      const files = cache.getFiles(dataDir);

      // Should find at least one .bin file
      assertNotEquals(files.length, 0, "Expected at least one .bin file");

      // All files should end with .bin
      for (const f of files) {
        assertEquals(f.endsWith(".bin"), true, `Expected .bin file: ${f}`);
      }

      // Files should be sorted (deterministic order)
      const sorted = [...files].sort();
      assertEquals(files, sorted, "Files should be in sorted order");
    } finally {
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "Issue #2260: DatasetFileListCache returns same reference on repeated calls",
  fn() {
    const dataDir = createTestDataDir(6);
    try {
      const cache = new DatasetFileListCache();
      const files1 = cache.getFiles(dataDir);
      const files2 = cache.getFiles(dataDir);

      // Should return the exact same array reference (cached)
      assertEquals(
        files1 === files2,
        true,
        "Expected same array reference from cache",
      );
    } finally {
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "Issue #2260: DatasetFileListCache.clear forces re-scan",
  fn() {
    const dataDir = createTestDataDir(6);
    try {
      const cache = new DatasetFileListCache();
      const files1 = cache.getFiles(dataDir);
      cache.clear();
      const files2 = cache.getFiles(dataDir);

      // After clear, should get a new array (different reference)
      assertEquals(
        files1 === files2,
        false,
        "Expected different array reference after clear",
      );

      // But same contents
      assertEquals(files1, files2, "File contents should match after re-scan");
    } finally {
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "Issue #2260: DatasetFileListCache handles directory change",
  fn() {
    const dataDir1 = createTestDataDir(3);
    const dataDir2 = createTestDataDir(6);
    try {
      const cache = new DatasetFileListCache();
      const files1 = cache.getFiles(dataDir1);
      const files2 = cache.getFiles(dataDir2);

      // Different directories should give different results
      assertNotEquals(
        files1,
        files2,
        "Expected different file lists for different directories",
      );
    } finally {
      Deno.removeSync(dataDir1, { recursive: true });
      Deno.removeSync(dataDir2, { recursive: true });
    }
  },
});
