import { assert, assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import {
  isExactBehaviourPreserved,
  measureBehaviourDeviation,
} from "@architecture/BehaviourGuard.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3840: `buildSafeCompact` documents that the creature it returns scores
 * at least as well as the original, because every fold it applies is exact.
 * Nothing checked that, so a fold that changed the outputs shipped a creature
 * whose score had silently fallen.
 *
 * The chain fixture below is a real violation: two chained LOGISTIC neurons are
 * folded into one synapse as though the pair were affine, which drops both the
 * squash and the middle neuron's bias. The safe pass must not return such a
 * creature.
 */

/** input → a (LOGISTIC) → b (LOGISTIC) → output, a shape the chain fold takes. */
function logisticChain(): CreatureExport {
  return {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "chain-a", squash: "LOGISTIC", bias: 0.5 },
      { type: "hidden", uuid: "chain-b", squash: "LOGISTIC", bias: -0.75 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "chain-a", weight: 1.5 },
      { fromUUID: "chain-a", toUUID: "chain-b", weight: 2 },
      { fromUUID: "chain-b", toUUID: "output-0", weight: 1 },
    ],
  };
}

Deno.test("safe compaction never returns a creature that changed behaviour", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON(logisticChain(), false);
  const compacted = compactCreature(creature, false);

  if (compacted) {
    const deviation = measureBehaviourDeviation(creature, compacted);
    assert(
      isExactBehaviourPreserved(deviation),
      `safe compaction changed the outputs: worst delta ${deviation.worstDelta}`,
    );
  }
});

Deno.test("safe compaction still folds an exactly foldable creature", async () => {
  await initWasmForTests();

  // Two chained IDENTITY neurons with zero biases fold exactly, so the guard
  // must let the compaction through — the check rejects defects, not work.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "id-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "id-b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.25 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "id-a", weight: 1.5 },
      { fromUUID: "id-a", toUUID: "id-b", weight: 2 },
      { fromUUID: "id-b", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json, false);
  const compacted = compactCreature(creature, false);

  assert(compacted, "an exact fold must still be accepted");
  const deviation = measureBehaviourDeviation(creature, compacted);
  assert(
    isExactBehaviourPreserved(deviation),
    `accepted compaction changed the outputs: ${deviation.worstDelta}`,
  );
  assert(
    compacted.neurons.length < creature.neurons.length,
    "the fold must actually remove a neuron",
  );
});

Deno.test("safe compaction carries the creature's provenance tags", async () => {
  await initWasmForTests();

  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "id-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "id-b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.25 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "id-a", weight: 1.5 },
      { fromUUID: "id-a", toUUID: "id-b", weight: 2 },
      { fromUUID: "id-b", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json, false);
  addTag(creature, "trainID", "T-3840");
  addTag(creature, "error", "0.6310");

  const compacted = compactCreature(creature, false);
  assert(compacted, "the fixture must compact");

  assertEquals(
    getTag(compacted, "trainID"),
    "T-3840",
    "provenance must survive compaction",
  );
  assertEquals(
    getTag(compacted, "error"),
    "0.6310",
    "the source error must survive compaction",
  );
  assertEquals(
    getTag(compacted, "approach"),
    "compact",
    "the pass must still name itself",
  );
});
