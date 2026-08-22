/**
 * An Intelligent Design squash substitution must never produce a creature this
 * library's own validator refuses (Issue #3827).
 *
 * GRQ-13 handed an ID worker the same 5,050-neuron creature twice, three
 * minutes apart, and it died both times before scoring anything:
 *
 *     ValidationError: -1) 'IF' should have at least 3 inward connections was: 2
 *         at CreatureValidate.ts:165:15
 *         at creatureValidate (…/CreatureValidate.ts:85:20)
 *         at validateOrDiagnose (…/utils/Diagnostics.ts:161:14)
 *         at WorkerProcessor.process (…/intelligentDesign/workers/WorkerProcessor.ts:50:7)
 *
 * The two creature dumps were byte-identical (3,527,220 bytes each), so this
 * was one creature failing repeatedly — a producer/validator disagreement, not
 * an unlucky candidate. A substitution changes only `squash`; it cannot add the
 * three inward connections, nor the `condition` / `positive` / `negative`
 * synapse roles, that `CreatureValidate` demands of an `IF` neuron. `IF` is in
 * the substitution table on purpose (it was added with `MINIMUM` /
 * `MAXIMUM` for the tree/branching teams), so the fix is to skip the neurons
 * that cannot carry it.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { makeModifiedCreatureWithPrevious } from "@intelligentDesign/ImproveSquash.ts";
import { makeModifiedCreature } from "@intelligentDesign/TacitKnowledge.ts";
import {
  canAdoptSquash,
  squashSubstitutionBlockedReason,
} from "@intelligentDesign/SquashSubstitutionEligibility.ts";

/**
 * The GRQ-13 shape: a hidden neuron with exactly two inward connections.
 *
 * Three inputs, so the hidden neuron sits at index 3 — `CreatureValidate`
 * only applies the IF rule for `indx > 2`, and a fixture that sat at index 2
 * would pass validation for the wrong reason.
 */
const twoInwardJson: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    { type: "input", squash: "LOGISTIC", index: 2 },
    { type: "hidden", squash: "TANH", index: 3, bias: 0, uuid: "hidden-2in" },
    { type: "output", squash: "LOGISTIC", index: 4, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 3, weight: 0.5 },
    { from: 1, to: 3, weight: 0.5 },
    { from: 2, to: 4, weight: 0.5 },
    { from: 3, to: 4, weight: 0.5 },
  ],
  input: 3,
  output: 1,
};

/** Three inward connections, but every one of them an untyped (positive) edge. */
const threeInwardNoRolesJson: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    { type: "input", squash: "LOGISTIC", index: 2 },
    { type: "hidden", squash: "TANH", index: 3, bias: 0, uuid: "hidden-3in" },
    { type: "output", squash: "LOGISTIC", index: 4, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 3, weight: 0.5 },
    { from: 1, to: 3, weight: 0.5 },
    { from: 2, to: 3, weight: 0.5 },
    { from: 3, to: 4, weight: 0.5 },
  ],
  input: 3,
  output: 1,
};

/** Three inward connections carrying all three roles — a legitimate IF. */
const threeInwardWithRolesJson: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    { type: "input", squash: "LOGISTIC", index: 2 },
    { type: "hidden", squash: "IF", index: 3, bias: 0, uuid: "hidden-roles" },
    { type: "output", squash: "LOGISTIC", index: 4, bias: 0 },
  ],
  synapses: [
    { from: 0, to: 3, weight: 0.5, type: "condition" },
    { from: 1, to: 3, weight: 0.5, type: "positive" },
    { from: 2, to: 3, weight: 0.5, type: "negative" },
    { from: 3, to: 4, weight: 0.5 },
  ],
  input: 3,
  output: 1,
};

function exportOf(json: CreatureInternal) {
  return Creature.fromJSON(json).exportJSON();
}

Deno.test("the reported creature really is what the validator refuses (Issue #3827)", () => {
  // Build by hand exactly what an unguarded substitution used to hand the
  // worker, and confirm the validator's verdict — otherwise the guard below
  // could be protecting against nothing.
  const exported = exportOf(twoInwardJson);
  const neuron = exported.neurons.find((n) => n.uuid === "hidden-2in");
  assert(neuron, "fixture neuron missing");
  neuron.squash = "IF";

  const error = assertThrows(
    () => creatureValidate(Creature.fromJSON(exported)),
    ValidationError,
  ) as ValidationError;

  assert(
    error.message.includes("'IF' should have at least 3 inward connections"),
    `unexpected validator message: ${error.message}`,
  );
  assert(
    error.message.includes("was: 2"),
    `the fixture should reproduce the GRQ-13 count: ${error.message}`,
  );
});

Deno.test("a two-inward neuron cannot adopt IF, and the reason says why (Issue #3827)", () => {
  const exported = exportOf(twoInwardJson);

  const reason = squashSubstitutionBlockedReason(exported, "hidden-2in", "IF");
  assert(reason, "a two-inward neuron must be blocked from adopting IF");
  assert(
    reason.includes("at least 3 inward connections"),
    `the reason should name the rule: ${reason}`,
  );
  assert(
    reason.includes("has 2"),
    `the reason should name the actual count: ${reason}`,
  );
  assertEquals(canAdoptSquash(exported, "hidden-2in", "IF"), false);
});

Deno.test("three inward connections are not enough without the roles (Issue #3827)", () => {
  const exported = exportOf(threeInwardNoRolesJson);

  const reason = squashSubstitutionBlockedReason(exported, "hidden-3in", "IF");
  assert(reason, "an IF needs condition/positive/negative, not just a count");
  assert(
    reason.includes("condition") && reason.includes("negative"),
    `the reason should name the missing roles: ${reason}`,
  );

  // …and the validator agrees, which is the whole point of the gate.
  const neuron = exported.neurons.find((n) => n.uuid === "hidden-3in");
  assert(neuron);
  neuron.squash = "IF";
  assertThrows(
    () => creatureValidate(Creature.fromJSON(exported)),
    ValidationError,
  );
});

Deno.test("a neuron that already satisfies the IF rule is not blocked (Issue #3827)", () => {
  const exported = exportOf(threeInwardWithRolesJson);

  assertEquals(
    squashSubstitutionBlockedReason(exported, "hidden-roles", "IF"),
    undefined,
  );
  assertEquals(canAdoptSquash(exported, "hidden-roles", "IF"), true);

  // The gate is about IF's structural rule only — ordinary squashes on any
  // neuron stay eligible, including the two-inward one.
  const twoInward = exportOf(twoInwardJson);
  for (const squash of ["TANH", "GELU", "Mish", "MINIMUM", "MAXIMUM"]) {
    assertEquals(
      canAdoptSquash(twoInward, "hidden-2in", squash),
      true,
      `${squash} should not be gated`,
    );
  }
});

Deno.test("the substitution builders refuse to produce the invalid creature (Issue #3827)", () => {
  const exported = exportOf(twoInwardJson);

  for (
    const [name, build] of [
      [
        "makeModifiedCreatureWithPrevious",
        () => makeModifiedCreatureWithPrevious("hidden-2in", exported, "IF"),
      ],
      [
        "makeModifiedCreature",
        () => makeModifiedCreature("hidden-2in", exported, "IF"),
      ],
    ] as const
  ) {
    const error = assertThrows(build, Error) as Error;
    assert(
      error.message.includes("hidden-2in"),
      `${name} should name the neuron: ${error.message}`,
    );
    assert(
      error.message.includes("at least 3 inward connections"),
      `${name} should name the rule it enforced: ${error.message}`,
    );
    assert(
      !(error instanceof ValidationError),
      `${name} must reject BEFORE building the creature, not by validating it`,
    );
  }

  // The caller's creature is untouched — the refusal has no side effect.
  const neuron = exported.neurons.find((n) => n.uuid === "hidden-2in");
  assertEquals(neuron?.squash, "TANH");
});

Deno.test("an eligible substitution still goes through and still validates (Issue #3827)", () => {
  const exported = exportOf(twoInwardJson);

  const { creature, previousSquash } = makeModifiedCreatureWithPrevious(
    "hidden-2in",
    exported,
    "GELU",
  );
  assertEquals(previousSquash, "TANH");
  creatureValidate(creature);
  const modified = creature.exportJSON().neurons.find((n) =>
    n.uuid === "hidden-2in"
  );
  assertEquals(modified?.squash, "GELU");
});
