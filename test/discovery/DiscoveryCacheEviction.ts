/**
 * Tests for discovery cache eviction behaviour (Issue #1701).
 *
 * Verifies TTL-based eviction, size-based eviction, obsolete directory
 * cleanup, and cache statistics collection.
 */

import { assertEquals, assertGreater } from "@std/assert";
import { join } from "@std/path/join";
import {
  getCacheStatisticsSync,
  logCacheStatistics,
  pruneCacheSync,
  pruneObsoleteSync,
} from "@discovery/DiscoveryCacheEviction.ts";

/** Helper to write a fake cache entry file. */
function writeCacheEntry(
  cacheDir: string,
  changeType: string,
  key: string,
  content?: string,
): string {
  const dir = join(cacheDir, changeType);
  Deno.mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${key}.json`);
  Deno.writeTextFileSync(
    filePath,
    content ??
      JSON.stringify({ key, changeType, timestamp: new Date().toISOString() }),
  );
  return filePath;
}

/** Helper to set a file's mtime to a specific age in ms. */
function setFileAge(filePath: string, ageMs: number): void {
  const now = new Date();
  const past = new Date(now.getTime() - ageMs);
  Deno.utimeSync(filePath, now, past);
}

Deno.test("pruneCacheSync evicts entries older than TTL", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-eviction-ttl-",
  });

  try {
    // Create 3 entries: 2 old (beyond TTL) and 1 recent.
    const old1 = writeCacheEntry(cacheDir, "add-synapses", "old-entry-1");
    const old2 = writeCacheEntry(cacheDir, "add-neurons", "old-entry-2");
    const _recent = writeCacheEntry(cacheDir, "add-synapses", "recent-entry");

    // Age the old entries beyond a 1-day TTL.
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    setFileAge(old1, twoDaysMs);
    setFileAge(old2, twoDaysMs);

    const oneDayMs = 1 * 24 * 60 * 60 * 1000;
    const stats = pruneCacheSync(cacheDir, 10_000, oneDayMs);

    assertEquals(stats.evictedCount, 2, "Should evict 2 old entries");
    assertEquals(stats.entryCount, 1, "Should retain 1 recent entry");
    assertGreater(stats.totalBytes, 0, "Surviving entry should have size");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("pruneCacheSync evicts oldest when exceeding max entries", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-eviction-max-",
  });

  try {
    // Create 5 entries, all within TTL.
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const path = writeCacheEntry(cacheDir, "type-a", `entry-${i}`);
      // Stagger ages so oldest can be determined.
      setFileAge(path, (5 - i) * 60 * 1000); // oldest first
      paths.push(path);
    }

    // Set maxEntries to 3 (should evict 2 oldest).
    const largeTTL = 365 * 24 * 60 * 60 * 1000; // 1 year
    const stats = pruneCacheSync(cacheDir, 3, largeTTL);

    assertEquals(stats.evictedCount, 2, "Should evict 2 excess entries");
    assertEquals(stats.entryCount, 3, "Should retain 3 entries");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("pruneCacheSync handles empty or missing directory", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-eviction-empty-",
  });

  try {
    // Empty directory.
    const stats = pruneCacheSync(cacheDir, 100, 86_400_000);
    assertEquals(stats.entryCount, 0);
    assertEquals(stats.evictedCount, 0);
    assertEquals(stats.totalBytes, 0);
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }

  // Non-existent directory.
  const missingStats = pruneCacheSync(
    "/tmp/non-existent-cache-dir-12345",
    100,
    86_400_000,
  );
  assertEquals(missingStats.entryCount, 0);
  assertEquals(missingStats.evictedCount, 0);
});

Deno.test("pruneObsoleteSync removes old archived entries", () => {
  const obsoleteDir = Deno.makeTempDirSync({
    prefix: "neat-ai-eviction-obsolete-",
  });

  try {
    const old = writeCacheEntry(obsoleteDir, "add-synapses", "archived-old");
    const _recent = writeCacheEntry(
      obsoleteDir,
      "add-synapses",
      "archived-recent",
    );

    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    setFileAge(old, fiveDaysMs);

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const evicted = pruneObsoleteSync(obsoleteDir, threeDaysMs);

    assertEquals(evicted, 1, "Should evict 1 old archived entry");

    // Verify recent entry still exists.
    const remaining = Array.from(
      Deno.readDirSync(join(obsoleteDir, "add-synapses")),
    ).filter((e) => e.isFile && e.name.endsWith(".json"));
    assertEquals(remaining.length, 1, "Should retain 1 recent archived entry");
  } finally {
    Deno.removeSync(obsoleteDir, { recursive: true });
  }
});

Deno.test("pruneObsoleteSync handles missing directory", () => {
  const evicted = pruneObsoleteSync(
    "/tmp/non-existent-obsolete-12345",
    86_400_000,
  );
  assertEquals(evicted, 0);
});

Deno.test("getCacheStatisticsSync returns accurate counts", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-eviction-stats-",
  });

  try {
    writeCacheEntry(cacheDir, "type-a", "entry-1");
    writeCacheEntry(cacheDir, "type-a", "entry-2");
    writeCacheEntry(cacheDir, "type-b", "entry-3");

    const stats = getCacheStatisticsSync(cacheDir);

    assertEquals(stats.entryCount, 3, "Should count 3 entries across subdirs");
    assertGreater(stats.totalBytes, 0, "Total bytes should be positive");
    assertEquals(stats.evictedCount, 0, "No eviction performed");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});

Deno.test("logCacheStatistics does not throw on empty stats", () => {
  // Should not throw for zero entries.
  logCacheStatistics("Test", { entryCount: 0, totalBytes: 0, evictedCount: 0 });

  // Should not throw for non-zero entries.
  logCacheStatistics("Test", {
    entryCount: 5,
    totalBytes: 1024,
    evictedCount: 2,
  });
});

Deno.test("pruneCacheSync combines TTL and size eviction", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-eviction-combined-",
  });

  try {
    // Create 4 entries: 1 old (TTL), 3 recent.
    const old = writeCacheEntry(cacheDir, "type-a", "old-entry");
    setFileAge(old, 2 * 24 * 60 * 60 * 1000);

    for (let i = 0; i < 3; i++) {
      const path = writeCacheEntry(cacheDir, "type-a", `recent-${i}`);
      // Stagger slightly so oldest-first ordering works.
      setFileAge(path, (3 - i) * 1000);
    }

    // TTL removes 1, then maxEntries=2 removes 1 more (oldest remaining).
    const oneDayMs = 24 * 60 * 60 * 1000;
    const stats = pruneCacheSync(cacheDir, 2, oneDayMs);

    assertEquals(stats.evictedCount, 2, "Should evict 1 by TTL + 1 by size");
    assertEquals(stats.entryCount, 2, "Should retain 2 entries");
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
});
