/**
 * Issue #4185: an Intelligent Design squash substitution that takes an `IF`
 * neuron to another squash must clear the roles on that neuron's inward
 * synapses, through every entry point that writes a squash.
 *
 * `combineImprovements` and `applyNeuronChanges` are driven with combined
 * substitutions. `Creature.prototype.scoreDir` is stubbed so no dataset is
 * needed, following `TacitKnowledgeApplyNeuronChanges.ts`.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type {
  CreatureExport,
  CreatureInternal,
} from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Creature } from "@creature";
import {
  applyNeuronChanges,
  makeModifiedCreature,
} from "@intelligentDesign/TacitKnowledge.ts";
import {
  combineImprovements,
  makeModifiedCreatureWithPrevious,
} from "@intelligentDesign/ImproveSquash.ts";
import type { BestNeuronSquash } from "@intelligentDesign/BestNeuronSquash.ts";

/**
 * Hidden `IF` neurons `if-a` (3) and `if-b` (4), plus a hidden `TANH` neuron
 * `tanh-c` (5) that a combined change can touch without touching `if-b`.
 *
 * `if-a` takes two roles from input 1, and `if-b` is fed by `if-a` as a
 * `positive` source.
 */
const idFixture: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    { type: "input", squash: "LOGISTIC", index: 2 },
    {
      type: "hidden",
      squash: "IF",
      index: 3,
      bias: 0.1,
      uuid: "if-a",
      tags: [{ name: "neuron-tag", value: "kept" }],
    },
    { type: "hidden", squash: "IF", index: 4, bias: 0.2, uuid: "if-b" },
    { type: "hidden", squash: "TANH", index: 5, bias: 0, uuid: "tanh-c" },
    { type: "output", squash: "LOGISTIC", index: 6, bias: 0 },
  ],
  synapses: [
    {
      from: 0,
      to: 3,
      weight: 0.5,
      type: "condition",
      tags: [{ name: "keep", value: "me" }],
    },
    { from: 0, to: 4, weight: 0.3, type: "condition" },
    { from: 1, to: 3, weight: 0.25, type: "negative" },
    { from: 1, to: 3, weight: 0.6, type: "positive" },
    { from: 1, to: 4, weight: 0.4, type: "negative" },
    { from: 2, to: 3, weight: 0.7, type: "negative" },
    { from: 2, to: 5, weight: 0.5 },
    { from: 3, to: 4, weight: 0.8, type: "positive" },
    { from: 4, to: 6, weight: 0.9 },
    { from: 5, to: 6, weight: 0.6 },
  ],
  input: 3,
  output: 1,
};

/** A fresh export of the fixture, normalised as the ID callers do. */
function exportOf(): CreatureExport {
  const exported = Creature.fromJSON(idFixture).exportJSON();
  normaliseCreatureExport(exported);
  return exported;
}

/** The inward rows of `toUUID` as sorted `from:role` strings. */
function inwardRoles(exported: CreatureExport, toUUID: string): string[] {
  return exported.synapses
    .filter((s) => s.toUUID === toUUID)
    .map((s) => `${s.fromUUID}:${s.type ?? "untyped"}`)
    .sort();
}

/** The flattened inward rows of `if-a` once its roles are gone. */
const IF_A_FLATTENED = [
  "input-0:untyped",
  "input-1:untyped",
  "input-2:untyped",
];

/** The inward rows of `if-b` while it stays `IF`. */
const IF_B_ROLES = ["if-a:positive", "input-0:condition", "input-1:negative"];

/** Assert the shape a combined or single substitution must hand back. */
function assertIfAFlattenedAndIfBKept(exported: CreatureExport): void {
  assertEquals(inwardRoles(exported, "if-a"), IF_A_FLATTENED);
  assertEquals(inwardRoles(exported, "if-b"), IF_B_ROLES);

  const from0 = exported.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "if-a"
  );
  assert(from0, "input-0 -> if-a row missing");
  assertAlmostEquals(from0.weight, 0.5);
  assertEquals(from0.tags, [{ name: "keep", value: "me" }]);

  const from1 = exported.synapses.find((s) =>
    s.fromUUID === "input-1" && s.toUUID === "if-a"
  );
  assert(from1, "input-1 -> if-a row missing");
  assertAlmostEquals(from1.weight, 0.85);

  const ab = exported.synapses.find((s) =>
    s.fromUUID === "if-a" && s.toUUID === "if-b"
  );
  assert(ab, "if-a -> if-b row missing");
  assertAlmostEquals(ab.weight, 0.8);
}

Deno.test("makeModifiedCreature: IF -> RELU clears inward roles (Issue #4185)", () => {
  const creature = makeModifiedCreature("if-a", exportOf(), "RELU");
  creatureValidate(creature);

  const exported = creature.exportJSON();
  assertEquals(inwardRoles(exported, "if-a"), IF_A_FLATTENED);
  assertEquals(inwardRoles(exported, "if-b"), IF_B_ROLES);
  creatureValidate(Creature.fromJSON(exported));
});

Deno.test("makeModifiedCreatureWithPrevious: IF -> RELU clears inward roles (Issue #4185)", () => {
  const { creature, previousSquash } = makeModifiedCreatureWithPrevious(
    "if-a",
    exportOf(),
    "RELU",
  );
  assertEquals(previousSquash, "IF");
  creatureValidate(creature);

  const exported = creature.exportJSON();
  assertEquals(inwardRoles(exported, "if-a"), IF_A_FLATTENED);
  assertEquals(inwardRoles(exported, "if-b"), IF_B_ROLES);
  creatureValidate(Creature.fromJSON(exported));
});

Deno.test("applyNeuronChanges: IF -> RELU with a change that leaves if-b IF (Issue #4185)", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  try {
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 9.9, error: 0.01 } as const);
    };

    const neuronSquashMap = new Map<
      string,
      { squash: string; score: number; error: number }
    >();
    neuronSquashMap.set("if-a", { squash: "RELU", score: 2, error: 1 });
    neuronSquashMap.set("tanh-c", { squash: "RELU", score: 2, error: 1 });

    const result = await applyNeuronChanges(
      exportOf(),
      neuronSquashMap,
      ".",
      {},
    );
    assertIfAFlattenedAndIfBKept(result.creature);
    creatureValidate(Creature.fromJSON(result.creature));
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
  }
});

Deno.test("applyNeuronChanges: IF -> RELU and IF -> TANH clear both targets (Issue #4185)", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  try {
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 9.9, error: 0.01 } as const);
    };

    const neuronSquashMap = new Map<
      string,
      { squash: string; score: number; error: number }
    >();
    neuronSquashMap.set("if-a", { squash: "RELU", score: 2, error: 1 });
    neuronSquashMap.set("if-b", { squash: "TANH", score: 2, error: 1 });

    const result = await applyNeuronChanges(
      exportOf(),
      neuronSquashMap,
      ".",
      {},
    );
    assertEquals(inwardRoles(result.creature, "if-a"), IF_A_FLATTENED);
    assertEquals(inwardRoles(result.creature, "if-b"), [
      "if-a:untyped",
      "input-0:untyped",
      "input-1:untyped",
    ]);
    const ab = result.creature.synapses.find((s) =>
      s.fromUUID === "if-a" && s.toUUID === "if-b"
    );
    assertEquals(ab?.type, undefined);
    creatureValidate(Creature.fromJSON(result.creature));
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
  }
});

Deno.test("combineImprovements: IF -> RELU with a change that leaves if-b IF (Issue #4185)", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  try {
    // The combined score must beat every individual improvement so the
    // combined export is the one returned.
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 5, error: 0.01 } as const);
    };

    const improvements = new Map<string, BestNeuronSquash>([
      ["if-a", {
        squash: "RELU",
        score: 1,
        path: "unused-if-a.json",
        message: "if-a",
      }],
      ["tanh-c", {
        squash: "RELU",
        score: 1.1,
        path: "unused-tanh-c.json",
        message: "tanh-c",
      }],
    ]);

    const { creature } = await combineImprovements(
      exportOf(),
      improvements,
      ".",
      1,
    );
    assertIfAFlattenedAndIfBKept(creature);
    creatureValidate(Creature.fromJSON(creature));
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
  }
});

Deno.test("combineImprovements: IF -> RELU and IF -> TANH clear both targets (Issue #4185)", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  try {
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 5, error: 0.01 } as const);
    };

    const improvements = new Map<string, BestNeuronSquash>([
      ["if-a", {
        squash: "RELU",
        score: 1,
        path: "unused-if-a.json",
        message: "if-a",
      }],
      ["if-b", {
        squash: "TANH",
        score: 1.1,
        path: "unused-if-b.json",
        message: "if-b",
      }],
    ]);

    const { creature } = await combineImprovements(
      exportOf(),
      improvements,
      ".",
      1,
    );
    assertEquals(inwardRoles(creature, "if-a"), IF_A_FLATTENED);
    assertEquals(inwardRoles(creature, "if-b"), [
      "if-a:untyped",
      "input-0:untyped",
      "input-1:untyped",
    ]);
    creatureValidate(Creature.fromJSON(creature));
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
  }
});
