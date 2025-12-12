/**
 * Test for transitive focus checking in SubConnection and SubNeuron.
 *
 * The inFocus() method on Creature performs transitive checking - a neuron
 * is considered in focus if it's directly in the focus list OR if any of its
 * upstream connected neurons are in focus.
 *
 * SubConnection and SubNeuron should use this transitive check, not just
 * direct membership in the focus list.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { SubConnection } from "../../src/mutate/SubConnection.ts";
import { SubNeuron } from "../../src/mutate/SubNeuron.ts";

/**
 * Creates a longer chain network: input(0) -> hidden1(1) -> hidden2(2) -> output(3)
 * This allows us to test transitive focus - if input(0) is in focus, then
 * hidden1(1) should be transitively in focus (because it has an inward connection
 * from a focused neuron), and hidden2(2) should also be transitively in focus
 * (because it has an inward connection from hidden1 which is in focus).
 */
function createLongChainNetwork(): CreatureInternal {
  return {
    neurons: [
      { type: "input", index: 0 },
      { type: "hidden", index: 1, bias: 0, squash: "LOGISTIC" },
      { type: "hidden", index: 2, bias: 0, squash: "LOGISTIC" },
      { type: "output", index: 3, bias: 0, squash: "LOGISTIC" },
    ],
    synapses: [
      { from: 0, to: 1, weight: 1 }, // input -> hidden1
      { from: 1, to: 2, weight: 1 }, // hidden1 -> hidden2
      { from: 2, to: 3, weight: 1 }, // hidden2 -> output
    ],
    input: 1,
    output: 1,
  };
}

Deno.test("SubConnection should use transitive focus - synapse not directly involving focused neuron", () => {
  // Create a longer chain: input(0) -> hidden1(1) -> hidden2(2) -> output(3)
  const creature = Creature.fromJSON(createLongChainNetwork());

  // Focus on input neuron (index 0) only
  const focusList = [0];

  // Verify transitive focus via the creature's inFocus method:
  // - hidden1(1) should be in focus because it has inward connection from input(0) which is focused
  // - hidden2(2) should be in focus because it has inward connection from hidden1(1) which is in focus
  assertEquals(
    creature.inFocus(1, focusList),
    true,
    "hidden1 should be transitively in focus",
  );
  assertEquals(
    creature.inFocus(2, focusList),
    true,
    "hidden2 should be transitively in focus",
  );

  // The synapse hidden1(1) -> hidden2(2) does NOT directly involve the focused input(0)
  // With simple focusList.includes(): would NOT be considered in focus
  // With transitive creature.inFocus(): SHOULD be considered in focus

  // SubConnection should be able to remove the synapse from hidden1 to hidden2
  // because both endpoints are transitively in focus
  let removedHidden1ToHidden2 = false;
  for (let i = 0; i < 100; i++) {
    const testCreature = Creature.fromJSON(createLongChainNetwork());
    const synapsesBefore = testCreature.synapses.length;
    const testSubConnection = new SubConnection(testCreature);

    if (testSubConnection.mutate(focusList)) {
      // Check if the hidden1->hidden2 synapse was removed
      const hasHidden1ToHidden2 = testCreature.synapses.some(
        (s) => s.from === 1 && s.to === 2,
      );
      if (!hasHidden1ToHidden2 && synapsesBefore === 3) {
        removedHidden1ToHidden2 = true;
        break;
      }
    }
  }

  assertEquals(
    removedHidden1ToHidden2,
    true,
    "SubConnection should be able to remove synapse between transitively focused neurons (hidden1->hidden2)",
  );
});

Deno.test("SubNeuron should use transitive focus - strict check within first 12 attempts", () => {
  // Create a longer chain: input(0) -> hidden1(1) -> hidden2(2) -> output(3)
  const creature = Creature.fromJSON(createLongChainNetwork());

  // Focus on input neuron (index 0) only
  const focusList = [0];

  // Verify transitive focus via the creature's inFocus method:
  // - hidden2(2) should be in focus because of the chain: input(0) -> hidden1(1) -> hidden2(2)
  assertEquals(
    creature.inFocus(2, focusList),
    true,
    "hidden2 should be transitively in focus",
  );

  // hidden2(2) is NOT directly in the focus list
  // The SubNeuron code has a "relax" behaviour after 12 attempts, so we need to ensure
  // that transitive focus works within the first 12 attempts (strict mode)

  // Run many mutations and count successes within what would be the "strict" phase
  // If transitive focus works, we should consistently be able to select hidden1 or hidden2
  // In each call to mutate(), the strict phase is the first 12 random selections
  // If we call mutate() many times and it ONLY succeeds due to the relaxation,
  // then transitive focus isn't working

  // The test: if transitive focus works correctly, hidden2 should be selectable
  // even though it's not directly in focusList [0]
  let successCount = 0;
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    const testCreature = Creature.fromJSON(createLongChainNetwork());
    const testSubNeuron = new SubNeuron(testCreature);

    if (testSubNeuron.mutate(focusList)) {
      successCount++;
    }
  }

  // With only 2 removable neurons (hidden1, hidden2), both of which should be
  // transitively in focus, we expect high success rate. If transitive focus
  // doesn't work, the success rate would be much lower (only succeeding when
  // the relaxation kicks in after 12 attempts)
  assert(
    successCount >= iterations * 0.8,
    `SubNeuron should have high success rate with transitive focus. Got ${successCount}/${iterations}`,
  );
});

Deno.test("SubConnection direct focus still works", () => {
  // Create a longer chain: input(0) -> hidden1(1) -> hidden2(2) -> output(3)
  // Focus on hidden1 neuron directly (index 1)
  const focusList = [1];

  // SubConnection should find connections involving the directly focused neuron
  let mutationSucceeded = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(createLongChainNetwork());
    const testSubConnection = new SubConnection(testCreature);
    if (testSubConnection.mutate(focusList)) {
      mutationSucceeded = true;
      break;
    }
  }

  assertEquals(
    mutationSucceeded,
    true,
    "SubConnection should find connections when neuron is directly in focus",
  );
});

Deno.test("SubNeuron direct focus still works", () => {
  // Create a longer chain: input(0) -> hidden1(1) -> hidden2(2) -> output(3)
  // Focus on hidden1 neuron directly (index 1)
  const focusList = [1];

  // SubNeuron should find the directly focused hidden neuron to remove
  let mutationSucceeded = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(createLongChainNetwork());
    const testSubNeuron = new SubNeuron(testCreature);
    if (testSubNeuron.mutate(focusList)) {
      mutationSucceeded = true;
      break;
    }
  }

  assertEquals(
    mutationSucceeded,
    true,
    "SubNeuron should find neurons when directly in focus",
  );
});

Deno.test("No focus list means all neurons/connections are in focus", () => {
  // No focus list - everything should be in focus
  let connectionMutationSucceeded = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(createLongChainNetwork());
    const testSubConnection = new SubConnection(testCreature);
    if (testSubConnection.mutate()) {
      connectionMutationSucceeded = true;
      break;
    }
  }

  assertEquals(
    connectionMutationSucceeded,
    true,
    "SubConnection should mutate when no focus list is provided",
  );

  let neuronMutationSucceeded = false;
  for (let i = 0; i < 50; i++) {
    const testCreature = Creature.fromJSON(createLongChainNetwork());
    const testSubNeuron = new SubNeuron(testCreature);
    if (testSubNeuron.mutate()) {
      neuronMutationSucceeded = true;
      break;
    }
  }

  assertEquals(
    neuronMutationSucceeded,
    true,
    "SubNeuron should mutate when no focus list is provided",
  );
});
