/**
 * Integration tests for the breeding pipeline with genetically incompatible
 * sample creatures (Issue #2185).
 *
 * Exercises the complete inter-species breeding pipeline using the GRQ-25-1
 * and Europa fixtures — real-world creatures with worst-case genetic
 * incompatibility (zero shared hidden neuron UUIDs).
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature, CreatureUtil } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { inputWeightCrossover } from "@breed/InputWeightCrossover.ts";
import { subgraphTransplant } from "@breed/SubgraphTransplant.ts";
import { editParentByIndex } from "@breed/EditParentByIndex.ts";
import { getTag } from "@stsoftware/tags/mod";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Load a sample creature from the test/data directory. */
function loadSampleCreature(name: string): Creature {
  const json = JSON.parse(
    Deno.readTextFileSync(`./test/data/${name}-sample.json`),
  );
  return Creature.fromJSON(json);
}

// ─── 1. Genetic compatibility verification ─────────────────────────────

Deno.test(
  "GRQ-25-1 and Europa have near-zero genetic compatibility",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");

    const compat = geneticCompatibility(grq, europa);
    assertEquals(
      compat,
      0,
      "GRQ-25-1 and Europa share no hidden neuron UUIDs — compatibility should be 0",
    );
  },
);

Deno.test(
  "Both sample creatures have valid UUIDs",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");

    const grqUuid = CreatureUtil.makeUUID(grq);
    const europaUuid = CreatureUtil.makeUUID(europa);

    assert(grqUuid.length > 0, "GRQ-25-1 should have a valid UUID");
    assert(europaUuid.length > 0, "Europa should have a valid UUID");
    assertNotEquals(
      grqUuid,
      europaUuid,
      "Creatures should have distinct UUIDs",
    );
  },
);

// ─── 2. Neuron alignment via editParentByIndex ──────────────────────────

Deno.test(
  "editParentByIndex produces a valid mapped father for incompatible pair",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");

    // Align Europa (father) to GRQ-25-1 (mother)
    const mappedFather = editParentByIndex(grq, europa);

    assert(mappedFather, "editParentByIndex should return a mapped creature");
    creatureValidate(mappedFather);
  },
);

Deno.test(
  "editParentByIndex produces a valid mapped father (reversed direction)",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");

    // Align GRQ-25-1 (father) to Europa (mother)
    const mappedFather = editParentByIndex(europa, grq);

    assert(mappedFather, "editParentByIndex should return a mapped creature");
    creatureValidate(mappedFather);
  },
);

// ─── 3. Full Offspring.breed pipeline ───────────────────────────────────

Deno.test(
  "Offspring.breed produces valid offspring (GRQ-25-1 mother, Europa father)",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    let offspring: Creature | undefined;
    for (let i = 0; i < 30; i++) {
      offspring = Offspring.breed(mother, father, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring) break;
    }

    assert(offspring, "Breeding should produce offspring");
    creatureValidate(offspring);

    // Offspring preserves mother's input/output interface
    assertEquals(
      offspring.input,
      mother.input,
      "Input count must match mother",
    );
    assertEquals(
      offspring.output,
      mother.output,
      "Output count must match mother",
    );

    // Offspring has a unique UUID
    const offspringUuid = CreatureUtil.makeUUID(offspring);
    assertNotEquals(
      offspringUuid,
      CreatureUtil.makeUUID(mother),
      "Offspring UUID should differ from mother",
    );
    assertNotEquals(
      offspringUuid,
      CreatureUtil.makeUUID(father),
      "Offspring UUID should differ from father",
    );
  },
);

Deno.test(
  "Offspring.breed produces valid offspring (Europa mother, GRQ-25-1 father)",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    let offspring: Creature | undefined;
    for (let i = 0; i < 30; i++) {
      offspring = Offspring.breed(mother, father, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring) break;
    }

    assert(offspring, "Breeding should produce offspring");
    creatureValidate(offspring);

    assertEquals(
      offspring.input,
      mother.input,
      "Input count must match mother",
    );
    assertEquals(
      offspring.output,
      mother.output,
      "Output count must match mother",
    );

    const offspringUuid = CreatureUtil.makeUUID(offspring);
    assertNotEquals(
      offspringUuid,
      CreatureUtil.makeUUID(mother),
      "Offspring UUID should differ from mother",
    );
    assertNotEquals(
      offspringUuid,
      CreatureUtil.makeUUID(father),
      "Offspring UUID should differ from father",
    );
  },
);

// ─── 4. Input-weight crossover activation (#2175) ───────────────────────

Deno.test(
  "inputWeightCrossover produces valid offspring (GRQ-25-1 mother)",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");

    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "inputWeightCrossover should produce offspring");
    creatureValidate(offspring);

    // Offspring preserves mother's topology structure
    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();
    assertEquals(
      offspringExport.neurons.length,
      motherExport.neurons.length,
      "Offspring should preserve mother's neuron count",
    );
  },
);

Deno.test(
  "inputWeightCrossover produces valid offspring (Europa mother)",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");

    const offspring = inputWeightCrossover(mother, father);
    assert(offspring, "inputWeightCrossover should produce offspring");
    creatureValidate(offspring);

    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();
    assertEquals(
      offspringExport.neurons.length,
      motherExport.neurons.length,
      "Offspring should preserve mother's neuron count",
    );
  },
);

// ─── 5. Subgraph transplantation (#2177) ────────────────────────────────

Deno.test(
  "subgraphTransplant produces valid offspring (GRQ-25-1 mother, Europa father)",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "subgraphTransplant should produce offspring");
    creatureValidate(offspring);

    // Transplanted neurons should be tagged
    const exported = offspring.exportJSON();
    const motherUuids = new Set(
      mother.exportJSON().neurons.map((n) => n.uuid),
    );
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

    // Offspring should have more hidden neurons than the mother
    const motherHidden = mother.exportJSON().neurons.filter(
      (n) => n.type === "hidden",
    ).length;
    const offspringHidden = exported.neurons.filter(
      (n) => n.type === "hidden",
    ).length;
    assert(
      offspringHidden > motherHidden,
      `Offspring should have more hidden neurons (${offspringHidden}) than mother (${motherHidden})`,
    );
  },
);

Deno.test(
  "subgraphTransplant produces valid offspring (Europa mother, GRQ-25-1 father)",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");

    const offspring = subgraphTransplant(mother, father);
    assert(offspring, "subgraphTransplant should produce offspring");
    creatureValidate(offspring);

    const exported = offspring.exportJSON();
    const motherUuids = new Set(
      mother.exportJSON().neurons.map((n) => n.uuid),
    );
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

    const motherHidden = mother.exportJSON().neurons.filter(
      (n) => n.type === "hidden",
    ).length;
    const offspringHidden = exported.neurons.filter(
      (n) => n.type === "hidden",
    ).length;
    assert(
      offspringHidden > motherHidden,
      `Offspring should have more hidden neurons (${offspringHidden}) than mother (${motherHidden})`,
    );
  },
);

// ─── 6. Both breeding directions via full pipeline ──────────────────────

Deno.test(
  "Both breeding directions produce valid offspring via Offspring.breed",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");
    CreatureUtil.makeUUID(grq);
    CreatureUtil.makeUUID(europa);

    // Direction 1: many-neuron mother, few-neuron father
    let offspring1: Creature | undefined;
    for (let i = 0; i < 30; i++) {
      offspring1 = Offspring.breed(grq, europa, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring1) break;
    }
    assert(offspring1, "GRQ-as-mother should produce offspring");
    creatureValidate(offspring1);

    // Direction 2: few-neuron mother, many-neuron father
    let offspring2: Creature | undefined;
    for (let i = 0; i < 30; i++) {
      offspring2 = Offspring.breed(europa, grq, {
        geneticCompatibilityThreshold: 0.3,
        interSpeciesCrossoverThreshold: 0.1,
      });
      if (offspring2) break;
    }
    assert(offspring2, "Europa-as-mother should produce offspring");
    creatureValidate(offspring2);
  },
);
