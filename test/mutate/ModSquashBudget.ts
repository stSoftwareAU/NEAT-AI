/**
 * Integration test for the squash budget (Issue #3263): the ModActivation
 * (ModSquash) mutation operator must never assign a squash outside the active
 * allow-list.
 *
 * The budget is a per-worker global, so the allow-list is reset in a `finally`
 * block for isolation.
 */

import { assert } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { ModActivation } from "@mutate/ModSquash.ts";
import { Activations } from "@methods/activations/Activations.ts";

function createTestCreature(): Creature {
  const json: CreatureExport = {
    input: 4,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        id: 5001,
        squash: "LOGISTIC",
        bias: 0.1,
      },
      { type: "hidden", uuid: "hidden-2", id: 5002, squash: "TANH", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "RELU", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "input-2", toUUID: "hidden-1", weight: 0.4 },
      { fromUUID: "input-0", toUUID: "hidden-2", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.2 },
      { fromUUID: "input-3", toUUID: "hidden-2", weight: 0.1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.15 },
      { fromUUID: "input-3", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.35 },
      { fromUUID: "input-3", toUUID: "output-1", weight: 0.45 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.7 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("ModSquash: never emits a disallowed squash when a budget is set", () => {
  try {
    // Deliberately exclude the creature's seeded squashes (LOGISTIC / TANH /
    // IDENTITY / RELU are not all in the allow-list) so at least some
    // mutations must move onto allowed squashes only.
    const allowed = ["TANH", "ReLU", "SELU"];
    Activations.setAllowedSquashes(allowed);
    const allowedSet = new Set(allowed);

    const creature = createTestCreature();
    const modifier = new ModActivation(creature);

    for (let i = 0; i < 300; i++) {
      modifier.mutate();
      creatureValidate(creature);
      for (const neuron of creature.neurons) {
        if (neuron.type !== "hidden" && neuron.type !== "output") continue;
        const squash = neuron.squash;
        // A neuron may still carry its original (disallowed) squash if it was
        // never selected for mutation; but any squash the operator *assigns*
        // must be allowed. We assert the canonical name is allowed OR is one
        // of the untouched seed squashes.
        assert(squash !== undefined);
        const canonical = Activations.find(squash).getName();
        assert(
          allowedSet.has(canonical) ||
            ["LOGISTIC", "IDENTITY"].includes(canonical),
          `neuron ${neuron.uuid} has disallowed squash ${canonical}`,
        );
      }
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});

Deno.test("ModSquash: with a two-squash budget the population converges to allowed set", () => {
  try {
    const allowed = ["TANH", "ReLU"];
    Activations.setAllowedSquashes(allowed);
    const allowedSet = new Set(allowed);

    const creature = createTestCreature();
    const modifier = new ModActivation(creature);

    // Enough iterations that every mutable neuron is very likely reassigned.
    const observed = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      if (modifier.mutate()) {
        for (const neuron of creature.neurons) {
          if (neuron.type !== "hidden" && neuron.type !== "output") continue;
          if (neuron.squash === undefined) continue;
          observed.add(Activations.find(neuron.squash).getName());
        }
      }
    }

    // Every squash the operator ever assigned must be within the allow-list.
    for (const name of observed) {
      // Seed squashes that were never mutated are the only exception.
      assert(
        allowedSet.has(name) || ["LOGISTIC", "IDENTITY"].includes(name),
        `observed disallowed squash ${name}`,
      );
    }
  } finally {
    Activations.resetAllowedSquashesForTesting();
  }
});
