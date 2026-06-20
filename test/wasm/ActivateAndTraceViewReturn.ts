/**
 * WASM activateAndTrace() Zero-Copy View Return Tests
 *
 * Issue #3085 - perf: Return zero-copy views from WASM activateAndTrace instead
 *               of throwaway Float32Arrays.
 *
 * `activateAndTrace` returns `activations` and `hintValues` as zero-copy
 * `subarray` views into the per-call `result` buffer rather than freshly
 * allocated copies. These tests pin the observable behaviour that must hold for
 * that optimisation to be correct:
 *
 *   1. Numeric outputs are unchanged for a known network.
 *   2. The returned views stay valid and independent across consecutive calls
 *      (the `result` buffer is a fresh per-call copy, not a live WASM
 *      linear-memory view that a later call would overwrite).
 */

import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import {
  compileCreatureToWasm,
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "@wasm/mod.ts";

const TOLERANCE = 1e-5;

// A tiny deterministic network: 2 inputs, 1 hidden ReLU, 1 output IDENTITY.
//   hidden (index 2, bias 0.5, ReLU):     in0*1.0 + in1*-0.5 + 0.5
//   output (index 3, bias -0.2, IDENTITY): hidden*2.0 - 0.2
function makeNetwork(): Creature {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", index: 2, bias: 0.5, squash: "ReLU" },
      { type: "output", index: 3, bias: -0.2, squash: "IDENTITY" },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: -0.5 },
      { from: 2, to: 3, weight: 2.0 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.fix();
  creature.clearState();
  return creature;
}

Deno.test({
  name: "activateAndTrace view-return: Module initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

Deno.test({
  name: "activateAndTrace view-return: numeric outputs are correct",
  fn() {
    const compiled = compileCreatureToWasm(makeNetwork());
    const wasm = WasmCreatureActivation.create(compiled);
    assert(wasm, "Should create WASM activation");

    const trace = wasm.activateAndTrace(new Float32Array([1.0, 2.0]));

    // hidden pre = 1*1.0 + 2*-0.5 + 0.5 = 0.5 -> ReLU -> 0.5
    // output pre = 0.5*2.0 - 0.2 = 0.8 -> IDENTITY -> 0.8
    assertAlmostEquals(trace.outputs[0], 0.8, TOLERANCE, "output");

    // Non-input neurons in index order: hidden (2), output (3).
    assertAlmostEquals(trace.activations[0], 0.5, TOLERANCE, "hidden act");
    assertAlmostEquals(trace.activations[1], 0.8, TOLERANCE, "output act");

    // For these standard squashes hintValue == pre-squash weighted sum + bias.
    assertAlmostEquals(trace.hintValues[0], 0.5, TOLERANCE, "hidden hint");
    assertAlmostEquals(trace.hintValues[1], 0.8, TOLERANCE, "output hint");
  },
});

Deno.test({
  name:
    "activateAndTrace view-return: earlier result survives a later call (per-call buffer)",
  fn() {
    const compiled = compileCreatureToWasm(makeNetwork());
    const wasm = WasmCreatureActivation.create(compiled);
    assert(wasm, "Should create WASM activation");

    // First call — retain its views.
    const first = wasm.activateAndTrace(new Float32Array([1.0, 2.0]));
    const firstActivations = Float32Array.from(first.activations);
    const firstHintValues = Float32Array.from(first.hintValues);

    // Second call with different input must not corrupt the first result's
    // views. If `result` aliased live WASM memory, this would overwrite them.
    const second = wasm.activateAndTrace(new Float32Array([0.5, -1.0]));

    // hidden pre = 0.5*1.0 + -1.0*-0.5 + 0.5 = 1.5 -> ReLU -> 1.5
    // output pre = 1.5*2.0 - 0.2 = 2.8
    assertAlmostEquals(second.activations[0], 1.5, TOLERANCE, "2nd hidden act");
    assertAlmostEquals(second.activations[1], 2.8, TOLERANCE, "2nd output act");

    // First result still holds its original values.
    for (let i = 0; i < first.activations.length; i++) {
      assertAlmostEquals(
        first.activations[i],
        firstActivations[i],
        TOLERANCE,
        `first activations[${i}] unchanged`,
      );
      assertAlmostEquals(
        first.hintValues[i],
        firstHintValues[i],
        TOLERANCE,
        `first hintValues[${i}] unchanged`,
      );
    }
  },
});
