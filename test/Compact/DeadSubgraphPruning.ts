import { assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { pruneDeadSubgraphsInCreature } from "../../src/compact/CompactUtils.ts";
import { initWasmActivation } from "../../src/wasm/WasmActivation.ts";

// Get the project root directory for WASM module path
const projectRoot = new URL("../..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-live", squash: "TANH", bias: 0.1 },

      // Dead subgraph: internally connected (not orphaned), but has no path to any output.
      { type: "hidden", uuid: "hidden-dead-1", squash: "TANH", bias: -0.2 },
      { type: "hidden", uuid: "hidden-dead-2", squash: "TANH", bias: 0.3 },

      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-live", weight: 1.25 },
      { fromUUID: "hidden-live", toUUID: "output-0", weight: -0.75 },

      { fromUUID: "input-0", toUUID: "hidden-dead-1", weight: 0.9 },
      { fromUUID: "hidden-dead-1", toUUID: "hidden-dead-2", weight: -0.4 },
      { fromUUID: "hidden-dead-2", toUUID: "hidden-dead-1", weight: 0.2 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test("Dead subgraph pruning: removes unreachable subgraph without changing outputs", () => {
  const creature = makeCreature();
  const beforeNeuronCount = creature.neurons.length;
  const beforeSynapseCount = creature.synapses.length;

  const rnd = mulberry32(20251229);
  const inputs: Float32Array[] = [];
  for (let i = 0; i < 256; i++) {
    // Keep values moderate to avoid saturating everything.
    inputs.push(new Float32Array([(rnd() * 2 - 1) * 0.75]));
  }

  const beforeOutputs = inputs.map((x) => creature.activate(x));

  const result = pruneDeadSubgraphsInCreature(creature);
  assertEquals(result.removedNeurons, 2);
  assertEquals(result.removedSynapses, 3);

  creature.validate();

  assertEquals(creature.neurons.length, beforeNeuronCount - 2);
  assertEquals(creature.synapses.length, beforeSynapseCount - 3);

  for (let i = 0; i < inputs.length; i++) {
    const after = creature.activate(inputs[i]);
    assertAlmostEquals(after[0], beforeOutputs[i][0], 0.000_000_1);
  }
});
