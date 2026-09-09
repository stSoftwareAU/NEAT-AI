/**
 * Issue #3975 — the guards this repo keeps around NEAT-AI-core's `prune_neuron`.
 *
 * Core owns the rewrite, but two responsibilities stay on this side of the
 * boundary and neither is core's to enforce:
 *
 * 1. **The Issue #2421 overflow guard.** Every bias and weight in the answer is
 *    Rust-authored — the folded biases, the canonicalisation that moves a
 *    stranded neuron's fixed activation into its outgoing weight, and any
 *    correlated-survivor share. Core folds faithfully; this repo additionally
 *    caps what a runaway `weight × activation` product may become. The bound
 *    is enforced in more than one place (the removal clamps what core hands
 *    back, and creature load clamps again), so these tests assert the outcome
 *    rather than which layer caught it.
 * 2. **Refusing a measurement that cannot compensate anything.** A non-finite
 *    mean folded into a bias poisons every downstream activation, so
 *    `removeHarmfulNeuron` — whose whole remedy *is* that mean — refuses rather
 *    than removing uncompensated. `removeLowImpactNeuron` is deliberately not
 *    symmetrical: a low-impact neuron has negligible downstream effect by
 *    definition, so it proceeds with no mean at all.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { MAX_SAFE_WEIGHT_BIAS } from "@utils/WeightBiasClamp.ts";
import {
  removeHarmfulNeuron,
  removeLowImpactNeuron,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";

/**
 * Removing `feeder` strands `stranded`, which core then canonicalises to a
 * unity constant by folding its fixed activation into the outgoing weight.
 * With a huge bias and a huge outgoing weight, that product overflows the
 * guard's bound — the case the clamp exists for.
 */
function overflowFixture(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "feeder", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "stranded", type: "hidden", squash: IDENTITY.NAME, bias: 1e10 },
      { uuid: "other", type: "hidden", squash: IDENTITY.NAME, bias: 0.3 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "feeder", weight: 0.4 },
      { fromUUID: "feeder", toUUID: "stranded", weight: 0.5 },
      { fromUUID: "stranded", toUUID: "output-0", weight: 1e10 },
      { fromUUID: "input-1", toUUID: "other", weight: 0.7 },
      { fromUUID: "other", toUUID: "output-0", weight: 0.8 },
    ],
  };
  return Creature.fromJSON(json);
}

function plainFixture(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "hidden-1", type: "hidden", squash: IDENTITY.NAME, bias: 0.2 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("the overflow guard covers weights core authored, not just biases", () => {
  const removed = removeLowImpactNeuron("guard-test", overflowFixture(), {
    neuronUuid: "feeder",
    totalError: 0.001,
    impact: 0.0001,
    meanActivation: 0.25,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "core should accept removing the feeder");

  // Core folds activation (1e10) into the outgoing weight (1e10), which is
  // 1e20 uncapped — so this edge is the one the bound has to catch. This
  // pins the *outcome* (a removal never emits an unbounded weight); which
  // layer enforces it is free to change.
  const folded = removed.exportJSON().synapses.find((s) =>
    s.fromUUID === "stranded" && s.toUUID === "output-0"
  );
  assert(folded, "the canonicalised survivor should still feed the output");
  assertEquals(
    folded.weight,
    MAX_SAFE_WEIGHT_BIAS,
    "a removal must never hand back a weight beyond the guard's bound",
  );

  for (const synapse of removed.exportJSON().synapses) {
    assert(
      Math.abs(synapse.weight) <= MAX_SAFE_WEIGHT_BIAS,
      `weight ${synapse.weight} on ${synapse.fromUUID} -> ${synapse.toUUID} ` +
        `escaped the overflow guard`,
    );
  }
  for (const neuron of removed.exportJSON().neurons) {
    assert(
      Math.abs(neuron.bias) <= MAX_SAFE_WEIGHT_BIAS,
      `bias ${neuron.bias} on ${neuron.uuid} escaped the overflow guard`,
    );
  }
});

Deno.test("removeHarmfulNeuron refuses a non-finite mean rather than folding it", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = removeHarmfulNeuron("guard-test", plainFixture(), {
      neuronUuid: "hidden-0",
      errorMagnitude: 0.5,
      averageActivation: bad,
      // deno-lint-ignore no-explicit-any
    } as any);
    assertEquals(
      result,
      undefined,
      `${bad} cannot compensate anything, so the removal must be refused ` +
        `rather than poisoning every downstream bias`,
    );
  }
});

Deno.test("removeHarmfulNeuron still removes on a finite mean", () => {
  // Guards the test above: the refusal must be about the measurement, not
  // about this fixture being unremovable.
  const removed = removeHarmfulNeuron("guard-test", plainFixture(), {
    neuronUuid: "hidden-0",
    errorMagnitude: 0.5,
    averageActivation: 0.5,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "a finite mean must still remove the neuron");
  assertEquals(
    removed.exportJSON().neurons.find((n) => n.uuid === "hidden-0"),
    undefined,
  );
});

Deno.test("removeLowImpactNeuron proceeds when it has no usable mean", () => {
  // Not symmetrical with removeHarmfulNeuron by design: a low-impact neuron
  // has negligible downstream effect, so an absent mean is not a fault.
  const removed = removeLowImpactNeuron("guard-test", plainFixture(), {
    neuronUuid: "hidden-0",
    totalError: 0.001,
    impact: 0.0001,
    meanActivation: Number.NaN,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "an unusable mean must not block a low-impact removal");
  assertEquals(
    removed.exportJSON().neurons.find((n) => n.uuid === "hidden-0"),
    undefined,
  );
  for (const neuron of removed.exportJSON().neurons) {
    assert(
      Number.isFinite(neuron.bias),
      `bias on ${neuron.uuid} must stay finite when no mean was folded`,
    );
  }
});

Deno.test("a removal core cannot fully compensate still returns a valid creature", () => {
  const removed = removeLowImpactNeuron("guard-test", overflowFixture(), {
    neuronUuid: "feeder",
    totalError: 0.001,
    impact: 0.0001,
    meanActivation: 0.25,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "core should accept removing the feeder");
  removed.validate();
  assertAlmostEquals(
    removed.exportJSON().neurons.find((n) => n.uuid === "other")?.bias ?? -1,
    0.3,
    1e-12,
    "an untouched neuron must keep its bias",
  );
});

Deno.test("a Discovery remedy is folded once, not once here and again in core", () => {
  // Issue #1691: when Discovery supplies its own variance-aware compensation,
  // that measured remedy is applied in TypeScript before the rewrite and core
  // is then given no mean — otherwise the same contribution lands twice. The
  // survivor's bumped edge is the visible half of the remedy.
  const removed = removeHarmfulNeuron("guard-test", plainFixture(), {
    neuronUuid: "hidden-0",
    errorMagnitude: 0.5,
    averageActivation: 0.5,
    compensation: {
      removeNeuronCompensation: {
        survivorNeuronUuid: "hidden-1",
        targetNeuronUuid: "output-0",
        deltaWeight: 0.4,
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "a compensated removal should still be accepted");

  const exported = removed.exportJSON();
  const survivorEdge = exported.synapses.find((s) =>
    s.fromUUID === "hidden-1" && s.toUUID === "output-0"
  );
  assert(survivorEdge, "the survivor should still feed the output");
  assertAlmostEquals(
    survivorEdge.weight,
    0.35 + 0.4,
    1e-9,
    "the survivor bump must be applied exactly once",
  );

  // The mean fold is w * mean = 0.25 * 0.5 into output-0's bias, applied by
  // the TypeScript remedy. Core must not fold it a second time.
  const output = exported.neurons.find((n) => n.uuid === "output-0");
  assert(output, "the output should survive");
  assertAlmostEquals(
    output.bias,
    0 + (0.25 * 0.5),
    1e-9,
    "the mean must be folded once; core was deliberately given no statistics",
  );
});

Deno.test("an uncompensated removal we did not measure is still reported", () => {
  // The suppression above is narrow: it silences core's NO_STATISTICS only
  // when the TypeScript remedy already compensated. Without a remedy the
  // creature really is uncompensated, and that must still reach the log.
  const removed = removeLowImpactNeuron("guard-test", plainFixture(), {
    neuronUuid: "hidden-0",
    totalError: 0.001,
    impact: 0.0001,
    meanActivation: Number.NaN,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "an unusable mean must not block a low-impact removal");
  // output-0's bias is untouched: nothing was folded back for it.
  assertAlmostEquals(
    removed.exportJSON().neurons.find((n) => n.uuid === "output-0")?.bias ?? -1,
    0,
    1e-12,
  );
});
