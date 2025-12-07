import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("AddNeuron - basic mutation should add a neuron", () => {
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0.5,
        index: 2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 3,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);
  const neuronCountBefore = creature.neurons.length;

  const addNeuron = new AddNeuron(creature);
  const changed = addNeuron.mutate();

  assert(changed, "AddNeuron should return true on successful mutation");
  creatureValidate(creature);
  assert(
    creature.neurons.length > neuronCountBefore,
    "Should have more neurons after mutation",
  );
});

Deno.test("AddNeuron - should handle focus list", () => {
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0.5,
        index: 2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 3,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Run multiple times with focus list that might not include all neurons
  for (let i = 0; i < 20; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const addNeuron = new AddNeuron(testCreature);

    // Use a restrictive focus list - might force the fallback path
    addNeuron.mutate([0]); // Only focus on input neuron

    creatureValidate(testCreature);
  }
});

Deno.test("AddNeuron - should skip constant neurons when inserting", () => {
  // Create a creature with constant neurons
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "constant",
        uuid: "const-1",
        bias: 1.0,
        index: 2,
      },
      {
        type: "hidden",
        squash: "LOGISTIC",
        bias: 0.5,
        index: 3,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 4,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Run multiple mutations to hit the constant-skipping logic
  for (let i = 0; i < 30; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const addNeuron = new AddNeuron(testCreature);
    addNeuron.mutate();

    creatureValidate(testCreature);

    // The constant neuron should still be present
    const constNeuron = testCreature.neurons.find((n) => n.uuid === "const-1");
    assert(constNeuron, "Constant neuron should still exist");
    assertEquals(constNeuron.type, "constant");
  }
});

Deno.test("AddNeuron - should handle minimal network", () => {
  // Minimal network: just inputs and output
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 2,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  const addNeuron = new AddNeuron(creature);
  const changed = addNeuron.mutate();

  assert(changed, "Should successfully add neuron to minimal network");
  creatureValidate(creature);
  assert(
    creature.neurons.length > 1,
    "Should have more than just output neuron",
  );
});

Deno.test("AddNeuron - stress test with multiple neurons", () => {
  for (let iteration = 0; iteration < 50; iteration++) {
    const creature = Creature.fromJSON({
      neurons: [
        {
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.5,
          index: 3,
        },
        {
          type: "hidden",
          squash: "TANH",
          bias: 0.3,
          index: 4,
        },
        {
          type: "output",
          squash: "LOGISTIC",
          bias: 0.1,
          index: 5,
        },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 3, weight: 0.8 },
        { from: 2, to: 4, weight: 0.7 },
        { from: 3, to: 4, weight: 0.6 },
        { from: 3, to: 5, weight: 0.5 },
        { from: 4, to: 5, weight: 0.9 },
      ],
      input: 3,
      output: 1,
    });

    creatureValidate(creature);

    // Add multiple neurons
    for (let i = 0; i < 3; i++) {
      const addNeuron = new AddNeuron(creature);
      addNeuron.mutate();
      creatureValidate(creature);
    }
  }
});

Deno.test("AddNeuron - should create outward connection when needed", () => {
  // Test the fallback logic for ensuring outward connections
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.1,
        index: 2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        bias: 0.2,
        index: 3,
      },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 2,
  });

  creatureValidate(creature);

  // Multiple attempts to hit various edge cases
  for (let i = 0; i < 20; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const addNeuron = new AddNeuron(testCreature);
    const changed = addNeuron.mutate();

    if (changed) {
      creatureValidate(testCreature);

      // Every hidden neuron should have at least one outward connection
      for (const neuron of testCreature.neurons) {
        if (neuron.type === "hidden") {
          const outward = testCreature.outwardConnections(neuron.index);
          assert(
            outward.length > 0,
            `Hidden neuron ${neuron.uuid} should have outward connections`,
          );
        }
      }
    }
  }
});

Deno.test("AddNeuron - should handle network with many constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", uuid: "c1", bias: 1.0, index: 2 },
      { type: "constant", uuid: "c2", bias: 2.0, index: 3 },
      { type: "constant", uuid: "c3", bias: 3.0, index: 4 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 5 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 6 },
    ],
    synapses: [
      { from: 0, to: 5, weight: 1.0 },
      { from: 2, to: 6, weight: 0.8 },
      { from: 3, to: 6, weight: 0.7 },
      { from: 4, to: 6, weight: 0.6 },
      { from: 5, to: 6, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  // Run multiple times to exercise constant-skipping paths
  for (let i = 0; i < 30; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const addNeuron = new AddNeuron(testCreature);
    addNeuron.mutate();

    creatureValidate(testCreature);
  }
});

Deno.test("AddNeuron - should not connect to constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", uuid: "const", bias: 1.0, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  creatureValidate(creature);

  for (let i = 0; i < 20; i++) {
    const testCreature = Creature.fromJSON(creature.exportJSON());
    const addNeuron = new AddNeuron(testCreature);
    addNeuron.mutate();

    creatureValidate(testCreature);

    // Check that no connections go TO constant neurons (except from inputs)
    for (const synapse of testCreature.synapses) {
      const toNeuron = testCreature.neurons[synapse.to];
      if (toNeuron.type === "constant") {
        // Only input neurons should connect to constants
        assert(
          synapse.from < testCreature.input,
          "Only inputs should connect to constant neurons",
        );
      }
    }
  }
});
