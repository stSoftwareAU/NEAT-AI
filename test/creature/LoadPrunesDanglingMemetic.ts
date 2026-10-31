/**
 * Issue #4062 — a creature loaded from a file must not keep a `memetic` that
 * names structure the file does not carry.
 *
 * A "dirty" file written by an earlier release can carry memetic rows whose
 * synapse no longer exists. Loading used to adopt them verbatim, so they were
 * re-exported and copied into children by `memeticUpdate`. These tests load
 * such a file and assert the dangling references are gone, while valid rows
 * and the caller's input are left alone.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { memeticUpdate } from "@blackbox/MemeticUpdate.ts";
import { danglingMemeticReferences } from "../_memeticReferences.ts";
import { getLogger, type Logger, setLogger } from "../../src/utils/Logger.ts";

type Row = { fromUUID: string; toUUID: string; weight: number };
type Snapshot = {
  biases?: Record<string, number>;
  weights?: Row[] | Record<string, unknown>;
  ancestry?: Snapshot[];
};

/** A small clean export: two inputs feed two hidden neurons into one output. */
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

/**
 * The baseExport with a stale row in the root and in `ancestry[0]`. Both
 * endpoints exist, but `input-1 -> output-0` has no synapse in the file.
 */
function dirtyExport(): CreatureExport {
  const json = baseExport();
  const memetic = memeticOf(json);
  (memetic.weights as Row[]).push({
    fromUUID: "input-1",
    toUUID: "output-0",
    weight: 0.5,
  });
  (memetic.ancestry?.[0].weights as Row[]).push({
    fromUUID: "input-1",
    toUUID: "output-0",
    weight: 0.6,
  });
  return json;
}

function memeticOf(json: CreatureExport): Snapshot {
  return json.memetic as unknown as Snapshot;
}

/** Sorted `from->to=weight` rows of a wire snapshot. */
function rows(snapshot: Snapshot): string[] {
  const weights = snapshot.weights;
  assert(Array.isArray(weights), "wire weights must be an array of rows");
  return weights.map((r) => `${r.fromUUID}->${r.toUUID}=${r.weight}`).sort();
}

/** Sorted bias keys of a wire snapshot. */
function biasKeys(snapshot: Snapshot): string[] {
  return Object.keys(snapshot.biases ?? {}).sort();
}

/**
 * Order-insensitive view of a wire memetic, ancestry included. Export does not
 * promise a row order, so two equal records may list their rows differently.
 */
function fingerprint(snapshot: Snapshot): unknown {
  return {
    biases: biasKeys(snapshot).map((k) => [k, snapshot.biases?.[k]]),
    weights: rows(snapshot),
    ancestry: (snapshot.ancestry ?? []).map(fingerprint),
  };
}

Deno.test("load prunes a root memetic row that names a missing synapse (#4062)", () => {
  const exported = Creature.fromJSON(dirtyExport()).exportJSON();

  assertEquals(danglingMemeticReferences(exported), []);
  const memetic = memeticOf(exported);
  assertEquals(rows(memetic), [
    "hidden-0->output-0=0.25",
    "hidden-1->output-0=0.35",
  ]);
  assertEquals(biasKeys(memetic), ["hidden-0", "hidden-1"]);
});

Deno.test("load prunes an ancestry snapshot row that names a missing synapse (#4062)", () => {
  const exported = Creature.fromJSON(dirtyExport()).exportJSON();

  assertEquals(danglingMemeticReferences(exported), []);
  const ancestor = memeticOf(exported).ancestry?.[0] as Snapshot;
  assert(ancestor, "ancestry[0] must survive the load");
  assertEquals(rows(ancestor), [
    "hidden-0->output-0=0.26",
    "hidden-1->output-0=0.36",
  ]);
  assertEquals(biasKeys(ancestor), ["hidden-0", "hidden-1"]);
});

Deno.test("load prunes a legacy uuid-keyed weights map that names a missing pair (#4062)", () => {
  const json = baseExport();
  memeticOf(json).weights = {
    "hidden-0": [{ toUUID: "output-0", weight: 0.25 }],
    "input-1": [{ toUUID: "output-0", weight: 0.5 }],
  };

  const exported = Creature.fromJSON(json).exportJSON();

  assertEquals(danglingMemeticReferences(exported), []);
  assertEquals(rows(memeticOf(exported)), ["hidden-0->output-0=0.25"]);
});

Deno.test("load does not mutate the caller's memetic (#4062)", () => {
  const dirty = dirtyExport();
  const snapshot = structuredClone(memeticOf(dirty));

  Creature.fromJSON(dirty);

  assertEquals(memeticOf(dirty), snapshot);
});

Deno.test("a child built from a loaded dirty parent carries no dangling memetic row (#4062)", () => {
  const parent = Creature.fromJSON(dirtyExport());
  parent.score = -0.2;

  const child = parent.shallowClone();
  const hidden0 = child.neurons.find((n) => n.uuid === "hidden-0");
  const output = child.neurons.find((n) => n.type === "output");
  assert(hidden0 && output, "child must carry hidden-0 and output-0");
  const synapse = child.synapses.find((s) =>
    s.from === hidden0.index && s.to === output.index
  );
  assert(synapse, "child must carry a live hidden-0 -> output-0 synapse");
  synapse.weight = 0.9;
  delete child.uuid;

  const updated = memeticUpdate(parent, child);
  assert(updated !== undefined, "memeticUpdate must produce a memetic");
  child.memetic = updated;

  assertEquals(danglingMemeticReferences(child.exportJSON()), []);
});

Deno.test("a loaded dirty creature passes core creatureValidate (#4062)", () => {
  const loaded = Creature.fromJSON(dirtyExport());

  creatureValidate(loaded);
});

Deno.test("a clean memetic is unchanged by a load round trip (#4062)", () => {
  const clean = baseExport();
  const before = fingerprint(structuredClone(memeticOf(clean)));

  const once = Creature.fromJSON(clean).exportJSON();
  assertEquals(fingerprint(memeticOf(once)), before);

  const twice = Creature.fromJSON(once).exportJSON();
  assertEquals(fingerprint(memeticOf(twice)), before);
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

/** Runs `load` with the logger captured, and returns the warnings it logged. */
function warningsFrom(load: () => void): string[] {
  const previous = getLogger();
  const warnings: string[] = [];
  setLogger(captureWarnings(warnings));
  try {
    load();
  } finally {
    setLogger(previous);
  }
  return warnings;
}

Deno.test("loading a dirty export logs one Issue #4062 warning with the removed count (#4062)", () => {
  const warnings = warningsFrom(() => {
    Creature.fromJSON(dirtyExport());
  });

  const relevant = warnings.filter((w) => w.includes("Issue #4062"));
  assertEquals(relevant.length, 1);
  assert(
    relevant[0].includes("[loadFrom] Pruned 2 memetic reference(s)"),
    `warning must name the removed count, got: ${relevant[0]}`,
  );
});

Deno.test("loading a clean export logs no Issue #4062 warning (#4062)", () => {
  const warnings = warningsFrom(() => {
    Creature.fromJSON(baseExport());
  });

  assertEquals(warnings.filter((w) => w.includes("Issue #4062")), []);
});

Deno.test("a runtime-shaped memetic is pruned on a copy, not the caller's object (#4062)", () => {
  // Input and output ids are fixed by position; hidden ids come from a global
  // counter and change on every load, so only input and output ids are keyed.
  const built = Creature.fromJSON(baseExport());
  const input1 = built.neurons.find((n) => n.type === "input" && n.index === 1);
  const output = built.neurons.find((n) => n.type === "output");
  assert(input1 && output, "built creature must carry input-1 and output-0");

  const json = baseExport();
  const memetic = {
    generation: 4,
    score: -0.2,
    biases: { [String(output.id)]: 0.3 },
    // input-1 -> output-0 has no synapse in the file: a dangling pair.
    weights: { [String(input1.id)]: [{ toId: output.id, weight: 0.5 }] },
  };
  json.memetic = memetic as unknown as CreatureExport["memetic"];
  const before = structuredClone(memetic);

  const exported = Creature.fromJSON(json).exportJSON();

  assertEquals(danglingMemeticReferences(exported), []);
  assertEquals(memetic, before);
});
