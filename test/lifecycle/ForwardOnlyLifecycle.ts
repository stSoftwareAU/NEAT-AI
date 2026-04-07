/**
 * Integration tests verifying forward-only validity through mutation,
 * breeding, serialisation round-trips, and multi-generation evolution.
 *
 * Covers the full lifecycle from initialisation through multiple generations,
 * ensuring no creature ever gains a backward synapse or triggers the
 * "Stripping recurrent synapse" warning during normal operation.
 *
 * @see https://github.com/stSoftwareAU/NEAT-AI/issues/2192
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { getLogger } from "@utils/Logger.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Forward-only mutations (structural + weight/bias/squash). */
const FORWARD_ONLY_MUTATIONS: readonly { name: string }[] = Mutation.FFW;

/**
 * Assert that every synapse in the creature goes strictly forward
 * (from < to) and that structural validation passes with forwardOnly.
 */
function assertForwardOnly(creature: Creature, context: string): void {
  for (let i = 0; i < creature.synapses.length; i++) {
    const s = creature.synapses[i];
    assert(
      s.from < s.to,
      `${context}: synapse ${i} violates forward-only (from=${s.from}, to=${s.to})`,
    );
  }
  creature.validate({ forwardOnly: true });
  creatureValidate(creature);
}

// ---------------------------------------------------------------------------
// 1. Mutation lifecycle test
// ---------------------------------------------------------------------------
Deno.test("Forward-only lifecycle: mutations preserve topology", async () => {
  await initWasmForTests();

  const rngBefore = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(20250407));
  try {
    const creature = new Creature(3, 2, {
      layers: [{ count: 4 }, { count: 3 }],
    });
    assertEquals(creature.forwardOnly, true);
    assertForwardOnly(creature, "initial");

    const mutator = new Mutator(createNeatConfig({
      mutationRate: 1.0,
      mutationAmount: 3,
    }));

    // Apply multiple rounds of every forward-only mutation type.
    for (let round = 0; round < 5; round++) {
      for (const method of FORWARD_ONLY_MUTATIONS) {
        for (let attempt = 0; attempt < 4; attempt++) {
          if (mutator.mutateCreature(creature, method)) break;
        }
        mutator.repairAfterMutation(creature);
        assertForwardOnly(
          creature,
          `round ${round}, after ${method.name}`,
        );
      }
    }
  } finally {
    setRandomNumberGenerator(rngBefore);
  }
});

// ---------------------------------------------------------------------------
// 2. Breeding lifecycle test
// ---------------------------------------------------------------------------
Deno.test("Forward-only lifecycle: breeding produces valid offspring", async () => {
  await initWasmForTests();

  const rngBefore = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(20250408));
  try {
    // Create two distinct forward-only parents with hidden layers.
    const mum = new Creature(3, 2, {
      layers: [{ count: 5 }, { count: 3 }],
    });
    const dad = new Creature(3, 2, {
      layers: [{ count: 4 }, { count: 4 }],
    });

    const mutator = new Mutator(createNeatConfig({
      mutationRate: 1.0,
      mutationAmount: 2,
    }));

    // Mutate parents to create structural diversity.
    for (let i = 0; i < 10; i++) {
      mutator.mutateCreature(mum, Mutation.ADD_NODE);
      mutator.mutateCreature(dad, Mutation.ADD_NODE);
      mutator.mutateCreature(mum, Mutation.ADD_CONN);
      mutator.mutateCreature(dad, Mutation.ADD_CONN);
    }
    mutator.repairAfterMutation(mum);
    mutator.repairAfterMutation(dad);
    assertForwardOnly(mum, "mutated mum");
    assertForwardOnly(dad, "mutated dad");

    // Breed multiple offspring and validate each.
    let offspringCount = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const child = Offspring.breed(mum, dad, { forwardOnly: true });
      if (!child) continue;
      offspringCount++;
      assertForwardOnly(child, `offspring #${offspringCount}`);
      assertEquals(child.forwardOnly, true);
    }
    assert(
      offspringCount > 0,
      "Expected at least one offspring from breeding",
    );
  } finally {
    setRandomNumberGenerator(rngBefore);
  }
});

// ---------------------------------------------------------------------------
// 3. Serialisation round-trip test
// ---------------------------------------------------------------------------
Deno.test("Forward-only lifecycle: serialisation round-trip preserves topology", async () => {
  await initWasmForTests();

  const rngBefore = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(20250409));
  try {
    const creature = new Creature(3, 2, {
      layers: [{ count: 5 }, { count: 3 }],
    });

    const mutator = new Mutator(createNeatConfig({
      mutationRate: 1.0,
      mutationAmount: 2,
    }));

    // Add structural complexity.
    for (let i = 0; i < 8; i++) {
      mutator.mutateCreature(creature, Mutation.ADD_NODE);
      mutator.mutateCreature(creature, Mutation.ADD_CONN);
    }
    mutator.repairAfterMutation(creature);
    assertForwardOnly(creature, "before serialisation");

    // Intercept logger to detect stripping warnings.
    const logger = getLogger();
    const originalError = logger.error.bind(logger);
    const warnings: string[] = [];
    logger.error = (...args: unknown[]) => {
      const msg = args.map(String).join(" ");
      warnings.push(msg);
      originalError(...args);
    };

    try {
      const json = creature.exportJSON();
      assertEquals(json.forwardOnly, true);

      // Round-trip through JSON serialisation.
      const restored = Creature.fromJSON(json);

      // Check no stripping warnings were emitted.
      const strippingWarnings = warnings.filter((w) =>
        w.includes("Stripping recurrent synapse")
      );
      assertEquals(
        strippingWarnings.length,
        0,
        `Stripping warnings emitted during deserialisation: ${
          strippingWarnings.join("; ")
        }`,
      );

      // Validate restored creature.
      assertForwardOnly(restored, "after deserialisation");
      assertEquals(restored.forwardOnly, true);

      // Verify neuron and synapse counts match.
      assertEquals(
        restored.neurons.length,
        creature.neurons.length,
        "Neuron count changed after round-trip",
      );
      assertEquals(
        restored.synapses.length,
        creature.synapses.length,
        "Synapse count changed after round-trip (possible stripping)",
      );
    } finally {
      logger.error = originalError;
    }
  } finally {
    setRandomNumberGenerator(rngBefore);
  }
});

// ---------------------------------------------------------------------------
// 4. Multi-generation stress test
// ---------------------------------------------------------------------------
Deno.test("Forward-only lifecycle: multi-generation evolution", async () => {
  await initWasmForTests();

  const rngBefore = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(20250410));
  try {
    const POPULATION_SIZE = 6;
    const GENERATIONS = 5;

    // Initialise a small population of forward-only creatures.
    const population: Creature[] = [];
    for (let i = 0; i < POPULATION_SIZE; i++) {
      const creature = new Creature(2, 1, {
        layers: [{ count: 3 }],
      });
      assertForwardOnly(creature, `initial pop[${i}]`);
      population.push(creature);
    }

    const mutator = new Mutator(createNeatConfig({
      mutationRate: 1.0,
      mutationAmount: 2,
    }));

    for (let gen = 0; gen < GENERATIONS; gen++) {
      // Mutate each creature.
      for (let i = 0; i < population.length; i++) {
        const creature = population[i];
        // Pick a random forward-only mutation.
        const method = FORWARD_ONLY_MUTATIONS[
          Math.floor(Math.random() * FORWARD_ONLY_MUTATIONS.length)
        ];
        for (let attempt = 0; attempt < 4; attempt++) {
          if (mutator.mutateCreature(creature, method)) break;
        }
        mutator.repairAfterMutation(creature);
        assertForwardOnly(
          creature,
          `gen ${gen}, creature ${i} after mutation`,
        );
      }

      // Breed pairs to produce offspring for next generation.
      const offspring: Creature[] = [];
      for (let i = 0; i < population.length; i += 2) {
        const mum = population[i];
        const dad = population[(i + 1) % population.length];
        for (let attempt = 0; attempt < 10; attempt++) {
          const child = Offspring.breed(mum, dad, { forwardOnly: true });
          if (child) {
            assertForwardOnly(
              child,
              `gen ${gen}, offspring from ${i}x${(i + 1) % population.length}`,
            );
            offspring.push(child);
            break;
          }
        }
      }

      // Serialisation round-trip for each offspring.
      for (let i = 0; i < offspring.length; i++) {
        const json = offspring[i].exportJSON();
        const restored = Creature.fromJSON(json);
        assertForwardOnly(
          restored,
          `gen ${gen}, offspring[${i}] after round-trip`,
        );
      }

      // Replace weakest half of population with offspring.
      for (
        let i = 0;
        i < offspring.length && i < Math.floor(population.length / 2);
        i++
      ) {
        population[population.length - 1 - i] = offspring[i];
      }
    }

    // Final validation of entire surviving population.
    for (let i = 0; i < population.length; i++) {
      assertForwardOnly(population[i], `final pop[${i}]`);
    }
  } finally {
    setRandomNumberGenerator(rngBefore);
  }
});
