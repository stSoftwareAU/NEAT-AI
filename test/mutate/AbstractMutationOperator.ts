import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { AbstractMutationOperator } from "../../src/mutate/AbstractMutationOperator.ts";

/** Concrete subclass for testing the abstract base class. */
class TestMutationOperator extends AbstractMutationOperator {
  public mutateCalled = false;
  public lastFocusList?: number[];
  public shouldSucceed = true;

  protected performMutation(focusList?: number[]): boolean {
    this.mutateCalled = true;
    this.lastFocusList = focusList;
    return this.shouldSucceed;
  }

  /** Expose protected creature for testing. */
  public getCreature(): Creature {
    return this.creature;
  }

  /** Expose selectRandomHiddenNeuronIndex for testing. */
  public testSelectRandomHiddenNeuronIndex(
    focusList?: number[],
    maxAttempts?: number,
    relaxAfter?: number,
  ): number {
    return this.selectRandomHiddenNeuronIndex(
      focusList,
      maxAttempts,
      relaxAfter,
    );
  }

  /** Expose selectRandomNonInputNeuronIndex for testing. */
  public testSelectRandomNonInputNeuronIndex(
    focusList?: number[],
    maxAttempts?: number,
    relaxAfter?: number,
  ): number {
    return this.selectRandomNonInputNeuronIndex(
      focusList,
      maxAttempts,
      relaxAfter,
    );
  }
}

function makeSimpleCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.1, index: 2 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.2, index: 3 },
      { type: "output", squash: "LOGISTIC", bias: 0, index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 1, to: 3, weight: 0.3 },
      { from: 2, to: 4, weight: 0.7 },
      { from: 3, to: 4, weight: 0.4 },
    ],
    input: 2,
    output: 1,
  });
}

Deno.test("AbstractMutationOperator stores creature reference", () => {
  const creature = makeSimpleCreature();
  const op = new TestMutationOperator(creature);
  assertEquals(op.getCreature(), creature);
});

Deno.test("AbstractMutationOperator.mutate delegates to performMutation", () => {
  const creature = makeSimpleCreature();
  const op = new TestMutationOperator(creature);
  const result = op.mutate([0, 1]);
  assert(op.mutateCalled, "performMutation should have been called");
  assertEquals(op.lastFocusList, [0, 1]);
  assertEquals(result, true);
});

Deno.test("AbstractMutationOperator.mutate returns false when performMutation returns false", () => {
  const creature = makeSimpleCreature();
  const op = new TestMutationOperator(creature);
  op.shouldSucceed = false;
  const result = op.mutate();
  assertEquals(result, false);
});

Deno.test("selectRandomHiddenNeuronIndex returns valid hidden neuron index", () => {
  const creature = makeSimpleCreature();
  const op = new TestMutationOperator(creature);

  // Run many times to check statistical coverage
  const indices = new Set<number>();
  for (let i = 0; i < 100; i++) {
    const idx = op.testSelectRandomHiddenNeuronIndex();
    if (idx !== -1) {
      // Must be a hidden neuron
      const neuron = creature.neurons[idx];
      assertEquals(neuron.type, "hidden");
      indices.add(idx);
    }
  }
  // Should have found at least one hidden neuron
  assert(indices.size > 0, "Should find hidden neurons");
});

Deno.test("selectRandomHiddenNeuronIndex respects focus list", () => {
  const creature = makeSimpleCreature();
  const op = new TestMutationOperator(creature);

  // Focus on only one hidden neuron (index 2)
  const focusList = [2];
  let foundIdx2 = false;
  let foundOther = false;
  for (let i = 0; i < 50; i++) {
    const idx = op.testSelectRandomHiddenNeuronIndex(focusList, 50, 50);
    if (idx === 2) foundIdx2 = true;
    if (idx !== -1 && idx !== 2) foundOther = true;
  }
  assert(foundIdx2, "Should find neuron at index 2");
  // With strict focus (relaxAfter=50 > maxAttempts=50), should not find others
  assertEquals(foundOther, false, "Should not find neurons outside focus");
});

Deno.test("selectRandomNonInputNeuronIndex returns valid non-input index", () => {
  const creature = makeSimpleCreature();
  const op = new TestMutationOperator(creature);

  for (let i = 0; i < 50; i++) {
    const idx = op.testSelectRandomNonInputNeuronIndex();
    if (idx !== -1) {
      assert(idx >= creature.input, "Index should be >= input count");
      const neuron = creature.neurons[idx];
      assertNotEquals(neuron.type, "constant");
    }
  }
});

Deno.test("selectRandomNonInputNeuronIndex skips constant neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "constant", bias: 1.0, index: 2 },
      { type: "hidden", squash: "LOGISTIC", bias: 0.1, index: 3 },
      { type: "output", squash: "LOGISTIC", bias: 0, index: 4 },
    ],
    synapses: [
      { from: 0, to: 3, weight: 0.5 },
      { from: 2, to: 4, weight: 0.3 },
      { from: 3, to: 4, weight: 0.7 },
    ],
    input: 2,
    output: 1,
  });

  const op = new TestMutationOperator(creature);
  for (let i = 0; i < 50; i++) {
    const idx = op.testSelectRandomNonInputNeuronIndex();
    if (idx !== -1) {
      assertNotEquals(
        creature.neurons[idx].type,
        "constant",
        "Should never select constant neurons",
      );
    }
  }
});

Deno.test("selectRandomHiddenNeuronIndex returns -1 for creature with no hidden neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "output", squash: "LOGISTIC", bias: 0, index: 2 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });
  const op = new TestMutationOperator(creature);
  const idx = op.testSelectRandomHiddenNeuronIndex(undefined, 12);
  assertEquals(idx, -1);
});
