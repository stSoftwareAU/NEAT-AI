/**
 * Patch coverage: ensure the Intelligent Design barrel exports are exercised.
 *
 * These tests are intentionally lightweight; importing the modules executes the
 * re-export wiring so Codecov counts the added lines.
 */

import { assertEquals } from "@std/assert";

Deno.test("mod.ts exports Intelligent Design symbols", async () => {
  const neat = await import("../../mod.ts");

  assertEquals(typeof neat.scanForSquashImprovements, "function");
  assertEquals(typeof neat.combineImprovements, "function");
  assertEquals(typeof neat.IntelligentDesignWorkerHandler, "function");
});

Deno.test("src/intelligentDesign/mod.ts exports key utilities", async () => {
  const id = await import("../../src/intelligentDesign/mod.ts");

  assertEquals(typeof id.scanForSquashImprovements, "function");
  assertEquals(typeof id.combineImprovements, "function");
  assertEquals(typeof id.safeWriteText, "function");
  assertEquals(typeof id.WorkerHandler, "function");
});

/**
 * The Issue #3827 gate has to be reachable from the package root, not only from
 * the internal barrel: a downstream application that applies its own squash
 * substitution cannot call the copy applied inside `makeModifiedCreature*`, so
 * without a public export it rebuilds the very `IF` neurons this library's own
 * validator refuses — which is what a consuming fleet hit, ten dead scoring
 * tasks in a single run.
 */
Deno.test("mod.ts exports the squash substitution gate and it still enforces the IF rule", async () => {
  const neat = await import("../../mod.ts");

  assertEquals(typeof neat.squashSubstitutionBlockedReason, "function");
  assertEquals(typeof neat.canAdoptSquash, "function");
  assertEquals(neat.STRUCTURALLY_CONSTRAINED_SQUASHES.has("IF"), true);

  // A hidden neuron at index 3 with two inward connections — the shape the
  // validator refuses as `'IF' should have at least 3 inward connections`.
  const exported = neat.Creature.fromJSON({
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
  }).exportJSON();

  const reason = neat.squashSubstitutionBlockedReason(
    exported,
    "hidden-2in",
    "IF",
  );
  assertEquals(typeof reason, "string");
  assertEquals(neat.canAdoptSquash(exported, "hidden-2in", "IF"), false);
  // An unconstrained squash is never blocked by topology.
  assertEquals(neat.canAdoptSquash(exported, "hidden-2in", "TANH"), true);
});
