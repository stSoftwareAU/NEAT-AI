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
