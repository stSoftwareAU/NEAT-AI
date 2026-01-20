import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IF } from "../../src/methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "../../src/methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "../../src/methods/activations/aggregate/MINIMUM.ts";
import { ABSOLUTE } from "../../src/methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { ReLU } from "../../src/methods/activations/types/ReLU.ts";
import { HYPOT } from "../../src/deprecated/HYPOT.ts";
import { HYPOTv2 } from "../../src/deprecated/HYPOTv2.ts";
import { MEAN } from "../../src/deprecated/MEAN.ts";
import { initWasmActivation } from "../../src/wasm/WasmActivation.ts";

// Get the project root directory for WASM module path
const projectRoot = new URL("../..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

function maxAbsWeightAndBias(creature: Creature): number {
  let max = 0;
  for (const s of creature.synapses) max = Math.max(max, Math.abs(s.weight));
  for (const n of creature.neurons) {
    if (n.type !== "input") max = Math.max(max, Math.abs(n.bias));
  }
  return max;
}

function assertCompactionSimplifies(
  name: string,
  json: CreatureExport,
  inputs: number[][],
) {
  Deno.test(
    `compactCreature: simplifies large weights for ${name} without changing behaviour (issue #642)`,
    () => {
      const creature = Creature.fromJSON(json);
      const beforeMax = maxAbsWeightAndBias(creature);
      assert(
        beforeMax >= 1e6,
        "Sanity check: expected a very large starting value",
      );

      const compacted = compactCreature(creature, true);

      // TDD expectation: once we support this squash, compaction should rescale.
      assert(compacted, "Expected compaction to occur (weight normalisation)");
      compacted.validate();

      const afterMax = maxAbsWeightAndBias(compacted);
      assert(
        afterMax < beforeMax,
        `Expected max abs weight/bias to reduce (before=${beforeMax}, after=${afterMax})`,
      );

      for (const input of inputs) {
        const a = creature.activate(new Float32Array(input), false);
        const b = compacted.activate(new Float32Array(input), false);
        assert(a.length === b.length);
        for (let i = 0; i < a.length; i++) {
          assertAlmostEquals(
            a[i],
            b[i],
            1e-6,
            `${name} input=${JSON.stringify(input)} idx=${i} expected=${
              a[i]
            } actual=${b[i]}`,
          );
        }
      }
    },
  );
}

// Linear squashes (weighted sum + bias, then squash)
assertCompactionSimplifies(
  ReLU.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: ReLU.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 1,
    output: 1,
  },
  [[-3], [-1], [0], [1], [3]],
);

assertCompactionSimplifies(
  LeakyReLU.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: LeakyReLU.NAME, bias: -1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 1,
    output: 1,
  },
  [[-3], [-1], [-0.25], [0.25], [1], [3]],
);

// Aggregate squashes (NeuronActivationInterface) - still scale-homogeneous in our implementations.
assertCompactionSimplifies(
  MAXIMUM.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: MAXIMUM.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 2,
    output: 1,
  },
  [[-2, -2], [-2, 2], [2, -2], [2, 2]],
);

assertCompactionSimplifies(
  MINIMUM.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: MINIMUM.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 2,
    output: 1,
  },
  [[-2, -2], [-2, 2], [2, -2], [2, 2]],
);

assertCompactionSimplifies(
  IF.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IF.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 1e6,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: 1e6,
        type: "positive",
      },
      // Use a distinct source UUID for negative to avoid duplicate from/to pairs.
      {
        fromUUID: "input-2",
        toUUID: "hidden-0",
        weight: -1e6,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 3,
    output: 1,
  },
  [[-2, -3, -4], [-2, 3, 4], [2, -3, -4], [2, 3, 4]],
);

assertCompactionSimplifies(
  HYPOT.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: HYPOT.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 2,
    output: 1,
  },
  [[-2, -2], [-2, 2], [2, -2], [2, 2]],
);

assertCompactionSimplifies(
  HYPOTv2.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: HYPOTv2.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 2,
    output: 1,
  },
  [[-2, -2], [-2, 2], [2, -2], [2, 2]],
);

assertCompactionSimplifies(
  MEAN.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: MEAN.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 2,
    output: 1,
  },
  [[-2, -2], [-2, 2], [2, -2], [2, 2]],
);

// Sanity: keep the existing supported ones covered here too (optional redundancy).
assertCompactionSimplifies(
  ABSOLUTE.NAME,
  {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: ABSOLUTE.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 1,
    output: 1,
  },
  [[-3], [-1], [0], [1], [3]],
);
