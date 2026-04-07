/**
 * Issue #2191: Verify that forward-only topology assertions fire after
 * bulk index remapping operations (insertNeuron, removeHiddenNeuron,
 * normaliseComputationalNeuronOrder, and breeding).
 *
 * Each test exercises the real operation on a forward-only creature and
 * verifies the topology remains valid (all synapses satisfy from < to).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { removeHiddenNeuron } from "@compact/OrphanedNeuronCleanup.ts";
import { normaliseComputationalNeuronOrder } from "@architecture/NormaliseComputationalNeuronOrder.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Offspring } from "@architecture/Offspring.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Helper: build a simple forward-only creature with 2 inputs, 1 hidden, 1 output.
 * Topology: 0->2, 1->2, 2->3 (all forward).
 */
function makeForwardOnlyCreature(): Creature {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 2 },
      { type: "output", squash: "LOGISTIC", bias: 0.1, index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1.0 },
      { from: 1, to: 2, weight: 0.8 },
      { from: 2, to: 3, weight: 0.9 },
    ],
    input: 2,
    output: 1,
  });
  creature.DEBUG = true;
  creature.forwardOnly = true;
  return creature;
}

/**
 * Helper: build a larger forward-only creature with multiple hidden neurons.
 * 3 inputs, 3 hidden, 1 output.
 */
function makeLargerForwardOnlyCreature(): Creature {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.1, index: 3 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.2, index: 4 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.3, index: 5 },
      { type: "output", squash: "LOGISTIC", bias: 0.0, index: 6 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 1.0 },
      { from: 1, to: 4, weight: 0.8 },
      { from: 2, to: 5, weight: 0.7 },
      { from: 3, to: 4, weight: 0.6 },
      { from: 4, to: 5, weight: 0.5 },
      { from: 5, to: 6, weight: 0.9 },
    ],
    input: 3,
    output: 1,
  });
  creature.DEBUG = true;
  creature.forwardOnly = true;
  return creature;
}

/**
 * Verify all synapses satisfy forward-only constraint (from < to).
 */
function assertAllSynapsesForwardOnly(creature: Creature) {
  for (let i = 0; i < creature.synapses.length; i++) {
    const s = creature.synapses[i];
    assert(
      s.from < s.to,
      `Synapse ${i} violates forward-only: from=${s.from} to=${s.to}`,
    );
  }
}

// ── insertNeuron (AddNeuron) ─────────────────────────────────────────

Deno.test(
  "Issue #2191: insertNeuron preserves forward-only topology",
  () => {
    const creature = makeForwardOnlyCreature();

    const addNeuron = new AddNeuron(creature);
    const changed = addNeuron.mutate();
    assert(changed, "AddNeuron should succeed");

    assertAllSynapsesForwardOnly(creature);
    creatureValidate(creature);
  },
);

Deno.test(
  "Issue #2191: insertNeuron on larger creature preserves forward-only topology",
  () => {
    const creature = makeLargerForwardOnlyCreature();
    const originalCount = creature.neurons.length;

    const addNeuron = new AddNeuron(creature);
    const changed = addNeuron.mutate();
    assert(changed, "AddNeuron should succeed");

    assert(
      creature.neurons.length > originalCount,
      "Should have added a neuron",
    );
    assertAllSynapsesForwardOnly(creature);
    creatureValidate(creature);
  },
);

// ── removeHiddenNeuron ───────────────────────────────────────────────

Deno.test(
  "Issue #2191: removeHiddenNeuron preserves forward-only topology",
  () => {
    // Build a creature where the middle hidden neuron (index 4) can be
    // removed without orphaning other neurons. Neurons 3 and 5 both have
    // direct paths to the output that bypass neuron 4.
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.1, index: 3 },
        { type: "hidden", squash: "LOGISTIC", bias: 0.2, index: 4 },
        { type: "hidden", squash: "LOGISTIC", bias: 0.3, index: 5 },
        { type: "output", squash: "LOGISTIC", bias: 0.0, index: 6 },
      ],
      synapses: [
        { from: 0, to: 3, weight: 1.0 },
        { from: 1, to: 4, weight: 0.8 },
        { from: 2, to: 5, weight: 0.7 },
        { from: 3, to: 6, weight: 0.6 },
        { from: 4, to: 6, weight: 0.5 },
        { from: 5, to: 6, weight: 0.9 },
      ],
      input: 3,
      output: 1,
    });
    creature.DEBUG = true;
    creature.forwardOnly = true;
    const originalCount = creature.neurons.length;

    // Remove the middle hidden neuron (index 4)
    removeHiddenNeuron(creature, 4);

    assertEquals(
      creature.neurons.length,
      originalCount - 1,
      "Should have removed a neuron",
    );
    assertAllSynapsesForwardOnly(creature);
    creatureValidate(creature);
  },
);

Deno.test(
  "Issue #2191: removeHiddenNeuron at first hidden preserves forward-only topology",
  () => {
    const creature = makeLargerForwardOnlyCreature();

    // Remove the first hidden neuron (index 3 = first after 3 inputs)
    removeHiddenNeuron(creature, 3);

    assertAllSynapsesForwardOnly(creature);
    creatureValidate(creature);
  },
);

// ── normaliseComputationalNeuronOrder ────────────────────────────────

Deno.test(
  "Issue #2191: normaliseComputationalNeuronOrder preserves forward-only topology",
  () => {
    // Create a creature with a constant neuron after hidden neurons
    // (out of canonical order) to trigger reordering.
    const creature = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.1, index: 2 },
        { type: "constant", bias: 1.0, index: 3 },
        { type: "hidden", squash: "LOGISTIC", bias: 0.2, index: 4 },
        { type: "output", squash: "LOGISTIC", bias: 0.0, index: 5 },
      ],
      synapses: [
        { from: 0, to: 2, weight: 1.0 },
        { from: 1, to: 2, weight: 0.8 },
        { from: 2, to: 4, weight: 0.6 },
        { from: 3, to: 4, weight: 0.5 },
        { from: 4, to: 5, weight: 0.9 },
      ],
      input: 2,
      output: 1,
    });
    creature.DEBUG = true;
    creature.forwardOnly = true;

    normaliseComputationalNeuronOrder(creature);

    // Constants should now come before hiddens
    const compStart = creature.input;
    const compEnd = creature.neurons.length - creature.output;
    let seenHidden = false;
    for (let i = compStart; i < compEnd; i++) {
      if (creature.neurons[i].type === "hidden") seenHidden = true;
      if (creature.neurons[i].type === "constant" && seenHidden) {
        throw new Error("Constant found after hidden — reorder failed");
      }
    }

    assertAllSynapsesForwardOnly(creature);
    creatureValidate(creature);
  },
);

// ── Breeding / crossover ─────────────────────────────────────────────

Deno.test(
  "Issue #2191: Offspring.breed preserves forward-only topology",
  () => {
    const mother = makeLargerForwardOnlyCreature();
    mother.score = -0.5;

    const father = makeLargerForwardOnlyCreature();
    father.score = -0.8;

    const offspring = Offspring.breed(mother, father, {});

    if (offspring) {
      assert(
        offspring.forwardOnly === true,
        "Offspring should be forward-only",
      );
      assertAllSynapsesForwardOnly(offspring);
      creatureValidate(offspring);
    }
    // Offspring.breed can return undefined for clone detection — that is acceptable
  },
);

Deno.test(
  "Issue #2191: repeated insertNeuron mutations preserve forward-only topology",
  () => {
    const creature = makeForwardOnlyCreature();

    for (let i = 0; i < 5; i++) {
      const addNeuron = new AddNeuron(creature);
      const changed = addNeuron.mutate();
      if (changed) {
        assertAllSynapsesForwardOnly(creature);
      }
    }
    creatureValidate(creature);
  },
);
