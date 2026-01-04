/**
 * Tests for Tacit Knowledge utilities.
 */

import { assertEquals, assertExists } from "@std/assert";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import {
  cleanKnowledge,
  combineKnowledge,
  getNeuronsToTest,
  getValidNeuronSquashes,
  makeModifiedCreature,
} from "../../src/intelligentDesign/TacitKnowledge.ts";
import type { TacitKnowledgeMap } from "../../src/intelligentDesign/TacitKnowledge.ts";

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
    {
      type: "hidden",
      squash: "GELU",
      index: 3,
      bias: 0,
      uuid: "neuron-hidden-2",
    },
    { type: "output", squash: "LOGISTIC", index: 4, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 2, weight: 0.5 },
    { from: 1, to: 2, weight: 0.5 },
    { from: 2, to: 3, weight: 0.5 },
    { from: 3, to: 4, weight: 0.5 },
  ],
  input: 2,
  output: 1,
};

Deno.test("getValidNeuronSquashes returns map of hidden neurons", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();
  const validNeurons = getValidNeuronSquashes(exported);

  // Should have 2 hidden neurons
  assertEquals(validNeurons.size, 2);
  assertEquals(validNeurons.get("neuron-hidden-1"), "TANH");
  assertEquals(validNeurons.get("neuron-hidden-2"), "GELU");
});

Deno.test("combineKnowledge merges with local taking precedence", () => {
  const local: TacitKnowledgeMap = {
    "neuron-1": "GELU",
    "neuron-2": "Swish",
  };

  const hive: TacitKnowledgeMap = {
    "neuron-1": "TANH", // Should be overridden by local
    "neuron-3": "LeakyReLU",
  };

  const combined = combineKnowledge(local, hive);

  assertEquals(combined["neuron-1"], "GELU"); // Local wins
  assertEquals(combined["neuron-2"], "Swish");
  assertEquals(combined["neuron-3"], "LeakyReLU");
});

Deno.test("cleanKnowledge removes entries for non-existent neurons", () => {
  const validNeurons = new Map<string, string>();
  validNeurons.set("neuron-1", "TANH");
  validNeurons.set("neuron-2", "GELU");

  const local: TacitKnowledgeMap = {
    "neuron-1": "Swish",
    "neuron-99": "GELU", // Doesn't exist
  };

  const hive: TacitKnowledgeMap = {
    "neuron-1": "TANH",
    "neuron-88": "LeakyReLU", // Doesn't exist
  };

  const cleaned = cleanKnowledge(validNeurons, local, hive);

  // neuron-99 should be removed from local
  assertEquals(
    Object.keys(cleaned.localKnowledge).includes("neuron-99"),
    false,
  );

  // neuron-88 should be removed from hive
  assertEquals(
    Object.keys(cleaned.hiveKnowledge).includes("neuron-88"),
    false,
  );

  // neuron-2 should be added to hive (missing neurons get added)
  assertEquals(cleaned.hiveKnowledge["neuron-2"], "GELU");
});

Deno.test("getNeuronsToTest returns neurons with different squash than knowledge", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  // Create knowledge suggesting a different squash
  const knowledge: TacitKnowledgeMap = {
    "neuron-hidden-1": "Swish", // Different from TANH
    "neuron-hidden-2": "GELU", // Same as current, should not be included
  };

  const neuronsToTest = getNeuronsToTest(exported, knowledge);

  assertEquals(neuronsToTest.length, 1);
  assertEquals(neuronsToTest[0].uuid, "neuron-hidden-1");
});

Deno.test("getNeuronsToTest returns empty when knowledge matches current squash", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  // Create knowledge with the same squashes
  const knowledge: TacitKnowledgeMap = {
    "neuron-hidden-1": "TANH",
    "neuron-hidden-2": "GELU",
  };

  const neuronsToTest = getNeuronsToTest(exported, knowledge);

  assertEquals(neuronsToTest.length, 0);
});

Deno.test("makeModifiedCreature changes neuron squash and adds tag", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const newSquash = "Swish";

  const modified = makeModifiedCreature(
    "neuron-hidden-1",
    exported,
    newSquash,
  );
  const modifiedExport = modified.exportJSON();

  // Find the modified neuron
  const modifiedNeuron = modifiedExport.neurons.find(
    (n) => n.uuid === "neuron-hidden-1",
  );
  assertExists(modifiedNeuron);

  // Check squash was changed
  assertEquals(modifiedNeuron.squash, newSquash);

  // Check tag was added
  const tag = modifiedNeuron.tags?.find((t) => t.name === "intelligentDesign");
  assertExists(tag);
  assertEquals(tag.value, `TANH -> ${newSquash}`);
});
