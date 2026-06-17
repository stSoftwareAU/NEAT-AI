import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  AGGRESSIVE_PRUNE_WEIGHT_THRESHOLD,
  aggressivePrune,
} from "@compact/AggressivePrune.ts";
import {
  compactCreature,
  compactCreatureVariants,
} from "@compact/CompactCreature.ts";
import { selectCompactVariant } from "@compact/CompactVariants.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #3038: the aggressive compaction variant speculatively prunes
// low-impact structure (small-magnitude synapse weights) — including synapses
// feeding aggregate consumers (MAXIMUM/MINIMUM/HYPOT) that the exact/safe pass
// must leave untouched. It is judged purely structurally (no training data), is
// built on top of the safe floor, and is returned as a score-gated candidate.

const TINY = AGGRESSIVE_PRUNE_WEIGHT_THRESHOLD / 1000; // safely low-impact

Deno.test(
  "aggressivePrune drops a low-impact synapse feeding a MAXIMUM aggregate",
  () => {
    const exp: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", bias: 0, squash: "MAXIMUM" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 1.5 },
        { fromUUID: "input-1", toUUID: "output-0", weight: TINY },
      ],
    } as unknown as CreatureExport;

    const result = aggressivePrune(exp);

    assert(result.changed, "a low-impact synapse should be pruned");
    assertEquals(result.removedSynapses, 1);
    assertEquals(exp.synapses.length, 1, "only the strong synapse remains");
    assert(
      Math.abs(exp.synapses[0].weight) >= AGGRESSIVE_PRUNE_WEIGHT_THRESHOLD,
      "the retained synapse is the high-impact one",
    );
  },
);

Deno.test("aggressivePrune never touches a frozen low-impact synapse", () => {
  const exp: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: TINY, frozen: true },
    ],
  } as unknown as CreatureExport;

  const result = aggressivePrune(exp);

  assertEquals(result.changed, false, "frozen synapse must be preserved");
  assertEquals(exp.synapses.length, 2);
});

Deno.test("aggressivePrune keeps an output's last inbound edge", () => {
  // Both inbound edges are low-impact: one must survive for structural validity.
  const exp: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: TINY },
      { fromUUID: "input-1", toUUID: "output-0", weight: TINY },
    ],
  } as unknown as CreatureExport;

  const result = aggressivePrune(exp);

  assertEquals(result.removedSynapses, 1, "exactly one low-impact edge pruned");
  assertEquals(exp.synapses.length, 1, "output keeps a last inbound edge");
});

/**
 * A creature whose safe pass folds an exactly-zero synapse (so a safe variant
 * exists) while retaining a low-impact synapse feeding a MAXIMUM aggregate that
 * only the aggressive pass can prune.
 */
function aggressivelyPrunableCreature(): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", bias: 0, squash: "MAXIMUM" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0 }, // safe prunes
      { fromUUID: "input-2", toUUID: "output-0", weight: TINY }, // aggressive prunes
    ],
  } as unknown as CreatureExport;
  return Creature.fromJSON(json, false);
}

Deno.test(
  "compactCreatureVariants: aggressive prunes a synapse the safe variant keeps",
  async () => {
    await initWasmForTests();

    const variants = compactCreatureVariants(
      aggressivelyPrunableCreature(),
      false,
    );

    assert(variants.safe !== undefined, "safe candidate should exist");
    assert(variants.aggressive !== undefined, "aggressive candidate exists");

    const safeSynapses = variants.safe!.exportJSON().synapses.length;
    const aggressiveSynapses =
      variants.aggressive!.exportJSON().synapses.length;

    assert(
      aggressiveSynapses < safeSynapses,
      `aggressive (${aggressiveSynapses}) should drop the low-impact synapse the safe variant keeps (${safeSynapses})`,
    );

    // Distinct structure → distinct UUID so selection can score it.
    assert(
      CreatureUtil.makeUUID(variants.safe!) !==
        CreatureUtil.makeUUID(variants.aggressive!),
      "a real prune yields a distinct aggressive candidate",
    );
  },
);

Deno.test(
  "compactCreatureVariants: the safe variant is unchanged by the aggressive pass",
  async () => {
    await initWasmForTests();

    const safeOnly = compactCreature(aggressivelyPrunableCreature(), false);
    const variants = compactCreatureVariants(
      aggressivelyPrunableCreature(),
      false,
    );

    assert(safeOnly !== undefined, "safe-only compaction should occur");
    assertEquals(
      CreatureUtil.makeUUID(variants.safe!),
      CreatureUtil.makeUUID(safeOnly!),
      "the safe floor is identical with or without the aggressive pass",
    );
  },
);

Deno.test(
  "compactCreatureVariants: a harmful aggressive prune is rejected by selection",
  async () => {
    await initWasmForTests();

    const variants = compactCreatureVariants(
      aggressivelyPrunableCreature(),
      false,
    );

    // Construct the prune to hurt the score: the safe floor scores higher.
    variants.safe!.score = 10;
    variants.aggressive!.score = 5;

    assertEquals(
      selectCompactVariant(variants),
      variants.safe,
      "score-gated selection falls back to the safe floor",
    );
  },
);

Deno.test(
  "compactCreatureVariants: aggressive equals safe when nothing is low-impact",
  async () => {
    await initWasmForTests();

    // A creature that compacts safely but has no low-impact (tiny) weights.
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", bias: 0, squash: "MAXIMUM" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 2.0 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 0 }, // safe prunes
      ],
    } as unknown as CreatureExport;

    const variants = compactCreatureVariants(
      Creature.fromJSON(json, false),
      false,
    );

    assert(variants.safe !== undefined, "safe candidate should exist");
    assertEquals(
      CreatureUtil.makeUUID(variants.safe!),
      CreatureUtil.makeUUID(variants.aggressive!),
      "with no low-impact structure the variants dedupe to one",
    );
  },
);
