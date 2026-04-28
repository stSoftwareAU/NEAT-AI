/**
 * Issue #2461 — Minimal repro for `RuntimeError: unreachable` trap inside
 * `propagate_topological` introduced by NEAT-AI-core commit `142860e`.
 *
 * Pre-condition (taken care of by the worker): the vendored
 * `wasm_activation/pkg/` was sourced from a NEAT-AI-core revision in the range
 * `142860e..1d45e52b`. Earlier pins (e.g. `36ac4ea3`) do not trap.
 *
 * Run:
 *   ./build.sh --rev=1d45e52bc4d15ed1f4c0435ca8bbdd20b78a64c4
 *   deno run -A docs/evidence/2461-repro.ts
 *
 *   ./build.sh --rev=36ac4ea34fcd4e89d9fad3d6fae9efc5f02c8959   # baseline pin
 *   deno run -A docs/evidence/2461-repro.ts                       # passes
 *
 * Network shape (smallest creature that reproduces the trap):
 *
 *   inputs (5) ─┐         ┌── hidden A (IDENTITY) ──┐
 *               ├──────►──┤                          ├──► output-0 (MAXIMUM)
 *               │         └── hidden B (IDENTITY) ──┤
 *               │         ┌── hidden C (IDENTITY) ──┤
 *               └──────►──┤                          ├──► output-1 (MAXIMUM)
 *                         └── hidden D (IDENTITY) ──┘
 *
 * Trap stack (observed at pin `1d45e52b`):
 *   wasm_activation_bg.wasm:1:184056   ← reverse-topological loop bounds panic
 *   wasm_activation_bg.wasm:1:198533
 *   wasm_activation_bg.wasm:1:314079
 *   propagate_topological            (wasm_activation.js)
 *   wasmPropagateTopological         (src/wasm/WasmStandaloneFunctions.ts:601)
 *   wasmTopologicalBackprop          (src/propagate/WasmTopologicalBackprop.ts:289)
 *   propagateTopological             (src/propagate/TopologicalBackpropagation.ts:40)
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

// 5-input / 4-hidden / 2-output, MAXIMUM output activations — exercises the
// reverse-topological backprop path inside `propagate_topological_loop`.
const json: CreatureExport = {
  neurons: [
    { type: "hidden", uuid: "h-A", bias: -0.2, squash: "IDENTITY" },
    { type: "hidden", uuid: "h-B", bias: -0.1, squash: "IDENTITY" },
    { type: "hidden", uuid: "h-C", bias: 0.3, squash: "IDENTITY" },
    { type: "hidden", uuid: "h-D", bias: -0.3, squash: "IDENTITY" },
    { type: "output", uuid: "output-0", bias: 0.4, squash: "MAXIMUM" },
    { type: "output", uuid: "output-1", bias: 0.3, squash: "MAXIMUM" },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "h-A", weight: -0.7 },
    { fromUUID: "input-1", toUUID: "h-A", weight: 0.7 },
    { fromUUID: "input-1", toUUID: "h-C", weight: 0.4 },
    { fromUUID: "input-2", toUUID: "h-C", weight: 0.3 },
    { fromUUID: "input-3", toUUID: "h-B", weight: 0.6 },
    { fromUUID: "input-3", toUUID: "h-C", weight: 1.1 },
    { fromUUID: "input-4", toUUID: "h-B", weight: -0.6 },
    { fromUUID: "h-A", toUUID: "output-0", weight: 1.0 },
    { fromUUID: "h-B", toUUID: "h-D", weight: -1.1 },
    { fromUUID: "h-C", toUUID: "h-D", weight: -0.8 },
    { fromUUID: "h-C", toUUID: "output-1", weight: 0.2 },
    { fromUUID: "h-D", toUUID: "output-0", weight: -0.5 },
    { fromUUID: "h-D", toUUID: "output-1", weight: -0.4 },
  ],
  input: 5,
  output: 2,
};

const creature = Creature.fromJSON(json);
creature.validate();

const config = createBackPropagationConfig({
  generations: 0,
  learningRate: 0.1,
});
const sparseConfig = new SparseConfig(creature.exportJSON(), config);

// Repeated samples in the same propagation cycle drive the reverse-topological
// loop deep enough to hit the bounds-check panic on a bad pin.
const inputs: number[][] = [];
for (let i = 0; i < 100; i++) {
  inputs.push([
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
    Math.random() * 3 - 1.5,
  ]);
}

for (const input of inputs) {
  const inFloat = new Float32Array(input);
  const target = creature.activate(inFloat);
  creature.activateAndTrace(inFloat, false, sparseConfig);
  creature.propagate(
    new Float32Array(Array.from(target)),
    config,
    sparseConfig,
  );
}
creature.propagateUpdate(config, sparseConfig);
console.log("OK — propagate_topological returned without trapping");
