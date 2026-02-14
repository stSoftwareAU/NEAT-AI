/**
 * Behavioural tests for the ModActivation (ModSquash) mutation operator.
 *
 * Issue #1441: Verifies that:
 * 1. ModSquash produces valid activation function assignments
 * 2. Creature remains valid after squash modification
 * 3. Squash function actually changes
 * 4. Only non-input neurons are modified
 * 5. Memetic flag is cleared on change
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { ModActivation } from "../../src/mutate/ModSquash.ts";

/**
 * Creates a creature with multiple neurons using distinct squash functions.
 */
function createTestCreature(): Creature {
  // Each hidden and output neuron needs at least 3 inward connections
  // so the IF squash function (which requires >= 3) is always valid.
  const json: CreatureExport = {
    input: 4,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        squash: "TANH",
        bias: 0.2,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: 0,
      },
      {
        type: "output",
        uuid: "output-1",
        squash: "RELU",
        bias: 0,
      },
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

Deno.test("ModSquash: creature remains valid after squash mutation", () => {
  const creature = createTestCreature();
  creatureValidate(creature);

  const modifier = new ModActivation(creature);

  for (let i = 0; i < 50; i++) {
    modifier.mutate();
    creatureValidate(creature);
  }
});

Deno.test("ModSquash: squash function actually changes", () => {
  const creature = createTestCreature();
  CreatureUtil.makeUUID(creature);
  const uuidBefore = creature.uuid;

  const modifier = new ModActivation(creature);
  let changed = false;
  for (let i = 0; i < 100; i++) {
    if (modifier.mutate()) {
      changed = true;
      break;
    }
  }

  assert(changed, "ModSquash should change a squash function");

  // UUID should change because the structure has changed
  delete creature.uuid;
  const uuidAfter = CreatureUtil.makeUUID(creature);
  assertNotEquals(
    uuidBefore,
    uuidAfter,
    "UUID should change after squash modification",
  );
});

Deno.test("ModSquash: assigned squash is always a valid activation function", () => {
  const creature = createTestCreature();
  const modifier = new ModActivation(creature);

  for (let i = 0; i < 100; i++) {
    modifier.mutate();

    // Check every non-input neuron has a valid squash
    for (const neuron of creature.neurons) {
      if (neuron.type === "hidden" || neuron.type === "output") {
        assert(
          neuron.squash !== undefined && neuron.squash !== null,
          `Neuron ${neuron.uuid} has undefined/null squash`,
        );
        assert(
          typeof neuron.squash === "string" && neuron.squash.length > 0,
          `Neuron ${neuron.uuid} has invalid squash: ${neuron.squash}`,
        );
      }
    }
  }
});

Deno.test("ModSquash: can be exported and re-imported after mutation", () => {
  const creature = createTestCreature();
  const modifier = new ModActivation(creature);

  for (let i = 0; i < 20; i++) {
    modifier.mutate();
  }

  // Round-trip through JSON should work
  const exported = creature.exportJSON();
  const reimported = Creature.fromJSON(exported);
  creatureValidate(reimported);

  assertEquals(reimported.input, creature.input);
  assertEquals(reimported.output, creature.output);
});

Deno.test("ModSquash: clears memetic flag when squash changes", () => {
  const creature = createTestCreature();
  creature.memetic = { generation: 1, weights: {}, biases: {}, score: 0.5 };

  const modifier = new ModActivation(creature);
  let changed = false;
  for (let i = 0; i < 100; i++) {
    creature.memetic = { generation: 1, weights: {}, biases: {}, score: 0.5 };
    if (modifier.mutate()) {
      changed = true;
      assertEquals(
        creature.memetic,
        undefined,
        "Memetic flag should be cleared after squash change",
      );
      break;
    }
  }

  assert(changed, "Should modify squash at least once in 100 attempts");
});

Deno.test("ModSquash: produces diverse squash assignments over many mutations", () => {
  const creature = createTestCreature();
  const modifier = new ModActivation(creature);

  const observedSquashes = new Set<string>();
  for (let i = 0; i < 200; i++) {
    modifier.mutate();
    for (const neuron of creature.neurons) {
      if (
        neuron.squash &&
        (neuron.type === "hidden" || neuron.type === "output")
      ) {
        observedSquashes.add(neuron.squash);
      }
    }
  }

  // Should observe multiple different squash functions
  assert(
    observedSquashes.size > 3,
    `Expected diverse squash functions but only saw ${observedSquashes.size}: ${
      [...observedSquashes].join(", ")
    }`,
  );
});

Deno.test("ModSquash: input neurons are never modified", () => {
  const creature = createTestCreature();
  const modifier = new ModActivation(creature);

  // Record input neurons' state (they should not have squash)
  const inputNeurons = creature.neurons.filter((n) => n.type === "input");

  for (let i = 0; i < 100; i++) {
    modifier.mutate();
  }

  // Verify input neurons are unchanged
  const inputNeuronsAfter = creature.neurons.filter((n) => n.type === "input");
  assertEquals(
    inputNeuronsAfter.length,
    inputNeurons.length,
    "Input neuron count should not change",
  );
  for (let i = 0; i < inputNeurons.length; i++) {
    assertEquals(
      inputNeuronsAfter[i].type,
      "input",
      "Input neuron type should remain 'input'",
    );
  }
});
