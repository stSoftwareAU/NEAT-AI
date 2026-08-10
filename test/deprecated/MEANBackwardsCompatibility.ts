/**
 * Issue #3448 — `MEAN` is deprecated, but its two production call sites are
 * deliberately retained:
 *
 * 1. the {@link Activations} registry, so an already-serialised creature (or a
 *    CRISPR DNA fragment) that carries `MEAN` still deserialises, and
 * 2. the `simplifyLargeWeights` supported-squash list, so such a creature is
 *    still compacted rather than silently skipped.
 *
 * The third test pins the replacement the deprecation tag only gestures at: a
 * `MEAN` neuron is exactly an `IDENTITY` neuron whose inbound weights are each
 * divided by the inbound synapse count, which is what "a normal neural network
 * can mimic the behavior of this activation" means in practice.
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
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { MEAN } from "@deprecated/MEAN.ts";

/** A serialised creature carrying a `MEAN` hidden neuron. */
function meanCreatureJSON(): CreatureExport {
  return {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: MEAN.NAME, bias: 0.5 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 2 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
    input: 2,
    output: 1,
  };
}

Deno.test("MEAN: a serialised creature still deserialises, repairs and activates", () => {
  const creature = Creature.fromJSON(meanCreatureJSON());

  // `fix()` resolves the squash name through the registry, so this throws
  // `ActivationError` if the MEAN registration is dropped.
  creature.fix();

  const result = creature.activate(new Float32Array([1, 2]));

  // MEAN averages the weighted inbound values, then adds the bias:
  // (1*2 + 2*-3) / 2 + 0.5.
  assertAlmostEquals(result[0], (1 * 2 + 2 * -3) / 2 + 0.5, 1e-5);
});

Deno.test("MEAN: simplifyLargeWeights rescales an imbalanced MEAN neuron", () => {
  const exported: CreatureExport = {
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
  };
  normaliseCreatureExport(exported);

  const beforePenalty = calculateWeightBiasPenalty(exported);

  const changed = simplifyLargeWeights(exported);

  assert(changed, "MEAN is scale-homogeneous — expected a rescaling");
  const afterPenalty = calculateWeightBiasPenalty(exported);
  assert(
    afterPenalty < beforePenalty,
    `penalty should drop (before=${beforePenalty}, after=${afterPenalty})`,
  );
});

Deno.test("MEAN: an IDENTITY neuron with weights scaled by 1/n is the documented replacement", () => {
  const meanJSON = meanCreatureJSON();

  // Build the replacement generically: swap MEAN for IDENTITY and divide every
  // inbound weight by that neuron's inbound synapse count.
  const replacementJSON: CreatureExport = JSON.parse(JSON.stringify(meanJSON));
  for (const neuron of replacementJSON.neurons) {
    if (neuron.squash !== MEAN.NAME) continue;
    const inbound = replacementJSON.synapses.filter(
      (s) => s.toUUID === neuron.uuid,
    );
    neuron.squash = IDENTITY.NAME;
    for (const synapse of inbound) {
      synapse.weight /= inbound.length;
    }
  }

  const meanCreature = Creature.fromJSON(meanJSON);
  meanCreature.fix();
  const replacement = Creature.fromJSON(replacementJSON);
  replacement.fix();

  for (const [a, b] of [[0, 0], [1, 2], [-3.5, 0.25], [10, -10], [0.1, 0.2]]) {
    const expected = meanCreature.activate(new Float32Array([a, b]))[0];
    const actual = replacement.activate(new Float32Array([a, b]))[0];
    assertAlmostEquals(
      actual,
      expected,
      1e-5,
      `replacement diverged for inputs [${a}, ${b}]`,
    );
  }
});
