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

  const hidden1 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-1",
  );
  const hidden2 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-2",
  );
  assertExists(hidden1?.id);
  assertExists(hidden2?.id);

  // Should have 2 hidden neurons
  assertEquals(validNeurons.size, 2);
  assertEquals(validNeurons.get(hidden1.id), "TANH");
  assertEquals(validNeurons.get(hidden2.id), "GELU");
});

Deno.test("combineKnowledge merges with local taking precedence", () => {
  const local: TacitKnowledgeMap = {
    7001: "GELU",
    7002: "Swish",
  };

  const hive: TacitKnowledgeMap = {
    7001: "TANH", // Should be overridden by local
    7003: "LeakyReLU",
  };

  const combined = combineKnowledge(local, hive);

  assertEquals(combined[7001], "GELU"); // Local wins
  assertEquals(combined[7002], "Swish");
  assertEquals(combined[7003], "LeakyReLU");
});

Deno.test("cleanKnowledge removes entries for non-existent neurons", () => {
  const validNeurons = new Map<number, string>();
  validNeurons.set(7001, "TANH");
  validNeurons.set(7002, "GELU");

  const local: TacitKnowledgeMap = {
    7001: "Swish",
    7099: "GELU", // Doesn't exist
  };

  const hive: TacitKnowledgeMap = {
    7001: "TANH",
    7088: "LeakyReLU", // Doesn't exist
  };

  const cleaned = cleanKnowledge(validNeurons, local, hive);

  // 7099 should be removed from local
  assertEquals(
    Object.keys(cleaned.localKnowledge).includes("7099"),
    false,
  );

  // 7088 should be removed from hive
  assertEquals(
    Object.keys(cleaned.hiveKnowledge).includes("7088"),
    false,
  );

  // 7002 should be added to hive (missing neurons get added)
  assertEquals(cleaned.hiveKnowledge[7002], "GELU");
});

Deno.test("getNeuronsToTest returns neurons with different squash than knowledge", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const hidden1 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-1",
  );
  const hidden2 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-2",
  );
  assertExists(hidden1?.id);
  assertExists(hidden2?.id);

  // Create knowledge suggesting a different squash
  const knowledge: TacitKnowledgeMap = {
    [hidden1.id]: "Swish", // Different from TANH
    [hidden2.id]: "GELU", // Same as current, should not be included
  };

  const neuronsToTest = getNeuronsToTest(exported, knowledge);

  assertEquals(neuronsToTest.length, 1);
  assertEquals(neuronsToTest[0].id, hidden1.id);
});

Deno.test("getNeuronsToTest returns empty when knowledge matches current squash", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const hidden1 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-1",
  );
  const hidden2 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-2",
  );
  assertExists(hidden1?.id);
  assertExists(hidden2?.id);

  // Create knowledge with the same squashes
  const knowledge: TacitKnowledgeMap = {
    [hidden1.id]: "TANH",
    [hidden2.id]: "GELU",
  };

  const neuronsToTest = getNeuronsToTest(exported, knowledge);

  assertEquals(neuronsToTest.length, 0);
});

Deno.test("makeModifiedCreature changes neuron squash and adds tag", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const hidden1 = creature.neurons.find(
    (n) => n.type === "hidden" && n.uuid === "neuron-hidden-1",
  );
  assertExists(hidden1?.id);

  const newSquash = "Swish";

  const modified = makeModifiedCreature(
    hidden1.id,
    exported,
    newSquash,
  );
  const modifiedExport = modified.exportJSON();

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
