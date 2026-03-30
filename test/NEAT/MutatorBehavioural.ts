import {
  assert,
  assertEquals,
  assertGreater,
  assertNotEquals,
} from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";

/**
 * Behavioural tests for the mutation engine (Mutator.ts).
 *
 * Issue #1439: Verify mutation outcomes — valid creatures, structural
 * changes, forward-only constraint, and mutation rate behaviour.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({
    populationSize: 10,
    ...overrides,
  });
}

// ============================================================================
// Mutation Produces Valid Creatures
// ============================================================================

Deno.test("MutatorBehavioural: mutation produces valid creatures after ADD_NODE", () => {
  const config = createConfig({ debug: true });
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    CreatureUtil.makeUUID(creature);

    mutator.mutateCreature(creature, Mutation.ADD_NODE);
    mutator.repairAfterMutation(creature);

    // Creature must pass validation
    creatureValidate(creature);
    assertEquals(creature.input, 3, "Input preserved after ADD_NODE");
    assertEquals(creature.output, 2, "Output preserved after ADD_NODE");
  }
});

Deno.test("MutatorBehavioural: mutation produces valid creatures after ADD_CONN", () => {
  const config = createConfig({ debug: true });
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    CreatureUtil.makeUUID(creature);

    mutator.mutateCreature(creature, Mutation.ADD_CONN);
    mutator.repairAfterMutation(creature);

    creatureValidate(creature);
    assertEquals(creature.input, 3, "Input preserved after ADD_CONN");
    assertEquals(creature.output, 2, "Output preserved after ADD_CONN");
  }
});

Deno.test("MutatorBehavioural: mutation produces valid creatures after SUB_NODE", () => {
  const config = createConfig({ debug: true });
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 6 }] });
    CreatureUtil.makeUUID(creature);

    mutator.mutateCreature(creature, Mutation.SUB_NODE);
    mutator.repairAfterMutation(creature);

    creatureValidate(creature);
    assertEquals(creature.input, 3, "Input preserved after SUB_NODE");
    assertEquals(creature.output, 2, "Output preserved after SUB_NODE");
  }
});

Deno.test("MutatorBehavioural: mutation produces valid creatures after SUB_CONN", () => {
  const config = createConfig({ debug: true });
  const mutator = new Mutator(config);

  for (let attempt = 0; attempt < 20; attempt++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    CreatureUtil.makeUUID(creature);

    mutator.mutateCreature(creature, Mutation.SUB_CONN);
    mutator.repairAfterMutation(creature);

    creatureValidate(creature);
  }
});

Deno.test("MutatorBehavioural: mutation produces valid creatures across all FFW methods", () => {
  const config = createConfig({ debug: true });
  const mutator = new Mutator(config);

  for (const mutation of Mutation.FFW) {
    const creature = new Creature(4, 2, { layers: [{ count: 6 }] });
    CreatureUtil.makeUUID(creature);

    mutator.mutateCreature(creature, mutation);
    mutator.repairAfterMutation(creature);

    creatureValidate(creature);
    assertEquals(creature.input, 4, `Input preserved after ${mutation.name}`);
    assertEquals(creature.output, 2, `Output preserved after ${mutation.name}`);
  }
});

// ============================================================================
// Structural Change Verification
// ============================================================================

Deno.test("MutatorBehavioural: ADD_NODE creates expected structural changes", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let addedNeuronCount = 0;
  const attempts = 30;

  for (let i = 0; i < attempts; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
    const originalCount = creature.neurons.length;
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.ADD_NODE);
    if (changed && creature.neurons.length > originalCount) {
      addedNeuronCount++;
    }
  }

  assertGreater(
    addedNeuronCount,
    0,
    "ADD_NODE should add neurons in at least some attempts",
  );
});

Deno.test("MutatorBehavioural: ADD_CONN creates expected structural changes", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let addedConnectionCount = 0;
  const attempts = 30;

  for (let i = 0; i < attempts; i++) {
    // Use fewer layers to leave room for new connections
    const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
    const originalCount = creature.synapses.length;
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.ADD_CONN);
    if (changed && creature.synapses.length > originalCount) {
      addedConnectionCount++;
    }
  }

  assertGreater(
    addedConnectionCount,
    0,
    "ADD_CONN should add connections in at least some attempts",
  );
});

Deno.test("MutatorBehavioural: SUB_NODE removes neurons", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let removedCount = 0;
  const attempts = 30;

  for (let i = 0; i < attempts; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 6 }] });
    const originalCount = creature.neurons.length;
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.SUB_NODE);
    if (changed && creature.neurons.length < originalCount) {
      removedCount++;
    }
  }

  assertGreater(
    removedCount,
    0,
    "SUB_NODE should remove neurons in at least some attempts",
  );
});

Deno.test("MutatorBehavioural: MOD_WEIGHT changes synapse weights", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let changedCount = 0;
  const attempts = 20;

  for (let i = 0; i < attempts; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
    const originalWeights = creature.synapses.map((s) => s.weight);
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
    if (changed) {
      const newWeights = creature.synapses.map((s) => s.weight);
      const anyDifferent = originalWeights.some((w, idx) =>
        w !== newWeights[idx]
      );
      if (anyDifferent) changedCount++;
    }
  }

  assertGreater(
    changedCount,
    0,
    "MOD_WEIGHT should change weights in at least some attempts",
  );
});

Deno.test("MutatorBehavioural: MOD_BIAS changes neuron biases", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let changedCount = 0;
  const attempts = 20;

  for (let i = 0; i < attempts; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
    const originalBiases = creature.neurons.map((n) => n.bias);
    CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.MOD_BIAS);
    if (changed) {
      const newBiases = creature.neurons.map((n) => n.bias);
      const anyDifferent = originalBiases.some((b, idx) =>
        b !== newBiases[idx]
      );
      if (anyDifferent) changedCount++;
    }
  }

  assertGreater(
    changedCount,
    0,
    "MOD_BIAS should change biases in at least some attempts",
  );
});

// ============================================================================
// Forward-Only Constraint
// ============================================================================

Deno.test("MutatorBehavioural: forward-only constraint preserved across multiple mutations", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  creature.forwardOnly = true;
  CreatureUtil.makeUUID(creature);

  // Apply many mutations and verify forward-only is never violated
  for (let i = 0; i < 50; i++) {
    const method = mutator.selectMutationMethod(creature);
    mutator.mutateCreature(creature, method);
    // Issue #1583: fix/validate deferred — call repair before checking.
    mutator.repairAfterMutation(creature);

    // Verify all synapses go forward
    for (const synapse of creature.synapses) {
      assert(
        synapse.from !== synapse.to,
        `Self-connection found after mutation ${i}: ${synapse.from}`,
      );
      assert(
        synapse.from < synapse.to,
        `Backward connection found after mutation ${i}: from=${synapse.from} to=${synapse.to}`,
      );
    }
  }
});

Deno.test("MutatorBehavioural: semantic version 4.x enforces forward-only for weight/bias mutations", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  // Weight and bias mutations should never introduce recurrent connections
  const safeMutations = [
    Mutation.MOD_WEIGHT,
    Mutation.MOD_BIAS,
    Mutation.MOD_SQUASH,
  ];

  for (const mutation of safeMutations) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    creature.semanticVersion = "4.0.0";
    CreatureUtil.makeUUID(creature);

    mutator.mutateCreature(creature, mutation);
    mutator.repairAfterMutation(creature);

    // 4.x creatures must always be forward-only after non-topological mutations
    for (const synapse of creature.synapses) {
      assert(
        synapse.from !== synapse.to,
        `4.x self-connection after ${mutation.name}`,
      );
      assert(
        synapse.from < synapse.to,
        `4.x backward connection after ${mutation.name}: from=${synapse.from} to=${synapse.to}`,
      );
    }
  }
});

// ============================================================================
// Mutation Rate Configuration
// ============================================================================

Deno.test("MutatorBehavioural: high mutation rate mutates most creatures", () => {
  const config = createConfig({ mutationRate: 1.0 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  const originalUUIDs: string[] = [];
  for (let i = 0; i < 20; i++) {
    const c = new Creature(3, 2, { layers: [{ count: 4 }] });
    originalUUIDs.push(CreatureUtil.makeUUID(c));
    creatures.push(c);
  }

  mutator.mutate(creatures);

  let changedCount = 0;
  for (let i = 0; i < creatures.length; i++) {
    const newUUID = CreatureUtil.makeUUID(creatures[i]);
    if (newUUID !== originalUUIDs[i]) {
      changedCount++;
    }
  }

  assertGreater(
    changedCount,
    0,
    "With 100% mutation rate, at least some creatures should change",
  );
});

Deno.test("MutatorBehavioural: very low mutation rate leaves most creatures unchanged", () => {
  const config = createConfig({ mutationRate: 0.002 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  const originalUUIDs: string[] = [];
  for (let i = 0; i < 20; i++) {
    const c = new Creature(3, 2, { layers: [{ count: 4 }] });
    originalUUIDs.push(CreatureUtil.makeUUID(c));
    creatures.push(c);
  }

  mutator.mutate(creatures);

  let unchangedCount = 0;
  for (let i = 0; i < creatures.length; i++) {
    const newUUID = CreatureUtil.makeUUID(creatures[i]);
    if (newUUID === originalUUIDs[i]) {
      unchangedCount++;
    }
  }

  assertGreater(
    unchangedCount,
    creatures.length / 2,
    "Most creatures should remain unchanged with very low mutation rate",
  );
});

Deno.test("MutatorBehavioural: mutation amount controls mutations per creature", () => {
  // With mutationAmount=1 vs mutationAmount=5, more mutations should
  // cause more structural change
  const config1 = createConfig({ mutationRate: 1.0, mutationAmount: 1 });
  const config5 = createConfig({ mutationRate: 1.0, mutationAmount: 5 });
  const mutator1 = new Mutator(config1);
  const mutator5 = new Mutator(config5);

  // Run multiple times and compare average structural change
  let totalChange1 = 0;
  let totalChange5 = 0;
  const trials = 100;

  for (let t = 0; t < trials; t++) {
    const c1 = new Creature(3, 2, { layers: [{ count: 6 }] });
    const c5 = Creature.fromJSON(c1.exportJSON());
    const originalNeurons = c1.neurons.length;
    const originalSynapses = c1.synapses.length;
    CreatureUtil.makeUUID(c1);
    CreatureUtil.makeUUID(c5);

    mutator1.mutate([c1]);
    mutator5.mutate([c5]);

    totalChange1 += Math.abs(c1.neurons.length - originalNeurons) +
      Math.abs(c1.synapses.length - originalSynapses);
    totalChange5 += Math.abs(c5.neurons.length - originalNeurons) +
      Math.abs(c5.synapses.length - originalSynapses);
  }

  // With 5x mutations, we expect more structural change on average.
  // Allow some tolerance since mutations are stochastic.
  assert(
    totalChange5 >= totalChange1,
    `More mutations (${totalChange5}) should cause >= change than fewer (${totalChange1})`,
  );
});

// ============================================================================
// Select Mutation Method
// ============================================================================

Deno.test("MutatorBehavioural: selectMutationMethod returns valid mutations", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  CreatureUtil.makeUUID(creature);

  const validNames = new Set(Mutation.FFW.map((m) => m.name));

  for (let i = 0; i < 100; i++) {
    const method = mutator.selectMutationMethod(creature);
    assert(
      validNames.has(method.name),
      `Selected mutation '${method.name}' should be a valid FFW mutation`,
    );
  }
});

Deno.test("MutatorBehavioural: selectMutationMethod prefers weight/bias for large creatures", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  // Create a large creature — should heavily favour weight/bias mutations
  const creature = new Creature(3, 2, { layers: [{ count: 20 }] });
  CreatureUtil.makeUUID(creature);

  let weightBiasCount = 0;
  const total = 1000;

  for (let i = 0; i < total; i++) {
    const method = mutator.selectMutationMethod(creature);
    if (method.name === "MOD_WEIGHT" || method.name === "MOD_BIAS") {
      weightBiasCount++;
    }
  }

  // Large creatures should have > 70% weight/bias preference
  const ratio = weightBiasCount / total;
  assertGreater(
    ratio,
    0.7,
    `Weight/bias ratio for large creature should be > 0.7, got ${ratio}`,
  );
});

// ============================================================================
// Population-Level Mutation
// ============================================================================

Deno.test("MutatorBehavioural: batch mutation preserves all creature dimensions", () => {
  const config = createConfig({ mutationRate: 1.0, mutationAmount: 3 });
  const mutator = new Mutator(config);

  const creatures: Creature[] = [];
  for (let i = 0; i < 15; i++) {
    creatures.push(new Creature(5, 3, { layers: [{ count: 6 }] }));
  }

  mutator.mutate(creatures);

  for (let i = 0; i < creatures.length; i++) {
    assertEquals(
      creatures[i].input,
      5,
      `Creature ${i} should still have 5 inputs`,
    );
    assertEquals(
      creatures[i].output,
      3,
      `Creature ${i} should still have 3 outputs`,
    );
  }
});

Deno.test("MutatorBehavioural: mutated creature UUID differs from original", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  let changedAtLeastOnce = false;

  for (let i = 0; i < 20; i++) {
    const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
    const originalUUID = CreatureUtil.makeUUID(creature);

    const changed = mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
    if (changed) {
      const newUUID = CreatureUtil.makeUUID(creature);
      assertNotEquals(
        newUUID,
        originalUUID,
        "UUID should change when mutation succeeds",
      );
      changedAtLeastOnce = true;
    }
  }

  assert(
    changedAtLeastOnce,
    "At least one MOD_WEIGHT mutation should succeed over 20 attempts",
  );
});
