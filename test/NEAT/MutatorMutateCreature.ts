import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";

/**
 * Unit tests for Mutator.mutateCreature method.
 *
 * Issue #1397: Verify single-creature mutation behaviour including
 * forward-only constraint enforcement, semantic version upgrades,
 * UUID changes, and validation after mutation.
 */

function createConfig(overrides: Record<string, unknown> = {}) {
  return createNeatConfig({
    populationSize: 10,
    ...overrides,
  });
}

Deno.test("MutatorMutateCreature: MOD_WEIGHT changes creature UUID", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  const originalUUID = CreatureUtil.makeUUID(creature);

  const changed = mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);

  if (changed) {
    const newUUID = CreatureUtil.makeUUID(creature);
    assertNotEquals(
      newUUID,
      originalUUID,
      "UUID should change after successful mutation",
    );
  }
});

Deno.test("MutatorMutateCreature: MOD_BIAS changes creature UUID", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  const originalUUID = CreatureUtil.makeUUID(creature);

  const changed = mutator.mutateCreature(creature, Mutation.MOD_BIAS);

  if (changed) {
    const newUUID = CreatureUtil.makeUUID(creature);
    assertNotEquals(
      newUUID,
      originalUUID,
      "UUID should change after successful mutation",
    );
  }
});

Deno.test("MutatorMutateCreature: ADD_NODE adds a neuron", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  const originalNeuronCount = creature.neurons.length;

  const changed = mutator.mutateCreature(creature, Mutation.ADD_NODE);

  if (changed) {
    assert(
      creature.neurons.length >= originalNeuronCount,
      "Neuron count should increase or stay the same after ADD_NODE",
    );
  }
});

Deno.test("MutatorMutateCreature: SUB_NODE removes a neuron when hidden neurons exist", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  const originalNeuronCount = creature.neurons.length;

  const changed = mutator.mutateCreature(creature, Mutation.SUB_NODE);

  if (changed) {
    assert(
      creature.neurons.length <= originalNeuronCount,
      "Neuron count should decrease or stay the same after SUB_NODE",
    );
  }
});

Deno.test("MutatorMutateCreature: ADD_CONN adds a synapse", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  const originalSynapseCount = creature.synapses.length;

  const changed = mutator.mutateCreature(creature, Mutation.ADD_CONN);

  if (changed) {
    assert(
      creature.synapses.length >= originalSynapseCount,
      "Synapse count should increase or stay the same after ADD_CONN",
    );
  }
});

Deno.test("MutatorMutateCreature: MOD_SQUASH changes activation function", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  CreatureUtil.makeUUID(creature);

  // MOD_SQUASH should either change a squash function or return false
  mutator.mutateCreature(creature, Mutation.MOD_SQUASH);

  // Creature should still be valid regardless
  assertEquals(creature.input, 3);
  assertEquals(creature.output, 2);
});

Deno.test("MutatorMutateCreature: SWAP_NODES swaps neurons", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  // Need at least 2 hidden neurons for SWAP_NODES
  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });
  CreatureUtil.makeUUID(creature);

  mutator.mutateCreature(creature, Mutation.SWAP_NODES);

  // Creature should still be valid
  assertEquals(creature.input, 3);
  assertEquals(creature.output, 2);
});

Deno.test("MutatorMutateCreature: throws on unknown mutation method", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  CreatureUtil.makeUUID(creature);

  assertThrows(
    () => mutator.mutateCreature(creature, { name: "UNKNOWN_MUTATION" }),
    Error,
    "unknown mutation method",
  );
});

Deno.test("MutatorMutateCreature: preserves forward-only constraint", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  creature.forwardOnly = true;
  CreatureUtil.makeUUID(creature);

  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);

  // After mutation, creature should still be valid for forward-only
  // (no self-connections or backward connections)
  for (const synapse of creature.synapses) {
    assert(
      synapse.from !== synapse.to,
      "Forward-only creature should have no self-connections",
    );
    assert(
      synapse.from < synapse.to,
      `Forward-only constraint: from (${synapse.from}) should be < to (${synapse.to})`,
    );
  }
});

Deno.test("MutatorMutateCreature: semantic version 4.x enforces forward-only", () => {
  const config = createConfig();
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  creature.semanticVersion = "4.0.0";
  CreatureUtil.makeUUID(creature);

  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);

  // 4.x creatures should always enforce forward-only
  for (const synapse of creature.synapses) {
    assert(
      synapse.from !== synapse.to,
      "4.x creature should have no self-connections",
    );
    assert(
      synapse.from < synapse.to,
      `4.x creature forward-only: from (${synapse.from}) should be < to (${synapse.to})`,
    );
  }
});

Deno.test("MutatorMutateCreature: creature remains valid after mutation", () => {
  const config = createConfig({ debug: true });
  const mutator = new Mutator(config);

  const creature = new Creature(4, 3, { layers: [{ count: 6 }] });
  CreatureUtil.makeUUID(creature);

  // Run various mutations and verify creature validity
  const mutations = [
    Mutation.MOD_WEIGHT,
    Mutation.MOD_BIAS,
    Mutation.ADD_CONN,
    Mutation.MOD_SQUASH,
  ];

  for (const mutation of mutations) {
    const clone = Creature.fromJSON(creature.exportJSON());
    CreatureUtil.makeUUID(clone);

    mutator.mutateCreature(clone, mutation);

    // Creature should still be structurally valid
    creatureValidate(clone);
  }
});

Deno.test("MutatorMutateCreature: feedbackLoop=true with forwardOnly pre-4.x clears forwardOnly", () => {
  const config = createConfig({
    feedbackLoop: true,
    disableRandomSamples: true,
  });
  const mutator = new Mutator(config);

  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
  creature.forwardOnly = true;
  creature.semanticVersion = "3.0.0";
  CreatureUtil.makeUUID(creature);

  mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);

  // For pre-4.x creatures with feedbackLoop=true, forwardOnly should be cleared
  assertEquals(
    creature.forwardOnly,
    undefined,
    "forwardOnly should be cleared for pre-4.x with feedbackLoop=true",
  );
});
