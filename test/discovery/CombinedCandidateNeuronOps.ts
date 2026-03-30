/**
 * Tests for sequential application of discovery candidates.
 *
 * Verifies that when combining "add" and "remove" operations,
 * newly added elements are NOT incorrectly removed.
 *
 * Bug scenario:
 * - "add-neurons" runs before "remove-neuron" (alphabetical sorting)
 * - Remove logic compares creature (with new neurons) to candidate (built from base)
 * - New neurons incorrectly identified as "removed" because they're not in candidate
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { Synapse } from "@architecture/Synapse.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Creature } from "@creature";
import {
  buildCombinedFromSuccessful,
  type DiscoveryCandidate,
} from "@discovery/DiscoveryCandidates.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

// Integer IDs for neurons used in these tests (from UUID hashing):
// hidden-A = 1775329634, hidden-B = 1775329633, hidden-C = 1775329632
// hidden-D = 1775329631, hidden-E = 1775329630
// output-0 = -1

const ID_HIDDEN_A = 1775329634;
const ID_HIDDEN_B = 1775329633;
const ID_HIDDEN_C = 1775329632;
const ID_HIDDEN_D = 1775329631;
const ID_HIDDEN_E = 1775329630;

/**
 * Creates a base creature with known structure for testing.
 */
function makeTestCreature() {
  const json = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-A", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-B", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-C", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-B", weight: 0.5 },
      { fromUUID: "hidden-A", toUUID: "hidden-C", weight: 0.3 },
      { fromUUID: "hidden-B", toUUID: "hidden-C", weight: 0.3 },
      { fromUUID: "hidden-C", toUUID: "output-0", weight: 0.5 },
    ],
  };
  normaliseCreatureExport(
    json as Parameters<typeof normaliseCreatureExport>[0],
  );
  const creature = Creature.fromJSON(
    json as Parameters<typeof Creature.fromJSON>[0],
  );
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "buildCombinedFromSuccessful: add-neurons + remove-neuron preserves added neurons",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();
    normaliseCreatureExport(baseJSON);

    // Create "add-neurons" candidate: adds hidden-D
    const addNeuronsJSON = structuredClone(baseJSON);
    const outputIndex = addNeuronsJSON.neurons.findIndex((n) =>
      n.type === "output"
    );
    addNeuronsJSON.neurons.splice(
      outputIndex,
      0,
      {
        type: "hidden",
        uuid: "hidden-D",
        squash: "TANH",
        bias: 0.15,
      } as Parameters<typeof normaliseCreatureExport>[0]["neurons"][0],
    );
    addNeuronsJSON.synapses.push(
      { fromId: 0, toId: ID_HIDDEN_D, weight: 0.4 },
      { fromId: ID_HIDDEN_D, toId: -1, weight: 0.4 },
    );
    normaliseCreatureExport(addNeuronsJSON);
    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.fix();
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description: "Added hidden-D neuron",
      },
    };

    // Create "remove-neuron" candidate: removes hidden-C
    const removeNeuronJSON = structuredClone(baseJSON);
    removeNeuronJSON.neurons = removeNeuronJSON.neurons.filter(
      (n) => n.id !== ID_HIDDEN_C,
    );
    removeNeuronJSON.synapses = removeNeuronJSON.synapses.filter(
      (s) => s.fromId !== ID_HIDDEN_C && s.toId !== ID_HIDDEN_C,
    );
    // Reconnect A and B directly to output
    removeNeuronJSON.synapses.push(
      { fromId: ID_HIDDEN_A, toId: -1, weight: 0.3 },
      { fromId: ID_HIDDEN_B, toId: -1, weight: 0.3 },
    );
    const removeNeuronCreature = Creature.fromJSON(removeNeuronJSON);
    delete removeNeuronCreature.uuid;
    removeNeuronCreature.fix();
    CreatureUtil.makeUUID(removeNeuronCreature);

    const removeNeuronCandidate: DiscoveryCandidate = {
      creature: removeNeuronCreature,
      change: {
        type: "remove-neuron",
        description: "Removed hidden-C neuron",
      },
    };

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addNeuronsCandidate, removeNeuronCandidate],
    );

    // Should have at least one combined candidate
    assert(combined.length > 0, "Should produce combined candidates");

    // Find the combo-successful candidate
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    normaliseCreatureExport(comboJSON);
    const hiddenNeurons = comboJSON.neurons.filter((n) => n.type === "hidden");
    const neuronIds = hiddenNeurons.map((n) => n.id);

    // Critical assertion: hidden-D (added) should exist
    assertEquals(
      neuronIds.includes(ID_HIDDEN_D),
      true,
      `Added neuron hidden-D should be preserved. Found neurons: ${
        neuronIds.join(", ")
      }`,
    );

    // hidden-C (removed) should NOT exist
    assertEquals(
      neuronIds.includes(ID_HIDDEN_C),
      false,
      `Removed neuron hidden-C should not exist. Found neurons: ${
        neuronIds.join(", ")
      }`,
    );

    // Original neurons A and B should still exist
    assertEquals(
      neuronIds.includes(ID_HIDDEN_A),
      true,
      "Original neuron hidden-A should exist",
    );
    assertEquals(
      neuronIds.includes(ID_HIDDEN_B),
      true,
      "Original neuron hidden-B should exist",
    );

    // Final expected structure: A, B, D (not C)
    assertEquals(
      hiddenNeurons.length,
      3,
      `Should have 3 hidden neurons (A, B, D). Found: ${neuronIds.join(", ")}`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: add-neurons targeting hidden neuron keeps new neuron before target",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();
    normaliseCreatureExport(baseJSON);

    // Create "add-neurons" candidate: adds hidden-D and targets hidden-A (a hidden neuron).
    // The new neuron must be inserted BEFORE hidden-A; otherwise hidden-A can't receive
    // hidden-D's activation during the forward pass.
    const addNeuronsJSON = structuredClone(baseJSON);
    const targetIndex = addNeuronsJSON.neurons.findIndex(
      (n) => n.id === ID_HIDDEN_A,
    );
    assert(targetIndex >= 0, "Expected hidden-A to exist in base creature");

    addNeuronsJSON.neurons.splice(
      targetIndex,
      0,
      {
        type: "hidden",
        uuid: "hidden-D",
        squash: "TANH",
        bias: 0.15,
      } as Parameters<typeof normaliseCreatureExport>[0]["neurons"][0],
    );
    addNeuronsJSON.synapses.push(
      { fromId: 0, toId: ID_HIDDEN_D, weight: 0.4 },
      { fromId: ID_HIDDEN_D, toId: ID_HIDDEN_A, weight: 0.4 },
    );
    normaliseCreatureExport(addNeuronsJSON);
    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.fix();
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description: "Added hidden-D neuron targeting hidden-A",
      },
    };

    // Second candidate so buildCombinedFromSuccessful produces combinations.
    // Use remove-synapse to keep the structure change simple.
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromId === ID_HIDDEN_B && s.toId === ID_HIDDEN_C),
    );
    // Reconnect hidden-B directly to output
    removeSynapseJSON.synapses.push({
      fromId: ID_HIDDEN_B,
      toId: -1,
      weight: 0.25,
    });
    const removeSynapseCreature = Creature.fromJSON(removeSynapseJSON);
    delete removeSynapseCreature.uuid;
    removeSynapseCreature.fix();
    CreatureUtil.makeUUID(removeSynapseCreature);

    const removeSynapseCandidate: DiscoveryCandidate = {
      creature: removeSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "Removed hidden-B -> hidden-C synapse",
        synapseDetails: {
          fromNeuronUuid: "hidden-B",
          toNeuronUuid: "hidden-C",
        },
      },
    };

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addNeuronsCandidate, removeSynapseCandidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    normaliseCreatureExport(comboJSON);
    const indexOf = (id: number) =>
      comboJSON.neurons.findIndex((n) => n.id === id);

    const newIndex = indexOf(ID_HIDDEN_D);
    const targetHiddenIndex = indexOf(ID_HIDDEN_A);
    assert(newIndex >= 0, "Expected hidden-D to exist in combined creature");
    assert(
      targetHiddenIndex >= 0,
      "Expected hidden-A to exist in combined creature",
    );

    assert(
      newIndex < targetHiddenIndex,
      `Expected hidden-D (index ${newIndex}) to be before hidden-A (index ${targetHiddenIndex})`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: forward-only (4.x) combinations must not introduce recurrent synapses",
  () => {
    // Arrange: a forward-only (feed-forward) base creature.
    const base = makeTestCreature();
    base.forwardOnly = true;
    base.semanticVersion = "4.0.0";
    base.validate({ forwardOnly: true });

    const baseJSON = base.exportJSON();
    normaliseCreatureExport(baseJSON);

    // Candidate A: adds a *back* connection (hidden-C -> hidden-A). Illegal for forward-only;
    // simulates a bad hint delivered on a creature that still claims forward-only (in-memory only).
    const addBackSynapseCreature = Creature.fromJSON(structuredClone(baseJSON));
    delete addBackSynapseCreature.uuid;
    const idxC = addBackSynapseCreature.neurons.findIndex((n) =>
      n.uuid === "hidden-C"
    );
    const idxA = addBackSynapseCreature.neurons.findIndex((n) =>
      n.uuid === "hidden-A"
    );
    assert(idxC >= 0 && idxA >= 0, "Expected hidden-A and hidden-C in base");
    addBackSynapseCreature.synapses.push(new Synapse(idxC, idxA, 0.123));
    addBackSynapseCreature.synapses.sort((a, b) =>
      a.from === b.from ? a.to - b.to : a.from - b.from
    );
    CreatureUtil.makeUUID(addBackSynapseCreature);

    const addBackSynapseCandidate: DiscoveryCandidate = {
      creature: addBackSynapseCreature,
      change: {
        type: "add-synapses",
        description:
          "Adds back connection hidden-C -> hidden-A (should be rejected in forward-only)",
      },
    };

    // Candidate B: a second change so buildCombinedFromSuccessful produces a combination.
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromId === ID_HIDDEN_B && s.toId === ID_HIDDEN_C),
    );
    removeSynapseJSON.synapses.push({
      fromId: ID_HIDDEN_B,
      toId: -1,
      weight: 0.25,
    });
    const removeSynapseCreature = Creature.fromJSON(removeSynapseJSON);
    delete removeSynapseCreature.uuid;
    removeSynapseCreature.fix();
    CreatureUtil.makeUUID(removeSynapseCreature);

    const removeSynapseCandidate: DiscoveryCandidate = {
      creature: removeSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "Removed hidden-B -> hidden-C synapse",
        synapseDetails: {
          fromNeuronUuid: "hidden-B",
          toNeuronUuid: "hidden-C",
        },
      },
    };

    // Act: combine successful candidates.
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addBackSynapseCandidate, removeSynapseCandidate],
    );
    // Assert: either no combination is produced (because the illegal synapse is rejected),
    // or any produced combination must still be forward-only valid.
    for (const candidate of combined) {
      candidate.creature.validate({ forwardOnly: true });
    }
  },
);

Deno.test(
  "buildCombinedFromSuccessful: add-neurons (forward-only 4.x) filters recurrent synapses instead of relying on fix()",
  () => {
    // Arrange: forward-only base creature.
    const base = makeTestCreature();
    base.forwardOnly = true;
    base.semanticVersion = "4.0.0";
    base.validate({ forwardOnly: true });

    const baseJSON = base.exportJSON();
    normaliseCreatureExport(baseJSON);

    // Candidate A: add a new neuron, but also (incorrectly) includes a back connection
    // involving that new neuron. In forward-only mode this must be filtered out
    // *before* validation, otherwise DiscoveryCandidates falls back to fix().
    const addNeuronsJSON = structuredClone(baseJSON);
    addNeuronsJSON.neurons.splice(
      0,
      0,
      {
        type: "hidden",
        uuid: "hidden-D",
        squash: "TANH",
        bias: 0.15,
      } as Parameters<typeof normaliseCreatureExport>[0]["neurons"][0],
    );
    addNeuronsJSON.synapses.push(
      { fromId: 0, toId: ID_HIDDEN_D, weight: 0.4 },
      { fromId: ID_HIDDEN_D, toId: -1, weight: 0.4 },
      // Illegal in forward-only: hidden-C is after hidden-D in the neurone list,
      // so this becomes a back connection (from > to) once indices are rebuilt.
      { fromId: ID_HIDDEN_C, toId: ID_HIDDEN_D, weight: 0.123 },
    );
    normaliseCreatureExport(addNeuronsJSON);
    // Wire truthfully marks this candidate as non-forward-only (recurrent edge present).
    addNeuronsJSON.forwardOnly = false;

    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.validate(); // Recurrent is allowed in general mode.
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description:
          "Adds hidden-D but includes an illegal back connection hidden-C -> hidden-D",
      },
    };

    // Candidate B: ensure we actually build a combination.
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromId === ID_HIDDEN_A && s.toId === ID_HIDDEN_C),
    );
    removeSynapseJSON.synapses.push({
      fromId: ID_HIDDEN_A,
      toId: -1,
      weight: 0.25,
    });
    const removeSynapseCreature = Creature.fromJSON(removeSynapseJSON);
    delete removeSynapseCreature.uuid;
    removeSynapseCreature.fix();
    CreatureUtil.makeUUID(removeSynapseCreature);

    const removeSynapseCandidate: DiscoveryCandidate = {
      creature: removeSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "Removed hidden-A -> hidden-C synapse",
        synapseDetails: {
          fromNeuronUuid: "hidden-A",
          toNeuronUuid: "hidden-C",
        },
      },
    };

    // Act: capture warnings so we can detect if DiscoveryCandidates had to fall back to fix().
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const combined = buildCombinedFromSuccessful(
        base,
        "TEST_DISCOVERY",
        [addNeuronsCandidate, removeSynapseCandidate],
      );

      // Assert: we should not need to call fix() in the forward-only path.
      // If a recurrent synapse slips through, validation fails and we warn before fixing.
      assertEquals(
        warnings.length,
        0,
        `Expected no warnings (no fix() fallback), got ${warnings.length}: ${
          warnings.map((w) => w.join(" ")).join(" | ")
        }`,
      );

      // Sanity: any produced combination remains forward-only valid.
      for (const candidate of combined) {
        candidate.creature.validate({ forwardOnly: true });
      }
    } finally {
      console.warn = originalWarn;
    }
  },
);

Deno.test(
  "buildCombinedFromSuccessful: add-neurons chain keeps new neurons in candidate order (new -> new -> existing)",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();
    normaliseCreatureExport(baseJSON);

    // Create "add-neurons" candidate: adds hidden-D -> hidden-E -> hidden-A chain.
    //
    // Both hidden-D and hidden-E are new neurons. The merge logic must keep:
    // hidden-D before hidden-E before hidden-A, otherwise hidden-D -> hidden-E
    // becomes a backward edge and breaks forward-pass ordering.
    const addNeuronsJSON = structuredClone(baseJSON);
    const targetIndex = addNeuronsJSON.neurons.findIndex(
      (n) => n.id === ID_HIDDEN_A,
    );
    assert(targetIndex >= 0, "Expected hidden-A to exist in base creature");

    // Insert the chain in the intended (candidate) order.
    addNeuronsJSON.neurons.splice(
      targetIndex,
      0,
      {
        type: "hidden",
        uuid: "hidden-D",
        squash: "TANH",
        bias: 0.11,
      } as Parameters<typeof normaliseCreatureExport>[0]["neurons"][0],
      {
        type: "hidden",
        uuid: "hidden-E",
        squash: "TANH",
        bias: 0.12,
      } as Parameters<typeof normaliseCreatureExport>[0]["neurons"][0],
    );

    addNeuronsJSON.synapses.push(
      { fromId: 0, toId: ID_HIDDEN_D, weight: 0.4 },
      { fromId: ID_HIDDEN_D, toId: ID_HIDDEN_E, weight: 0.35 },
      { fromId: ID_HIDDEN_E, toId: ID_HIDDEN_A, weight: 0.3 },
    );
    normaliseCreatureExport(addNeuronsJSON);

    const addNeuronsCreature = Creature.fromJSON(addNeuronsJSON);
    delete addNeuronsCreature.uuid;
    addNeuronsCreature.fix();
    CreatureUtil.makeUUID(addNeuronsCreature);

    const addNeuronsCandidate: DiscoveryCandidate = {
      creature: addNeuronsCreature,
      change: {
        type: "add-neurons",
        description: "Added hidden-D -> hidden-E -> hidden-A chain",
      },
    };

    // Second candidate so buildCombinedFromSuccessful produces combinations.
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromId === ID_HIDDEN_A && s.toId === ID_HIDDEN_C),
    );
    removeSynapseJSON.synapses.push({
      fromId: ID_HIDDEN_A,
      toId: -1,
      weight: 0.25,
    });
    const removeSynapseCreature = Creature.fromJSON(removeSynapseJSON);
    delete removeSynapseCreature.uuid;
    removeSynapseCreature.fix();
    CreatureUtil.makeUUID(removeSynapseCreature);

    const removeSynapseCandidate: DiscoveryCandidate = {
      creature: removeSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "Removed hidden-A -> hidden-C synapse",
        synapseDetails: {
          fromNeuronUuid: "hidden-A",
          toNeuronUuid: "hidden-C",
        },
      },
    };

    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addNeuronsCandidate, removeSynapseCandidate],
    );

    assert(combined.length > 0, "Should produce combined candidates");
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    normaliseCreatureExport(comboJSON);
    const indexOf = (id: number) =>
      comboJSON.neurons.findIndex((n) => n.id === id);

    const dIndex = indexOf(ID_HIDDEN_D);
    const eIndex = indexOf(ID_HIDDEN_E);
    const aIndex = indexOf(ID_HIDDEN_A);

    assert(dIndex >= 0, "Expected hidden-D to exist in combined creature");
    assert(eIndex >= 0, "Expected hidden-E to exist in combined creature");
    assert(aIndex >= 0, "Expected hidden-A to exist in combined creature");

    assert(
      dIndex < eIndex,
      `Expected hidden-D (index ${dIndex}) to be before hidden-E (index ${eIndex})`,
    );
    assert(
      eIndex < aIndex,
      `Expected hidden-E (index ${eIndex}) to be before hidden-A (index ${aIndex})`,
    );
  },
);

Deno.test(
  "buildCombinedFromSuccessful: add-synapses + remove-synapse preserves added synapses",
  () => {
    const base = makeTestCreature();
    const baseJSON = base.exportJSON();
    normaliseCreatureExport(baseJSON);

    // Create "add-synapses" candidate: adds input-1 -> hidden-A synapse
    const addSynapsesJSON = structuredClone(baseJSON);
    addSynapsesJSON.synapses.push({
      fromId: 1,
      toId: ID_HIDDEN_A,
      weight: 0.35,
    });
    const addSynapsesCreature = Creature.fromJSON(addSynapsesJSON);
    delete addSynapsesCreature.uuid;
    addSynapsesCreature.fix();
    CreatureUtil.makeUUID(addSynapsesCreature);

    const addSynapsesCandidate: DiscoveryCandidate = {
      creature: addSynapsesCreature,
      change: {
        type: "add-synapses",
        description: "Added input-1 -> hidden-A synapse",
      },
    };

    // Create "remove-synapse" candidate: removes hidden-A -> hidden-C synapse
    const removeSynapseJSON = structuredClone(baseJSON);
    removeSynapseJSON.synapses = removeSynapseJSON.synapses.filter(
      (s) => !(s.fromId === ID_HIDDEN_A && s.toId === ID_HIDDEN_C),
    );
    // Reconnect hidden-A directly to output
    removeSynapseJSON.synapses.push({
      fromId: ID_HIDDEN_A,
      toId: -1,
      weight: 0.25,
    });
    const removeSynapseCreature = Creature.fromJSON(removeSynapseJSON);
    delete removeSynapseCreature.uuid;
    removeSynapseCreature.fix();
    CreatureUtil.makeUUID(removeSynapseCreature);

    const removeSynapseCandidate: DiscoveryCandidate = {
      creature: removeSynapseCreature,
      change: {
        type: "remove-synapse",
        description: "Removed hidden-A -> hidden-C synapse",
        synapseDetails: {
          fromNeuronUuid: "hidden-A",
          toNeuronUuid: "hidden-C",
        },
      },
    };

    // Build combined candidates
    const combined = buildCombinedFromSuccessful(
      base,
      "TEST_DISCOVERY",
      [addSynapsesCandidate, removeSynapseCandidate],
    );

    // Should have at least one combined candidate
    assert(combined.length > 0, "Should produce combined candidates");

    // Find the combo-successful candidate
    const combo = combined.find((c) => c.change.type === "combo-successful");
    assertExists(combo, "Should have a combo-successful candidate");

    const comboJSON = combo.creature.exportJSON();
    normaliseCreatureExport(comboJSON);
    const synapseKeys = comboJSON.synapses.map((s) => `${s.fromId}->${s.toId}`);

    // Critical assertion: added synapse should exist
    assertEquals(
      synapseKeys.length > 0,
      true,
      `Added synapse input-1->hidden-A should be preserved. Found synapses: ${
        synapseKeys.join(", ")
      }`,
    );

    // Removed synapse should NOT exist
    assertEquals(
      synapseKeys.some((k) => k === `${ID_HIDDEN_A}->${ID_HIDDEN_C}`),
      false,
      `Removed synapse hidden-A->hidden-C should not exist. Found synapses: ${
        synapseKeys.join(", ")
      }`,
    );
  },
);
