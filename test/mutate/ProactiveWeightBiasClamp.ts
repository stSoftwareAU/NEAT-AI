/**
 * Tests for Issue #2421: proactive weight/bias clamping at mutation and
 * training write sites.
 *
 * Issue #2378/#2384 added a reactive clamp when a creature is loaded from
 * JSON. Those tests live in `test/creature/WeightBiasOverflowClamp.ts`. This
 * suite verifies the *proactive* half: that mutation operators and training
 * propagation cannot produce an out-of-range value in memory, even when
 * regularisation limits are disabled (Infinity) — so a runaway value cannot
 * compound through scoring or serialisation before the next save/load cycle.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { ModWeight } from "@mutate/ModWeight.ts";
import { ModBias } from "@mutate/ModBias.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "@config/WeightRegularisationConfig.ts";
import {
  DEFAULT_BIAS_REGULARISATION_CONFIG,
  type RequiredBiasRegularisationConfig,
} from "@config/BiasRegularisationConfig.ts";
import { MAX_SAFE_WEIGHT_BIAS } from "@utils/WeightBiasClamp.ts";
import {
  clampAndTrack,
  getOverflowGuardStats,
  resetOverflowGuardStats,
} from "@utils/OverflowGuardStats.ts";
import { applyHebbianUpdate } from "@predictiveCoding/PredictiveCodingLearning.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Creates a minimal creature with a single synapse and a known weight.
 */
function makeWeightCreature(initialWeight: number): Creature {
  return Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: initialWeight },
    ],
  });
}

/**
 * Creates a minimal creature with a single non-input neuron carrying a known bias.
 */
function makeBiasCreature(initialBias: number): Creature {
  return Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      {
        type: "output" as const,
        uuid: "output-0",
        bias: initialBias,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  });
}

Deno.test(
  "ModWeight proactively clamps when maxAbsoluteWeight is disabled (Infinity)",
  () => {
    // Seed just below MAX_SAFE_INTEGER so the L2/small-change maths keeps the
    // value finite but well over the safe range. fromJSON will clamp on load,
    // so we must inject the extreme value *after* construction to simulate an
    // in-memory runaway.
    const creature = makeWeightCreature(1);
    creature.synapses[0].weight = 9.9e15;

    const config: RequiredWeightRegularisationConfig = {
      ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
      enabled: true,
      // Disable the regulariser's own hard limit so only the proactive
      // overflow guard can keep the value in range.
      maxAbsoluteWeight: Number.POSITIVE_INFINITY,
      maxWeightChange: Number.POSITIVE_INFINITY,
    };

    const modWeight = new ModWeight(creature, config);
    resetOverflowGuardStats();

    // Run many mutations. Regardless of RNG draws the operator must never
    // write a weight above MAX_SAFE_WEIGHT_BIAS.
    for (let i = 0; i < 200; i++) {
      modWeight.mutate();
      const w = creature.synapses[0].weight;
      assert(
        Math.abs(w) <= MAX_SAFE_WEIGHT_BIAS,
        `Weight ${w} exceeded MAX_SAFE_WEIGHT_BIAS after iteration ${i}`,
      );
    }

    // At least one of those mutations should have hit the clamp.
    const stats = getOverflowGuardStats();
    assert(
      stats.counts["mutation.weight"] >= 1,
      `Expected proactive weight clamps to fire at least once, got ${
        stats.counts["mutation.weight"]
      }`,
    );
  },
);

Deno.test(
  "ModBias proactively clamps when maxAbsoluteBias is disabled (Infinity)",
  () => {
    const creature = makeBiasCreature(1);
    // Inject an extreme bias past construction to simulate a runaway already
    // in memory.
    creature.neurons[creature.input].bias = 9.9e15;

    const config: RequiredBiasRegularisationConfig = {
      ...DEFAULT_BIAS_REGULARISATION_CONFIG,
      enabled: true,
      maxAbsoluteBias: Number.POSITIVE_INFINITY,
      maxBiasChange: Number.POSITIVE_INFINITY,
    };

    const modBias = new ModBias(creature, config);
    resetOverflowGuardStats();

    for (let i = 0; i < 200; i++) {
      modBias.mutate();
      const b = creature.neurons[creature.input].bias;
      assert(
        Math.abs(b) <= MAX_SAFE_WEIGHT_BIAS,
        `Bias ${b} exceeded MAX_SAFE_WEIGHT_BIAS after iteration ${i}`,
      );
    }

    const stats = getOverflowGuardStats();
    assert(
      stats.counts["mutation.bias"] >= 1,
      `Expected proactive bias clamps to fire at least once, got ${
        stats.counts["mutation.bias"]
      }`,
    );
  },
);

Deno.test(
  "applyHebbianUpdate proactively clamps overflow produced by a large delta",
  () => {
    const creature = makeWeightCreature(1);
    // Put the synapse within range so the starting state is plausible.
    creature.synapses[0].weight = 1;
    const initialBias = creature.neurons[creature.input].bias;

    // Simulate a pathological gradient: a large positive delta applied in a
    // single Hebbian step. The predictive-coding learner normally keeps deltas
    // small, but we want to prove the guard catches any delta that overflows.
    const gradients = {
      synapseGradients: [{
        synapseIndex: 0,
        delta: 1e200,
      }],
      biasGradients: [{
        neuronIndex: creature.input,
        delta: 1e200,
      }],
    };

    resetOverflowGuardStats();
    applyHebbianUpdate(creature, gradients);

    assertEquals(creature.synapses[0].weight, MAX_SAFE_WEIGHT_BIAS);
    const newBias = creature.neurons[creature.input].bias;
    assert(
      Math.abs(newBias) <= MAX_SAFE_WEIGHT_BIAS,
      `Bias ${newBias} (started ${initialBias}) exceeded MAX_SAFE_WEIGHT_BIAS`,
    );
    assertEquals(newBias, MAX_SAFE_WEIGHT_BIAS);

    const stats = getOverflowGuardStats();
    assertEquals(stats.counts["predictiveCoding.weight"], 1);
    assertEquals(stats.counts["predictiveCoding.bias"], 1);
  },
);

Deno.test(
  "clampAndTrack is available for direct use by any new write site",
  () => {
    // Sanity: ensures the shared helper is exported and behaves as documented.
    resetOverflowGuardStats();
    const out = clampAndTrack(1e200, "rustFfi.weight", "proactive-test");
    assertEquals(out, MAX_SAFE_WEIGHT_BIAS);
    assertEquals(getOverflowGuardStats().counts["rustFfi.weight"], 1);
  },
);
