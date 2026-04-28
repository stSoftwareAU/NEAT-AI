/**
 * Issue #2466 — Permanent regression test for `wasmPropagateTopological` traps.
 *
 * Background (Issue #2460):
 *
 *   Bumping the pinned `neatCore.rev` to commits in the range
 *   `142860e..1d45e52b` introduced a `RuntimeError: unreachable` trap inside
 *   the WASM `propagate_topological` shim — caused by a byte-packed ABI
 *   mismatch between the TypeScript encoder
 *   (`src/propagate/WasmTopologicalBackprop.ts`) and the Rust decoder
 *   (`neat-core/src/wasm_exports.rs`). The trap surfaced indirectly as ~120
 *   downstream convergence assertions failing with what looked like ordinary
 *   numerical noise; the real cause was only visible in the trap stack.
 *
 *   `propagate_topological` is on the AGENTS.md "WASM-only operations (no
 *   TS fallback)" list, so a TypeScript-side guard test is the only line of
 *   defence against an ABI regression. This test drives the WASM path
 *   end-to-end with the exact creature shape from the original repro
 *   (`docs/evidence/2461-repro.ts`) — 5 inputs / 4 hidden (IDENTITY) /
 *   2 outputs (MAXIMUM) — and asserts that:
 *
 *     1. The backprop call returns without throwing a `RuntimeError`.
 *     2. The accumulation state has the expected shape and contains finite
 *        values (no `NaN`/`Infinity` outside the documented `Infinity`
 *        sentinel for the special-neuron fallback path).
 *
 *   The test is deterministic — inputs are produced by a seeded LCG, no
 *   `Math.random()` outside that helper — and finishes well under five
 *   seconds on local hardware.
 *
 *   Verified manually that this test FAILS against the bad pin
 *   `1d45e52bc4d15ed1f4c0435ca8bbdd20b78a64c4` (the trap is thrown from
 *   `creature.propagate(...)`) and PASSES against the fixed pin currently
 *   recorded in `deno.json`.
 */

import { assert } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";

/**
 * Seeded linear congruential generator — keeps the regression test
 * deterministic without depending on `Math.random()`. Values returned in
 * `[-1.5, 1.5)` to mirror the original repro's input distribution.
 */
function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG constants — adequate for deterministic test data.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return ((state / 0x1_0000_0000) * 3) - 1.5;
  };
}

/**
 * Network shape from the original `1d45e52b` reproducer — 5 inputs through
 * 4 IDENTITY hidden neurons into 2 MAXIMUM outputs, with a synthetic-style
 * cross-layer synapse (`h-B → h-D`, `h-C → h-D`) so the reverse-topological
 * loop has something deeper than a single layer to walk.
 */
function buildTrapGuardCreature(): Creature {
  const json: CreatureExport = {
    input: 5,
    output: 2,
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
      // Synthetic-style cross-layer hop — `h-D` sits between hidden and output.
      { fromUUID: "h-B", toUUID: "h-D", weight: -1.1 },
      { fromUUID: "h-C", toUUID: "h-D", weight: -0.8 },
      { fromUUID: "h-C", toUUID: "output-1", weight: 0.2 },
      { fromUUID: "h-D", toUUID: "output-0", weight: -0.5 },
      { fromUUID: "h-D", toUUID: "output-1", weight: -0.4 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test("WasmPropagateTopologicalTrapGuard: backprop loop does not trap (Issue #2460)", async () => {
  await ensureWasmActivation();
  assert(
    isWasmActivationAvailable(),
    "WASM must be available for this regression test — the trap can only be " +
      "observed via the WASM-only `propagate_topological` path.",
  );

  const creature = buildTrapGuardCreature();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 0.1,
    plankConstant: 1e-7,
    disableRandomSamples: true,
    batchSize: 64,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  // 100 deterministic samples — enough depth in the reverse-topological loop
  // to consistently surface the bounds-check panic on a bad pin.
  const rng = makeSeededRng(0xC0FFEE);
  const samples: Float32Array[] = [];
  for (let i = 0; i < 100; i++) {
    samples.push(
      new Float32Array([rng(), rng(), rng(), rng(), rng()]),
    );
  }

  // Fixed target distinct from the network's natural output so the WASM
  // backprop path actually accumulates non-zero error into per-neuron state.
  const target = new Float32Array([0.42, -0.31]);

  for (const inFloat of samples) {
    creature.activateAndTrace(inFloat, false, sparseConfig);
    // The function under guard. Throws `RuntimeError: unreachable` on a
    // bad pin; returns normally on a good pin.
    creature.propagate(target, config, sparseConfig);
  }
  creature.propagateUpdate(config, sparseConfig);

  // ---- Shape & finite-value assertions on the accumulation state. ----
  const state = creature.state;

  // Every neuron's accumulator floats must be finite. The only documented
  // `Infinity` sentinel lives in the raw WASM result buffer (`cachedAct` for
  // the special-neuron fallback path) — by the time WasmTopologicalBackprop
  // returns, every `state.node(i)` accumulator must hold a real number.
  // Note: MAXIMUM/IF/MINIMUM output neurons take the TS-fallback path and so
  // do not accumulate `totalErrorAbsolute` directly; we therefore look for
  // accumulated error on *any* neuron, not specifically outputs.
  let sawNeuronError = false;
  for (let i = 0; i < creature.neurons.length; i++) {
    const ns = state.node(i);
    if (ns.totalErrorAbsolute > 0) sawNeuronError = true;
    assert(
      Number.isFinite(ns.totalErrorAbsolute),
      `node(${i}).totalErrorAbsolute must be finite, got ${ns.totalErrorAbsolute}`,
    );
    assert(
      Number.isFinite(ns.totalBias),
      `node(${i}).totalBias must be finite, got ${ns.totalBias}`,
    );
    assert(
      Number.isFinite(ns.totalAdjustedBias),
      `node(${i}).totalAdjustedBias must be finite, got ${ns.totalAdjustedBias}`,
    );
  }
  assert(
    sawNeuronError,
    "At least one neuron should have totalErrorAbsolute > 0 after 100 " +
      "training samples — if all neurons report zero error, the WASM result " +
      "buffer was not written back into creature state.",
  );

  // Synapse-level state shape: at least one connection must have been
  // touched (count > 0) and every recorded accumulator must be finite.
  let sawSynapseUpdate = false;
  for (const syn of creature.synapses) {
    const cs = state.connection(syn.from, syn.to);
    if (cs.count > 0) sawSynapseUpdate = true;
    assert(
      Number.isFinite(cs.totalPositiveActivation),
      `connection(${syn.from},${syn.to}).totalPositiveActivation must be finite`,
    );
    assert(
      Number.isFinite(cs.totalNegativeActivation),
      `connection(${syn.from},${syn.to}).totalNegativeActivation must be finite`,
    );
    assert(
      Number.isFinite(cs.totalPositiveAdjustedValue),
      `connection(${syn.from},${syn.to}).totalPositiveAdjustedValue must be finite`,
    );
    assert(
      Number.isFinite(cs.totalNegativeAdjustedValue),
      `connection(${syn.from},${syn.to}).totalNegativeAdjustedValue must be finite`,
    );
  }
  assert(
    sawSynapseUpdate,
    "At least one synapse must show count > 0 after 100 samples — otherwise " +
      "the WASM accumulation state was not deserialised back into creature state.",
  );

  // Cached activations populated by the WASM result must also be finite.
  // `cacheAdjustedActivation` is a `DenseNumberMap` keyed by neuron index, so
  // iterate over the neuron range and probe by `has(...)`.
  for (let i = 0; i < creature.neurons.length; i++) {
    if (!state.cacheAdjustedActivation.has(i)) continue;
    const value = state.cacheAdjustedActivation.get(i)!;
    assert(
      Number.isFinite(value),
      `cacheAdjustedActivation[${i}] must be finite, got ${value}`,
    );
  }
});
