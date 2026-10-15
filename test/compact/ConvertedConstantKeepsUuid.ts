/**
 * Regression tests for Issue #4071.
 *
 * `cleanupOrphanedNeurons` converts a hidden neuron with outward but no inward
 * synapses into a constant. Before the fix the converted constant dropped the
 * neuron's `uuid`. On reload `Neuron.fromJSON` then labelled it
 * `legacy-neuron-<id>`, which could equal the uuid another neuron already
 * carried. The creature then held two neurons with one uuid, and every
 * export/import round trip stranded the earlier constant, failing in CI with:
 *
 *   Uncaught ValidationError: constants neuron legacy-neuron-148065463 has no outward connections
 *
 * The converted constant must keep the source neuron's uuid so that the uuid
 * stays the neuron's identity across the conversion.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  cleanupOrphanedNeurons,
  cleanupOrphanedNeuronsInCreature,
} from "@compact/OrphanedNeuronCleanup.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Run `fn` under a fresh seeded RNG, restoring the ambient generator afterwards.
 * Keeps RNG-sensitive sibling tests deterministic regardless of file ordering.
 */
function withIsolatedRng(fn: () => void): Promise<void> {
  return withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(4071));
      fn();
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
}

Deno.test("Issue #4071 - a converted constant survives an export round trip beside a legacy-labelled constant", async () => {
  await initWasmForTests();
  await withIsolatedRng(() => {
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      input: 2,
      output: 1,
      neurons: [
        // Legacy-labelled constant: its uuid is what a uuid-less conversion
        // of the hidden neuron with id 1777777 would have collided with.
        { type: "constant", uuid: "legacy-neuron-1777777", bias: 0.5 },
        // Hidden neuron with no inward synapses: converted to a constant.
        {
          type: "hidden",
          uuid: "U",
          id: 1777777,
          squash: "IDENTITY",
          bias: 0.3,
        },
        { type: "hidden", uuid: "H2", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "H2", weight: 0.5 },
        { fromUUID: "legacy-neuron-1777777", toUUID: "output-0", weight: 0.7 },
        { fromUUID: "U", toUUID: "output-0", weight: 0.9 },
        { fromUUID: "H2", toUUID: "output-0", weight: 0.4 },
      ],
    };
    const creature = Creature.fromJSON(json, false);

    const result = cleanupOrphanedNeuronsInCreature(creature);
    assertEquals(result.converted, 1, "Should have converted 1 neuron");
    assertEquals(result.removed, 0, "Should have removed 0 neurons");

    // Must not throw: the converted constant keeps uuid "U", so the reload
    // does not relabel it onto the legacy constant's uuid.
    const reloaded = Creature.fromJSON(creature.exportJSON(), true);

    const constants = reloaded.neurons.filter((n) => n.type === "constant");
    assertEquals(constants.length, 2, "Should have exactly two constants");
    assertEquals(
      constants.map((n) => n.uuid).sort(),
      ["U", "legacy-neuron-1777777"],
      "Constant uuids should be the two distinct source uuids",
    );

    reloaded.neurons.forEach((n, index) => {
      if (n.type === "constant") {
        assert(
          reloaded.outwardConnections(index).length > 0,
          `constant ${n.uuid} should have at least one outward synapse`,
        );
      }
    });

    creatureValidate(reloaded);
  });
});

Deno.test("Issue #4071 - cleanupOrphanedNeurons keeps the source uuid on a hidden converted to a constant", async () => {
  await initWasmForTests();
  await withIsolatedRng(() => {
    const creatureExport: CreatureExport = {
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-no-inward",
          squash: LOGISTIC.NAME,
          bias: 0.5,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: LOGISTIC.NAME,
          bias: 0.1,
        },
      ],
      synapses: [
        { fromUUID: "hidden-no-inward", toUUID: "output-0", weight: 1.0 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
      ],
      input: 2,
      output: 1,
    };

    const result = cleanupOrphanedNeurons(creatureExport);
    assertEquals(result.converted, 1, "Should have converted 1 neuron");

    const constants = creatureExport.neurons.filter(
      (n) => n.type === "constant",
    );
    assertEquals(constants.length, 1, "Should have exactly one constant");
    assertEquals(constants[0].uuid, "hidden-no-inward");
  });
});
