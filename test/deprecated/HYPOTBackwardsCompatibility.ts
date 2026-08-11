/**
 * Issue #3446 — `HYPOT` is deprecated, but its two production call sites are
 * deliberately retained:
 *
 * 1. the {@link Activations} registry, so a pre-v2.0.0 serialised creature can
 *    still be deserialised (and then upgraded to SQRT/SQUARE), and
 * 2. the `simplifyLargeWeights` supported-squash list, so such a creature is
 *    still compacted rather than silently skipped.
 *
 * These tests fail if either call site is removed.
 *
 * @module
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import {
  calculateWeightBiasPenalty,
  simplifyLargeWeights,
} from "@compact/SimplifyLargeWeights.ts";
import { HYPOT } from "@deprecated/HYPOT.ts";

Deno.test("HYPOT: a serialised creature still deserialises, repairs and activates", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: HYPOT.NAME, bias: 0.5 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 2 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
    input: 2,
    output: 1,
  });

  // `fix()` resolves the squash name through the registry, so this throws
  // `ActivationError` if the HYPOT registration is dropped.
  creature.fix();

  const result = creature.activate(new Float32Array([1, 2]));

  // HYPOT takes the hypotenuse of the weighted inbound values, then adds the
  // bias: hypot(1*2, 2*-3) + 0.5.
  assertAlmostEquals(result[0], Math.hypot(2, -6) + 0.5, 1e-5);
});

Deno.test("HYPOT: simplifyLargeWeights rescales an imbalanced HYPOT neuron", () => {
  const exported: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: HYPOT.NAME, bias: 1e6 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 2,
    output: 1,
  };
  normaliseCreatureExport(exported);

  const beforePenalty = calculateWeightBiasPenalty(exported);

  const changed = simplifyLargeWeights(exported);

  assert(changed, "HYPOT is scale-homogeneous — expected a rescaling");
  const afterPenalty = calculateWeightBiasPenalty(exported);
  assert(
    afterPenalty < beforePenalty,
    `penalty should drop (before=${beforePenalty}, after=${afterPenalty})`,
  );
});
