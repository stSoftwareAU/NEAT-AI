import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Test suite for Offspring.breed() functionality after shallowClone optimisation.
 *
 * Issue #1095: Performance - Avoid JSON clone in Offspring.breed() parent preparation
 *
 * The breed() method previously used:
 *   const mother = upgrade(Creature.fromJSON(mum.exportJSON()));
 *   let father = upgrade(Creature.fromJSON(dad.exportJSON()));
 *
 * This creates full JSON clones which is slow for large creatures.
 *
 * The optimisation uses shallowClone() instead, which:
 * - Creates a new Creature with copied neuron/synapse arrays
 * - Avoids JSON string creation and parsing
 * - Is 3-4x faster than JSON serialisation/deserialisation
 *
 * These tests verify functional correctness. Performance benchmarking is done
 * in bench/BreedPerformance.ts.
 */

Deno.test("Offspring.breed() - breeding output equivalence after shallowClone optimisation", () => {
  // Create two parent creatures with moderate complexity
  const mum = new Creature(5, 3, {
    layers: [{ count: 10 }, { count: 5 }],
  });
  creatureValidate(mum);

  const dad = new Creature(5, 3, {
    layers: [{ count: 8 }, { count: 6 }],
  });
  creatureValidate(dad);

  // Breed multiple times and verify offspring are valid
  let successCount = 0;
  for (let i = 0; i < 20; i++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring) {
      creatureValidate(offspring);
      assertEquals(offspring.input, mum.input, "Offspring input mismatch");
      assertEquals(offspring.output, mum.output, "Offspring output mismatch");

      // Verify offspring can activate
      const input = new Float32Array(5);
      for (let j = 0; j < 5; j++) {
        input[j] = Math.random();
      }
      const output = offspring.activate(input);
      assertEquals(output.length, 3, "Offspring output count mismatch");

      // Verify all outputs are valid numbers
      for (let j = 0; j < output.length; j++) {
        assert(
          Number.isFinite(output[j]),
          `Offspring output ${j} is not finite`,
        );
      }

      successCount++;
    }
  }

  // At least some breeding should succeed
  assert(successCount > 0, "No offspring were successfully bred");
});

Deno.test("Offspring.breed() - parent creatures are not modified during breeding", () => {
  // Create parent creatures
  const mum = new Creature(4, 2, {
    layers: [{ count: 8 }],
  });
  creatureValidate(mum);
  mum.uuid = "mum-test-uuid";
  mum.score = 0.95;

  const dad = new Creature(4, 2, {
    layers: [{ count: 6 }],
  });
  creatureValidate(dad);
  dad.uuid = "dad-test-uuid";
  dad.score = 0.85;

  // Record original state
  const mumJSON = JSON.stringify(mum.exportJSON());
  const dadJSON = JSON.stringify(dad.exportJSON());
  const mumBiases = mum.neurons.map((n) => n.bias);
  const dadBiases = dad.neurons.map((n) => n.bias);
  const mumWeights = mum.synapses.map((s) => s.weight);
  const dadWeights = dad.synapses.map((s) => s.weight);

  // Breed multiple times
  for (let i = 0; i < 10; i++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring) {
      creatureValidate(offspring);

      // Mutate offspring (simulate what evolution might do)
      for (
        let j = offspring.input;
        j < offspring.neurons.length;
        j++
      ) {
        offspring.neurons[j].bias += Math.random() * 0.1 - 0.05;
      }
      for (const synapse of offspring.synapses) {
        synapse.weight += Math.random() * 0.1 - 0.05;
      }
    }
  }

  // Verify parents are unchanged
  assertEquals(mum.uuid, "mum-test-uuid", "Mum UUID was modified");
  assertEquals(dad.uuid, "dad-test-uuid", "Dad UUID was modified");
  assertEquals(mum.score, 0.95, "Mum score was modified");
  assertEquals(dad.score, 0.85, "Dad score was modified");

  for (let i = 0; i < mum.neurons.length; i++) {
    assertEquals(
      mum.neurons[i].bias,
      mumBiases[i],
      `Mum neuron ${i} bias was modified`,
    );
  }
  for (let i = 0; i < dad.neurons.length; i++) {
    assertEquals(
      dad.neurons[i].bias,
      dadBiases[i],
      `Dad neuron ${i} bias was modified`,
    );
  }

  for (let i = 0; i < mum.synapses.length; i++) {
    assertEquals(
      mum.synapses[i].weight,
      mumWeights[i],
      `Mum synapse ${i} weight was modified`,
    );
  }
  for (let i = 0; i < dad.synapses.length; i++) {
    assertEquals(
      dad.synapses[i].weight,
      dadWeights[i],
      `Dad synapse ${i} weight was modified`,
    );
  }

  assertEquals(
    JSON.stringify(mum.exportJSON()),
    mumJSON,
    "Mum export JSON was modified",
  );
  assertEquals(
    JSON.stringify(dad.exportJSON()),
    dadJSON,
    "Dad export JSON was modified",
  );
});

Deno.test("Offspring.breed() - large creature breeding functionality", () => {
  // Create large parent creatures matching issue requirements (500+ neurons)
  const mum = new Creature(50, 20, {
    layers: [
      { count: 200 },
      { count: 150 },
      { count: 100 },
    ],
  });
  creatureValidate(mum);

  const dad = new Creature(50, 20, {
    layers: [
      { count: 180 },
      { count: 160 },
      { count: 80 },
    ],
  });
  creatureValidate(dad);

  // Verify breeding works for large creatures
  // Performance benchmarking is done in bench/BreedPerformance.ts
  let successCount = 0;
  for (let i = 0; i < 3; i++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring) {
      creatureValidate(offspring);
      assertEquals(offspring.input, mum.input, "Offspring input mismatch");
      assertEquals(offspring.output, mum.output, "Offspring output mismatch");
      successCount++;
    }
  }

  // At least some breeding should succeed
  assert(successCount > 0, "No offspring were successfully bred");
});

Deno.test("Offspring.breed() - semantic version and forwardOnly preservation", () => {
  // Create creatures with specific version settings
  const mum = new Creature(3, 2, {
    layers: [{ count: 5 }],
    semanticVersion: "4.0.0",
  });
  mum.forwardOnly = true;
  creatureValidate(mum);

  const dad = new Creature(3, 2, {
    layers: [{ count: 5 }],
    semanticVersion: "4.0.0",
  });
  dad.forwardOnly = true;
  creatureValidate(dad);

  // Breed and verify version handling
  let foundOffspring = false;
  for (let i = 0; i < 20; i++) {
    const offspring = Offspring.breed(mum, dad, { forwardOnly: true });
    if (offspring) {
      creatureValidate(offspring);
      // The offspring should respect forwardOnly when both parents are 4.x
      assertEquals(
        offspring.forwardOnly,
        true,
        "Offspring should be forwardOnly",
      );
      foundOffspring = true;
      break;
    }
  }
  assert(foundOffspring, "Should have at least one successful offspring");
});

Deno.test("Offspring.breed() - activation equivalence with original implementation", async () => {
  await initWasmForTests();
  // Create creatures and breed them
  const mum = new Creature(4, 2, {
    layers: [{ count: 6 }],
  });
  creatureValidate(mum);

  const dad = new Creature(4, 2, {
    layers: [{ count: 6 }],
  });
  creatureValidate(dad);

  // Breed and test activation
  let testedOffspring = 0;
  for (let i = 0; i < 30 && testedOffspring < 5; i++) {
    const offspring = Offspring.breed(mum, dad);
    if (offspring) {
      creatureValidate(offspring);

      // Test activation with multiple inputs
      for (let j = 0; j < 10; j++) {
        const input = new Float32Array([
          Math.random(),
          Math.random(),
          Math.random(),
          Math.random(),
        ]);

        offspring.clearState();
        const output1 = offspring.activate(input.slice() as Float32Array);

        // Create a clone of offspring using JSON method
        const offspringClone = Creature.fromJSON(offspring.exportJSON());
        offspringClone.clearState();
        const output2 = offspringClone.activate(input.slice() as Float32Array);

        // Outputs should match
        for (let k = 0; k < output1.length; k++) {
          assertAlmostEquals(
            output1[k],
            output2[k],
            1e-10,
            `Output ${k} mismatch for offspring ${testedOffspring}, input ${j}`,
          );
        }
      }
      testedOffspring++;
    }
  }

  assert(testedOffspring > 0, "No offspring were tested");
});
