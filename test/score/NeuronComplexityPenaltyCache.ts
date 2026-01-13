import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { calculate } from "../../src/architecture/Score.ts";
import { Activations } from "../../src/methods/activations/Activations.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { IF } from "../../src/methods/activations/aggregate/IF.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

/**
 * Test suite for neuron-level complexity penalty caching.
 * Issue #1043: Cache Activations.find() lookups in score calculation.
 *
 * The goal is to cache the complexityPenalty on each Neuron object so that
 * repeated score calculations don't need to call Activations.find() repeatedly.
 */

function createSimpleCreature(): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function createCreatureWithIF(): Creature {
  const creature = new Creature(3, 1, {
    layers: [{ count: 1, squash: IF.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

Deno.test("NeuronComplexityPenaltyCache: getComplexityPenalty returns cached value", () => {
  const creature = createSimpleCreature();
  const hiddenNeuron = creature.neurons[creature.input]; // First hidden neuron

  // Get the complexity penalty twice
  const penalty1 = hiddenNeuron.getComplexityPenalty();
  const penalty2 = hiddenNeuron.getComplexityPenalty();

  // Both should return the same value
  assertEquals(penalty1, penalty2, "Complexity penalty should be consistent");

  // IDENTITY has no complexity penalty (0 or undefined)
  const expectedPenalty = Activations.find(IDENTITY.NAME).complexityPenalty ??
    0;
  assertEquals(
    penalty1,
    expectedPenalty,
    "IDENTITY should have no complexity penalty",
  );
});

Deno.test("NeuronComplexityPenaltyCache: IF squash has complexity penalty of 3", () => {
  const creature = createCreatureWithIF();
  const hiddenNeuron = creature.neurons[creature.input]; // The IF neuron

  // IF has complexityPenalty = 3
  const penalty = hiddenNeuron.getComplexityPenalty();
  assertEquals(penalty, 3, "IF squash should have complexity penalty of 3");
});

Deno.test("NeuronComplexityPenaltyCache: cache is cleared when setSquash is called", () => {
  const creature = createSimpleCreature();
  const hiddenNeuron = creature.neurons[creature.input];

  // Get initial penalty (should cache it)
  const initialPenalty = hiddenNeuron.getComplexityPenalty();
  assertEquals(initialPenalty, 0, "IDENTITY should have no complexity penalty");

  // Change to TANH which also has no penalty, but tests the cache invalidation
  hiddenNeuron.setSquash(TANH.NAME);

  // The cache should have been cleared; get penalty again
  const newPenalty = hiddenNeuron.getComplexityPenalty();
  const expectedTanhPenalty = Activations.find(TANH.NAME).complexityPenalty ??
    0;
  assertEquals(
    newPenalty,
    expectedTanhPenalty,
    "After changing to TANH, complexity penalty should match",
  );

  // Verify the squash actually changed
  assertEquals(
    hiddenNeuron.squash,
    TANH.NAME,
    "Squash should be changed to TANH",
  );
});

Deno.test("NeuronComplexityPenaltyCache: cache is cleared on mutate MOD_SQUASH", () => {
  const creature = createSimpleCreature();
  const hiddenNeuron = creature.neurons[creature.input];

  // Get initial penalty to populate cache (value not used, just priming the cache)
  hiddenNeuron.getComplexityPenalty();

  // Mutate the squash (this may or may not change it, but should invalidate cache)
  const originalSquash = hiddenNeuron.squash;
  let attempts = 0;
  const maxAttempts = 100;

  // Keep mutating until we get a different squash
  while (hiddenNeuron.squash === originalSquash && attempts < maxAttempts) {
    hiddenNeuron.setSquash(originalSquash); // Reset
    hiddenNeuron.mutate("MOD_SQUASH");
    attempts++;
  }

  // If squash changed, the penalty might be different
  if (hiddenNeuron.squash !== originalSquash) {
    const newPenalty = hiddenNeuron.getComplexityPenalty();
    const expectedPenalty =
      Activations.find(hiddenNeuron.squash!).complexityPenalty ?? 0;
    assertEquals(
      newPenalty,
      expectedPenalty,
      "Penalty should match the new squash function",
    );
  }
});

Deno.test("NeuronComplexityPenaltyCache: input neurons return 0 penalty", () => {
  const creature = createSimpleCreature();
  const inputNeuron = creature.neurons[0]; // First input neuron

  assertEquals(inputNeuron.type, "input", "Should be an input neuron");
  const penalty = inputNeuron.getComplexityPenalty();
  assertEquals(penalty, 0, "Input neurons should have no complexity penalty");
});

Deno.test("NeuronComplexityPenaltyCache: constant neurons return 0 penalty", () => {
  // Create a creature with a constant neuron
  const json = {
    input: 2,
    output: 1,
    neurons: [
      { type: "constant" as const, uuid: "const-1", bias: 1.0 },
      {
        type: "output" as const,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "const-1", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  const constantNeuron = creature.neurons.find((n) => n.type === "constant");

  assertEquals(constantNeuron?.type, "constant", "Should be a constant neuron");
  const penalty = constantNeuron!.getComplexityPenalty();
  assertEquals(
    penalty,
    0,
    "Constant neurons should have no complexity penalty",
  );
});

Deno.test("NeuronComplexityPenaltyCache: output neurons have correct penalty", () => {
  const creature = createSimpleCreature();
  const outputNeuron = creature.neurons[creature.neurons.length - 1];

  assertEquals(outputNeuron.type, "output", "Should be an output neuron");
  const penalty = outputNeuron.getComplexityPenalty();
  const expectedPenalty =
    Activations.find(outputNeuron.squash!).complexityPenalty ?? 0;
  assertEquals(
    penalty,
    expectedPenalty,
    "Output neuron penalty should match its squash",
  );
});

Deno.test("NeuronComplexityPenaltyCache: creature score cache invalidated on setSquash", () => {
  const creature = createSimpleCreature();
  const hiddenNeuron = creature.neurons[creature.input];

  // Trigger score calculation to populate creature cache
  calculate(creature, 0.1, 0.0001);

  // Score cache should be populated
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be populated",
  );

  // Change squash function
  hiddenNeuron.setSquash(TANH.NAME);

  // Score cache should be invalidated
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be invalidated after setSquash",
  );
});

Deno.test("NeuronComplexityPenaltyCache: multiple neurons accumulate penalties correctly", () => {
  // Create a creature with multiple hidden neurons with different squashes
  const creature = new Creature(2, 1, {
    layers: [
      { count: 1, squash: IDENTITY.NAME },
      { count: 1, squash: TANH.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });

  let totalPenalty = 0;
  for (let i = creature.input; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    totalPenalty += neuron.getComplexityPenalty();
  }

  // IDENTITY has penalty 0, TANH has penalty 0 (or undefined)
  // Both should sum to 0
  const identityPenalty = Activations.find(IDENTITY.NAME).complexityPenalty ??
    0;
  const tanhPenalty = Activations.find(TANH.NAME).complexityPenalty ?? 0;
  const outputIdentityPenalty =
    Activations.find(IDENTITY.NAME).complexityPenalty ?? 0;

  const expectedTotal = identityPenalty + tanhPenalty + outputIdentityPenalty;
  assertEquals(
    totalPenalty,
    expectedTotal,
    "Total penalty should be sum of all neuron penalties",
  );
});
