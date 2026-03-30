/**
 * Tests for Tacit Knowledge utilities.
 *
 * Issue #2085: All tacit knowledge APIs use neuron UUID (string) as the stable
 * public identifier, not runtime integer id.
 */

import { assertEquals, assertExists } from "@std/assert";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import {
  cleanKnowledge,
  combineKnowledge,
  getNeuronsToTest,
  getValidNeuronSquashes,
  makeModifiedCreature,
} from "@intelligentDesign/TacitKnowledge.ts";
import type { TacitKnowledgeMap } from "@intelligentDesign/TacitKnowledge.ts";

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

Deno.test("getValidNeuronSquashes returns map keyed by UUID strings", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();
  const validNeurons = getValidNeuronSquashes(exported);

  // Should have 2 hidden neurons keyed by UUID
  assertEquals(validNeurons.size, 2);
  assertEquals(validNeurons.get("neuron-hidden-1"), "TANH");
  assertEquals(validNeurons.get("neuron-hidden-2"), "GELU");
});

Deno.test("combineKnowledge merges with local taking precedence (UUID keys)", () => {
  const local: TacitKnowledgeMap = {
    "neuron-uuid-a": "GELU",
    "neuron-uuid-b": "Swish",
  };

  const hive: TacitKnowledgeMap = {
    "neuron-uuid-a": "TANH", // Should be overridden by local
    "neuron-uuid-c": "LeakyReLU",
  };

  const combined = combineKnowledge(local, hive);

  assertEquals(combined["neuron-uuid-a"], "GELU"); // Local wins
  assertEquals(combined["neuron-uuid-b"], "Swish");
  assertEquals(combined["neuron-uuid-c"], "LeakyReLU");
});

Deno.test("cleanKnowledge removes entries for non-existent neurons (UUID keys)", () => {
  const validNeurons = new Map<string, string>();
  validNeurons.set("neuron-hidden-1", "TANH");
  validNeurons.set("neuron-hidden-2", "GELU");

  const local: TacitKnowledgeMap = {
    "neuron-hidden-1": "Swish",
    "neuron-missing": "GELU", // Doesn't exist
  };

  const hive: TacitKnowledgeMap = {
    "neuron-hidden-1": "TANH",
    "neuron-also-missing": "LeakyReLU", // Doesn't exist
  };

  const cleaned = cleanKnowledge(validNeurons, local, hive);

  // neuron-missing should be removed from local
  assertEquals(
    Object.keys(cleaned.localKnowledge).includes("neuron-missing"),
    false,
  );

  // neuron-also-missing should be removed from hive
  assertEquals(
    Object.keys(cleaned.hiveKnowledge).includes("neuron-also-missing"),
    false,
  );

  // neuron-hidden-2 should be added to hive (missing neurons get added)
  assertEquals(cleaned.hiveKnowledge["neuron-hidden-2"], "GELU");
});

Deno.test("getNeuronsToTest returns neurons with different squash than knowledge (UUID keys)", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  // Create knowledge suggesting a different squash, keyed by UUID
  const knowledge: TacitKnowledgeMap = {
    "neuron-hidden-1": "Swish", // Different from TANH
    "neuron-hidden-2": "GELU", // Same as current, should not be included
  };

  const neuronsToTest = getNeuronsToTest(exported, knowledge);

  assertEquals(neuronsToTest.length, 1);
  assertEquals(neuronsToTest[0].uuid, "neuron-hidden-1");
});

Deno.test("getNeuronsToTest returns empty when knowledge matches current squash (UUID keys)", () => {
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

Deno.test("makeModifiedCreature accepts UUID string and changes neuron squash", () => {
  const creature = Creature.fromJSON(testCreatureJson);
  const exported = creature.exportJSON();

  const newSquash = "Swish";

  const modified = makeModifiedCreature(
    "neuron-hidden-1",
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
