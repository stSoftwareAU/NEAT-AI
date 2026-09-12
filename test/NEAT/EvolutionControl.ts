/**
 * Evolution control — the model-management policy of Jin (2011) §4 (Issue #3931).
 *
 * The tests below are the invariants the issue calls non-optional: an
 * approximate score may never reach an elite slot, `previousFittest`, or an
 * export; a cheap score may never be ordered against an exact one; and the
 * false-optimum canary must escalate on both a threshold breach and a widening
 * trend. `"none"` must behave exactly as the build did before this module.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import {
  EvolutionControl,
  orderingDivergence,
} from "@neat/EvolutionControl.ts";
import {
  type EvolutionControlConfig,
  resolveEvolutionControlConfig,
} from "@config/EvolutionControlConfig.ts";
import { EvolutionControlError } from "@errors/EvolutionControlError.ts";
import {
  isExactScore,
  SCORE_FIDELITY_TAG,
  scoreFidelity,
} from "@architecture/ScoreFidelity.ts";
import { getTag } from "@stsoftware/tags/mod";

/** A scored creature, with a UUID so error messages can name it. */
function scored(score: number, uuid: string): Creature {
  const creature = new Creature(2, 1, { lazyInitialization: true });
  creature.uuid = uuid;
  creature.score = score;
  return creature;
}

/** A control with the defaults, overridden as named. */
function control(overrides: EvolutionControlConfig = {}): EvolutionControl {
  return new EvolutionControl(resolveEvolutionControlConfig(overrides));
}

Deno.test("evolution control — the default strategy is off and every generation is exact", () => {
  const policy = control();
  assertEquals(policy.strategy, "none");
  assertEquals(policy.active, false);
  for (let generation = 1; generation <= 20; generation++) {
    const plan = policy.beginGeneration(generation);
    assertEquals(plan.fidelity, "exact");
    assertEquals(plan.exactSweep, true);
    assertEquals(plan.reason, "strategy-off");
  }
});

Deno.test("evolution control — off means no creature is tagged, so exports are unchanged", () => {
  const policy = control();
  const population = [scored(1, "a"), scored(2, "b")];
  policy.beginGeneration(1);
  const summary = policy.summarise(population);
  assertEquals(summary.exactEvaluations, 2);
  assertEquals(summary.approximateEvaluations, 0);
  for (const creature of population) {
    assertEquals(getTag(creature, SCORE_FIDELITY_TAG), null);
    assertEquals(scoreFidelity(creature), null);
  }
});

Deno.test("evolution control — generation-based control anchors every λth generation", () => {
  const policy = control({ strategy: "generation", exactEvery: 5 });
  const fidelities: string[] = [];
  for (let generation = 1; generation <= 11; generation++) {
    fidelities.push(policy.beginGeneration(generation).fidelity);
  }
  // Generation 1 always anchors: there is nothing to measure drift against.
  assertEquals(fidelities, [
    "exact",
    "approximate",
    "approximate",
    "approximate",
    "exact",
    "approximate",
    "approximate",
    "approximate",
    "approximate",
    "exact",
    "approximate",
  ]);
});

Deno.test("evolution control — a longer λ buys more cheap generations per anchor", () => {
  const policy = control({ strategy: "generation", exactEvery: 10 });
  let exact = 0;
  for (let generation = 1; generation <= 50; generation++) {
    if (policy.beginGeneration(generation).exactSweep) exact++;
  }
  // Generation 1, plus 10, 20, 30, 40, 50.
  assertEquals(exact, 6);
});

Deno.test("evolution control — individual-based control runs cheap sweeps with an exact subset", () => {
  const policy = control({
    strategy: "individual",
    exactTopK: 2,
    diverseSampleSize: 2,
  });
  const plan = policy.beginGeneration(3);
  assertEquals(plan.fidelity, "approximate");
  assertEquals(plan.exactSweep, false);
  assertEquals(plan.reason, "individual-subset");

  const population = [
    scored(1, "worst"),
    scored(9, "best"),
    scored(5, "middle"),
    scored(7, "second"),
    scored(3, "fourth"),
    scored(2, "fifth"),
  ];
  const chosen = policy.selectExactCandidates(population);
  const uuids = chosen.map((c) => c.uuid);
  // The two best-predicted, plus a spread across the remainder.
  assert(uuids.includes("best"), `top-k missing best: ${uuids}`);
  assert(uuids.includes("second"), `top-k missing second: ${uuids}`);
  assertEquals(chosen.length, 4);
  assertEquals(new Set(uuids).size, 4, "no creature is chosen twice");
});

Deno.test("evolution control — the exact subset is deterministic across runs", () => {
  const population = [
    scored(1, "a"),
    scored(9, "b"),
    scored(5, "c"),
    scored(7, "d"),
    scored(3, "e"),
    scored(2, "f"),
  ];
  const first = control({ strategy: "individual" })
    .selectExactCandidates(population).map((c) => c.uuid);
  const second = control({ strategy: "individual" })
    .selectExactCandidates(population).map((c) => c.uuid);
  assertEquals(first, second);
});

Deno.test("evolution control — guaranteed creatures lead the exact subset, without duplicates", () => {
  const best = scored(9, "best");
  const population = [scored(1, "a"), best, scored(5, "c")];
  const chosen = control({ strategy: "individual", exactTopK: 1 })
    .selectExactCandidates(population, [best]);
  assertEquals(chosen[0].uuid, "best");
  assertEquals(chosen.filter((c) => c.uuid === "best").length, 1);
});

Deno.test("evolution control — an approximate score cannot reach an elite slot", () => {
  const policy = control({ strategy: "generation" });
  const elite = scored(9, "elite");
  policy.markFidelity(elite, 0.1);
  const error = assertThrows(
    () => policy.assertExactAll([elite], "elitism"),
    EvolutionControlError,
  );
  assertEquals(error.reason, "APPROXIMATE_SCORE");
  assert(error.message.includes("elitism"), error.message);
});

Deno.test("evolution control — an approximate score cannot become previousFittest", () => {
  const policy = control({ strategy: "generation" });
  const fittest = scored(9, "fittest");
  policy.markFidelity(fittest, 0.5);
  assertThrows(
    () => policy.assertExact(fittest, "previousFittest"),
    EvolutionControlError,
  );
});

Deno.test("evolution control — an approximate score cannot be exported", () => {
  const policy = control({ strategy: "individual" });
  // A fully initialised creature, because the export path clones it.
  const creature = new Creature(2, 1);
  creature.uuid = "export-me";
  creature.score = 9;
  policy.markFidelity(creature, 0.25);
  // The export path clones first; the fidelity must survive the clone, or the
  // guard could be walked around simply by exporting a copy.
  const clone = creature.shallowClone();
  assertEquals(scoreFidelity(clone), 0.25);
  assertThrows(
    () => policy.assertExact(clone, "export"),
    EvolutionControlError,
  );
});

Deno.test("evolution control — an exactly-scored creature passes every guard", () => {
  const policy = control({ strategy: "generation" });
  const creature = scored(9, "exact");
  policy.markFidelity(creature, 1);
  policy.assertExact(creature, "elitism");
  assertEquals(isExactScore(creature), true);
  assertEquals(policy.fidelityOf(creature), 1);
});

Deno.test("evolution control — comparing a cheap score against an exact one is refused", () => {
  const policy = control({ strategy: "generation" });
  const cheap = scored(9, "cheap");
  policy.markFidelity(cheap, 0.1);
  const exact = scored(8, "exact");

  const error = assertThrows(
    () => policy.compareScores(cheap, exact),
    EvolutionControlError,
  );
  assertEquals(error.reason, "MIXED_FIDELITY_COMPARISON");
  // Symmetric: the refusal does not depend on argument order.
  assertThrows(
    () => policy.compareScores(exact, cheap),
    EvolutionControlError,
  );
});

Deno.test("evolution control — same-fidelity scores order best first", () => {
  const policy = control({ strategy: "generation" });
  const better = scored(9, "better");
  const worse = scored(4, "worse");
  assert(policy.compareScores(better, worse) < 0);
  assert(policy.compareScores(worse, better) > 0);
  assertEquals(policy.compareScores(better, scored(9, "tie")), 0);

  const cheapA = scored(9, "cheap-a");
  const cheapB = scored(4, "cheap-b");
  policy.markFidelity(cheapA, 0.1);
  policy.markFidelity(cheapB, 0.1);
  assert(policy.compareScores(cheapA, cheapB) < 0);
});

Deno.test("evolution control — an unscored creature is refused, not ordered as zero", () => {
  const policy = control();
  const unscored = new Creature(2, 1, { lazyInitialization: true });
  unscored.uuid = "unscored";
  assertThrows(
    () => policy.compareScores(unscored, scored(1, "scored")),
    EvolutionControlError,
  );
});

Deno.test("ordering divergence — an identical ordering diverges by zero", () => {
  assertEquals(orderingDivergence([3, 2, 1], [30, 20, 10]), 0);
});

Deno.test("ordering divergence — a reversed ordering diverges by one", () => {
  assertEquals(orderingDivergence([1, 2, 3], [30, 20, 10]), 1);
});

Deno.test("ordering divergence — one inverted pair in three is a third", () => {
  // Cheap says a > b > c; exact says b > a > c. Only the (a, b) pair inverts.
  const divergence = orderingDivergence([3, 2, 1], [2, 3, 1]);
  assertEquals(divergence, 1 / 3);
});

Deno.test("ordering divergence — a tie the exact ordering separates counts as a failure", () => {
  assertEquals(orderingDivergence([1, 1], [2, 1]), 1);
});

Deno.test("ordering divergence — fewer than two creatures is undecidable, not clean", () => {
  assertEquals(orderingDivergence([1], [1]), null);
  assertEquals(orderingDivergence([], []), null);
});

Deno.test("ordering divergence — misaligned score arrays are refused", () => {
  const error = assertThrows(
    () => orderingDivergence([1, 2], [1]),
    EvolutionControlError,
  );
  assertEquals(error.reason, "MIXED_FIDELITY_COMPARISON");
});

Deno.test("false-optimum canary — a reading past the threshold abandons the cheap path", () => {
  const policy = control({
    strategy: "generation",
    exactEvery: 2,
    canaryThreshold: 0.25,
  });
  policy.beginGeneration(1);
  const clean = policy.recordExactSweep(2, [3, 2, 1], [30, 20, 10]);
  assertEquals(clean.divergence, 0);
  assertEquals(clean.escalated, false);
  assertEquals(policy.beginGeneration(3).fidelity, "approximate");

  const drifted = policy.recordExactSweep(4, [1, 2, 3], [30, 20, 10]);
  assertEquals(drifted.divergence, 1);
  assertEquals(drifted.escalated, true);
  assertEquals(policy.escalated, true);
  assertEquals(policy.escalatedGeneration, 4);
});

Deno.test("false-optimum canary — after escalation every generation is exact", () => {
  const policy = control({ strategy: "generation", exactEvery: 5 });
  policy.beginGeneration(1);
  policy.recordExactSweep(1, [1, 2, 3], [30, 20, 10]);
  for (let generation = 2; generation <= 12; generation++) {
    const plan = policy.beginGeneration(generation);
    assertEquals(plan.fidelity, "exact");
    assertEquals(plan.exactSweep, true);
    assertEquals(plan.reason, "canary-escalated");
  }
});

Deno.test("false-optimum canary — a widening trend escalates below the threshold", () => {
  const policy = control({
    strategy: "generation",
    exactEvery: 2,
    canaryThreshold: 1,
    canaryWindow: 3,
  });
  // Six creatures give 15 pairs, so divergence can rise in small steps while
  // staying far below a threshold of 1.
  const exact = [6, 5, 4, 3, 2, 1];
  const readings = [
    policy.recordExactSweep(2, [6, 5, 4, 3, 2, 1], exact), // 0 inversions
    policy.recordExactSweep(4, [5, 6, 4, 3, 2, 1], exact), // 1 inversion
    policy.recordExactSweep(6, [5, 6, 3, 4, 2, 1], exact), // 2 inversions
  ];
  assertEquals(readings.map((r) => r.divergence), [0, 1 / 15, 2 / 15]);
  assert(
    readings[2].divergence !== null && readings[2].divergence < 1,
    "the trend must escalate while every reading is below the threshold",
  );
  assertEquals(readings[2].widening, true);
  assertEquals(policy.escalated, true);
});

Deno.test("false-optimum canary — a stable divergence does not escalate", () => {
  const policy = control({
    strategy: "generation",
    exactEvery: 2,
    canaryThreshold: 1,
    canaryWindow: 3,
  });
  const exact = [6, 5, 4, 3, 2, 1];
  for (let i = 0; i < 5; i++) {
    policy.recordExactSweep(2 * (i + 1), [5, 6, 4, 3, 2, 1], exact);
  }
  assertEquals(policy.escalated, false);
});

Deno.test("false-optimum canary — an undecidable reading is not recorded as clean", () => {
  const policy = control({ strategy: "generation", exactEvery: 2 });
  const reading = policy.recordExactSweep(2, [1], [1]);
  assertEquals(reading.divergence, null);
  assertEquals(reading.pairs, 0);
  assertEquals(policy.escalated, false);
  // A second, genuinely clean reading must be the first entry in the trend, so
  // the undecidable one cannot pad the widening window.
  const next = policy.recordExactSweep(4, [2, 1], [2, 1]);
  assertEquals(next.divergence, 0);
  assertEquals(next.widening, false);
});

Deno.test("evolution control — the per-generation summary names fidelity and exact count", () => {
  const policy = control({ strategy: "individual" });
  policy.beginGeneration(4);
  const population = [scored(3, "a"), scored(2, "b"), scored(1, "c")];
  policy.markFidelity(population[0], 1);
  policy.markFidelity(population[1], 0.1);
  policy.markFidelity(population[2], 0.1);

  const summary = policy.summarise(population);
  assertEquals(summary.generation, 4);
  assertEquals(summary.strategy, "individual");
  assertEquals(summary.fidelity, "approximate");
  assertEquals(summary.exactEvaluations, 1);
  assertEquals(summary.approximateEvaluations, 2);

  const line = policy.describe(summary);
  assert(line.includes("generation 4"), line);
  assert(line.includes("1 exact / 2 approximate"), line);
});

Deno.test("evolution control — reset clears the canary and the escalation", () => {
  const policy = control({ strategy: "generation", exactEvery: 2 });
  policy.recordExactSweep(2, [1, 2, 3], [30, 20, 10]);
  assertEquals(policy.escalated, true);
  policy.reset();
  assertEquals(policy.escalated, false);
  assertEquals(policy.lastCanaryReading, undefined);
  assertEquals(policy.beginGeneration(3).fidelity, "approximate");
});

Deno.test("evolution control — an unhonoured plan is reported loudly, once", () => {
  const policy = control({ strategy: "generation", exactEvery: 5 });
  policy.beginGeneration(3);
  // The plan asked for a cheap sweep; every creature came back exact, because
  // nothing downstream honours the plan yet.
  const population = [scored(3, "a"), scored(2, "b")];
  const summary = policy.summarise(population);
  assertEquals(summary.fidelity, "approximate");
  assertEquals(summary.approximateEvaluations, 0);

  const warning = policy.unhonouredPlanWarning(summary);
  assert(warning !== undefined, "the mismatch must be reported");
  assert(warning.includes("generation"), warning);
  assert(warning.includes("no cheap evaluator"), warning);
  // Once per run, not once per generation.
  assertEquals(policy.unhonouredPlanWarning(summary), undefined);
});

Deno.test("evolution control — an honoured plan reports nothing", () => {
  const policy = control({ strategy: "generation", exactEvery: 5 });
  policy.beginGeneration(3);
  const population = [scored(3, "a"), scored(2, "b")];
  policy.markFidelity(population[0], 0.1);
  policy.markFidelity(population[1], 0.1);
  assertEquals(
    policy.unhonouredPlanWarning(policy.summarise(population)),
    undefined,
  );
});

Deno.test("evolution control — an exact sweep never reports an unhonoured plan", () => {
  const policy = control({ strategy: "generation", exactEvery: 5 });
  policy.beginGeneration(5);
  const population = [scored(3, "a"), scored(2, "b")];
  assertEquals(policy.summarise(population).fidelity, "exact");
  assertEquals(
    policy.unhonouredPlanWarning(policy.summarise(population)),
    undefined,
  );
});

Deno.test("ordering divergence — a pair the exact evaluation also ties is not a disagreement", () => {
  assertEquals(orderingDivergence([1, 1], [2, 2]), 0);
});
