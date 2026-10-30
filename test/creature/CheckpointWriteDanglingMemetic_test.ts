/**
 * Issue #4062 — a population checkpoint must never carry a creature whose
 * `memetic` names a synapse (or neuron) the same file does not carry.
 *
 * These tests inject stale memetic references to exercise the write boundary.
 * They do not identify a production mutation or run an abandoned generation.
 * The writer prunes such rows at the export boundary; core's validator would
 * otherwise reject the file with
 * "Memetic from id X to id Y has no matching synapses".
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { writeCreatures } from "../../src/creature/CheckpointWriter.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { pruneDanglingMemeticFromExport } from "../../src/compact/MemeticCleanup.ts";
import { danglingMemeticReferences } from "../_memeticReferences.ts";
import { getLogger, type Logger, setLogger } from "../../src/utils/Logger.ts";

function baseExport(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "IDENTITY", bias: 0.1 },
      { uuid: "hidden-1", type: "hidden", squash: "IDENTITY", bias: 0.2 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
    ],
    memetic: {
      generation: 4,
      score: -0.2,
      biases: { "hidden-0": 0.1, "hidden-1": 0.2 },
      weights: [
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
      ],
      ancestry: [{
        generation: 3,
        score: -0.3,
        biases: { "hidden-0": 0.11, "hidden-1": 0.21 },
        weights: [
          { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.26 },
          { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.36 },
        ],
      }],
    },
  } as unknown as CreatureExport;
}

/** A live creature carrying a valid memetic record. */
function memeticCreature(): Creature {
  const creature = Creature.fromJSON(baseExport());
  assertEquals(
    danglingMemeticReferences(creature.exportJSON()),
    [],
    "fixture must start with a valid memetic",
  );
  return creature;
}

/**
 * Removes the hidden-1 -> output-0 synapse straight from the live creature
 * WITHOUT touching memetic — a synthetic fault, not a production mutation.
 */
function dropSynapseKeepingMemetic(
  creature: Creature,
  fromUuid = "hidden-1",
): void {
  const hidden = creature.neurons.find((n) =>
    n.uuid === fromUuid ||
    (n.type === "input" && `input-${n.index}` === fromUuid)
  );
  const output = creature.neurons.find((n) => n.type === "output");
  assert(hidden && output);
  creature.synapses = creature.synapses.filter((s) =>
    !(s.from === hidden.index && s.to === output.index)
  );
  delete creature.uuid;
}

type Row = { fromUUID: string; toUUID: string; weight: number };
type Snapshot = {
  biases?: Record<string, number>;
  weights?: Row[];
  ancestry?: Snapshot[];
};

function pairs(snapshot: Snapshot): string[] {
  return (snapshot.weights ?? []).map((r) => `${r.fromUUID}->${r.toUUID}`);
}

async function readAll(dir: string): Promise<CreatureExport[]> {
  const entries = await Array.fromAsync(Deno.readDir(dir));
  const out: CreatureExport[] = [];
  for (const entry of entries) {
    out.push(
      JSON.parse(
        // deno-lint-ignore no-await-in-loop
        await Deno.readTextFile(`${dir}/${entry.name}`),
      ) as CreatureExport,
    );
  }
  return out;
}

Deno.test("writeCreatures never writes a memetic row naming a missing synapse (#4062)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_memetic_" });
  try {
    const population = [memeticCreature(), memeticCreature()];
    const stale = population[1];
    let calls = 0;
    const writeTextFile = (path: string, text: string): Promise<void> => {
      // Inject a synthetic fault between exports. This does not exercise
      // evolve() or identify how a production creature becomes stale.
      if (calls++ === 0) dropSynapseKeepingMemetic(stale);
      return Deno.writeTextFile(path, text);
    };

    await writeCreatures(
      { population, warmupGenerations: 0, currentGeneration: 0 },
      dir,
      { batchSize: 1, writeTextFile },
    );

    assertEquals(calls, 2);
    const files = await readAll(dir);
    assertEquals(files.length, 2);

    // Precondition: the live creature really is stale, so the test cannot
    // pass vacuously.
    const liveDangling = danglingMemeticReferences(stale.exportJSON());
    assert(
      liveDangling.length > 0,
      "live creature must carry a dangling memetic reference",
    );

    let sawValid = 0;
    for (const file of files) {
      assertEquals(
        danglingMemeticReferences(file),
        [],
        "written file must not carry a dangling memetic reference",
      );
      const synapses = new Set(
        file.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
      );
      const labels = new Set<string>(["input-0", "input-1"]);
      for (const n of file.neurons) labels.add(n.uuid as string);

      const walk = (snap: Snapshot): void => {
        for (const p of pairs(snap)) assert(synapses.has(p), `dangling ${p}`);
        for (const k of Object.keys(snap.biases ?? {})) {
          assert(labels.has(k), `dangling bias ${k}`);
        }
        for (const a of snap.ancestry ?? []) walk(a);
      };
      walk(file.memetic as unknown as Snapshot);

      if (
        pairs(file.memetic as unknown as Snapshot).includes(
          "hidden-1->output-0",
        )
      ) sawValid++;
    }
    // Positive control: the untouched creature keeps its valid rows.
    assertEquals(sawValid, 1, "the unmutated creature keeps its memetic rows");
    for (const file of files) {
      assert(
        pairs(file.memetic as unknown as Snapshot).includes(
          "hidden-0->output-0",
        ),
        "valid rows survive in every file",
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a stale-memetic checkpoint file passes core validation (#4062)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_memetic_val_" });
  try {
    // A redundant input-0 -> output-0 shortcut: dropping it leaves every
    // neuron connected, so the only fault in the file would be the memetic.
    const json = baseExport();
    json.synapses.push({
      fromUUID: "input-0",
      toUUID: "output-0",
      weight: 0.4,
    });
    (json.memetic as unknown as Snapshot).weights?.push({
      fromUUID: "input-0",
      toUUID: "output-0",
      weight: 0.4,
    });
    const creature = Creature.fromJSON(json);
    dropSynapseKeepingMemetic(creature, "input-0");
    assert(
      danglingMemeticReferences(creature.exportJSON()).length > 0,
      "precondition: live memetic is stale",
    );

    await writeCreatures(
      { population: [creature], warmupGenerations: 0, currentGeneration: 0 },
      dir,
      { batchSize: 1 },
    );

    const [file] = await readAll(dir);
    const reloaded = Creature.fromJSON(file, true);
    creatureValidate(reloaded);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("pruneDanglingMemeticFromExport removes dangling rows and keeps valid ones (#4062)", () => {
  const json = baseExport();
  json.synapses = json.synapses.filter((s) =>
    s.fromUUID !== "hidden-1" || s.toUUID !== "output-0"
  );
  json.neurons = json.neurons.filter((n) => n.uuid !== "hidden-1");
  json.synapses = json.synapses.filter((s) =>
    s.fromUUID !== "input-1" && s.toUUID !== "hidden-1"
  );
  assert(danglingMemeticReferences(json).length > 0, "precondition");

  const pruned = pruneDanglingMemeticFromExport(json);
  assert(pruned > 0);

  const memetic = json.memetic as unknown as Snapshot;
  assertEquals(pairs(memetic), ["hidden-0->output-0"]);
  assertEquals(Object.keys(memetic.biases ?? {}), ["hidden-0"]);
  const ancestor = memetic.ancestry?.[0] as Snapshot;
  assertEquals(pairs(ancestor), ["hidden-0->output-0"]);
  assertEquals(Object.keys(ancestor.biases ?? {}), ["hidden-0"]);
  assertEquals(danglingMemeticReferences(json), []);
});

Deno.test("pruneDanglingMemeticFromExport removes a row whose pair has no synapse (#4062)", () => {
  const json = baseExport();
  json.synapses = json.synapses.filter((s) =>
    s.fromUUID !== "hidden-1" || s.toUUID !== "output-0"
  );
  assertEquals(pruneDanglingMemeticFromExport(json) > 0, true);
  const memetic = json.memetic as unknown as Snapshot;
  assertEquals(pairs(memetic), ["hidden-0->output-0"]);
  // The neuron itself is still exported, so its bias key stays.
  assertEquals(Object.keys(memetic.biases ?? {}).sort(), [
    "hidden-0",
    "hidden-1",
  ]);
});

Deno.test("pruneDanglingMemeticFromExport leaves a clean export untouched (#4062)", () => {
  const json = baseExport();
  const before = JSON.stringify(json);
  assertEquals(pruneDanglingMemeticFromExport(json), 0);
  assertEquals(JSON.stringify(json), before);
});

Deno.test("pruneDanglingMemeticFromExport returns 0 when there is no memetic (#4062)", () => {
  const json = baseExport();
  delete json.memetic;
  const before = JSON.stringify(json);
  assertEquals(pruneDanglingMemeticFromExport(json), 0);
  assertEquals(JSON.stringify(json), before);
});

Deno.test("pruneDanglingMemeticFromExport leaves a legacy map-shaped weights value untouched (#4062)", () => {
  const json = baseExport();
  const legacy = { "hidden-0->output-0": 0.5, "gone->output-0": 0.25 };
  (json.memetic as unknown as { weights: unknown }).weights = legacy;
  assertEquals(pruneDanglingMemeticFromExport(json), 0);
  assertEquals(
    (json.memetic as unknown as { weights: unknown }).weights,
    { "hidden-0->output-0": 0.5, "gone->output-0": 0.25 },
  );
});

function captureWarnings(warnings: string[]): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    },
    error: () => {},
  };
}

Deno.test("writeCreatures warns with the pruned count when it drops a dangling memetic reference (#4062)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_memetic_warn_" });
  const previous = getLogger();
  const warnings: string[] = [];
  setLogger(captureWarnings(warnings));
  try {
    const creature = memeticCreature();
    dropSynapseKeepingMemetic(creature);
    await writeCreatures(
      { population: [creature], warmupGenerations: 0, currentGeneration: 0 },
      dir,
      { batchSize: 1 },
    );
    const relevant = warnings.filter((w) => w.includes("[CheckpointWriter]"));
    assertEquals(relevant.length, 1);
    assert(relevant[0].includes("Pruned 2 "), relevant[0]);
    assert(relevant[0].includes("Issue #4062"), relevant[0]);
  } finally {
    setLogger(previous);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeCreatures does not warn when every memetic reference is valid (#4062)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "neat_ckpt_memetic_nowarn_" });
  const previous = getLogger();
  const warnings: string[] = [];
  setLogger(captureWarnings(warnings));
  try {
    await writeCreatures(
      {
        population: [memeticCreature()],
        warmupGenerations: 0,
        currentGeneration: 0,
      },
      dir,
      { batchSize: 1 },
    );
    assertEquals(
      warnings.filter((w) => w.includes("[CheckpointWriter]")).length,
      0,
    );
  } finally {
    setLogger(previous);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("pruneDanglingMemeticFromExport removes a row whose UUID is not a string (#4062)", () => {
  const json = baseExport();
  (json.memetic as unknown as { weights: unknown[] }).weights.push({
    fromUUID: 7,
    toUUID: "output-0",
    weight: 0.1,
  });
  assertEquals(pruneDanglingMemeticFromExport(json), 1);
  assertEquals(
    pairs(json.memetic as unknown as Snapshot),
    pairs(baseExport().memetic as unknown as Snapshot),
  );
});
