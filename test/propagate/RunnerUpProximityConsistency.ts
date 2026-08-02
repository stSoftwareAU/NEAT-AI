/**
 * Issue #3635: the runner-up proximity rule must agree between
 * `activateAndTrace` (which marks a close runner-up as `used`) and
 * `propagate` (which leaks it a fraction of the gradient) for both
 * extremum aggregates.
 *
 * When the two disagreed, a connection could receive leaked gradient in
 * `propagate` yet never be marked `used`, so `applyLearnings` disconnected a
 * connection that was still learning. The divergence was the magnitude floor:
 * tracing floored at 1e-12, propagation at `config.plankConstant` (1e-7 by
 * default), so any winner magnitude between the two produced two different
 * windows.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import type { SynapseState } from "@propagate/SynapseState.ts";

const RUNNER_UP_INDEX = 1;
const OUTPUT_INDEX = 2;

/**
 * Trace then propagate one sample through a two-input extremum neuron,
 * returning the runner-up synapse state.
 */
function traceAndPropagate(
  squash: MAXIMUM | MINIMUM,
  input: number[],
): SynapseState {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: squash.getName(), bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  // Default plank constant (1e-7) — the value that used to widen the
  // propagation window beyond the tracing window.
  const config = createBackPropagationConfig({
    generations: 1,
    disableRandomSamples: true,
    batchSize: 1000,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  const neuron = creature.neurons[OUTPUT_INDEX];
  creature.state.makeActivation(new Float32Array(input), false);
  squash.activateAndTrace(neuron);
  squash.propagate(neuron, 0.5, config, sparseConfig);

  return creature.state.connection(RUNNER_UP_INDEX, OUTPUT_INDEX);
}

/**
 * The invariant: a connection that received leaked gradient must have been
 * marked `used`, otherwise `applyLearnings` will disconnect it.
 */
function assertNoGradientToUnusedSynapse(cs: SynapseState, label: string) {
  assert(
    cs.count === 0 || cs.used === true,
    `${label}: runner-up received gradient (count=${cs.count}) but was not marked used (used=${cs.used})`,
  );
}

Deno.test("MAXIMUM: distant runner-up neither marked used nor leaked gradient (#3635)", () => {
  // Winner 1e-9 (between the two old floors), runner-up 1e-8 away: inside the
  // old propagation window (2e-8) but outside the tracing window (2e-10).
  const cs = traceAndPropagate(new MAXIMUM(), [1e-9, -9e-9]);

  assertNoGradientToUnusedSynapse(cs, "MAXIMUM");
  assertEquals(cs.used ?? false, false, "distant runner-up must not be used");
  assertEquals(cs.count, 0, "distant runner-up must not receive gradient");
});

Deno.test("MAXIMUM: close runner-up is both marked used and leaked gradient (#3635)", () => {
  // Runner-up 1e-10 away from a 1e-9 winner: inside the 2e-10 window.
  const cs = traceAndPropagate(new MAXIMUM(), [1e-9, 9e-10]);

  assertNoGradientToUnusedSynapse(cs, "MAXIMUM");
  assertEquals(cs.used, true, "close runner-up must be marked used");
  assert(cs.count > 0, "close runner-up must receive leaked gradient");
});

Deno.test("MINIMUM: distant runner-up neither marked used nor leaked gradient (#3635)", () => {
  // Mirror of the MAXIMUM case — runner-ups sit above the winning minimum.
  const cs = traceAndPropagate(new MINIMUM(), [-1e-9, 9e-9]);

  assertNoGradientToUnusedSynapse(cs, "MINIMUM");
  assertEquals(cs.used ?? false, false, "distant runner-up must not be used");
  assertEquals(cs.count, 0, "distant runner-up must not receive gradient");
});

Deno.test("MINIMUM: close runner-up is both marked used and leaked gradient (#3635)", () => {
  const cs = traceAndPropagate(new MINIMUM(), [-1e-9, -9e-10]);

  assertNoGradientToUnusedSynapse(cs, "MINIMUM");
  assertEquals(cs.used, true, "close runner-up must be marked used");
  assert(cs.count > 0, "close runner-up must receive leaked gradient");
});
