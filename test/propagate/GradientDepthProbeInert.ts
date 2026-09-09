/**
 * Issue #3972 — the probe must be provably inert.
 *
 * A diagnostic that changes what it measures is worse than no diagnostic. Two
 * things are checked here: the creature handed to the probe is byte-identical
 * afterwards, and a seeded training run produces the same weights whether or
 * not the probe ran first (the probe must not advance the global RNG either).
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { probeGradientDepth } from "@propagate/GradientDepthProbe.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { initWasmForTests } from "../_initWasm.ts";

function trainable(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: -0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "h1", weight: -0.3 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "h2", toUUID: "output-0", weight: -0.6 },
    ],
  };
}

const rows: Float32Array[] = Array.from(
  { length: 12 },
  (_, i) => new Float32Array([(i % 5) / 5 - 0.5, (i % 3) / 3 - 0.5]),
);

/** Ten seeded training iterations; returns the resulting weights and biases. */
function train(seed: number, probeFirst: boolean): string {
  setRandomNumberGenerator(createSeededRng(seed));
  const creature = Creature.fromJSON(trainable());

  if (probeFirst) {
    probeGradientDepth(creature, rows);
  }

  const config = createBackPropagationConfig({ generations: 1 });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  for (const row of rows) {
    creature.activateAndTrace(row, false, sparseConfig);
    creature.propagate(
      new Float32Array([row[0] * 0.5 + 0.25]),
      config,
      sparseConfig,
    );
  }
  creature.applyLearnings(config, sparseConfig);
  return JSON.stringify(creature.exportJSON());
}

Deno.test("GradientDepthProbe - leaves the creature it profiled untouched", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(trainable());
  const before = JSON.stringify(creature.exportJSON());

  probeGradientDepth(creature, rows);

  assertEquals(JSON.stringify(creature.exportJSON()), before);
});

Deno.test("GradientDepthProbe - same seed trains identically with the probe on or off", async () => {
  await initWasmForTests();

  const withoutProbe = train(1234, false);
  const withProbe = train(1234, true);

  assertEquals(
    withProbe,
    withoutProbe,
    "the probe changed the trained result — it is not inert",
  );

  // Guard the guard: training must actually have moved the weights, otherwise
  // the assertion above would pass on a run that learned nothing at all.
  assertNotEquals(
    withoutProbe,
    JSON.stringify(Creature.fromJSON(trainable()).exportJSON()),
    "training left the creature unchanged — the inertness check is vacuous",
  );
});
