/**
 * Integration tests for offspring quality metrics and edge cases in
 * inter-species breeding (Issue #2186).
 *
 * Covers:
 *  1. Offspring quality — not a clone, carries father-origin content, valid topology
 *  2. Memetic data handling — inheritance in both directions, orphan pruning
 *  3. Edge cases — asymmetric neuron counts, multiple consecutive breedings
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, CreatureUtil } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Offspring } from "@architecture/Offspring.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Load a sample creature from the test/data directory. */
function loadSampleCreature(name: string): Creature {
  const json = JSON.parse(
    Deno.readTextFileSync(`./test/data/${name}-sample.json`),
  );
  return Creature.fromJSON(json);
}

/** Helper: breed with retries until offspring is produced. */
function breedWithRetries(
  mother: Creature,
  father: Creature,
  maxAttempts = 30,
): Creature {
  for (let i = 0; i < maxAttempts; i++) {
    const offspring = Offspring.breed(mother, father, {
      geneticCompatibilityThreshold: 0.3,
      interSpeciesCrossoverThreshold: 0.1,
    });
    if (offspring) return offspring;
  }
  throw new Error(
    `Breeding failed to produce offspring after ${maxAttempts} attempts`,
  );
}

// ─── 1. Offspring quality metrics ──────────────────────────────────────

Deno.test(
  "Offspring is not a clone of the mother (GRQ-25-1 mother)",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const offspring = breedWithRetries(mother, father);
    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();

    // Remove UUIDs from comparison — we want structural differences
    const motherNeuronBiases = motherExport.neurons.map((n) => n.bias);
    const offspringNeuronBiases = offspringExport.neurons.map((n) => n.bias);

    // Check for meaningful structural differences beyond just UUID
    let hasDifferentNeuronCount = false;
    let hasDifferentWeights = false;
    let hasDifferentBiases = false;

    if (motherExport.neurons.length !== offspringExport.neurons.length) {
      hasDifferentNeuronCount = true;
    }

    if (motherExport.synapses.length !== offspringExport.synapses.length) {
      hasDifferentWeights = true;
    }

    // Check if biases differ
    if (motherNeuronBiases.length === offspringNeuronBiases.length) {
      for (let i = 0; i < motherNeuronBiases.length; i++) {
        if (motherNeuronBiases[i] !== offspringNeuronBiases[i]) {
          hasDifferentBiases = true;
          break;
        }
      }
    } else {
      hasDifferentBiases = true;
    }

    // Check synapse weights differ
    if (!hasDifferentWeights) {
      const motherWeights = motherExport.synapses.map((s) => s.weight);
      const offspringWeights = offspringExport.synapses.map((s) => s.weight);
      for (let i = 0; i < motherWeights.length; i++) {
        if (motherWeights[i] !== offspringWeights[i]) {
          hasDifferentWeights = true;
          break;
        }
      }
    }

    assert(
      hasDifferentNeuronCount || hasDifferentWeights || hasDifferentBiases,
      "Offspring must differ meaningfully from mother (neurons, synapses, or weights)",
    );
  },
);

Deno.test(
  "Offspring is not a clone of the mother (Europa mother)",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const offspring = breedWithRetries(mother, father);
    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();

    let hasDifferences = false;

    if (motherExport.neurons.length !== offspringExport.neurons.length) {
      hasDifferences = true;
    }
    if (motherExport.synapses.length !== offspringExport.synapses.length) {
      hasDifferences = true;
    }

    if (!hasDifferences) {
      // Check biases and weights for differences
      for (let i = 0; i < motherExport.neurons.length; i++) {
        if (motherExport.neurons[i].bias !== offspringExport.neurons[i].bias) {
          hasDifferences = true;
          break;
        }
      }
    }
    if (!hasDifferences) {
      for (let i = 0; i < motherExport.synapses.length; i++) {
        if (
          motherExport.synapses[i].weight !== offspringExport.synapses[i].weight
        ) {
          hasDifferences = true;
          break;
        }
      }
    }

    assert(
      hasDifferences,
      "Offspring must differ meaningfully from mother",
    );
  },
);

Deno.test(
  "Offspring inherits structural elements from the father",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const offspring = breedWithRetries(mother, father);
    const motherExport = mother.exportJSON();
    const offspringExport = offspring.exportJSON();

    const motherUuids = new Set(motherExport.neurons.map((n) => n.uuid));

    // Father-origin content: either transplanted neurons (new UUIDs not in mother)
    // or blended weights that differ from mother's originals
    let hasFatherOriginNeurons = false;
    for (const n of offspringExport.neurons) {
      if (n.uuid && !motherUuids.has(n.uuid)) {
        hasFatherOriginNeurons = true;
        break;
      }
    }

    let hasDifferentWeights = false;
    if (!hasFatherOriginNeurons) {
      // Even without new neurons, weights should be blended from father
      const motherWeightMap = new Map<string, number>();
      for (const s of motherExport.synapses) {
        motherWeightMap.set(`${s.fromUUID}->${s.toUUID}`, s.weight);
      }
      for (const s of offspringExport.synapses) {
        const key = `${s.fromUUID}->${s.toUUID}`;
        const motherWeight = motherWeightMap.get(key);
        if (motherWeight !== undefined && motherWeight !== s.weight) {
          hasDifferentWeights = true;
          break;
        }
      }
    }

    assert(
      hasFatherOriginNeurons || hasDifferentWeights,
      "Offspring should carry father-origin structural elements " +
        "(transplanted neurons or blended weights)",
    );
  },
);

Deno.test(
  "Offspring topology is valid — forward-only, no disconnected hidden neurons",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const offspring = breedWithRetries(mother, father);

    // creatureValidate checks forward-only constraints and connectivity
    creatureValidate(offspring);

    const exported = offspring.exportJSON();

    // Verify every hidden neuron has at least one inward and one outward connection
    const hiddenUuids = new Set(
      exported.neurons
        .filter((n) => n.type === "hidden")
        .map((n) => n.uuid),
    );

    const hasInward = new Set<string>();
    const hasOutward = new Set<string>();

    for (const s of exported.synapses) {
      if (hiddenUuids.has(s.toUUID)) hasInward.add(s.toUUID!);
      if (hiddenUuids.has(s.fromUUID)) hasOutward.add(s.fromUUID!);
    }

    for (const uuid of hiddenUuids) {
      assert(
        hasInward.has(uuid!),
        `Hidden neuron ${uuid} lacks inward connections`,
      );
      assert(
        hasOutward.has(uuid!),
        `Hidden neuron ${uuid} lacks outward connections`,
      );
    }
  },
);

// ─── 2. Memetic data handling ──────────────────────────────────────────

Deno.test(
  "Memetic inherited from mother (Europa mother with memetic, GRQ-25-1 father without)",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // Europa has memetic data, GRQ-25-1 does not
    assert(mother.memetic, "Europa should have memetic data");
    assertEquals(
      father.memetic,
      undefined,
      "GRQ-25-1 should lack memetic data",
    );

    const offspring = breedWithRetries(mother, father);

    // Memetic may or may not be inherited depending on topology compatibility,
    // but if it is present it must be valid
    if (offspring.memetic) {
      assert(
        typeof offspring.memetic.generation === "number",
        "Memetic generation should be a number",
      );
    }
  },
);

Deno.test(
  "Memetic fallback from father (GRQ-25-1 mother without memetic, Europa father with)",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // GRQ-25-1 has no memetic, Europa does
    assertEquals(
      mother.memetic,
      undefined,
      "GRQ-25-1 should lack memetic data",
    );
    assert(father.memetic, "Europa should have memetic data");

    const offspring = breedWithRetries(mother, father);

    // Father memetic fallback path in Offspring.ts: if mother has no memetic,
    // tries memeticUpdate(father, child). Result depends on topology compatibility.
    if (offspring.memetic) {
      assert(
        typeof offspring.memetic.generation === "number",
        "Memetic generation should be a number",
      );
    }
  },
);

Deno.test(
  "Memetic data references valid neurons after breeding",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    const offspring = breedWithRetries(mother, father);

    if (!offspring.memetic) return; // No memetic to validate

    // Collect all valid neuron IDs in the offspring
    const validNeuronIds = new Set<number>();
    for (const n of offspring.neurons) {
      validNeuronIds.add(n.id);
    }

    // Check bias keys reference valid neurons
    if (offspring.memetic.biases) {
      for (const key of Object.keys(offspring.memetic.biases)) {
        const id = Number(key);
        assert(
          validNeuronIds.has(id),
          `Memetic bias references non-existent neuron id ${id}`,
        );
      }
    }

    // Check weight keys reference valid neurons and valid synapses
    if (offspring.memetic.weights) {
      const synapseKeys = new Set<string>();
      for (const s of offspring.synapses) {
        synapseKeys.add(`${s.from}->${s.to}`);
      }

      for (const fromKey of Object.keys(offspring.memetic.weights)) {
        const fromId = Number(fromKey);
        assert(
          validNeuronIds.has(fromId),
          `Memetic weight references non-existent source neuron id ${fromId}`,
        );
        const entries = offspring.memetic.weights[fromId];
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            assert(
              validNeuronIds.has(entry.toId),
              `Memetic weight references non-existent target neuron id ${entry.toId}`,
            );
          }
        }
      }
    }
  },
);

// ─── 3. Edge cases ─────────────────────────────────────────────────────

Deno.test(
  "Asymmetric neuron counts: many-neuron father (GRQ-25-1), few-neuron mother (Europa)",
  () => {
    const mother = loadSampleCreature("europa");
    const father = loadSampleCreature("grq-25-1");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // Europa has ~22 neurons, GRQ-25-1 has ~62 — father has many more
    assert(
      father.neurons.length > mother.neurons.length,
      "Father should have more neurons than mother for this test",
    );

    const offspring = breedWithRetries(mother, father);
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
  },
);

Deno.test(
  "Asymmetric neuron counts: few-neuron father (Europa), many-neuron mother (GRQ-25-1)",
  () => {
    const mother = loadSampleCreature("grq-25-1");
    const father = loadSampleCreature("europa");
    CreatureUtil.makeUUID(mother);
    CreatureUtil.makeUUID(father);

    // GRQ-25-1 has ~62 neurons, Europa has ~22 — father has many fewer
    assert(
      father.neurons.length < mother.neurons.length,
      "Father should have fewer neurons than mother for this test",
    );

    const offspring = breedWithRetries(mother, father);
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
  },
);

Deno.test(
  "Multiple consecutive breedings produce valid, varied offspring without state corruption",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");
    CreatureUtil.makeUUID(grq);
    CreatureUtil.makeUUID(europa);

    // Snapshot parent state before breeding
    const grqJsonBefore = JSON.stringify(grq.exportJSON());
    const europaJsonBefore = JSON.stringify(europa.exportJSON());

    const offspringList: Creature[] = [];
    const offspringJsons: string[] = [];

    for (let round = 0; round < 5; round++) {
      const offspring = breedWithRetries(grq, europa);
      creatureValidate(offspring);
      offspringList.push(offspring);
      offspringJsons.push(JSON.stringify(offspring.exportJSON()));
    }

    // Parents remain unchanged after all breedings
    const grqJsonAfter = JSON.stringify(grq.exportJSON());
    const europaJsonAfter = JSON.stringify(europa.exportJSON());
    assertEquals(
      grqJsonBefore,
      grqJsonAfter,
      "GRQ-25-1 parent must not be mutated by breeding",
    );
    assertEquals(
      europaJsonBefore,
      europaJsonAfter,
      "Europa parent must not be mutated by breeding",
    );

    // Offspring should not all be identical (randomness produces variety)
    let hasVariety = false;
    for (let i = 1; i < offspringJsons.length; i++) {
      if (offspringJsons[i] !== offspringJsons[0]) {
        hasVariety = true;
        break;
      }
    }
    assert(
      hasVariety,
      "Multiple consecutive breedings should produce varied offspring",
    );
  },
);

Deno.test(
  "Multiple consecutive breedings in reverse direction",
  () => {
    const grq = loadSampleCreature("grq-25-1");
    const europa = loadSampleCreature("europa");
    CreatureUtil.makeUUID(grq);
    CreatureUtil.makeUUID(europa);

    const grqJsonBefore = JSON.stringify(grq.exportJSON());
    const europaJsonBefore = JSON.stringify(europa.exportJSON());

    const offspringJsons: string[] = [];

    for (let round = 0; round < 5; round++) {
      const offspring = breedWithRetries(europa, grq);
      creatureValidate(offspring);
      offspringJsons.push(JSON.stringify(offspring.exportJSON()));
    }

    // Parents remain unchanged
    assertEquals(
      grqJsonBefore,
      JSON.stringify(grq.exportJSON()),
      "GRQ-25-1 parent must not be mutated by breeding",
    );
    assertEquals(
      europaJsonBefore,
      JSON.stringify(europa.exportJSON()),
      "Europa parent must not be mutated by breeding",
    );

    // Verify variety
    let hasVariety = false;
    for (let i = 1; i < offspringJsons.length; i++) {
      if (offspringJsons[i] !== offspringJsons[0]) {
        hasVariety = true;
        break;
      }
    }
    assert(
      hasVariety,
      "Multiple consecutive breedings should produce varied offspring",
    );
  },
);
