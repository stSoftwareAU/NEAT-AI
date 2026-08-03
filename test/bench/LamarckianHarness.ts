/**
 * Issue #3638 — Tests for the shared Lamarckian benchmark harness.
 *
 * The harness in `bench/lamarckian_harness.ts` is the single source of truth for
 * the teacher problem, the fitness metric, the one-generation memetic training
 * step, and the perturbation operator used by the pace/convergence experiment
 * family. These tests exercise the real functions and assert on outcomes.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  buildTeacherDataset,
  meanAbsoluteError,
  perturb,
  type Sample,
  trainOneGeneration,
} from "../../bench/lamarckian_harness.ts";

/** Deterministic RNG so every assertion below is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff; // [0, 1)
  };
}

const INPUTS = 4;
const OUTPUTS = 2;
const HIDDEN = 3;

/** A small dense feed-forward network matching the harness problem shape. */
function buildNetwork(rng: () => number): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const inputUUIDs = Array.from({ length: INPUTS }, (_, i) => `input-${i}`);
  const hiddenUUIDs = Array.from({ length: HIDDEN }, (_, h) => `h-${h}`);
  for (const uuid of hiddenUUIDs) {
    neurons.push({
      type: "hidden",
      uuid,
      squash: "TANH",
      bias: (rng() * 2 - 1) * 0.1,
    });
  }
  const outputUUIDs = Array.from({ length: OUTPUTS }, (_, o) => `output-${o}`);
  for (const uuid of outputUUIDs) {
    neurons.push({
      type: "output",
      uuid,
      squash: "LOGISTIC",
      bias: (rng() * 2 - 1) * 0.1,
    });
  }

  for (const from of inputUUIDs) {
    for (const to of hiddenUUIDs) {
      synapses.push({ fromUUID: from, toUUID: to, weight: rng() * 2 - 1 });
    }
  }
  for (const from of hiddenUUIDs) {
    for (const to of outputUUIDs) {
      synapses.push({ fromUUID: from, toUUID: to, weight: rng() * 2 - 1 });
    }
  }

  return { input: INPUTS, output: OUTPUTS, neurons, synapses };
}

const DATASET_OPTIONS = {
  inputs: INPUTS,
  outputs: OUTPUTS,
  datasetSize: 12,
} as const;

Deno.test("buildTeacherDataset - shapes samples and bounds the teacher outputs", () => {
  const data = buildTeacherDataset(seededRandom(3638), DATASET_OPTIONS);

  assertEquals(data.length, DATASET_OPTIONS.datasetSize);
  for (const { input, target } of data) {
    assertEquals(input.length, INPUTS);
    assertEquals(target.length, OUTPUTS);
    for (const v of input) assert(v >= -1 && v < 1, `input out of range: ${v}`);
    // Targets are logistic(Σ wᵢxᵢ), so strictly inside (0, 1).
    for (const t of target) assert(t > 0 && t < 1, `target out of range: ${t}`);
  }
});

Deno.test("buildTeacherDataset - is deterministic for a deterministic RNG", () => {
  const first = buildTeacherDataset(seededRandom(7), DATASET_OPTIONS);
  const second = buildTeacherDataset(seededRandom(7), DATASET_OPTIONS);

  assertEquals(first.length, second.length);
  for (let s = 0; s < first.length; s++) {
    assertEquals([...first[s].input], [...second[s].input]);
    assertEquals([...first[s].target], [...second[s].target]);
  }
});

Deno.test("buildTeacherDataset - rejects non-positive problem sizes", () => {
  const rng = seededRandom(1);
  assertThrows(
    () => buildTeacherDataset(rng, { ...DATASET_OPTIONS, inputs: 0 }),
    RangeError,
    "inputs",
  );
  assertThrows(
    () => buildTeacherDataset(rng, { ...DATASET_OPTIONS, outputs: -1 }),
    RangeError,
    "outputs",
  );
  assertThrows(
    () => buildTeacherDataset(rng, { ...DATASET_OPTIONS, datasetSize: 2.5 }),
    RangeError,
    "datasetSize",
  );
});

Deno.test("meanAbsoluteError - is zero when targets match the creature's own output", () => {
  const creature = Creature.fromJSON(buildNetwork(seededRandom(11)));
  const inputs = buildTeacherDataset(seededRandom(12), DATASET_OPTIONS);
  const selfTargets: Sample[] = inputs.map(({ input }) => ({
    input,
    target: Float32Array.from(creature.activate(input)),
  }));

  assertAlmostEquals(
    meanAbsoluteError(creature, selfTargets, OUTPUTS),
    0,
    1e-6,
  );
});

Deno.test("meanAbsoluteError - averages absolute deviations over samples and outputs", () => {
  const creature = Creature.fromJSON(buildNetwork(seededRandom(13)));
  const data = buildTeacherDataset(seededRandom(14), DATASET_OPTIONS);

  let expected = 0;
  for (const { input, target } of data) {
    const out = creature.activate(input);
    for (let o = 0; o < OUTPUTS; o++) expected += Math.abs(out[o] - target[o]);
  }
  expected /= data.length * OUTPUTS;

  assertAlmostEquals(
    meanAbsoluteError(creature, data, OUTPUTS),
    expected,
    1e-9,
  );
});

Deno.test("trainOneGeneration - reduces the error on a learnable dataset", () => {
  const json = buildNetwork(seededRandom(15));
  const data = buildTeacherDataset(seededRandom(16), DATASET_OPTIONS);
  const creature = Creature.fromJSON(structuredClone(json));

  const before = meanAbsoluteError(creature, data, OUTPUTS);
  for (let round = 0; round < 5; round++) {
    trainOneGeneration(creature, data, 0.1, 4);
  }
  const after = meanAbsoluteError(creature, data, OUTPUTS);

  assert(
    after < before,
    `expected training to improve error: ${before} -> ${after}`,
  );
});

Deno.test("trainOneGeneration - leaves the creature untouched with zero inner iterations", () => {
  const json = buildNetwork(seededRandom(17));
  const data = buildTeacherDataset(seededRandom(18), DATASET_OPTIONS);
  const creature = Creature.fromJSON(structuredClone(json));

  const before = creature.exportJSON();
  trainOneGeneration(creature, data, 0.1, 0);

  assertEquals(creature.exportJSON(), before);
});

Deno.test("perturb - jitters every weight and bias within scale, leaving the source intact", () => {
  const source = Creature.fromJSON(buildNetwork(seededRandom(19)));
  const before = source.exportJSON();
  const scale = 0.25;

  const child = perturb(source, seededRandom(20), scale);
  const childJson = child.exportJSON();

  assertEquals(source.exportJSON(), before, "source must not be mutated");
  assertEquals(childJson.synapses.length, before.synapses.length);
  for (let i = 0; i < before.synapses.length; i++) {
    const delta = childJson.synapses[i].weight - before.synapses[i].weight;
    assert(
      Math.abs(delta) <= scale + 1e-6,
      `weight jitter exceeded scale: ${delta}`,
    );
  }
  for (let i = 0; i < before.neurons.length; i++) {
    const oldBias = before.neurons[i].bias;
    const newBias = childJson.neurons[i].bias;
    if (typeof oldBias !== "number" || typeof newBias !== "number") continue;
    assert(
      Math.abs(newBias - oldBias) <= scale + 1e-6,
      `bias jitter exceeded scale: ${newBias - oldBias}`,
    );
  }
});

Deno.test("perturb - a zero scale produces an unchanged copy", () => {
  const source = Creature.fromJSON(buildNetwork(seededRandom(21)));
  const child = perturb(source, seededRandom(22), 0);

  assertEquals(child.exportJSON(), source.exportJSON());
});
