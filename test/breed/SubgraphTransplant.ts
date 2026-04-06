/**
 * Tests for subgraph transplantation breeding strategy (Issue #2177).
 *
 * Subgraph transplantation extracts small, self-contained clusters of
 * hidden neurons from a donor creature and transplants them into a
 * recipient creature. This is a biologically-inspired horizontal gene
 * transfer mechanism for inter-species breeding.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import {
  extractSubgraphs,
  subgraphTransplant,
} from "@breed/SubgraphTransplant.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { getTag } from "@stsoftware/tags/mod";

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
 * Creates a donor (father) creature with a clear subgraph cluster.
 */
function createDonorWithSubgraph(): Creature {
  // Father: 3 inputs, 4 hidden neurons forming a subgraph cluster (fA, fB)
  // plus two other neurons (fC, fD)
  return buildCreature(
    3,
    ["fA", "fB", "fC", "fD"],
    1,
    [
      // Subgraph cluster: fA -> fB (internal)
      { from: "input-0", to: "fA", weight: 0.5 },
      { from: "input-1", to: "fA", weight: -0.3 },
      { from: "fA", to: "fB", weight: 0.8 },
      { from: "fB", to: "output-0", weight: 0.6 },
      // Other neurons
      { from: "input-2", to: "fC", weight: 0.4 },
      { from: "fC", to: "fD", weight: -0.5 },
      { from: "fD", to: "output-0", weight: 0.3 },
    ],
  );
}

/**
 * Creates a recipient (mother) creature with simple topology.
 */
function createRecipient(): Creature {
  return buildCreature(
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
}

Deno.test(
  "extractSubgraphs finds connected hidden neuron clusters",
  () => {
    const donor = createDonorWithSubgraph();
    const donorExport = donor.exportJSON();

    const subgraphs = extractSubgraphs(donorExport);
    assert(subgraphs.length > 0, "Should find at least one subgraph");

    // Each subgraph should have between 2 and 5 neurons
    for (const sg of subgraphs) {
      assert(
        sg.neuronUuids.length >= 2 && sg.neuronUuids.length <= 5,
        `Subgraph should have 2-5 neurons, got ${sg.neuronUuids.length}`,
      );
    }
  },
);

Deno.test(
  "extractSubgraphs returns subgraphs with internal connections",
  () => {
    const donor = createDonorWithSubgraph();
    const donorExport = donor.exportJSON();

    const subgraphs = extractSubgraphs(donorExport);
    assert(subgraphs.length > 0, "Should find at least one subgraph");

    // Each subgraph should have at least one internal synapse
    for (const sg of subgraphs) {
      assert(
        sg.internalSynapses.length > 0,
        "Each subgraph must have at least one internal connection",
      );
    }
  },
);

Deno.test(
  "subgraphTransplant produces valid offspring",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Offspring should be created");

    // Should pass creatureValidate without errors
    creatureValidate(offspring);
  },
);

Deno.test(
  "subgraphTransplant produces valid forward-only offspring",
  () => {
    const mother = createRecipient();
    mother.forwardOnly = true;
    const father = createDonorWithSubgraph();
    father.forwardOnly = true;

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Forward-only offspring should be created");

    creatureValidate(offspring, { forwardOnly: true });
  },
);

Deno.test(
  "subgraphTransplant tags transplanted neurons with approach: transplant",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Offspring should be created");

    const exported = offspring.exportJSON();
    const motherUuids = new Set(
      mother.exportJSON().neurons.map((n) => n.uuid),
    );

    // At least one neuron should be tagged as transplanted
    let hasTransplantTag = false;
    for (const n of exported.neurons) {
      if (n.uuid && !motherUuids.has(n.uuid)) {
        const approach = getTag(n, "approach");
        if (approach === "transplant") {
          hasTransplantTag = true;
        }
      }
    }
    assert(
      hasTransplantTag,
      "At least one transplanted neuron should have approach: transplant tag",
    );
  },
);

Deno.test(
  "subgraphTransplant gives new UUIDs to transplanted neurons",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Offspring should be created");

    const exported = offspring.exportJSON();
    const fatherUuids = new Set(
      father.exportJSON().neurons.map((n) => n.uuid),
    );

    // Transplanted neurons should have new UUIDs (not reuse father's)
    for (const n of exported.neurons) {
      if (n.type === "hidden" && n.uuid) {
        assert(
          !fatherUuids.has(n.uuid),
          `Transplanted neuron should have a new UUID, not reuse father's ${n.uuid}`,
        );
      }
    }
  },
);

Deno.test(
  "subgraphTransplant preserves mother's input/output structure",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Offspring should be created");

    assertEquals(
      offspring.input,
      mother.input,
      "Offspring should have same input count as mother",
    );
    assertEquals(
      offspring.output,
      mother.output,
      "Offspring should have same output count as mother",
    );
  },
);

Deno.test(
  "subgraphTransplant offspring has more hidden neurons than mother",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Offspring should be created");

    const motherHidden = mother.exportJSON().neurons.filter(
      (n) => n.type === "hidden",
    ).length;
    const offspringHidden = offspring.exportJSON().neurons.filter(
      (n) => n.type === "hidden",
    ).length;

    assert(
      offspringHidden > motherHidden,
      `Offspring should have more hidden neurons (${offspringHidden}) than mother (${motherHidden})`,
    );
  },
);

Deno.test(
  "subgraphTransplant works with incompatible parents",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const compat = geneticCompatibility(mother, father);
    assertEquals(
      compat,
      0,
      "Parents with no shared hidden UUIDs should have 0 compatibility",
    );

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Should produce offspring from incompatible parents");
    creatureValidate(offspring);
  },
);

Deno.test(
  "Offspring.breed can use subgraph transplant for very low compatibility",
  () => {
    const mother = createRecipient();
    const father = createDonorWithSubgraph();
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // When compatibility is below interSpeciesCrossoverThreshold,
    // Offspring.breed may use either inputWeightCrossover or
    // subgraphTransplant. Run enough times to get an offspring.
    let offspring: Creature | undefined;
    for (let i = 0; i < 30; i++) {
      offspring = Offspring.breed(mother, father, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring) break;
    }

    assert(
      offspring,
      "Offspring should be created via inter-species breeding",
    );
    creatureValidate(offspring);
  },
);

Deno.test(
  "subgraphTransplant with single hidden neuron donor returns undefined",
  () => {
    // Donor with only 1 hidden neuron — can't form a 2+ subgraph
    const father = buildCreature(
      3,
      ["fH1"],
      1,
      [
        { from: "input-0", to: "fH1", weight: 0.5 },
        { from: "fH1", to: "output-0", weight: 0.9 },
      ],
    );
    const mother = createRecipient();

    const offspring = subgraphTransplant(mother, father);
    assertEquals(
      offspring,
      undefined,
      "Should return undefined when donor has no viable subgraph",
    );
  },
);

Deno.test(
  "subgraphTransplant with larger networks",
  () => {
    // Mother with deeper topology
    const mother = buildCreature(
      4,
      ["mA", "mB", "mC", "mD"],
      2,
      [
        { from: "input-0", to: "mA", weight: 0.5 },
        { from: "input-1", to: "mA", weight: -0.3 },
        { from: "input-2", to: "mB", weight: 0.8 },
        { from: "input-3", to: "mB", weight: 0.2 },
        { from: "mA", to: "mC", weight: 0.4 },
        { from: "mB", to: "mC", weight: -0.6 },
        { from: "mC", to: "mD", weight: 0.7 },
        { from: "mD", to: "output-0", weight: 0.9 },
        { from: "mC", to: "output-1", weight: -0.5 },
      ],
    );

    // Father with different topology but rich subgraph potential
    const father = buildCreature(
      4,
      ["fA", "fB", "fC", "fD", "fE"],
      2,
      [
        { from: "input-0", to: "fA", weight: -0.7 },
        { from: "input-1", to: "fB", weight: 0.6 },
        { from: "input-2", to: "fA", weight: 0.2 },
        { from: "input-3", to: "fC", weight: 0.3 },
        { from: "fA", to: "fB", weight: -0.5 },
        { from: "fB", to: "fC", weight: 0.8 },
        { from: "fC", to: "fD", weight: 0.4 },
        { from: "fD", to: "fE", weight: -0.3 },
        { from: "fE", to: "output-0", weight: 0.7 },
        { from: "fD", to: "output-1", weight: -0.2 },
      ],
    );

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "Should create offspring from larger networks");
    creatureValidate(offspring);

    assertEquals(offspring.input, 4);
    assertEquals(offspring.output, 2);
  },
);
