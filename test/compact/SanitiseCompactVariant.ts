/**
 * Regression tests for the compaction boundary guard (Issue #3383).
 *
 * A compaction sub-step can intermittently strand a `constant` neuron with no
 * outward connections. Because the worker-side compact load runs with
 * `validate: false`, that `NO_OUTWARD_CONNECTIONS` violation stays latent until
 * the coordinator's strict load in `processCompletedResults` throws. The
 * `Merge coverage & results` job of the `Test Coverage` workflow flaked on
 * exactly this path via the seeded `XOR-evolve` test.
 *
 * `sanitiseCompactVariant` closes the gap at the producer: it repairs (or, as a
 * last resort, drops) a compact candidate before it can be serialised.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { sanitiseCompactVariant } from "@compact/SanitiseCompactVariant.ts";

/**
 * Build a forward-only creature that violates the `NO_OUTWARD_CONNECTIONS`
 * invariant: a `constant` neuron (`c-1`) with no outward connections. The
 * creature is loaded with `validate: false` so the invalid topology survives
 * construction — mirroring the worker-side compact load.
 */
function invalidOrphanedConstantCreature(): Creature {
  const json = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "constant", uuid: "c-1", bias: 1, index: 2 },
      { type: "hidden", uuid: "h-1", squash: "LOGISTIC", bias: 0.1, index: 3 },
      {
        type: "output",
        uuid: "output-0",
        squash: "LOGISTIC",
        bias: 0.2,
        index: 4,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h-1", weight: 0.5 },
      { fromUUID: "h-1", toUUID: "output-0", weight: 0.5 },
    ],
  } as unknown as CreatureExport;

  return Creature.fromJSON(json, false, "test:invalidOrphanedConstant", {
    throwOnRecurrent: "never",
  });
}

Deno.test("sanitiseCompactVariant - repairs an orphaned constant so it validates", () => {
  const creature = invalidOrphanedConstantCreature();

  // Precondition: the crafted creature is genuinely invalid.
  assertEquals(
    creature.outwardConnections(2).length,
    0,
    "constant should start with no outward connections",
  );
  assertThrows(
    () => creature.validate(),
    Error,
    "no outward connections",
  );

  const result = sanitiseCompactVariant(creature);

  assert(result !== undefined, "repairable variant should not be dropped");
  // The repaired creature must now validate cleanly...
  result.validate();
  // ...and must not carry any constant neuron with no outward connections.
  for (let i = 0; i < result.neurons.length; i++) {
    const neuron = result.neurons[i];
    if (neuron.type === "constant") {
      assert(
        result.outwardConnections(i).length > 0,
        `constant neuron ${neuron.ID()} must have outward connections`,
      );
    }
  }
});

Deno.test("sanitiseCompactVariant - returns a valid creature unchanged", () => {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: "LOGISTIC" }],
  });
  // Sanity: already valid.
  creature.validate();
  const neuronCountBefore = creature.neurons.length;
  const synapseCountBefore = creature.synapses.length;

  const result = sanitiseCompactVariant(creature);

  assert(result !== undefined, "a valid creature must be returned");
  assertEquals(result, creature, "the same instance should be returned");
  assertEquals(
    result.neurons.length,
    neuronCountBefore,
    "a valid creature must not be modified",
  );
  assertEquals(
    result.synapses.length,
    synapseCountBefore,
    "a valid creature must not be modified",
  );
});
