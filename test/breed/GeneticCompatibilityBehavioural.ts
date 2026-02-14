/**
 * Behavioural tests for genetic compatibility calculation.
 *
 * Issue #1441: Verifies that:
 * 1. Identical creatures have perfect compatibility (1.0)
 * 2. Creatures with no hidden neurons have compatibility 1.0
 * 3. Completely different hidden neurons yield compatibility 0.0
 * 4. Partially overlapping hidden neurons yield intermediate values
 * 5. Compatibility is symmetric
 * 6. Result is always between 0 and 1
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { geneticCompatibility } from "../../src/breed/GeneticCompatibility.ts";

/**
 * Creates a creature with the specified hidden neuron UUIDs.
 */
function createCreatureWithHiddenNeurons(
  hiddenUUIDs: string[],
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (const uuid of hiddenUUIDs) {
    neurons.push({
      type: "hidden",
      uuid: uuid,
      squash: "LOGISTIC",
      bias: 0.1,
    });
    synapses.push({
      fromUUID: "input-0",
      toUUID: uuid,
      weight: 0.5,
    });
    synapses.push({
      fromUUID: uuid,
      toUUID: "output-0",
      weight: 0.8,
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  // Add a direct connection if no hidden neurons
  if (hiddenUUIDs.length === 0) {
    synapses.push({
      fromUUID: "input-0",
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons,
    synapses,
  };

  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("GeneticCompatibility: creatures with no hidden neurons return 1.0", () => {
  const a = createCreatureWithHiddenNeurons([]);
  const b = createCreatureWithHiddenNeurons([]);

  const compatibility = geneticCompatibility(a, b);
  assertEquals(
    compatibility,
    1,
    "No hidden neurons should yield perfect compatibility",
  );
});

Deno.test("GeneticCompatibility: identical hidden neurons yield 1.0", () => {
  const a = createCreatureWithHiddenNeurons(["hidden-1", "hidden-2"]);
  const b = createCreatureWithHiddenNeurons(["hidden-1", "hidden-2"]);

  const compatibility = geneticCompatibility(a, b);
  assertAlmostEquals(compatibility, 1.0, 0.001);
});

Deno.test("GeneticCompatibility: completely different hidden neurons yield 0.0", () => {
  const a = createCreatureWithHiddenNeurons(["hidden-a1", "hidden-a2"]);
  const b = createCreatureWithHiddenNeurons(["hidden-b1", "hidden-b2"]);

  const compatibility = geneticCompatibility(a, b);
  assertAlmostEquals(compatibility, 0.0, 0.001);
});

Deno.test("GeneticCompatibility: partial overlap yields intermediate value", () => {
  // a has [1, 2], b has [2, 3] — 1 out of 2 match = 0.5
  const a = createCreatureWithHiddenNeurons(["hidden-1", "hidden-2"]);
  const b = createCreatureWithHiddenNeurons(["hidden-2", "hidden-3"]);

  const compatibility = geneticCompatibility(a, b);
  assertAlmostEquals(compatibility, 0.5, 0.001);
});

Deno.test("GeneticCompatibility: is symmetric", () => {
  const a = createCreatureWithHiddenNeurons(["hidden-1", "hidden-2"]);
  const b = createCreatureWithHiddenNeurons(["hidden-2", "hidden-3"]);

  const ab = geneticCompatibility(a, b);
  const ba = geneticCompatibility(b, a);

  assertAlmostEquals(ab, ba, 0.001, "Compatibility should be symmetric");
});

Deno.test("GeneticCompatibility: result is always between 0 and 1", () => {
  // Test various configurations
  const configs: [string[], string[]][] = [
    [[], []],
    [["h1"], ["h1"]],
    [["h1"], ["h2"]],
    [["h1", "h2", "h3"], ["h1"]],
    [["h1"], ["h1", "h2", "h3"]],
    [["h1", "h2"], ["h3", "h4"]],
    [["h1", "h2", "h3"], ["h1", "h2", "h3"]],
  ];

  for (const [aHidden, bHidden] of configs) {
    const a = createCreatureWithHiddenNeurons(aHidden);
    const b = createCreatureWithHiddenNeurons(bHidden);

    const compatibility = geneticCompatibility(a, b);
    assert(
      compatibility >= 0 && compatibility <= 1,
      `Compatibility ${compatibility} out of range for ` +
        `a=[${aHidden.join(",")}] b=[${bHidden.join(",")}]`,
    );
  }
});

Deno.test("GeneticCompatibility: uses smaller set for ratio calculation", () => {
  // a has 1 hidden neuron, b has 3. The shared neuron is 1 of 1 (smallest set).
  const a = createCreatureWithHiddenNeurons(["hidden-1"]);
  const b = createCreatureWithHiddenNeurons([
    "hidden-1",
    "hidden-2",
    "hidden-3",
  ]);

  const compatibility = geneticCompatibility(a, b);
  // smallest set is a with 1 neuron, "hidden-1" matches => 1/1 = 1.0
  assertAlmostEquals(compatibility, 1.0, 0.001);
});

Deno.test("GeneticCompatibility: one matching out of larger set uses smaller set size", () => {
  // a has 3 hidden, b has 2 hidden. Only 1 overlaps.
  // Smallest set has 2 neurons, 1 match => 0.5
  const a = createCreatureWithHiddenNeurons(["h1", "h2", "h3"]);
  const b = createCreatureWithHiddenNeurons(["h1", "h4"]);

  const compatibility = geneticCompatibility(a, b);
  assertAlmostEquals(compatibility, 0.5, 0.001);
});
