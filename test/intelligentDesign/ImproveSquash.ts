/**
 * Tests for squash improvement utilities.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  makeModifiedCreatureWithPrevious,
  shuffle,
} from "../../src/intelligentDesign/ImproveSquash.ts";

// Test creature with hidden neurons
const testCreatureJson: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    {
      type: "hidden",
      squash: "TANH",
      index: 2,
      bias: 0,
      uuid: "neuron-hidden-1",
    },
    { type: "output", squash: "LOGISTIC", index: 3, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 2, weight: 0.5 },
    { from: 1, to: 2, weight: 0.5 },
    { from: 2, to: 3, weight: 0.5 },
  ],
  input: 2,
  output: 1,
};

Deno.test("shuffle randomises array order", () => {
  // Use a large enough array that shuffling will almost certainly change order
  const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = [...original];

  shuffle(copy);

  // Array should have same elements
  assertEquals(copy.sort((a, b) => a - b), original);

  // With 10 elements, probability of same order is 1/10! = very low
  // We won't assert order changed as it could rarely be the same
});

Deno.test("shuffle returns the same array reference", () => {
  const arr = [1, 2, 3];
  const result = shuffle(arr);

  assertEquals(result, arr);
});

Deno.test("shuffle handles empty array", () => {
  const arr: number[] = [];
  shuffle(arr);
  assertEquals(arr.length, 0);
});

Deno.test("shuffle handles single element", () => {
  const arr = [42];
  shuffle(arr);
  assertEquals(arr, [42]);
});

Deno.test("makeModifiedCreatureWithPrevious returns creature and previous squash", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const originalSquash = "TANH";
  const newSquash = "Swish";

  const result = makeModifiedCreatureWithPrevious(
    "neuron-hidden-1",
    exported,
    newSquash,
  );

  assertEquals(result.previousSquash, originalSquash);

  // Verify the creature has the new squash
  const modifiedExport = result.creature.exportJSON();
  const modifiedNeuron = modifiedExport.neurons.find(
    (n) => n.uuid === "neuron-hidden-1",
  );

  assertEquals(modifiedNeuron?.squash, newSquash);
});

Deno.test("makeModifiedCreatureWithPrevious adds intelligentDesign tag", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const originalSquash = "TANH";
  const newSquash = "GELU";

  const result = makeModifiedCreatureWithPrevious(
    "neuron-hidden-1",
    exported,
    newSquash,
  );

  const modifiedExport = result.creature.exportJSON();
  const modifiedNeuron = modifiedExport.neurons.find(
    (n) => n.uuid === "neuron-hidden-1",
  );

  const tag = modifiedNeuron?.tags?.find((t) => t.name === "intelligentDesign");
  assertNotEquals(tag, undefined);
  assertEquals(tag?.value, `${originalSquash} -> ${newSquash}`);
});
