import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { DiscoveryReplayRunner } from "../../src/discovery/DiscoveryReplayRunner.ts";
import type { SuccessCacheEntry } from "../../src/discovery/SuccessCache.ts";
import {
  archiveSuccessByKeySync,
  getObsoleteDir,
} from "../../src/discovery/SuccessCache.ts";
import { join } from "@std/path/join";

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  return Creature.fromJSON(base);
}

function makeEntry(overrides: Partial<SuccessCacheEntry>): SuccessCacheEntry {
  return {
    key: overrides.key ?? "k",
    changeType: overrides.changeType ?? "add-synapses",
    description: overrides.description,
    originalScore: overrides.originalScore ?? 0.5,
    candidateScore: overrides.candidateScore ?? 0.6,
    scoreDelta: overrides.scoreDelta ?? 0.1,
    error: overrides.error ?? 0.4,
    originalError: overrides.originalError ?? 0.5,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    rustRequest: overrides.rustRequest,
    actualCreatureChange: overrides.actualCreatureChange,
    discoveryVersion: overrides.discoveryVersion,
  };
}

Deno.test("getObsoleteDir returns correct sibling directory", () => {
  assertEquals(getObsoleteDir("/path/to/success-cache"), "/path/to/obsolete");
  assertEquals(getObsoleteDir("discovery/success"), "discovery/obsolete");
  assertEquals(
    getObsoleteDir(".discovery/success-cache"),
    ".discovery/obsolete",
  );
});

Deno.test("archiveSuccessByKeySync moves file to obsolete directory", async () => {
  const tempDir = await Deno.makeTempDir();
  const successCacheDir = join(tempDir, "success-cache");
  const obsoleteDir = join(tempDir, "obsolete");
  const changeType = "add-synapses";
  const key = "test-key-123";

  try {
    // Create a success cache entry
    const entryDir = join(successCacheDir, changeType);
    await Deno.mkdir(entryDir, { recursive: true });
    const entryPath = join(entryDir, `${key}.json`);
    const entryContent = JSON.stringify({ key, changeType, test: true });
    await Deno.writeTextFile(entryPath, entryContent);

    // Verify the file exists in the success directory
    const statBefore = await Deno.stat(entryPath);
    assertExists(statBefore);

    // Archive the entry
    archiveSuccessByKeySync(successCacheDir, changeType, key);

    // Verify the file no longer exists in the success directory
    let sourceExists = true;
    try {
      await Deno.stat(entryPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        sourceExists = false;
      } else {
        throw error;
      }
    }
    assertEquals(sourceExists, false, "Source file should have been moved");

    // Verify the file exists in the obsolete directory
    const archivedPath = join(obsoleteDir, changeType, `${key}.json`);
    const statAfter = await Deno.stat(archivedPath);
    assertExists(statAfter);

    // Verify the content is preserved
    const archivedContent = await Deno.readTextFile(archivedPath);
    assertEquals(archivedContent, entryContent);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("archiveSuccessByKeySync handles missing file gracefully", () => {
  // Archiving a non-existent file should not throw
  archiveSuccessByKeySync("/non/existent/path", "add-synapses", "missing-key");
});

Deno.test("DiscoveryReplayRunner archives obsolete entries instead of deleting", async () => {
  const base = makeBaseCreature();

  const successfulEntry = makeEntry({
    key: "k1",
    changeType: "add-synapses",
    scoreDelta: 0.1,
  });

  const obsoleteEntry = makeEntry({
    key: "k2",
    changeType: "change-squash",
    scoreDelta: 0.05,
  });

  const archived: Array<{ key: string; changeType: string }> = [];

  const runner = new DiscoveryReplayRunner({
    listEntries: (_dir) => [successfulEntry, obsoleteEntry],
    archiveEntry: (_dir, entry) =>
      archived.push({ key: entry.key, changeType: entry.changeType }),
    applyEntry: (current, entry) => {
      const clone = Creature.fromJSON(current.exportJSON());
      clone.uuid = `${current.uuid ?? "base"}-${entry.key}`;
      return clone;
    },
    evaluateError: (c) => {
      const id = c.uuid ?? "";
      if (id === "base") return Promise.resolve({ error: 0, score: 0.5 });
      if (id.endsWith("-k1")) return Promise.resolve({ error: 0, score: 0.6 }); // success
      if (id.endsWith("-k2")) return Promise.resolve({ error: 0, score: 0.49 }); // obsolete
      return Promise.resolve({ error: 0, score: 0.5 });
    },
  });

  base.uuid = "base";

  const result = await runner.replayDir({
    creature: base,
    dataDir: "/tmp/does-not-matter",
    options: {
      discoverySuccessCacheDir: "/tmp/does-not-matter",
      costOfGrowth: 0,
      discoveryReplayMaxSingles: 10,
      discoveryReplayMaxPairwise: 10,
      discoveryReplayMaxTriples: 10,
      threads: 1,
    },
  });

  assertEquals(result.evaluatedSingles, 2);
  assertEquals(result.pruned, 1);

  // Verify the obsolete entry was archived
  assertEquals(archived, [{ key: "k2", changeType: "change-squash" }]);

  // Verify the successful entry is still reported as an improvement
  assertExists(result.improvement);
  assertEquals(result.improvement.changeType, "add-synapses");
});
