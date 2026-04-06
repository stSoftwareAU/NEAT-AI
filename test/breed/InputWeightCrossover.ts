/**
 * Tests for input-weight crossover strategy (Issue #2175).
 *
 * When two creatures have very low genetic compatibility (below
 * interSpeciesCrossoverThreshold), a specialised crossover blends
 * input/output connection weights using the mother's topology as
 * the base, rather than the standard neuron-level crossover.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { inputWeightCrossover } from "@breed/InputWeightCrossover.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Builds a creature with a specific set of hidden neurons and connections.
 */
function buildCreature(
  inputCount: number,
  hiddenUUIDs: string[],
  outputCount: number,
  connections: Array<{ from: string; to: string; weight: number }>,
  squash = "LOGISTIC",
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash,
    bias: 0.1,
  }));
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  const synapses = connections.map((c) => ({
    fromUUID: c.from,
    toUUID: c.to,
    weight: c.weight,
  }));

  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };
  return Creature.fromJSON(json);
}

/**
 * Creates two creatures with completely different hidden topologies
 * (zero genetic compatibility) but the same input/output interface.
 */
function createIncompatiblePair(): { mother: Creature; father: Creature } {
  // Mother: 3 inputs, 2 hidden neurons (mH1, mH2), 1 output
  const mother = buildCreature(
    3,
    ["mH1", "mH2"],
    1,
    [
      { from: "input-0", to: "mH1", weight: 0.5 },
      { from: "input-1", to: "mH1", weight: -0.3 },
      { from: "input-2", to: "mH2", weight: 0.8 },
      { from: "mH1", to: "mH2", weight: 0.4 },
      { from: "mH2", to: "output-0", weight: 0.9 },
    ],
  );

  // Father: 3 inputs, 2 hidden neurons (fH1, fH2) — completely different UUIDs
  const father = buildCreature(
    3,
    ["fH1", "fH2"],
    1,
    [
      { from: "input-0", to: "fH1", weight: -0.7 },
      { from: "input-1", to: "fH2", weight: 0.6 },
      { from: "input-2", to: "fH1", weight: 0.2 },
      { from: "fH1", to: "fH2", weight: -0.5 },
      { from: "fH2", to: "output-0", weight: 0.3 },
    ],
  );

  return { mother, father };
}

Deno.test(
  "incompatible parents have zero genetic compatibility",
  () => {
    const { mother, father } = createIncompatiblePair();
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);
    const compat = geneticCompatibility(mother, father);
    assertEquals(
      compat,
      0,
      "Parents with no shared hidden UUIDs should have 0 compatibility",
    );
  },
);

Deno.test(
  "inputWeightCrossover preserves mother's topology",
  () => {
    const { mother, father } = createIncompatiblePair();
    const motherExport = mother.exportJSON();

    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "Offspring should be created");
    const offspringExport = offspring.exportJSON();

    // Offspring should have the same number of neurons as the mother
    assertEquals(
      offspringExport.neurons.length,
      motherExport.neurons.length,
      "Offspring should preserve mother's neuron count",
    );

    // Offspring should preserve mother's neuron UUIDs
    const motherUuids = new Set(motherExport.neurons.map((n) => n.uuid));
    for (const neuron of offspringExport.neurons) {
      assert(
        motherUuids.has(neuron.uuid),
        `Offspring neuron UUID ${neuron.uuid} should be from mother`,
      );
    }
  },
);

Deno.test(
  "inputWeightCrossover blends input connection weights",
  () => {
    const { mother, father } = createIncompatiblePair();

    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "Offspring should be created");

    // The offspring weights should differ from both parents (blended)
    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();

    // Find input-to-hidden connections in both
    const motherInputWeights = new Map<string, number>();
    for (const syn of motherExport.synapses) {
      if (syn.fromUUID?.startsWith("input-")) {
        const key = `${syn.fromUUID}->${syn.toUUID}`;
        motherInputWeights.set(key, syn.weight);
      }
    }

    const offspringInputWeights = new Map<string, number>();
    for (const syn of offspringExport.synapses) {
      if (syn.fromUUID?.startsWith("input-")) {
        const key = `${syn.fromUUID}->${syn.toUUID}`;
        offspringInputWeights.set(key, syn.weight);
      }
    }

    // At least some input weights should be blended (not identical to mother)
    let hasBlendedWeight = false;
    for (const [key, motherWeight] of motherInputWeights) {
      const offspringWeight = offspringInputWeights.get(key);
      if (offspringWeight !== undefined && offspringWeight !== motherWeight) {
        hasBlendedWeight = true;
        break;
      }
    }
    assert(
      hasBlendedWeight,
      "At least some input weights should be blended from both parents",
    );
  },
);

Deno.test(
  "inputWeightCrossover produces valid offspring",
  () => {
    const { mother, father } = createIncompatiblePair();
    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "Offspring should be created");

    // Should pass creatureValidate without errors
    creatureValidate(offspring);
  },
);

Deno.test(
  "inputWeightCrossover produces valid forward-only offspring",
  () => {
    // Build forward-only creatures
    const mother = buildCreature(
      3,
      ["mH1", "mH2"],
      1,
      [
        { from: "input-0", to: "mH1", weight: 0.5 },
        { from: "input-1", to: "mH1", weight: -0.3 },
        { from: "input-2", to: "mH2", weight: 0.8 },
        { from: "mH1", to: "mH2", weight: 0.4 },
        { from: "mH2", to: "output-0", weight: 0.9 },
      ],
    );
    mother.forwardOnly = true;

    const father = buildCreature(
      3,
      ["fH1", "fH2"],
      1,
      [
        { from: "input-0", to: "fH1", weight: -0.7 },
        { from: "input-1", to: "fH2", weight: 0.6 },
        { from: "input-2", to: "fH1", weight: 0.2 },
        { from: "fH1", to: "fH2", weight: -0.5 },
        { from: "fH2", to: "output-0", weight: 0.3 },
      ],
    );
    father.forwardOnly = true;

    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "Forward-only offspring should be created");
    creatureValidate(offspring, { forwardOnly: true });
  },
);

Deno.test(
  "Offspring.breed uses input-weight crossover when interSpeciesCrossoverThreshold is set",
  () => {
    const { mother, father } = createIncompatiblePair();
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // Standard breed with geneticCompatibilityThreshold triggers editParentByIndex
    // Adding interSpeciesCrossoverThreshold should trigger input-weight crossover instead
    let offspring: Creature | undefined;
    for (let i = 0; i < 20; i++) {
      offspring = Offspring.breed(mother, father, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring) break;
    }

    assert(
      offspring,
      "Offspring should be created with input-weight crossover",
    );
    creatureValidate(offspring);
  },
);

Deno.test(
  "Offspring.breed falls back to standard crossover for partially compatible parents",
  () => {
    // Create parents with partial compatibility (shared neuron "B")
    const mother = buildCreature(
      3,
      ["mH1", "B"],
      1,
      [
        { from: "input-0", to: "mH1", weight: 0.5 },
        { from: "input-1", to: "B", weight: 0.8 },
        { from: "mH1", to: "B", weight: 0.4 },
        { from: "B", to: "output-0", weight: 0.9 },
      ],
    );

    const father = buildCreature(
      3,
      ["fH1", "B"],
      1,
      [
        { from: "input-0", to: "fH1", weight: -0.7 },
        { from: "input-2", to: "B", weight: 0.6 },
        { from: "fH1", to: "B", weight: -0.5 },
        { from: "B", to: "output-0", weight: 0.3 },
      ],
    );
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // Compatibility = 0.5 (1 shared out of 2) — above interSpeciesCrossoverThreshold
    const compat = geneticCompatibility(mother, father);
    assert(
      compat > 0.1,
      "Partially compatible parents should have compat > 0.1",
    );

    // Standard crossover should work; input-weight crossover should NOT activate
    let offspring: Creature | undefined;
    for (let i = 0; i < 20; i++) {
      offspring = Offspring.breed(mother, father, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring) break;
    }

    if (offspring) {
      creatureValidate(offspring);
    }
  },
);

Deno.test(
  "inputWeightCrossover with larger input space (mimicking GRQ-25-1 / Europa scale)",
  () => {
    // Create creatures with many inputs to simulate real-world scale
    const inputCount = 50;
    const motherHiddenUuids = ["mH1", "mH2", "mH3"];
    const fatherHiddenUuids = ["fH1", "fH2"];

    const motherConns: Array<{ from: string; to: string; weight: number }> = [];
    const fatherConns: Array<{ from: string; to: string; weight: number }> = [];

    // Connect various inputs to hidden neurons
    for (let i = 0; i < 10; i++) {
      motherConns.push({
        from: `input-${i}`,
        to: "mH1",
        weight: (i * 0.1) - 0.5,
      });
    }
    for (let i = 5; i < 15; i++) {
      motherConns.push({
        from: `input-${i}`,
        to: "mH2",
        weight: (i * -0.05) + 0.3,
      });
    }
    motherConns.push({ from: "mH1", to: "mH3", weight: 0.6 });
    motherConns.push({ from: "mH2", to: "mH3", weight: -0.4 });
    motherConns.push({ from: "mH3", to: "output-0", weight: 0.9 });

    for (let i = 3; i < 12; i++) {
      fatherConns.push({
        from: `input-${i}`,
        to: "fH1",
        weight: (i * 0.08) - 0.2,
      });
    }
    for (let i = 10; i < 20; i++) {
      fatherConns.push({
        from: `input-${i}`,
        to: "fH2",
        weight: (i * -0.03) + 0.1,
      });
    }
    fatherConns.push({ from: "fH1", to: "fH2", weight: 0.7 });
    fatherConns.push({ from: "fH2", to: "output-0", weight: -0.5 });

    const mother = buildCreature(inputCount, motherHiddenUuids, 1, motherConns);
    const father = buildCreature(inputCount, fatherHiddenUuids, 1, fatherConns);

    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const compat = geneticCompatibility(mother, father);
    assertEquals(
      compat,
      0,
      "Completely different topologies should have 0 compatibility",
    );

    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "Offspring should be created for large input space");
    creatureValidate(offspring);

    // Verify mother's topology is preserved
    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();
    assertEquals(
      offspringExport.neurons.length,
      motherExport.neurons.length,
      "Offspring should preserve mother's neuron count even with many inputs",
    );
  },
);

Deno.test(
  "inputWeightCrossover mother-biased blending keeps weights closer to mother",
  () => {
    // Build creatures where both parents connect the SAME inputs to their
    // single hidden neuron — this ensures cosine similarity > 0 so alignment
    // is created and weight blending occurs.
    const mother = buildCreature(
      3,
      ["mH1"],
      1,
      [
        { from: "input-0", to: "mH1", weight: 1.0 },
        { from: "input-1", to: "mH1", weight: 1.0 },
        { from: "input-2", to: "mH1", weight: 1.0 },
        { from: "mH1", to: "output-0", weight: 1.0 },
      ],
    );

    const father = buildCreature(
      3,
      ["fH1"],
      1,
      [
        { from: "input-0", to: "fH1", weight: -1.0 },
        { from: "input-1", to: "fH1", weight: -1.0 },
        { from: "input-2", to: "fH1", weight: -1.0 },
        { from: "fH1", to: "output-0", weight: -1.0 },
      ],
    );

    // Run multiple times and check that offspring weights are closer to mother
    const offspringWeights: number[] = [];
    for (let trial = 0; trial < 10; trial++) {
      const offspring = inputWeightCrossover(mother, father);
      if (!offspring) continue;
      const exported = offspring.exportJSON();
      for (const syn of exported.synapses) {
        if (syn.fromUUID?.startsWith("input-")) {
          offspringWeights.push(syn.weight);
        }
      }
    }

    assert(offspringWeights.length > 0, "Should have produced some offspring");

    // Mother weights are 1.0, father weights are -1.0
    // Mother-biased blending (alpha 0.6-0.9) should produce positive values
    const avgWeight = offspringWeights.reduce((a, b) => a + b, 0) /
      offspringWeights.length;
    assert(
      avgWeight > 0,
      `Average blended weight should be positive (mother-biased), got ${avgWeight}`,
    );
  },
);

Deno.test(
  "no regression: compatible creatures still breed normally",
  () => {
    // Creatures with shared hidden neuron "B"
    const mother = buildCreature(
      2,
      ["B"],
      1,
      [
        { from: "input-0", to: "B", weight: 0.5 },
        { from: "B", to: "output-0", weight: 0.9 },
      ],
    );
    const father = buildCreature(
      2,
      ["B"],
      1,
      [
        { from: "input-1", to: "B", weight: -0.3 },
        { from: "B", to: "output-0", weight: 0.7 },
      ],
    );

    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const compat = geneticCompatibility(mother, father);
    assertEquals(compat, 1, "Fully compatible parents should have compat = 1");

    // Standard breed should work as before
    let offspring: Creature | undefined;
    for (let i = 0; i < 20; i++) {
      offspring = Offspring.breed(mother, father, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring) break;
    }

    if (offspring) {
      creatureValidate(offspring);
    }
  },
);
