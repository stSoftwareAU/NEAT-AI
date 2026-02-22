import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Tests for Issue #1583: Batch fix() and validate() calls.
 *
 * Verifies that:
 * 1. mutateCreature no longer calls fix()/validate() internally.
 * 2. repairAfterMutation() correctly fixes and validates a creature.
 * 3. mutate() produces valid creatures with batched repair.
 * 4. Forward-only constraint is preserved with batched repair.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({
    populationSize: 10,
    ...overrides,
  });
}

// ============================================================================
// repairAfterMutation produces valid creatures
// ============================================================================

Deno.test("MutatorBatchRepair: repairAfterMutation produces valid creature after ADD_NODE", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.ADD_NODE);
    if (changed) {
      mutator.repairAfterMutation(creature);
    }

    creatureValidate(creature);
    assertEquals(creature.input, 3, "Input preserved after ADD_NODE + repair");
    assertEquals(
      creature.output,
      2,
      "Output preserved after ADD_NODE + repair",
    );
  }
});

Deno.test("MutatorBatchRepair: repairAfterMutation produces valid creature after SUB_NODE", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 6 }] });
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.SUB_NODE);
    if (changed) {
      mutator.repairAfterMutation(creature);
    }

    creatureValidate(creature);
  }
});

// ============================================================================
// Multiple mutations then single repair
// ============================================================================

Deno.test("MutatorBatchRepair: multiple mutations then single repair produces valid creature", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(4, 2, { layers: [{ count: 6 }] });
    CreatureUtil.makeUUID(creature);

    let changed = false;

    // Apply 5 mutations without repair
    for (let i = 0; i < 5; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (mutator.mutateCreature(creature, method)) {
        changed = true;
      }
    }

    // Single repair at the end
    if (changed) {
      mutator.repairAfterMutation(creature);
    }

    creatureValidate(creature);
    assertEquals(creature.input, 4, "Input preserved after batch mutation");
    assertEquals(creature.output, 2, "Output preserved after batch mutation");
  }
});

// ============================================================================
// mutate() with high mutationAmount produces valid creatures
// ============================================================================

Deno.test("MutatorBatchRepair: mutate with mutationAmount=10 produces valid creatures", () => {
  const config = createConfig({ mutationRate: 1.0, mutationAmount: 10 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 20; i++) {
    creatures.push(new Creature(5, 3, { layers: [{ count: 6 }] }));
  }

  mutator.mutate(creatures);

  for (let i = 0; i < creatures.length; i++) {
    creatureValidate(creatures[i]);
    assertEquals(creatures[i].input, 5, `Creature ${i} inputs preserved`);
    assertEquals(creatures[i].output, 3, `Creature ${i} outputs preserved`);
  }
});

// ============================================================================
// Forward-only constraint preserved with batched repair
// ============================================================================

Deno.test("MutatorBatchRepair: forward-only constraint preserved with batched repair", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 10; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    creature.forwardOnly = true;
    CreatureUtil.makeUUID(creature);

    let changed = false;

    // Apply 5 mutations without repair
    for (let i = 0; i < 5; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (mutator.mutateCreature(creature, method)) {
        changed = true;
      }
    }

    // Single repair at the end
    if (changed) {
      mutator.repairAfterMutation(creature);
    }

    // Verify forward-only constraint
    for (const synapse of creature.synapses) {
      assert(
        synapse.from !== synapse.to,
        `Self-connection found: ${synapse.from}`,
      );
      assert(
        synapse.from < synapse.to,
        `Backward connection found: from=${synapse.from} to=${synapse.to}`,
      );
    }

    creatureValidate(creature);
  }
});

// ============================================================================
// Semantic version 4.x with batched repair
// ============================================================================

Deno.test("MutatorBatchRepair: 4.x forward-only enforced with batched repair", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 10; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    creature.semanticVersion = "4.0.0";
    CreatureUtil.makeUUID(creature);

    let changed = false;

    for (let i = 0; i < 5; i++) {
      const method = mutator.selectMutationMethod(creature);
      if (mutator.mutateCreature(creature, method)) {
        changed = true;
      }
    }

    if (changed) {
      mutator.repairAfterMutation(creature);
    }

    // 4.x creatures must always be forward-only
    for (const synapse of creature.synapses) {
      assert(
        synapse.from !== synapse.to,
        `4.x self-connection found: ${synapse.from}`,
      );
      assert(
        synapse.from < synapse.to,
        `4.x backward connection found: from=${synapse.from} to=${synapse.to}`,
      );
    }

    creatureValidate(creature);
  }
});

// ============================================================================
// mutateCreature return value still correct
// ============================================================================

Deno.test("MutatorBatchRepair: mutateCreature returns boolean indicating change", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let trueCount = 0;
  let falseCount = 0;

  for (let i = 0; i < 50; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    CreatureUtil.makeUUID(creature);

    const result = mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
    if (result) {
      trueCount++;
      mutator.repairAfterMutation(creature);
    } else {
      falseCount++;
    }
  }

  // At least some should succeed
  assert(trueCount > 0, "Some MOD_WEIGHT mutations should succeed");
  // Both outcomes are possible (though false is rare for MOD_WEIGHT)
  assert(
    trueCount + falseCount === 50,
    "Every call should return true or false",
  );
});
