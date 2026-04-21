/**
 * Tests for ModWeight no-op retry behaviour (Issue #2383).
 *
 * `MOD_WEIGHT` occasionally returned `false` without touching any synapse,
 * wasting a mutation slot and producing noisy telemetry. These tests verify:
 *
 * 1. When a single synapse selection yields a no-op (e.g. clamped at the
 *    boundary), the operator retries with a different synapse and/or a fresh
 *    modification draw, within a bounded retry budget.
 * 2. When every synapse is genuinely unable to change (e.g. maxWeightChange
 *    is zero), the operator returns false cleanly without throwing.
 * 3. The operator still returns true when at least one reachable synapse can
 *    produce an observable change.
 * 4. The operator always returns false when there are no mutable synapses.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { ModWeight } from "@mutate/ModWeight.ts";
import {
  DEFAULT_WEIGHT_REGULARISATION_CONFIG,
  type RequiredWeightRegularisationConfig,
} from "@config/WeightRegularisationConfig.ts";

function snapshotWeights(creature: Creature): number[] {
  return creature.synapses.map((s) => s.weight);
}

function weightsUnchanged(before: number[], after: number[]): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return false;
  }
  return true;
}

/**
 * Creates a creature with several mutable synapses.
 */
function createCreature(weights: number[]): Creature {
  const json: CreatureExport = {
    input: weights.length,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: weights.map((w, i) => ({
      fromUUID: `input-${i}`,
      toUUID: "output-0",
      weight: w,
    })),
  };
  return Creature.fromJSON(json, true);
}

Deno.test(
  "ModWeight: returns false cleanly when maxWeightChange is zero (all attempts are no-ops)",
  () => {
    const creature = createCreature([1, -2, 3, -4, 5]);
    const config: RequiredWeightRegularisationConfig = {
      ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
      maxWeightChange: 0,
    };
    const modWeight = new ModWeight(creature, config);

    const before = snapshotWeights(creature);
    const changed = modWeight.mutate();
    const after = snapshotWeights(creature);

    assertEquals(
      changed,
      false,
      "should return false when no synapse can be changed",
    );
    assert(
      weightsUnchanged(before, after),
      "weights must not be modified when no change is possible",
    );
  },
);

Deno.test(
  "ModWeight: retries past a no-op synapse to find a changeable one",
  () => {
    // One synapse is pinned at the positive maxAbsoluteWeight boundary, the
    // others are well inside the range. A single-shot selection frequently
    // lands on the pinned synapse and — when the random modification is
    // positive — produces a no-op via clamping. With retry logic in place,
    // this should reliably succeed within a small budget.
    const maxAbs = 5;
    const config: RequiredWeightRegularisationConfig = {
      ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
      maxAbsoluteWeight: maxAbs,
      maxWeightChange: 1,
      l2Strength: 0,
      preferSmallChanges: false,
    };

    // Use many mutable synapses and a single pinned one so random selection
    // usually reaches a mutable synapse within retry budget.
    const creature = createCreature([maxAbs, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const modWeight = new ModWeight(creature, config);

    let successes = 0;
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
      // Reset weights each iteration to keep the test deterministic in shape.
      creature.synapses[0].weight = maxAbs;
      creature.synapses[1].weight = 0.1;
      creature.synapses[2].weight = 0.2;
      creature.synapses[3].weight = 0.3;
      creature.synapses[4].weight = 0.4;
      creature.synapses[5].weight = 0.5;
      creature.synapses[6].weight = 0.6;

      const before = snapshotWeights(creature);
      const changed = modWeight.mutate();
      const after = snapshotWeights(creature);
      if (changed) {
        assert(
          !weightsUnchanged(before, after),
          "when mutate() returns true, weights must have changed",
        );
        successes++;
      }
    }

    // With retries enabled, we expect essentially every attempt to succeed.
    // Without retries, roughly half would fail whenever the pinned synapse is
    // selected with a positive modification. Assert a very high success rate.
    assert(
      successes >= iterations - 5,
      `expected almost all iterations to change a weight; got ${successes}/${iterations}`,
    );
  },
);

Deno.test(
  "ModWeight: returns false cleanly when creature has no mutable synapses",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [],
    };
    const creature = Creature.fromJSON(json, true);
    const modWeight = new ModWeight(creature);
    assertEquals(modWeight.mutate(), false);
  },
);

Deno.test(
  "ModWeight: never reports changed=true without actually changing a weight",
  () => {
    // Stress test — across many random mutations with a punishing config, a
    // return value of `true` must always correspond to an observable weight
    // change. This would catch the original silent no-op bug.
    const creature = createCreature([5, -5, 5, -5, 5, -5]);
    const config: RequiredWeightRegularisationConfig = {
      ...DEFAULT_WEIGHT_REGULARISATION_CONFIG,
      maxAbsoluteWeight: 5,
      maxWeightChange: 0.5,
    };
    const modWeight = new ModWeight(creature, config);

    for (let i = 0; i < 500; i++) {
      const before = snapshotWeights(creature);
      const changed = modWeight.mutate();
      const after = snapshotWeights(creature);
      if (changed) {
        assert(
          !weightsUnchanged(before, after),
          `iteration ${i}: mutate() returned true but no weight changed`,
        );
      } else {
        assert(
          weightsUnchanged(before, after),
          `iteration ${i}: mutate() returned false but a weight changed`,
        );
      }
    }
  },
);
