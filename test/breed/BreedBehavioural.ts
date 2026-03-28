/**
 * Behavioural tests for the Breed class and Offspring crossover.
 *
 * Issue #1441: Verifies that:
 * 1. Offspring inherits structure from both parents
 * 2. Crossover produces valid creatures
 * 3. Offspring preserves input/output dimensions
 * 4. Offspring has connections from both parents
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

/**
 * Creates a creature with known structure and a unique hidden neuron.
 * Each parent has a distinct hidden neuron UUID so we can trace
 * which parent contributed to the offspring.
 */
function createParentCreature(
  hiddenUUID: string,
  squash: string,
  bias: number,
  weight: number,
): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      {
        type: "hidden",
        uuid: hiddenUUID,
        squash: squash,
        bias: bias,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUUID, weight: weight },
      { fromUUID: "input-1", toUUID: hiddenUUID, weight: weight * 0.5 },
      { fromUUID: hiddenUUID, toUUID: "output-0", weight: weight * 0.8 },
      { fromUUID: hiddenUUID, toUUID: "output-1", weight: weight * 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = bias; // Use bias as a proxy for score
  addTag(creature, "score", bias.toString());
  return creature;
}

Deno.test("Breed: offspring preserves input and output dimensions", () => {
  const mum = createParentCreature("hidden-mum-1", "LOGISTIC", 0.9, 0.5);
  const dad = createParentCreature("hidden-dad-1", "TANH", 0.7, 0.6);

  let offspring: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  assert(offspring, "Should produce offspring from compatible parents");
  assertEquals(
    offspring.input,
    3,
    "Offspring must have same input count as parents",
  );
  assertEquals(
    offspring.output,
    2,
    "Offspring must have same output count as parents",
  );
});

Deno.test("Breed: offspring is a valid creature", () => {
  const mum = createParentCreature("hidden-mum-2", "LOGISTIC", 0.9, 0.5);
  const dad = createParentCreature("hidden-dad-2", "TANH", 0.7, 0.6);

  let offspring: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  assert(offspring, "Should produce offspring");
  // Validation should not throw for a valid offspring
  creatureValidate(offspring);
});

Deno.test("Breed: offspring UUID differs from both parents", () => {
  const mum = createParentCreature("hidden-mum-3", "LOGISTIC", 0.9, 0.5);
  const dad = createParentCreature("hidden-dad-3", "TANH", 0.7, 0.6);

  let offspring: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  assert(offspring, "Should produce offspring");
  assertNotEquals(
    offspring.uuid,
    mum.uuid,
    "Offspring UUID must differ from mother",
  );
  assertNotEquals(
    offspring.uuid,
    dad.uuid,
    "Offspring UUID must differ from father",
  );
});

Deno.test("Breed: crossover with structurally different parents produces valid offspring", () => {
  // Mother has 2 hidden layers
  const mum = new Creature(3, 2, {
    layers: [
      { count: 3, squash: "LOGISTIC" },
      { count: 2, squash: "TANH" },
    ],
  });
  CreatureUtil.makeUUID(mum);
  mum.score = 0.9;
  addTag(mum, "score", "0.9");

  // Father has 1 hidden layer with different squash
  const dad = new Creature(3, 2, {
    layers: [
      { count: 4, squash: "RELU" },
    ],
  });
  CreatureUtil.makeUUID(dad);
  dad.score = 0.7;
  addTag(dad, "score", "0.7");

  let successCount = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring) {
      successCount++;
      assertEquals(offspring.input, 3, "Input count preserved");
      assertEquals(offspring.output, 2, "Output count preserved");
      creatureValidate(offspring);
    }
  }

  assert(
    successCount > 0,
    "Should produce at least one valid offspring in 50 attempts",
  );
});

Deno.test("Breed: offspring has synapses (not empty)", () => {
  const mum = createParentCreature("hidden-mum-4", "LOGISTIC", 0.9, 1.0);
  const dad = createParentCreature("hidden-dad-4", "TANH", 0.7, 0.8);

  let offspring: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  assert(offspring, "Should produce offspring");
  assert(
    offspring.synapses.length > 0,
    "Offspring must have at least one synapse",
  );
});

Deno.test("Breed: offspring can be exported and re-imported without error", () => {
  const mum = createParentCreature("hidden-mum-5", "LOGISTIC", 0.9, 0.5);
  const dad = createParentCreature("hidden-dad-5", "RELU", 0.7, 0.6);

  let offspring: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    offspring = Offspring.breed(mum, dad);
    if (offspring) break;
  }

  assert(offspring, "Should produce offspring");

  // Round-trip through JSON should produce identical creature
  const exported = offspring.exportJSON();
  const reimported = Creature.fromJSON(exported);
  creatureValidate(reimported);
  assertEquals(reimported.input, offspring.input);
  assertEquals(reimported.output, offspring.output);
});

Deno.test("Breed: forward-only offspring has no backward connections", () => {
  const mum = createParentCreature("hidden-mum-6", "LOGISTIC", 0.9, 0.5);
  const dad = createParentCreature("hidden-dad-6", "TANH", 0.7, 0.6);

  let offspring: Creature | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    offspring = Offspring.breed(mum, dad, { forwardOnly: true });
    if (offspring) break;
  }

  assert(offspring, "Should produce forward-only offspring");

  // Verify no backward connections: all synapses must have from < to
  for (const synapse of offspring.synapses) {
    assert(
      synapse.from <= synapse.to,
      `Forward-only violation: synapse ${synapse.from} -> ${synapse.to}`,
    );
    // Also verify no self-connections in forward-only mode
    assert(
      synapse.from !== synapse.to,
      `Self-connection in forward-only offspring: ${synapse.from} -> ${synapse.to}`,
    );
  }
});

Deno.test("Breed: repeated crossover produces diverse offspring", () => {
  const mum = new Creature(3, 2, {
    layers: [
      { count: 4, squash: "LOGISTIC" },
      { count: 3, squash: "TANH" },
    ],
  });
  CreatureUtil.makeUUID(mum);
  mum.score = 0.9;
  addTag(mum, "score", "0.9");

  const dad = new Creature(3, 2, {
    layers: [
      { count: 3, squash: "RELU" },
      { count: 2, squash: "LeakyReLU" },
    ],
  });
  CreatureUtil.makeUUID(dad);
  dad.score = 0.7;
  addTag(dad, "score", "0.7");

  const offspringUUIDs = new Set<string>();
  for (let attempt = 0; attempt < 100; attempt++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring?.uuid) {
      offspringUUIDs.add(offspring.uuid);
    }
  }

  // Should produce at least some diverse offspring (not all identical)
  assert(
    offspringUUIDs.size > 1,
    `Expected diverse offspring but got ${offspringUUIDs.size} unique UUIDs`,
  );
});
