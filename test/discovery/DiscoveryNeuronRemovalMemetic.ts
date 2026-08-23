/**
 * Issue #3844 — removing a neuron in discovery must not leave `memetic`
 * pointing at it.
 *
 * `DiscoveryNeuronRemoval` is the pass whose tag shows up on live fleet
 * creatures (`🪶 Removed low-impact neuron … (impact: 0.00%)`), so it is the
 * removal that matters most in production. Both entry points already route
 * through `cleanupMemeticForRemovedNeuron` (`DiscoveryNeuronRemoval.ts:298` and
 * `:491`), which drops the record when the removed neuron is named — these
 * tests lock that in rather than repair it.
 *
 * They also cover the half no per-removal helper inspects:
 * `cleanupMemeticForRemovedNeuron` reads only the top-level `biases`/`weights`,
 * never `ancestry[]`. Discovery survives that gap because its record makes the
 * round trip through `exportJSON()` as **wire labels**, and an unresolvable
 * label is dropped on re-import by `NormaliseCreatureExport.convertMapKeys`.
 * A stale *runtime integer* key would not be — see
 * `test/blackbox/RestoreSourceMemeticDangling.ts` for the path where that
 * actually bites.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import {
  removeHarmfulNeuron,
  removeLowImpactNeuron,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import { danglingMemeticReferences } from "../_memeticReferences.ts";

/** `hidden-0` is the neuron every case here removes. */
function fixture(withAncestry: boolean): Creature {
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
      // Keeps the topology valid once hidden-0 goes.
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.15 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
    ],
  };

  const memetic: Record<string, unknown> = withAncestry
    ? {
      generation: 3,
      score: -0.5,
      // Top level names only the survivor …
      biases: { "hidden-1": 0.2 },
      weights: [{ fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 }],
      // … while the ancestor snapshot still points at hidden-0.
      ancestry: [{
        generation: 2,
        score: -0.6,
        biases: { "hidden-0": 0.1, "hidden-1": 0.21 },
        weights: [{ fromUUID: "hidden-0", toUUID: "output-0", weight: 0.24 }],
      }],
    }
    : {
      generation: 3,
      score: -0.5,
      biases: { "hidden-0": 0.1, "hidden-1": 0.2 },
      weights: [
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
      ],
    };

  return Creature.fromJSON(
    { ...json, memetic } as unknown as CreatureExport,
  );
}

function assertRemoved(creature: Creature): void {
  const exported = creature.exportJSON();
  assertEquals(
    exported.neurons.some((n) => n.uuid === "hidden-0"),
    false,
    "hidden-0 must be gone",
  );
  assertEquals(
    exported.synapses.some((s) =>
      s.fromUUID === "hidden-0" || s.toUUID === "hidden-0"
    ),
    false,
    "hidden-0's synapses must be gone",
  );
  const dangling = danglingMemeticReferences(exported);
  assertEquals(
    dangling,
    [],
    `memetic must not name the removed neuron — ${dangling.join("; ")}`,
  );
}

Deno.test(
  "Issue #3844: removeLowImpactNeuron leaves no memetic key naming the removed neuron",
  () => {
    const removed = removeLowImpactNeuron("issue-3844", fixture(false), {
      neuronUuid: "hidden-0",
      totalError: 1,
      impact: 0.001,
      reason: "issue-3844",
      meanActivation: 0.1,
    });
    assert(removed, "the low-impact removal must produce a creature");
    assertRemoved(removed);
  },
);

Deno.test(
  "Issue #3844: removeHarmfulNeuron leaves no memetic key naming the removed neuron",
  () => {
    const removed = removeHarmfulNeuron("issue-3844", fixture(false), {
      neuronUuid: "hidden-0",
      errorMagnitude: 1e11,
      averageActivation: 0.1,
      expectedCreatureScoreGain: 0.01,
      sampleCount: 32,
    });
    assert(removed, "the harmful removal must produce a creature");
    assertRemoved(removed);
  },
);

Deno.test(
  "Issue #3844: discovery removal leaves no ancestry snapshot naming the removed neuron",
  () => {
    const removed = removeLowImpactNeuron("issue-3844", fixture(true), {
      neuronUuid: "hidden-0",
      totalError: 1,
      impact: 0.001,
      reason: "issue-3844",
      meanActivation: 0.1,
    });
    assert(removed, "the low-impact removal must produce a creature");
    assertRemoved(removed);

    // The record survives here (the top level never named hidden-0), so this
    // also proves the survivor's ancestor delta is not thrown away.
    const memetic = removed.exportJSON().memetic;
    assert(memetic, "a record naming only survivors must be kept");
    const ancestry = (memetic as unknown as {
      ancestry?: Array<{ biases: Record<string, number> }>;
    }).ancestry;
    assert(ancestry && ancestry.length === 1, "ancestry must be kept");
    assertEquals(Object.keys(ancestry[0].biases), ["hidden-1"]);
  },
);
