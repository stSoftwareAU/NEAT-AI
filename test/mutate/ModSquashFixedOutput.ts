/**
 * Integration tests for the output-squash pin (Issue #3797): with a pin
 * configured, no mutation path may rewrite an output neuron's squash, and a
 * seed carrying a different output squash is normalised at import instead of
 * silently diverging (Issue #3234).
 *
 * The pin is a per-worker global, so it is reset in a `finally` block.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { Mutation } from "@neat/Mutation.ts";
import { ModActivation } from "@mutate/ModSquash.ts";
import { Activations } from "@methods/activations/Activations.ts";

function createTestCreature(outputSquash = "TANH"): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      { type: "hidden", uuid: "hidden-2", squash: "TANH", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: outputSquash, bias: 0 },
      { type: "output", uuid: "output-1", squash: outputSquash, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "hidden-2", weight: 0.6 },
      { fromUUID: "input-2", toUUID: "hidden-2", weight: 0.1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.15 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 0.45 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.7 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("fixed output squash: ModSquash never rewrites an output neuron", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    const creature = createTestCreature();
    const modifier = new ModActivation(creature);

    let hiddenChanged = false;
    for (let i = 0; i < 500; i++) {
      modifier.mutate();
      for (const neuron of creature.neurons) {
        if (neuron.type === "output") {
          assertEquals(
            neuron.squash,
            "TANH",
            `output neuron ${neuron.uuid} lost the pinned squash`,
          );
        } else if (neuron.type === "hidden" && neuron.squash !== "LOGISTIC") {
          hiddenChanged = true;
        }
      }
    }
    assert(hiddenChanged, "hidden neurons should still mutate freely");
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: neuron.mutate(MOD_SQUASH) leaves outputs pinned", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    const creature = createTestCreature();
    const output = creature.neurons.find((n) => n.type === "output");
    assert(output !== undefined);

    for (let i = 0; i < 50; i++) {
      assertEquals(
        output.mutate(Mutation.MOD_SQUASH.name),
        false,
        "a pinned output neuron must report no mutation",
      );
      assertEquals(output.squash, "TANH");
    }
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: mutation without a pin still rewrites outputs", () => {
  Activations.resetFixedOutputSquashForTesting();
  const creature = createTestCreature();
  const modifier = new ModActivation(creature);

  let outputChanged = false;
  for (let i = 0; i < 500 && !outputChanged; i++) {
    modifier.mutate();
    for (const neuron of creature.neurons) {
      if (neuron.type === "output" && neuron.squash !== "TANH") {
        outputChanged = true;
      }
    }
  }
  assert(outputChanged, "without a pin output squashes must still evolve");
});

Deno.test("fixed output squash: an imported seed is normalised to the pin", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    // Seeded with LOGISTIC outputs — the import must normalise, not diverge.
    const creature = createTestCreature("LOGISTIC");
    for (const neuron of creature.neurons) {
      if (neuron.type !== "output") continue;
      assertEquals(neuron.squash, "TANH");
    }

    // The normalisation survives an export/import round-trip.
    const reloaded = Creature.fromJSON(creature.exportJSON());
    for (const neuron of reloaded.neurons) {
      if (neuron.type !== "output") continue;
      assertEquals(neuron.squash, "TANH");
    }
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: an alias in the seed is not treated as a conflict", () => {
  try {
    Activations.setFixedOutputSquash("ReLU");
    const creature = createTestCreature("RELU");
    for (const neuron of creature.neurons) {
      if (neuron.type !== "output") continue;
      assertEquals(neuron.squash, "ReLU");
    }
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: hidden neuron squashes are untouched at import", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    const creature = createTestCreature();
    const hidden = creature.neurons.filter((n) => n.type === "hidden");
    assertEquals(hidden.length, 2);
    assertEquals(hidden[0].squash, "LOGISTIC");
    assertEquals(hidden[1].squash, "TANH");
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});
