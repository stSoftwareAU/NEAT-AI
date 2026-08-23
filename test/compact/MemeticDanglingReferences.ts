/**
 * Issue #3844 — the property that has to hold everywhere: **after any pass that
 * changed the neuron or synapse count, every key still in `memetic` resolves to
 * structure the creature still carries.**
 *
 * The rule is *no dangling references*, not *no memetic*. Dropping the record
 * satisfies it (that is what the compaction family does) and so does keeping a
 * record whose every key resolves. What must never happen is structure being
 * removed while the record still points at it — the Rust reader fails loud on
 * one, and `MemeticWireExport.canonicalBiases` will happily put a stale runtime
 * integer key on the wire (`next[wireKey ?? k]`).
 *
 * The sweep runs the compaction/simplification family, the discovery removals,
 * and `restoreSource` over one fixture, and asserts the property on each. The
 * compaction family is included to prove it *stays* correct, not because it was
 * ever suspect.
 */
import { assert, assertEquals } from "@std/assert";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { cleanupOrphanedNeurons } from "@compact/OrphanedNeuronCleanup.ts";
import {
  mergeDuplicateSynapses,
  pruneZeroWeightSynapses,
} from "@compact/SynapsePruning.ts";
import { pruneDeadSubgraphs } from "@compact/DeadSubgraphPruning.ts";
import { aggressivePrune } from "@compact/AggressivePrune.ts";
import { foldConstants } from "@compact/ConstantFold.ts";
import { mergeRedundantConstants } from "@compact/ConstantMerge.ts";
import { collapseConstantIf } from "@compact/IfCollapse.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import { simplify } from "@optimize/Simplify.ts";
import { removeLowImpactNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import { restoreSource } from "@blackbox/RestoreSource.ts";
import { danglingMemeticReferences } from "../_memeticReferences.ts";

/**
 * One fixture carrying every shape a pass might act on: an orphan hidden
 * neuron, a zero-weight synapse, a duplicate synapse, a constant, and a memetic
 * record with an `ancestry[]` snapshot.
 */
function fixtureExport(): CreatureExport {
  return {
    input: 3,
    output: 1,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "IDENTITY", bias: 0.1 },
      { uuid: "hidden-1", type: "hidden", squash: "IDENTITY", bias: 0.2 },
      // hidden-2 has no outward edge — the orphan.
      { uuid: "hidden-2", type: "hidden", squash: "IDENTITY", bias: 0.3 },
      { uuid: "const-0", type: "constant", bias: 1 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "input-2", toUUID: "hidden-2", weight: 0.4 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0 },
      { fromUUID: "const-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.05 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.06 },
    ],
    memetic: {
      generation: 4,
      score: -0.2,
      biases: { "hidden-0": 0.1, "hidden-1": 0.2, "hidden-2": 0.3 },
      weights: [
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0 },
        { fromUUID: "input-2", toUUID: "hidden-2", weight: 0.4 },
        { fromUUID: "const-0", toUUID: "output-0", weight: 0.5 },
      ],
      ancestry: [{
        generation: 3,
        score: -0.3,
        biases: { "hidden-0": 0.11, "hidden-2": 0.31 },
        weights: [{ fromUUID: "input-2", toUUID: "hidden-2", weight: 0.41 }],
      }],
    },
  } as unknown as CreatureExport;
}

/**
 * The same shape as a live `Creature`: the duplicate synapse and the orphan
 * hidden neuron are dropped, since neither survives construction — they exist
 * in the export fixture only to provoke the export-level passes.
 */
function fixtureCreature(): Creature {
  const json = fixtureExport();
  json.neurons = json.neurons.filter((n) => n.uuid !== "hidden-2");
  json.synapses = json.synapses.filter((s, i) =>
    i !== 7 && s.toUUID !== "hidden-2"
  );
  return Creature.fromJSON(json);
}

/** A neuron id no fixture here carries. */
const GHOST_NEURON_ID = 987654321;

/**
 * A creature whose ancestor snapshot is keyed by a **runtime integer** for a
 * neuron that is gone. Wire labels that fail to resolve are dropped on import
 * by `NormaliseCreatureExport.convertMapKeys`; a stale integer is copied
 * through as "already a numeric key", so this is the shape that can actually
 * reach the wire.
 */
function creatureWithStaleAncestry(): Creature {
  const creature = fixtureCreature();
  const idOf = (uuid: string) => {
    const neuron = creature.neurons.find((n) => n.uuid === uuid);
    assert(neuron, `fixture must carry ${uuid}`);
    return neuron.id;
  };
  creature.memetic = {
    generation: 4,
    score: -0.2,
    biases: { [idOf("hidden-0")]: 0.1 },
    weights: {
      [idOf("hidden-0")]: [{ toId: idOf("output-0"), weight: 0.25 }],
    },
    ancestry: [{
      generation: 3,
      score: -0.3,
      biases: { [GHOST_NEURON_ID]: 0.7, [idOf("hidden-0")]: 0.11 },
      weights: {
        [GHOST_NEURON_ID]: [{ toId: idOf("output-0"), weight: 0.12 }],
      },
    }],
  };
  return creature;
}

/** A pass that mutates a `CreatureExport` in place. */
const exportPasses: Array<[string, (e: CreatureExport) => void]> = [
  ["cleanupOrphanedNeurons", (e) => void cleanupOrphanedNeurons(e)],
  ["pruneZeroWeightSynapses", (e) => void pruneZeroWeightSynapses(e)],
  ["mergeDuplicateSynapses", (e) => void mergeDuplicateSynapses(e)],
  ["pruneDeadSubgraphs", (e) => void pruneDeadSubgraphs(e)],
  ["aggressivePrune", (e) => void aggressivePrune(e)],
  ["foldConstants", (e) => void foldConstants(e)],
  ["mergeRedundantConstants", (e) => void mergeRedundantConstants(e)],
  ["collapseConstantIf", (e) => void collapseConstantIf(e)],
];

Deno.test(
  "Issue #3844: no compaction pass leaves a dangling memetic reference",
  () => {
    const changed: string[] = [];
    for (const [name, run] of exportPasses) {
      const exported = fixtureExport();
      const neurons = exported.neurons.length;
      const synapses = exported.synapses.length;

      run(exported);

      if (
        exported.neurons.length !== neurons ||
        exported.synapses.length !== synapses
      ) {
        changed.push(name);
      }

      const dangling = danglingMemeticReferences(exported);
      assertEquals(
        dangling,
        [],
        `${name}: memetic must not name removed structure — ${
          dangling.join("; ")
        }`,
      );
    }

    // Guards the sweep against going vacuous: if the fixture stops provoking
    // these passes the property above proves nothing.
    for (
      const expected of [
        "cleanupOrphanedNeurons",
        "pruneZeroWeightSynapses",
        "mergeDuplicateSynapses",
        "pruneDeadSubgraphs",
        "foldConstants",
      ]
    ) {
      assert(
        changed.includes(expected),
        `fixture must still provoke ${expected} — changed: ${
          changed.join(",")
        }`,
      );
    }
  },
);

Deno.test(
  "Issue #3844: no creature-level pass leaves a dangling memetic reference",
  () => {
    const cases: Array<[string, () => Creature | undefined]> = [
      ["compactCreature", () => compactCreature(fixtureCreature(), false)],
      ["simplify", () => simplify(fixtureCreature())],
      [
        "removeLowImpactNeuron",
        () =>
          removeLowImpactNeuron("issue-3844", fixtureCreature(), {
            neuronUuid: "hidden-0",
            totalError: 1,
            impact: 0.001,
            reason: "issue-3844",
            meanActivation: 0.1,
          }),
      ],
      ["restoreSource", () => restoreSource(fixtureCreature())],
      [
        "restoreSource (stale ancestry)",
        () => restoreSource(creatureWithStaleAncestry()),
      ],
    ];

    let anyChanged = false;
    for (const [name, run] of cases) {
      const before = fixtureCreature();
      const after = run();
      if (!after) continue;

      if (
        after.neurons.length !== before.neurons.length ||
        after.synapses.length !== before.synapses.length
      ) {
        anyChanged = true;
      }

      const dangling = danglingMemeticReferences(after.exportJSON());
      assertEquals(
        dangling,
        [],
        `${name}: memetic must not name removed structure — ${
          dangling.join("; ")
        }`,
      );
    }

    assert(
      anyChanged,
      "at least one creature-level pass must change structure",
    );
  },
);

Deno.test(
  "Issue #3844: a tags-only change leaves memetic and uuid untouched",
  () => {
    // The creature hash covers neurons, synapses, weights, biases, squash and
    // synapse type — not tags. So a pass that only writes tags has changed no
    // structure, and clearing memetic (or uuid) there would throw away valid
    // fine-tuning history for nothing.
    const creature = fixtureCreature();
    const uuid = CreatureUtil.makeUUID(creature);
    assert(creature.memetic, "fixture must carry memetic");
    const memeticBefore = JSON.stringify(creature.memetic);

    addTag(creature, "approach", "compact");
    addTag(creature, "Discovery", "tags only — no structural change");
    removeTag(creature, "approach-logged");

    assertEquals(
      JSON.stringify(creature.memetic),
      memeticBefore,
      "a tags-only change must not touch memetic",
    );
    assertEquals(
      creature.uuid,
      uuid,
      "a tags-only change must not invalidate the creature uuid",
    );
    assertEquals(
      CreatureUtil.makeUUID(creature),
      uuid,
      "tags must not enter the creature hash",
    );
    assertEquals(danglingMemeticReferences(creature.exportJSON()), []);
  },
);
