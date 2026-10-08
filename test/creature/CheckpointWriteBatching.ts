/**
 * Issue #3436 — checkpoint writes must be bounded-batch, not
 * "stringify the whole population then Promise.all".
 *
 * These are outcome tests: they assert on the number of genome JSON strings
 * alive at once (observed through the injected write seam), on the files
 * actually produced, and on the semanticVersion / warm-up tag invariants at
 * the export boundary (#2349 / #2909).
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { addTag, getTag, type TagsInterface } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CURRENT_CREATURE_SEMANTIC_VERSION } from "@creature";
import {
  type CheckpointSource,
  DEFAULT_CHECKPOINT_WRITE_BATCH_SIZE,
  writeCreatures,
} from "@creature/CheckpointWriter.ts";

function buildPopulation(size: number): Creature[] {
  const population: Creature[] = [];
  for (let i = 0; i < size; i++) {
    const creature = new Creature(3, 1, { layers: [{ count: 4 }] });
    creature.score = i;
    population.push(creature);
  }
  return population;
}

function source(
  population: Creature[],
  warmupGenerations = 0,
  currentGeneration = 0,
): CheckpointSource {
  return { population, warmupGenerations, currentGeneration };
}

interface CheckpointJson extends TagsInterface {
  semanticVersion?: string;
}

/** Read `1.json` … `<count>.json` from `dir`, parsed, in file order. */
function readCheckpoints(
  dir: string,
  count: number,
): Promise<CheckpointJson[]> {
  return Promise.all(
    Array.from(
      { length: count },
      (_, i) =>
        Deno.readTextFile(`${dir}/${i + 1}.json`).then((text) =>
          JSON.parse(text) as CheckpointJson
        ),
    ),
  );
}

/** Sorted file names in `dir`. */
async function listNames(dir: string): Promise<string[]> {
  const entries = await Array.fromAsync(Deno.readDir(dir));
  return entries.map((entry) => entry.name).sort();
}

/** Records how many writes (and therefore JSON strings) overlap in time. */
function makeTrackingWriter() {
  const files = new Map<string, string>();
  let inFlight = 0;
  let peakInFlight = 0;
  const writeTextFile = (path: string, text: string): Promise<void> => {
    inFlight++;
    if (inFlight > peakInFlight) peakInFlight = inFlight;
    return new Promise<void>((resolve) => {
      // Resolve on a later microtask so overlapping writes are observable.
      queueMicrotask(() => {
        files.set(path, text);
        inFlight--;
        resolve();
      });
    });
  };
  return { files, writeTextFile, peak: () => peakInFlight };
}

Deno.test("writeCreatures caps concurrent checkpoint writes at the batch size", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_batch_" });
  try {
    const tracker = makeTrackingWriter();
    const population = buildPopulation(40);

    await writeCreatures(source(population), dir, {
      batchSize: 4,
      writeTextFile: tracker.writeTextFile,
    });

    assertEquals(tracker.files.size, 40, "every creature written");
    assertEquals(
      tracker.peak(),
      4,
      "at most batchSize checkpoint strings alive at once",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures peak concurrency is independent of population size", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_scale_" });
  try {
    const small = makeTrackingWriter();
    const large = makeTrackingWriter();

    await writeCreatures(source(buildPopulation(12)), dir, {
      writeTextFile: small.writeTextFile,
    });
    await writeCreatures(source(buildPopulation(120)), dir, {
      writeTextFile: large.writeTextFile,
    });

    assertEquals(large.files.size, 120);
    assertEquals(
      large.peak(),
      small.peak(),
      "peak in-flight writes must not grow with population size",
    );
    assert(
      large.peak() <= DEFAULT_CHECKPOINT_WRITE_BATCH_SIZE,
      `peak ${large.peak()} exceeded default batch size`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures produces the same files regardless of batch size", async () => {
  const dirA = await Deno.makeTempDir({ prefix: "neat_ckpt_eqA_" });
  const dirB = await Deno.makeTempDir({ prefix: "neat_ckpt_eqB_" });
  try {
    const population = buildPopulation(9);
    await writeCreatures(source(population), dirA, { batchSize: 1 });
    await writeCreatures(source(population), dirB, { batchSize: 64 });

    const [batchedOne, batchedAll] = await Promise.all([
      readCheckpoints(dirA, 9),
      readCheckpoints(dirB, 9),
    ]);
    for (let i = 0; i < 9; i++) {
      assertEquals(
        JSON.stringify(batchedOne[i]),
        JSON.stringify(batchedAll[i]),
        `${i + 1}.json must be identical across batch sizes`,
      );
    }

    assertEquals(
      (await listNames(dirA)).length,
      9,
      "exactly one file per creature",
    );
  } finally {
    await Deno.remove(dirA, { recursive: true });
    await Deno.remove(dirB, { recursive: true });
  }
});

Deno.test("writeCreatures numbers files 1..N in population order", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_order_" });
  try {
    const population = buildPopulation(20);
    population.forEach((creature, i) => addTag(creature, "member", `${i}`));
    await writeCreatures(source(population), dir, { batchSize: 3 });

    const written = await readCheckpoints(dir, population.length);
    written.forEach((parsed, i) => {
      assertEquals(
        getTag(parsed, "member"),
        `${i}`,
        `${i + 1}.json must hold population member ${i}`,
      );
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures empties stale checkpoint files first", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_empty_" });
  try {
    await Deno.writeTextFile(`${dir}/99.json`, "{}");
    await writeCreatures(source(buildPopulation(2)), dir, { batchSize: 1 });

    assertEquals(
      await listNames(dir),
      ["1.json", "2.json"],
      "stale files removed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures with an empty population writes nothing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_none_" });
  try {
    await Deno.writeTextFile(`${dir}/1.json`, "{}");
    await writeCreatures(source([]), dir);
    assertEquals((await listNames(dir)).length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures heals an invalid semanticVersion before writing (#2349)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_semver_" });
  try {
    const population = buildPopulation(5);
    population[3].semanticVersion = "";
    await writeCreatures(source(population), dir, { batchSize: 2 });

    const written = await readCheckpoints(dir, 5);
    assertEquals(written[3].semanticVersion, CURRENT_CREATURE_SEMANTIC_VERSION);
    assertEquals(
      population[3].semanticVersion,
      CURRENT_CREATURE_SEMANTIC_VERSION,
      "live population member healed too",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures stamps warm-up tags on every batch while warming (#2909)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_warm_" });
  try {
    const population = buildPopulation(10);
    // Warming: currentGeneration <= warmupGenerations.
    await writeCreatures(source(population, 100, 7), dir, { batchSize: 3 });

    const written = await readCheckpoints(dir, 10);
    written.forEach((parsed, i) => {
      assertEquals(getTag(parsed, "warmupGenerations"), "100", `${i + 1}.json`);
      assertEquals(getTag(parsed, "currentGeneration"), "7", `${i + 1}.json`);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures strips warm-up tags once warm (#2909)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_wa_" });
  try {
    const population = buildPopulation(6);
    // Warm: currentGeneration > warmupGenerations.
    await writeCreatures(source(population, 5, 9), dir, { batchSize: 4 });

    const written = await readCheckpoints(dir, 6);
    written.forEach((parsed, i) => {
      assertEquals(getTag(parsed, "warmupGenerations"), null, `${i + 1}.json`);
      assertEquals(getTag(parsed, "currentGeneration"), null, `${i + 1}.json`);
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures rejects an invalid batch size loudly", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_bad_" });
  try {
    const population = buildPopulation(2);
    await Promise.all(
      [0, -1, 1.5, Number.NaN].map((bad) =>
        assertRejects(
          () => writeCreatures(source(population), dir, { batchSize: bad }),
          RangeError,
          "batchSize",
        )
      ),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures propagates a write failure instead of swallowing it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_fail_" });
  try {
    const population = buildPopulation(6);
    await assertRejects(
      () =>
        writeCreatures(source(population), dir, {
          batchSize: 2,
          writeTextFile: (path: string) =>
            path.endsWith("3.json")
              ? Promise.reject(new Error("disk full"))
              : Promise.resolve(),
        }),
      Error,
      "disk full",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Issue #4050 (PR #4051 review): a generation abandoned past the hard
// deadline can dispose a population member — clearing its neurons and
// synapses — while a checkpoint write for the *previous* population is
// still in flight. The disposed creature used to throw a RangeError inside
// exportJSON() that writeCreatures mis-blamed on every RangeError, and the
// directory was emptied up front, so a crash partway through left the
// checkpoint with gaps instead of the last-good state.

Deno.test("writeCreatures skips a disposed creature in the middle and names it, writing every other member", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_disposed_" });
  try {
    const population = buildPopulation(5);
    population[2].dispose();

    await writeCreatures(source(population), dir, { batchSize: 2 });

    assertEquals(
      await listNames(dir),
      ["1.json", "2.json", "4.json", "5.json"],
      "every member except the disposed one (index 2 -> 3.json) is written",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures does not mislabel a genuine export error on a non-disposed creature as disposal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_genuine_err_" });
  try {
    const population = buildPopulation(4);
    // A real, non-disposed creature (neurons.length >= input) whose export
    // fails for an unrelated reason. The old blanket `catch (RangeError)`
    // would have silently skipped this one and logged it as disposed; the
    // explicit neurons.length < input check does not match it, so the error
    // must propagate with its original message.
    population[1].exportJSON = () => {
      throw new RangeError("unrelated export bug, not disposal");
    };

    await assertRejects(
      () => writeCreatures(source(population), dir, { batchSize: 2 }),
      RangeError,
      "unrelated export bug, not disposal",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures survives a creature disposed mid-write by a racing generation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_race_" });
  try {
    // 6 creatures, batchSize 2 -> batches [0,1], [2,3], [4,5]. Dispose
    // population[4] (file "5.json", in the third/last batch) while the
    // second batch's writes are still in flight — exactly the window the
    // abandoned background evolve() races into in production.
    const population = buildPopulation(6);
    const writeTextFile = (path: string, text: string): Promise<void> => {
      if (path.endsWith("4.json")) {
        population[4].dispose();
      }
      return Deno.writeTextFile(path, text);
    };

    await writeCreatures(source(population), dir, {
      batchSize: 2,
      writeTextFile,
    });

    assertEquals(
      await listNames(dir),
      ["1.json", "2.json", "3.json", "4.json", "6.json"],
      "5.json (disposed mid-write) is skipped; every other member is written",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures refuses to replace the checkpoint when every member is disposed", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_all_disposed_" });
  try {
    // Seed a last-good checkpoint first.
    const good = buildPopulation(3);
    await writeCreatures(source(good), dir);
    const before = await listNames(dir);

    const allDisposed = buildPopulation(2);
    for (const creature of allDisposed) creature.dispose();

    await assertRejects(
      () => writeCreatures(source(allDisposed), dir),
      Error,
      "disposed",
    );

    assertEquals(
      await listNames(dir),
      before,
      "the last-good checkpoint must survive an all-disposed write attempt",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** True when `path` exists; false only for ENOENT. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Yield one macrotask turn so pending real filesystem ops get a chance to settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// PR #4051 review: two problems in how CheckpointWriter handles its temp
// dir, found after the #4050 fix above landed.

Deno.test("writeCreatures awaits in-flight batch writes before removing tempDir on error (#4051 review)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_cleanup_race_" });
  try {
    const population = buildPopulation(2);
    let releaseFirstWrite: () => void = () => {};
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let firstWriteStarted = false;
    const writeTextFile = async (path: string, text: string): Promise<void> => {
      if (path.endsWith("1.json")) {
        firstWriteStarted = true;
        // Not resolved until the test releases it below — simulates a write
        // still in flight when the second creature's export throws.
        await firstWriteGate;
      }
      await Deno.writeTextFile(path, text);
    };
    // The second creature's export throws synchronously, in the same batch
    // as the first creature's still-pending write.
    population[1].exportJSON = () => {
      throw new Error("export boom");
    };

    const result = writeCreatures(source(population), dir, {
      batchSize: 2,
      writeTextFile,
    });

    for (let i = 0; i < 50 && !firstWriteStarted; i++) {
      // deno-lint-ignore no-await-in-loop
      await tick();
    }
    assert(firstWriteStarted, "precondition: first write must have started");
    // Give the (buggy, pre-fix) cleanup remove several turns to run before
    // asserting — an empty-directory remove completes within one of these.
    for (let i = 0; i < 10; i++) {
      // deno-lint-ignore no-await-in-loop
      await tick();
    }

    assert(
      await exists(`${dir}.tmp`),
      "tempDir must not be removed while its in-flight write is still pending",
    );

    releaseFirstWrite();
    await assertRejects(() => result, Error, "export boom");

    assertEquals(
      await exists(`${dir}.tmp`),
      false,
      "tempDir must be cleaned up once the in-flight write has settled",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures discards a stale leftover temp dir from a previous crash (#4051 review)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_stale_tmp_" });
  try {
    // Simulate a kill between mkdir and the final rename on a prior call:
    // a leftover sibling temp dir with stale content.
    const staleTempDir = `${dir}.tmp`;
    await Deno.mkdir(staleTempDir, { recursive: true });
    await Deno.writeTextFile(`${staleTempDir}/stale.json`, "{}");

    const population = buildPopulation(2);
    await writeCreatures(source(population), dir);

    assertEquals(
      await listNames(dir),
      ["1.json", "2.json"],
      "stale leftover content must not be merged into the new checkpoint",
    );
    assertEquals(
      await exists(staleTempDir),
      false,
      "leftover temp dir must be cleared, not left behind forever",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures recovers the last-good checkpoint from a leftover .old dir after a kill between swap renames (#4051 review)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_old_recover_" });
  try {
    const good = buildPopulation(2);
    good.forEach((creature, i) => addTag(creature, "member", `good-${i}`));
    await writeCreatures(source(good), dir);

    // Simulate a kill between the two swap renames: `dir` was renamed aside
    // to `.old` but the temp dir never got renamed into place.
    const oldDir = `${dir}.old`;
    await Deno.rename(dir, oldDir);
    assert(!(await exists(dir)), "precondition: dir missing like mid-crash");

    // A second write that itself fails must still recover the last-good
    // checkpoint from `.old` — recovery runs unconditionally before the
    // write even starts, independent of whether this write succeeds.
    const population = buildPopulation(3);
    await assertRejects(
      () =>
        writeCreatures(source(population), dir, {
          writeTextFile: () => Promise.reject(new Error("disk full")),
        }),
      Error,
      "disk full",
    );

    assertEquals(
      await exists(oldDir),
      false,
      ".old must be recovered, not left behind",
    );
    const recovered = await readCheckpoints(dir, 2);
    recovered.forEach((parsed, i) => {
      assertEquals(
        getTag(parsed, "member"),
        `good-${i}`,
        "last-good checkpoint must be recovered from .old",
      );
    });
  } finally {
    // `dir` may legitimately not exist here if recovery did not run (the
    // very defect this test guards against) — clean up both possible
    // locations without letting a missing one mask the real assertion.
    await Promise.allSettled([
      Deno.remove(dir, { recursive: true }),
      Deno.remove(`${dir}.old`, { recursive: true }),
    ]);
  }
});

// PR #4051 review: `creatureStore` paths ending in a separator (which shell
// tab-completion adds by default) used to make `tempDir`/`oldDir` land
// *inside* the store instead of beside it, so the swap renamed the store
// into its own subdirectory and failed with EINVAL.
Deno.test("writeCreatures replaces an existing checkpoint when dir has a trailing separator (#4051 review)", async () => {
  const base = await Deno.makeTempDir({ prefix: "neat_ckpt_trailing_slash_" });
  const dir = `${base}/`;
  try {
    const first = buildPopulation(2);
    first.forEach((creature, i) => addTag(creature, "member", `first-${i}`));
    await writeCreatures(source(first), dir);

    const second = buildPopulation(3);
    second.forEach((creature, i) => addTag(creature, "member", `second-${i}`));
    await writeCreatures(source(second), dir);

    const written = await readCheckpoints(base, 3);
    written.forEach((parsed, i) => {
      assertEquals(
        getTag(parsed, "member"),
        `second-${i}`,
        `${i + 1}.json must hold the second checkpoint`,
      );
    });
    assertEquals(
      await exists(`${base}.tmp`),
      false,
      "tempDir must be a sibling of the store, not left behind inside it",
    );
    assertEquals(
      await exists(`${base}.old`),
      false,
      "oldDir must be cleaned up, not left behind",
    );
  } finally {
    await Promise.allSettled([
      Deno.remove(base, { recursive: true }),
      Deno.remove(`${base}.tmp`, { recursive: true }),
      Deno.remove(`${base}.old`, { recursive: true }),
    ]);
  }
});

Deno.test("writeCreatures leaves the previous checkpoint untouched when a write fails partway through", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_atomic_" });
  try {
    const good = buildPopulation(3);
    await writeCreatures(source(good), dir);
    const before = await readCheckpoints(dir, 3);

    const population = buildPopulation(6);
    await assertRejects(
      () =>
        writeCreatures(source(population), dir, {
          batchSize: 2,
          writeTextFile: (path: string) =>
            path.endsWith("3.json")
              ? Promise.reject(new Error("disk full"))
              : Promise.resolve(),
        }),
      Error,
      "disk full",
    );

    const after = await readCheckpoints(dir, 3);
    assertEquals(
      JSON.stringify(after),
      JSON.stringify(before),
      "the previous checkpoint's files must be byte-for-byte unchanged",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
