/**
 * Issue #3881: weight/bias magnitude must carry real selection pressure.
 *
 * The old `1 / (1 + 1 / value)` curve saturated by `|w| ~ 100`, so the score
 * could not tell a well-conditioned creature from one carrying a weight of
 * `1e+195` — the gap between `max|w| = 1e3` and `max|w| = 1.16e195` was 6.2e-14
 * of score. These tests pin the three properties that fix it: a constant cost
 * per decade, a gap comparable to a structural difference, and cross-engine
 * agreement on a shared corpus.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  calculate,
  MAGNITUDE_COST,
  magnitudePenalty,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
  valuePenalty,
} from "@architecture/Score.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

/** The fleet's production growth cost — see the issue's derivation. */
const GROWTH_COST = 1e-7;
const ERROR = 0.1;

interface CorpusCase {
  magnitude: number;
  penalty: number;
}

interface Corpus {
  decadeCap: number;
  maxSafeMagnitude: number;
  tolerance: number;
  cases: CorpusCase[];
}

function loadCorpus(): Corpus {
  return JSON.parse(
    Deno.readTextFileSync(
      "test/fixtures/scoring/magnitude-penalty-corpus.json",
    ),
  ) as Corpus;
}

/**
 * A creature whose every weight and bias sits at `magnitude`, so the mean
 * per-value penalty is exactly `magnitudePenalty(magnitude)`.
 */
function creatureAtMagnitude(magnitude: number, hidden = 2): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: hidden, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  creature.synapses.forEach((s) => s.weight = magnitude);
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = magnitude;
  }
  creature.invalidateScoreCache();
  return creature;
}

Deno.test("Magnitude #3881: the corpus pins the curve for both engines", () => {
  const corpus = loadCorpus();
  assert(corpus.cases.length > 0, "corpus must not be empty");

  for (const testCase of corpus.cases) {
    assertAlmostEquals(
      magnitudePenalty(testCase.magnitude),
      testCase.penalty,
      corpus.tolerance,
      `magnitude ${testCase.magnitude} must score ${testCase.penalty}`,
    );
  }
});

Deno.test("Magnitude #3881: the corpus spans 1 to 1e20 and stays in [0, 1)", () => {
  const corpus = loadCorpus();
  const magnitudes = corpus.cases.map((c) => c.magnitude);

  assert(
    magnitudes.some((m) => m <= 1) && magnitudes.some((m) => m >= 1e20),
    "the corpus must cover magnitudes 1 -> 1e20",
  );
  for (const testCase of corpus.cases) {
    assert(
      testCase.penalty >= 0 && testCase.penalty < 1,
      `penalty for ${testCase.magnitude} must be in [0, 1), got ${testCase.penalty}`,
    );
  }

  // Monotonic: a bigger magnitude is never cheaper than a smaller one.
  const sorted = [...corpus.cases].sort((a, b) => a.magnitude - b.magnitude);
  for (let i = 1; i < sorted.length; i++) {
    assert(
      sorted[i].penalty >= sorted[i - 1].penalty,
      `penalty must not fall from ${sorted[i - 1].magnitude} to ${
        sorted[i].magnitude
      }`,
    );
  }
});

Deno.test("Magnitude #3881: every decade above 1 costs the same", () => {
  const perDecade = magnitudePenalty(10) - magnitudePenalty(1);
  for (let decade = 1; decade < 12; decade++) {
    assertAlmostEquals(
      magnitudePenalty(10 ** (decade + 1)) - magnitudePenalty(10 ** decade),
      perDecade,
      1e-12,
      `decade ${decade} -> ${decade + 1} must cost the same as the first`,
    );
  }
  assert(perDecade > 0, "a decade of growth must never be free");
});

Deno.test("Magnitude #3881: magnitudePenalty clamps beyond MAX_SAFE_INTEGER instead of throwing", () => {
  const corpus = loadCorpus();
  const atBound = magnitudePenalty(corpus.maxSafeMagnitude);

  // The magnitude from the production clamp log that opened this issue.
  assertEquals(magnitudePenalty(1.1559466326634707e195), atBound);
  assertEquals(magnitudePenalty(-1.1559466326634707e195), atBound);
  assert(atBound < 1, `clamped penalty ${atBound} must stay below 1`);

  // valuePenalty itself keeps its bound — the clamp is the caller's contract.
  assertEquals(valuePenalty(corpus.maxSafeMagnitude), atBound);
});

Deno.test("Magnitude #3881: a decade of growth costs more than a structural change", () => {
  // Acceptance 1: two creatures identical but for weight magnitude — one at
  // max|w| ~ 10, one at max|w| ~ 1e8 — must differ by an amount comparable to a
  // structural difference, not by 1e-13.
  const sane = calculate(creatureAtMagnitude(10), ERROR, GROWTH_COST);
  const drifted = calculate(creatureAtMagnitude(1e8), ERROR, GROWTH_COST);
  const magnitudeGap = sane - drifted;

  // One extra hidden neuron costs exactly `growthCost`.
  const extraNeuron = calculate(creatureAtMagnitude(10, 3), ERROR, GROWTH_COST);
  const structuralGap = sane - extraNeuron;

  assert(magnitudeGap > 0, "the drifted creature must score worse");
  assert(
    structuralGap > 0,
    "the structurally larger creature must score worse",
  );
  assert(
    magnitudeGap >= structuralGap,
    `seven decades of magnitude (${magnitudeGap}) must cost at least as much ` +
      `as one hidden neuron plus its synapses (${structuralGap})`,
  );

  // The exact term, so a change to MAGNITUDE_COST is a deliberate one.
  assertAlmostEquals(
    magnitudeGap,
    (magnitudePenalty(1e8) - magnitudePenalty(10)) * GROWTH_COST *
      MAGNITUDE_COST,
    1e-18,
  );
});

Deno.test("Magnitude #3881: the penalty still discriminates where the fleet lives", () => {
  // Acceptance 2: published champions carry avg|w| in the thousands and
  // max|w| ~ 1e8. The old curve scored those 0.9999 and 0.99999999.
  const typical = magnitudePenalty(4544);
  const largest = magnitudePenalty(1.631e8);
  assert(
    largest - typical > 0.3,
    `avg|w|=4544 (${typical}) and max|w|=1.631e8 (${largest}) must be plainly ` +
      `separated`,
  );

  // And a creature whose *typical* weight grows a decade pays for it, which the
  // old (max, avg) aggregate could not charge for.
  const before = calculate(creatureAtMagnitude(4544), ERROR, GROWTH_COST);
  const after = calculate(creatureAtMagnitude(45440), ERROR, GROWTH_COST);
  assert(
    before - after > 1e-9,
    `a decade on the typical weight must cost more than 1e-9, got ${
      before - after
    }`,
  );
});

Deno.test("Magnitude #3881: incremental weight update survives an overflowing weight", () => {
  // The magnitude that opened this issue arrived through `fromJSON`, so the
  // incremental path meets it too. It must charge the clamped penalty rather
  // than throwing, and agree with a full recalculation.
  const creature = creatureAtMagnitude(10);
  calculate(creature, ERROR, GROWTH_COST);

  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = 1.1559466326634707e195;

  const incremental = updateScoreForWeightChange(
    creature,
    ERROR,
    GROWTH_COST,
    oldWeight,
    newWeight,
  );

  synapse.weight = newWeight;
  creature.invalidateScoreCache();
  const full = calculate(creature, ERROR, GROWTH_COST);

  assertAlmostEquals(
    incremental,
    full,
    1e-15,
    "incremental and full scoring must agree on an overflowing weight",
  );
});

Deno.test("Magnitude #3881: incremental bias update survives an overflowing bias", () => {
  const creature = creatureAtMagnitude(10);
  calculate(creature, ERROR, GROWTH_COST);

  const neuron = creature.neurons[creature.input];
  const oldBias = neuron.bias;
  const newBias = -2.668e28;

  const incremental = updateScoreForBiasChange(
    creature,
    ERROR,
    GROWTH_COST,
    oldBias,
    newBias,
  );

  neuron.bias = newBias;
  creature.invalidateScoreCache();
  const full = calculate(creature, ERROR, GROWTH_COST);

  assertAlmostEquals(
    incremental,
    full,
    1e-15,
    "incremental and full scoring must agree on an overflowing bias",
  );
});
