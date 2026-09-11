/**
 * The GRQ-protecting safety invariants, on a problem small enough for CI —
 * Issue #3935.
 *
 * The invariants that protect the GRQ lineage from the mechanisms of the Issue
 * #3919 sweep are cheap to state and impossible to test on the production
 * corpus: 21 GiB of records does not fit in a CI runner, and a 7.8-minute
 * generation does not fit in a test. The cheap problems of
 * `bench/lib/cheapProblem.ts` give the same three properties something to be
 * asserted against that runs in milliseconds:
 *
 * 1. **An approximate score never reaches `previousFittest`.** The elite band
 *    and the incumbent are ground truth; a cheap score entering either is the
 *    quiet corruption Issue #3931 exists to prevent.
 * 2. **A screened-out creature is never exported.** Pre-selection discards
 *    offspring *before* anyone pays to evaluate them (Issue #3932), so a
 *    discard carries no score and can reach no downstream consumer.
 * 3. **A disabled policy produces bit-identical scores.** With evolution
 *    control on `"none"`, pre-selection at `ratio: 1` and the uncertainty
 *    guard off, a run must score exactly what it scored before any of this
 *    landed — `Object.is`-identical, not "close".
 *
 * **Scope:** nothing here says anything about whether a surrogate can rank
 * real GRQ creatures. That question belongs to Issues #3927 and #3930. These
 * are safety properties — what must never happen — and they hold or fail
 * independently of how good any model is.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  isExactScore,
  markScoreFidelity,
  partialCorpusFidelity,
  refreshExactScoreFidelity,
  scoreFidelity,
} from "@architecture/ScoreFidelity.ts";
import {
  EvolutionControl,
  type GenerationFidelity,
} from "@neat/EvolutionControl.ts";
import { PreSelection } from "@neat/PreSelection.ts";
import { SampledCorpusScreen } from "@neat/OffspringScreen.ts";
import { resolveEvolutionControlConfig } from "@config/EvolutionControlConfig.ts";
import { resolvePreSelectionConfig } from "@config/PreSelectionConfig.ts";
import { EvolutionControlError } from "@errors/EvolutionControlError.ts";
import { PreSelectionError } from "@errors/PreSelectionError.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import {
  type CheapProblem,
  createCheapProblem,
  enumerateLattice,
  scoreAt,
} from "../../bench/lib/cheapProblem.ts";
import { stridePhaseIndices } from "../../scripts/lib/rankFidelity.ts";

/** The problem every invariant below is asserted on. */
const PROBLEM: CheapProblem = createCheapProblem({
  surface: "rastrigin",
  dimensions: 2,
  levels: 11,
  records: 16,
  seed: 3935,
});

/** The lattice, so a creature can be given a point to stand at. */
const LATTICE = enumerateLattice(PROBLEM);

/** The cheap fidelity: a quarter of the records. */
const CHEAP_RECORDS = stridePhaseIndices(PROBLEM.records.length, 0.25, 0);

/**
 * The fidelity tag a quarter-rate score carries, derived through the same
 * `partialCorpusFidelity` bridge a sampled-corpus run uses (Issues #3926,
 * #3931) rather than by a second copy of the arithmetic.
 */
const CHEAP_FIDELITY = partialCorpusFidelity(
  CHEAP_RECORDS.length,
  PROBLEM.records.length,
);

/**
 * `count` structurally distinct forward-only creatures, each standing at its
 * own lattice point.
 *
 * The creature is only a carrier: the objective is the cheap problem, so a
 * benchmark generation costs microseconds rather than the 7.8 minutes a GRQ
 * generation costs.
 */
function buildPopulation(
  count: number,
  offset = 0,
): { creatures: Creature[]; points: Map<Creature, readonly number[]> } {
  const creatures: Creature[] = [];
  const points = new Map<Creature, readonly number[]>();
  for (let i = 0; i < count; i++) {
    const neurons: CreatureExport["neurons"] = [];
    const synapses: CreatureExport["synapses"] = [];
    const hidden = offset + i + 1;
    for (let h = 0; h < hidden; h++) {
      neurons.push({
        type: "hidden",
        uuid: `hidden-${h}`,
        squash: "TANH",
        bias: 0.1 * (h + 1),
      });
      synapses.push({
        fromUUID: h === 0 ? "input-0" : `hidden-${h - 1}`,
        toUUID: `hidden-${h}`,
        weight: 0.25 + 0.05 * h,
      });
    }
    neurons.push({
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0.1,
    });
    synapses.push({
      fromUUID: `hidden-${hidden - 1}`,
      toUUID: "output-0",
      weight: 0.8,
    });
    const creature = Creature.fromJSON({
      neurons,
      synapses,
      input: 2,
      output: 1,
      forwardOnly: true,
    });
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
    // Spread the population over the lattice deterministically, so two runs of
    // the same size stand at the same points and their scores are comparable.
    points.set(creature, LATTICE[(i * 37 + offset * 7) % LATTICE.length]);
  }
  return { creatures, points };
}

/** Score a creature exactly — every record — and tag the fidelity. */
function scoreExactly(
  creature: Creature,
  points: Map<Creature, readonly number[]>,
): number {
  const point = points.get(creature);
  assert(point !== undefined, "every creature must stand at a lattice point");
  creature.score = scoreAt(PROBLEM, point);
  refreshExactScoreFidelity(creature);
  return creature.score;
}

/** Score a creature over the cheap record stride and tag it as approximate. */
function scoreCheaply(
  creature: Creature,
  points: Map<Creature, readonly number[]>,
): number {
  const point = points.get(creature);
  assert(point !== undefined, "every creature must stand at a lattice point");
  creature.score = scoreAt(PROBLEM, point, CHEAP_RECORDS);
  markScoreFidelity(creature, CHEAP_FIDELITY);
  return creature.score;
}

Deno.test("cheap-problem invariant - an approximate score cannot become previousFittest", () => {
  const control = new EvolutionControl(
    resolveEvolutionControlConfig({ strategy: "generation", exactEvery: 3 }),
  );
  const { creatures, points } = buildPopulation(6);

  // Generation 1 always anchors on ground truth.
  const first = control.beginGeneration(1);
  assertEquals(first.fidelity, "exact");
  for (const creature of creatures) scoreExactly(creature, points);
  control.assertExactAll(creatures, "previousFittest");

  // Generation 2 runs cheap, and every creature in it is disqualified from the
  // incumbent slot — by the tag, not by a convention anyone has to remember.
  const second = control.beginGeneration(2);
  assertEquals(second.fidelity, "approximate");
  for (const creature of creatures) scoreCheaply(creature, points);
  for (const creature of creatures) {
    assertEquals(isExactScore(creature), false);
    assertThrows(
      () => control.assertExact(creature, "previousFittest"),
      EvolutionControlError,
      "previousFittest",
    );
  }
  assertThrows(
    () => control.assertExactAll(creatures, "elite band"),
    EvolutionControlError,
  );

  // And the cheap score really is a different number, so the invariant is
  // protecting against a real substitution rather than a no-op.
  const cheap = creatures[0].score;
  const exact = scoreExactly(creatures[0], points);
  assert(
    cheap !== exact,
    "the cheap fidelity must disagree with the exact one somewhere, or this " +
      "invariant is vacuous",
  );
  control.assertExact(creatures[0], "previousFittest");
});

Deno.test("cheap-problem invariant - the elite band of a cheap generation is refused wholesale", () => {
  const control = new EvolutionControl(
    resolveEvolutionControlConfig({ strategy: "generation", exactEvery: 3 }),
  );
  const { creatures, points } = buildPopulation(8);
  control.beginGeneration(1);
  for (const creature of creatures) scoreExactly(creature, points);
  control.beginGeneration(2);
  // One cheap creature among seven exact ones is still a refusal: the band is
  // ground truth or it is not.
  scoreCheaply(creatures[5], points);

  const summary = control.summarise(creatures);
  assertEquals(summary.exactEvaluations, 7);
  assertEquals(summary.approximateEvaluations, 1);
  assertThrows(
    () => control.assertExactAll(creatures, "elite band"),
    EvolutionControlError,
  );
});

Deno.test("cheap-problem invariant - a screened-out creature carries no score and is never exported", async () => {
  const { creatures, points } = buildPopulation(12);
  const screen = new SampledCorpusScreen((candidates) =>
    Promise.resolve(
      candidates.map((candidate) => {
        const point = points.get(candidate);
        assert(point !== undefined);
        return scoreAt(PROBLEM, point, CHEAP_RECORDS);
      }),
    )
  );
  const preSelection = new PreSelection(
    resolvePreSelectionConfig({ ratio: 3, screen: "sampled" }),
    screen,
  );

  const outcome = await preSelection.select(
    creatures,
    4,
    1,
    createSeededRng(3935),
  );

  assertEquals(outcome.survivors.length, 4);
  assertEquals(outcome.discarded.length, 8);
  assertEquals(outcome.summary.screenedOut, 8);

  const survivorIds = new Set(outcome.survivors.map((c) => c.uuid));
  for (const discarded of outcome.discarded) {
    // Never evaluated, so never scored — and a creature with no score reaches
    // no downstream consumer that ranks, persists or exports on one.
    assertEquals(
      discarded.score,
      undefined,
      "a screened-out creature must carry no score",
    );
    // Nor a fidelity tag: the screen never measured it at any fidelity, so
    // there is no reading to mistake for one.
    assertEquals(scoreFidelity(discarded), null);
    assert(
      !survivorIds.has(discarded.uuid),
      "a discarded creature must not also be a survivor",
    );
  }

  // Only the survivors are ever paid for, and the exported population is drawn
  // from those alone.
  for (const survivor of outcome.survivors) scoreExactly(survivor, points);
  const exported = outcome.survivors.map((c) => c.exportJSON());
  assertEquals(exported.length, 4);
  assertEquals(
    outcome.survivors.length + outcome.discarded.length,
    creatures.length,
    "every candidate is either a survivor or a discard, and never both",
  );
});

Deno.test("cheap-problem invariant - a screen that writes a score is refused", async () => {
  const { creatures, points } = buildPopulation(9);
  const screen = new SampledCorpusScreen((candidates) =>
    Promise.resolve(
      candidates.map((candidate, index) => {
        const point = points.get(candidate);
        assert(point !== undefined);
        const value = scoreAt(PROBLEM, point, CHEAP_RECORDS);
        // A screen value is not a fitness. Writing one is the failure the
        // stage has to refuse rather than absorb.
        if (index === 0) candidate.score = value;
        return value;
      }),
    )
  );
  const preSelection = new PreSelection(
    resolvePreSelectionConfig({ ratio: 3, screen: "sampled" }),
    screen,
  );

  let thrown: unknown;
  try {
    await preSelection.select(creatures, 3, 1, createSeededRng(3935));
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof PreSelectionError, "the screen must be refused");
  assertEquals(thrown.reason, "SCREEN_WROTE_SCORE");
});

/**
 * One generation of the benchmark loop, with the fidelity chosen by whatever
 * `EvolutionControl` the caller supplies.
 *
 * The policy is genuinely in the scoring path: `plan.fidelity` decides whether
 * a creature is scored over the whole record set or over the cheap stride, so
 * a policy that is *on* provably changes the numbers and a policy that is
 * *off* provably does not.
 */
async function scoreGeneration(
  generation: number,
  control?: EvolutionControl,
  preSelection?: PreSelection,
): Promise<{ fidelity: GenerationFidelity; scores: number[] }> {
  const { creatures, points } = buildPopulation(10, generation);
  // Read synchronously, before any await: the plan belongs to this generation
  // and must not be re-read from the shared policy after later generations
  // have moved it on.
  const fidelity = control?.beginGeneration(generation).fidelity ?? "exact";
  const rng = createSeededRng(3935);
  const population = preSelection === undefined
    ? creatures
    : (await preSelection.select(creatures, 10, generation, rng)).survivors;
  return {
    fidelity,
    scores: population.map((creature) =>
      fidelity === "approximate"
        ? scoreCheaply(creature, points)
        : scoreExactly(creature, points)
    ),
  };
}

Deno.test("cheap-problem invariant - a disabled policy produces bit-identical scores", async () => {
  const off = new EvolutionControl(
    resolveEvolutionControlConfig({ strategy: "none" }),
  );
  const offSelection = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 1,
      screen: "none",
      uncertainty: { enabled: false },
    }),
  );
  assertEquals(off.active, false);
  assertEquals(offSelection.active, false);
  assertEquals(offSelection.surrogateGuard, undefined);
  // An off policy does not change how many offspring are bred, either.
  assertEquals(offSelection.offspringTarget(10), 10);

  // The plans are taken in generation order as the calls are made; the awaits
  // are gathered afterwards because a generation's score does not depend on
  // the one before it.
  const generations = [1, 2, 3, 4];
  const baselines = await Promise.all(
    generations.map((generation) => scoreGeneration(generation)),
  );
  const disabled = await Promise.all(
    generations.map((generation) =>
      scoreGeneration(generation, off, offSelection)
    ),
  );

  assertEquals(off.plan.reason, "strategy-off");
  for (let g = 0; g < generations.length; g++) {
    assertEquals(disabled[g].fidelity, "exact");
    assertEquals(disabled[g].scores.length, baselines[g].scores.length);
    for (let i = 0; i < baselines[g].scores.length; i++) {
      assert(
        Object.is(baselines[g].scores[i], disabled[g].scores[i]),
        `generation ${generations[g]} creature ${i} scored ` +
          `${disabled[g].scores[i]} with the policy off, was ` +
          `${baselines[g].scores[i]}: a disabled policy must be ` +
          `bit-identical, not merely close`,
      );
    }
  }
});

Deno.test("cheap-problem invariant - the same loop with the policy on does change the scores", async () => {
  // The counterpart the bit-identity assertion needs to be worth anything: if
  // switching the policy on could not move a score either, the test above
  // would pass over a loop the policy is not wired into at all.
  const on = new EvolutionControl(
    resolveEvolutionControlConfig({ strategy: "generation", exactEvery: 3 }),
  );
  const generations = [1, 2, 3, 4];
  const baselines = await Promise.all(
    generations.map((generation) => scoreGeneration(generation)),
  );
  const controlled = await Promise.all(
    generations.map((generation) => scoreGeneration(generation, on)),
  );

  let differed = 0;
  let approximateGenerations = 0;
  for (let g = 0; g < generations.length; g++) {
    if (controlled[g].fidelity !== "approximate") continue;
    approximateGenerations++;
    for (let i = 0; i < baselines[g].scores.length; i++) {
      if (!Object.is(baselines[g].scores[i], controlled[g].scores[i])) {
        differed++;
      }
    }
  }
  assert(
    approximateGenerations > 0,
    "the policy must plan at least one cheap generation, or it is not on",
  );
  assert(
    differed > 0,
    "an approximate generation must score at least one creature differently",
  );
});

Deno.test("cheap-problem invariant - pre-selection with the stage off is an order-preserving pass-through", async () => {
  const preSelection = new PreSelection(
    resolvePreSelectionConfig({ ratio: 1, screen: "none" }),
  );
  const { creatures } = buildPopulation(10);

  const outcome = await preSelection.select(
    creatures,
    10,
    1,
    createSeededRng(3935),
  );

  assertEquals(outcome.discarded.length, 0);
  assertEquals(
    outcome.survivors.map((c) => c.uuid),
    creatures.map((c) => c.uuid),
  );
});

Deno.test("cheap-problem invariant - a cheap fidelity really does reorder the population", () => {
  // The regression #3926's multi-fidelity claim rests on: a sampled corpus is
  // a *different* estimator, so a run holding cheap scores is holding a
  // different ordering — which is why the fidelity tag has to exist at all.
  const { creatures, points } = buildPopulation(12);
  const exact = creatures.map((creature) => scoreExactly(creature, points));
  const cheap = creatures.map((creature) => scoreCheaply(creature, points));

  assert(CHEAP_FIDELITY < 1, "the cheap stride must be a partial corpus");
  assert(
    cheap.some((value, i) => value !== exact[i]),
    "a quarter of the records must score at least one creature differently",
  );
  const byExact = [...creatures].sort((a, b) =>
    exact[creatures.indexOf(b)] - exact[creatures.indexOf(a)]
  );
  const byCheap = [...creatures].sort((a, b) =>
    cheap[creatures.indexOf(b)] - cheap[creatures.indexOf(a)]
  );
  assert(
    byExact.some((creature, i) => creature !== byCheap[i]),
    "the cheap ordering must differ from the exact one somewhere, or the " +
      "fidelity tag is guarding against nothing",
  );
  for (const creature of creatures) {
    assertEquals(scoreFidelity(creature), CHEAP_FIDELITY);
    assertEquals(isExactScore(creature), false);
  }
});

Deno.test("cheap-problem invariant - a disabled uncertainty guard never disables the surrogate path", async () => {
  const { creatures, points } = buildPopulation(12);
  const screen = new SampledCorpusScreen((candidates) =>
    Promise.resolve(
      candidates.map((candidate) => {
        const point = points.get(candidate);
        assert(point !== undefined);
        return scoreAt(PROBLEM, point, CHEAP_RECORDS);
      }),
    )
  );
  const preSelection = new PreSelection(
    resolvePreSelectionConfig({
      ratio: 3,
      screen: "sampled",
      uncertainty: { enabled: false },
    }),
    screen,
  );

  const outcome = await preSelection.select(
    creatures,
    4,
    1,
    createSeededRng(3935),
  );
  for (const survivor of outcome.survivors) scoreExactly(survivor, points);
  preSelection.observe(outcome.survivors, 1);

  assertEquals(preSelection.surrogateGuard, undefined);
  assertEquals(preSelection.lastDriftReading, undefined);
  assertEquals(outcome.summary.surrogate, undefined);
  assertEquals(preSelection.active, true);
});
