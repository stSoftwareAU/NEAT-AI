import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { Neuron } from "../../src/architecture/Neuron.ts";

/**
 * Regression test for https://github.com/stSoftwareAU/NEAT-AI/issues/956
 *
 * The historic failure mode was that `compactCreature()` could leave orphaned
 * hidden neurons (no outward connections) when removing backward synapses in
 * non-feedbackLoop mode. This happened because:
 *
 * 1. The `outwardConnections` map was not rebuilt after backward-synapse removal.
 * 2. The `danglesFound` flag was never set to `true`, so the do/while loop
 *    only ran once and never iterated to find cascade orphans.
 *
 * A 4.x forward-only creature MUST remain valid after compaction; any orphaned
 * neuron is a bug in our code.
 */
Deno.test("compactCreature: removes orphaned neurons when backward synapses are stripped (issue #956)", () => {
  // Arrange: Build a creature where removing a backward synapse orphans a neuron.
  //
  // Structure (before compaction):
  //   input-0 ──▶ hidden-A ──▶ hidden-B ──▶ output-0
  //                   ▲            │
  //                   └────────────┘ (backward synapse, from > to)
  //
  // When feedbackLoop=false, the backward synapse hidden-B -> hidden-A is removed.
  // hidden-B still has the forward connection to output-0, so it's NOT orphaned.
  // This tests that compaction handles backward removal correctly without
  // corrupting valid neurons.

  const creature = new Creature(1, 1, { lazyInitialization: true });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  // Manually build neurons in correct order: input, hidden-A, hidden-B, output
  // Input neuron (index 0)
  const inputNeuron = new Neuron("input-0", "input", 0, creature);
  inputNeuron.index = 0;

  // hidden-A (index 1)
  const hiddenA = new Neuron("hidden-A", "hidden", 0.1, creature, "IDENTITY");
  hiddenA.index = 1;

  // hidden-B (index 2)
  const hiddenB = new Neuron("hidden-B", "hidden", 0.2, creature, "IDENTITY");
  hiddenB.index = 2;

  // Output neuron (index 3)
  const outputNeuron = new Neuron(
    "output-0",
    "output",
    0,
    creature,
    "IDENTITY",
  );
  outputNeuron.index = 3;

  creature.neurons = [inputNeuron, hiddenA, hiddenB, outputNeuron];

  // Synapses:
  // input-0 -> hidden-A (forward)
  // hidden-A -> hidden-B (forward)
  // hidden-B -> output-0 (forward)
  // hidden-B -> hidden-A (BACKWARD, index 2 -> 1) - this will be stripped
  creature.synapses = [
    new Synapse(0, 1, 1.0), // input-0 -> hidden-A
    new Synapse(1, 2, 0.5), // hidden-A -> hidden-B
    new Synapse(2, 1, 0.3), // hidden-B -> hidden-A (backward!)
    new Synapse(2, 3, 1.0), // hidden-B -> output-0
  ];
  creature.synapses.sort((a, b) =>
    a.from === b.from ? a.to - b.to : a.from - b.from
  );

  // Sanity check: creature is currently invalid for forward-only due to backward synapse
  let caughtError = false;
  try {
    creature.validate({ forwardOnly: true });
  } catch {
    caughtError = true;
  }
  assert(
    caughtError,
    "Creature should fail forward-only validation before compaction",
  );

  // Act: Compact with feedbackLoop=false (strips backward synapses)
  const compacted = compactCreature(creature, false);

  // Assert: compaction should have occurred (backward synapse removed)
  assert(compacted !== undefined, "Compaction should have occurred");

  // The compacted creature MUST be valid (no orphaned neurons)
  compacted.validate(); // General validation
  compacted.validate({ forwardOnly: true }); // Forward-only validation

  // hidden-B should still exist (it has a valid outward connection to output)
  const hasHiddenB = compacted.neurons.some((n) => n.uuid === "hidden-B");
  assertEquals(
    hasHiddenB,
    true,
    "hidden-B should remain (has outward to output)",
  );

  // Verify forward-only semantics preserved
  assertEquals(compacted.forwardOnly, true, "forwardOnly should be preserved");
});

Deno.test("compactCreature: cascade removal of multiple orphaned neurons", () => {
  // Arrange: Build a chain where removing one synapse orphans multiple neurons.
  //
  // Structure:
  //   input-0 ──▶ hidden-A ──▶ output-0
  //                   │
  //                   └──▶ hidden-B ──▶ hidden-C (backward to hidden-A)
  //
  // When the backward synapse hidden-C -> hidden-A is removed:
  // - hidden-C has no outward connections -> orphaned
  // - Removing hidden-C orphans hidden-B (its only outward was to hidden-C)

  const creature = new Creature(1, 1, { lazyInitialization: true });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  // Neurons in order: input, hidden-A, hidden-B, hidden-C, output
  const inputNeuron = new Neuron("input-0", "input", 0, creature);
  inputNeuron.index = 0;

  const hiddenA = new Neuron("hidden-A", "hidden", 0.1, creature, "IDENTITY");
  hiddenA.index = 1;

  const hiddenB = new Neuron("hidden-B", "hidden", 0.2, creature, "IDENTITY");
  hiddenB.index = 2;

  const hiddenC = new Neuron("hidden-C", "hidden", 0.3, creature, "IDENTITY");
  hiddenC.index = 3;

  const outputNeuron = new Neuron(
    "output-0",
    "output",
    0,
    creature,
    "IDENTITY",
  );
  outputNeuron.index = 4;

  creature.neurons = [inputNeuron, hiddenA, hiddenB, hiddenC, outputNeuron];

  creature.synapses = [
    new Synapse(0, 1, 1.0), // input-0 -> hidden-A
    new Synapse(1, 2, 0.5), // hidden-A -> hidden-B
    new Synapse(1, 4, 1.0), // hidden-A -> output-0
    new Synapse(2, 3, 0.4), // hidden-B -> hidden-C
    new Synapse(3, 1, 0.3), // hidden-C -> hidden-A (backward!)
  ];
  creature.synapses.sort((a, b) =>
    a.from === b.from ? a.to - b.to : a.from - b.from
  );

  // Act
  const compacted = compactCreature(creature, false);

  // Assert
  assert(compacted !== undefined, "Compaction should have occurred");
  compacted.validate();
  compacted.validate({ forwardOnly: true });

  // Both hidden-B and hidden-C should be removed (cascade)
  const hasHiddenB = compacted.neurons.some((n) => n.uuid === "hidden-B");
  const hasHiddenC = compacted.neurons.some((n) => n.uuid === "hidden-C");
  assertEquals(hasHiddenB, false, "hidden-B should be cascade-removed");
  assertEquals(hasHiddenC, false, "hidden-C should be removed");
});
