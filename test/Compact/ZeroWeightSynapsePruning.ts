import { assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
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
      { type: "hidden", uuid: "hidden-unused", squash: "TANH", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      // This path is live and determines outputs.
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.25 },

      // These synapses are behaviour-preserving dead weight:
      // hidden-unused influences output only via a zero-weight edge.
      { fromUUID: "input-0", toUUID: "hidden-unused", weight: -0.5 },
      { fromUUID: "hidden-unused", toUUID: "output-0", weight: 0 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test("Compact: prunes zero-weight synapses then removes newly-orphaned neurons (behaviour-preserving)", () => {
  const creature = makeCreature();
  const beforeNeuronCount = creature.neurons.length;
  const beforeSynapseCount = creature.synapses.length;

  const rnd = mulberry32(20251229);
  const inputs: Float32Array[] = [];
  for (let i = 0; i < 256; i++) {
    inputs.push(new Float32Array([(rnd() * 2 - 1) * 0.9]));
  }

  const beforeOutputs = inputs.map((x) => creature.activate(x));

  const compacted = creature.compact(false);

  // Without zero-weight pruning inside compaction, this would be undefined because
  // the network remains structurally unchanged (the dead-weight edge keeps the
  // hidden neuron "connected").
  assertEquals(typeof compacted !== "undefined", true);

  compacted!.validate();

  // Zero-weight synapse should be removed, which should orphan the hidden neuron,
  // which should then be removed by orphan cleanup.
  assertEquals(compacted!.neurons.length, beforeNeuronCount - 1);
  // We remove:
  // - the zero-weight synapse (hidden-unused -> output-0)
  // - the inbound synapse to the newly removed neuron (input-0 -> hidden-unused)
  assertEquals(compacted!.synapses.length, beforeSynapseCount - 2);
  assertEquals(compacted!.synapses.some((s) => s.weight === 0), false);
  assertEquals(
    compacted!.neurons.some((n) => n.uuid === "hidden-unused"),
    false,
  );

  for (let i = 0; i < inputs.length; i++) {
    const after = compacted!.activate(inputs[i]);
    assertAlmostEquals(after[0], beforeOutputs[i][0], 0.000_000_1);
  }
});
