/**
 * Issue #3844 — `restoreSource` changes structure, so it must not hand back a
 * creature whose `memetic` still names structure that is not there.
 *
 * `restoreSource` rebuilds a creature from its memetic snapshot: it rewrites
 * biases, rewrites weights, and **re-adds synapses the record names but the
 * live creature no longer carries** (`RestoreSource.ts` pushes onto
 * `restoredCreature.synapses`). It then hands the whole memetic record —
 * including every `ancestry[]` snapshot — to the restored creature untouched.
 *
 * The top-level snapshot is safe by construction: the bias and weight loops
 * bail out (`return undefined`) the moment a key fails to resolve. `ancestry[]`
 * gets no such check, and `memeticUpdate` propagates that subtree to offspring
 * **by reference, never touched** (`MemeticUpdate.ts`), so an ancestor snapshot
 * routinely outlives the neurons it was keyed to.
 *
 * A stale *runtime integer* key then survives every hop: `convertMapKeys`
 * copies it through as "already a numeric key", and `canonicalBiases` writes
 * `next[wireKey ?? k]` — the raw id — onto the wire, where the Rust reader
 * fails loud.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { restoreSource } from "@blackbox/RestoreSource.ts";
import { danglingMemeticReferences } from "../_memeticReferences.ts";

/** A neuron id that no creature in this file carries. */
const GHOST_NEURON_ID = 987654321;

function baseExport(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "IDENTITY", bias: 0.1 },
      { uuid: "hidden-1", type: "hidden", squash: "IDENTITY", bias: 0.2 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.35 },
    ],
  };
}

function idOf(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron, `fixture must carry ${uuid}`);
  return neuron.id;
}

/**
 * A creature whose restore genuinely changes structure — the record names
 * `input-1 -> hidden-0`, which the live creature does not have, so
 * `restoreSource` re-adds it — while an ancestor snapshot still points at a
 * neuron that is long gone.
 */
function creatureWithStaleAncestry(): Creature {
  const creature = Creature.fromJSON(baseExport());
  creature.score = -0.1;
  creature.memetic = {
    generation: 4,
    score: -0.4,
    biases: { [idOf(creature, "hidden-0")]: 0.9 },
    weights: {
      // input-1 (runtime id 1) -> hidden-0: absent from the live creature.
      1: [{ toId: idOf(creature, "hidden-0"), weight: 0.42 }],
    },
    ancestry: [
      {
        generation: 3,
        score: -0.5,
        biases: {
          [GHOST_NEURON_ID]: 0.7,
          [idOf(creature, "hidden-1")]: 0.21,
        },
        weights: {
          [GHOST_NEURON_ID]: [
            { toId: idOf(creature, "output-0"), weight: 0.11 },
          ],
          [idOf(creature, "hidden-1")]: [
            { toId: idOf(creature, "output-0"), weight: 0.34 },
          ],
        },
      },
    ],
  };
  return creature;
}

Deno.test(
  "Issue #3844: restoreSource must not carry memetic references to structure that is gone",
  () => {
    const creature = creatureWithStaleAncestry();
    const beforeSynapses = creature.synapses.length;

    const restored = restoreSource(creature);
    assert(restored, "restoreSource must produce a creature for this fixture");

    // The restore is a structural change: it re-adds the synapse the record
    // names. Without this the test would prove nothing about removals.
    assertEquals(
      restored.synapses.length,
      beforeSynapses + 1,
      "fixture must exercise a restore that changes structure",
    );

    const dangling = danglingMemeticReferences(restored.exportJSON());
    assertEquals(
      dangling,
      [],
      `restored creature must carry no dangling memetic key — ${
        dangling.join("; ")
      }`,
    );
  },
);

Deno.test(
  "Issue #3844: restoreSource prunes only the dangling memetic keys, keeping valid deltas",
  () => {
    const creature = creatureWithStaleAncestry();
    const restored = restoreSource(creature);
    assert(restored, "restoreSource must produce a creature for this fixture");

    const memetic = restored.exportJSON().memetic;
    assert(memetic, "a prune must not throw the whole record away");
    assertEquals(memetic.generation, 4);
    assertAlmostEquals(memetic.score, -0.4);

    // The top-level deltas are all still valid and must survive untouched.
    const biases = memetic.biases as unknown as Record<string, number>;
    assertAlmostEquals(biases["hidden-0"], 0.9);

    const weights = memetic.weights as unknown as Array<
      { fromUUID: string; toUUID: string; weight: number }
    >;
    assert(
      weights.some((row) =>
        row.fromUUID === "input-1" && row.toUUID === "hidden-0"
      ),
      "the re-added synapse's delta must be kept",
    );

    // The ancestor snapshot keeps the neuron that is still there and loses only
    // the one that is not.
    const ancestry = (memetic as unknown as {
      ancestry?: Array<{ biases: Record<string, number> }>;
    }).ancestry;
    assert(ancestry && ancestry.length === 1, "ancestry must be kept");
    assertAlmostEquals(ancestry[0].biases["hidden-1"], 0.21);
    assertEquals(
      Object.keys(ancestry[0].biases).includes(`${GHOST_NEURON_ID}`),
      false,
      "the stale ancestor key must be gone",
    );
  },
);

Deno.test(
  "Issue #3844: a clean restore leaves every memetic delta intact",
  () => {
    const creature = Creature.fromJSON(baseExport());
    creature.score = -0.1;
    creature.memetic = {
      generation: 2,
      score: -0.3,
      biases: {
        [idOf(creature, "hidden-0")]: 0.15,
        [idOf(creature, "hidden-1")]: 0.25,
      },
      weights: {
        [idOf(creature, "hidden-0")]: [
          { toId: idOf(creature, "output-0"), weight: 0.26 },
        ],
      },
    };

    const restored = restoreSource(creature);
    assert(restored);

    assertEquals(danglingMemeticReferences(restored.exportJSON()), []);

    const memetic = restored.exportJSON().memetic;
    assert(memetic);
    const biases = memetic.biases as unknown as Record<string, number>;
    assertAlmostEquals(biases["hidden-0"], 0.15);
    assertAlmostEquals(biases["hidden-1"], 0.25);
    const weights = memetic.weights as unknown as Array<
      { fromUUID: string; toUUID: string; weight: number }
    >;
    assertEquals(weights.length, 1);
    assertAlmostEquals(weights[0].weight, 0.26);
  },
);
