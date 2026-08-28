/**
 * The squash-substitution eligibility rule is part of the public surface
 * (GRQ #4440, follow-on to Issue #3827).
 *
 * #3827 gated this library's own substitution helpers, but left the rule
 * private to `@intelligentDesign/mod.ts`. A consumer that writes
 * `neuron.squash` itself is a producer too, and could not reach it: the
 * published entry point is `mod.ts` alone. GRQ keys Intelligent Design by
 * neuron uuid — integer neuron ids are unstable across generations — so it
 * re-implemented the substitution, could not import the gate, and re-created
 * the fault on NEAT-AI 7.0.0: ten `intelligentDesign-worker` deaths in one
 * 40-minute run, each on an `IF` neuron this library's own validator refuses.
 *
 * These tests import through `../../mod.ts`, the way a consumer does. They fail
 * if the re-export is dropped.
 */

import { assert, assertEquals } from "@std/assert";
import {
  canAdoptSquash,
  Creature,
  type CreatureExport,
  normaliseCreatureExport,
  squashSubstitutionBlockedReason,
  STRUCTURALLY_CONSTRAINED_SQUASHES,
} from "../../mod.ts";

/** Three inputs, so the hidden neuron sits at index 3 and the IF rule applies. */
function twoInwardExport(): CreatureExport {
  const draft = {
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
    // deno-lint-ignore no-explicit-any
  } as any;
  const exported = Creature.fromJSON(draft).exportJSON();
  normaliseCreatureExport(exported);
  return exported;
}

Deno.test("mod.ts re-exports the squash-substitution eligibility rule", () => {
  const exported = twoInwardExport();

  const reason = squashSubstitutionBlockedReason(exported, "hidden-2in", "IF");
  assert(reason, "a two-inward neuron must not be allowed to adopt IF");
  assert(
    reason.includes("at least 3 inward connections"),
    `the reason must name the rule: ${reason}`,
  );

  assertEquals(canAdoptSquash(exported, "hidden-2in", "IF"), false);
  assertEquals(canAdoptSquash(exported, "hidden-2in", "GELU"), true);
});

Deno.test("mod.ts re-exports the structurally constrained squash set", () => {
  assertEquals(STRUCTURALLY_CONSTRAINED_SQUASHES.has("IF"), true);
  assertEquals(STRUCTURALLY_CONSTRAINED_SQUASHES.has("GELU"), false);
});
