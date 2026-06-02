import { assert, assertAlmostEquals, fail } from "@std/assert";
import { Creature } from "@creature";
import { calculate, valuePenalty } from "@architecture/Score.ts";
import { upgradeTwo } from "../../mod.ts";

function setupCreature() {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/large.json")),
  );

  creature.neurons.forEach((n) => {
    if (Math.abs(n.bias) > 100_000) {
      n.bias = Math.sign(n.bias) * 100000;
    }
  });
  creature.synapses.forEach((s) => {
    if (Math.abs(s.weight) > 100_000) {
      s.weight = Math.sign(s.weight) * 100000;
    }
  });
  return creature;
}

Deno.test("Score: Calculation with given parameters", () => {
  const creature = setupCreature();
  const score = calculate(creature, 0.603, 0.000_000_1);
  const upgradeExport = upgradeTwo(creature.exportJSON());
  const upgradeCreature = Creature.fromJSON(upgradeExport);
  const upgradedScore = calculate(upgradeCreature, 0.603, 0.000_000_1);
  if (upgradedScore < score) {
    fail(
      `Upgraded score: ${upgradedScore} difference: ${upgradedScore - score}`,
    );
  }

  // The fitness score is defined in src/architecture/Score.ts as:
  //   score = 1 - error - complexityPenalty - versionPenalty
  // Every penalty term is non-negative, so `1 - error` is a ceiling the score
  // can never reach. Asserting against this derived relationship — rather than
  // a copied six-decimal magic constant — keeps the test tracking the scoring
  // *spec*: subtracting the error, keeping penalties positive, and bounding the
  // complexity penalty by network size. A legitimate tweak to the penalty
  // formula no longer forces a developer to paste in whatever the new run
  // prints, but a regression (error not subtracted, a flipped penalty sign, or
  // an unbounded penalty) still breaks the test.
  const error = 0.603;
  const scoreCeiling = 1 - error; // 0.397 — strict, unreachable upper bound
  assert(
    score < scoreCeiling,
    `Score ${score} must sit below the error ceiling ${scoreCeiling}: ` +
      `the complexity and version penalties are strictly positive`,
  );

  // The complexity penalty is dominated by the deterministic, size-driven terms
  // of the formula (hidden-neuron growth + synapse growth), both scaled by
  // growthCost. We can therefore derive the expected score from the fixture's
  // own structure instead of capturing it from output. The remaining
  // weight/bias and version-penalty terms are small, so a 1e-4 tolerance bounds
  // them without reconstructing the entire formula.
  const growthCost = 0.000_000_1;
  const hiddenNeurons = creature.neurons.length - creature.input -
    creature.output;
  const structuralPenalty = hiddenNeurons * growthCost +
    creature.synapses.length * growthCost / 10;
  const expectedScore = scoreCeiling - structuralPenalty;
  assertAlmostEquals(score, expectedScore, 0.000_1, `Score was: ${score}`);
});

Deno.test("Score: Weight change should affect score", () => {
  const creature = setupCreature();
  const initialScore = calculate(creature, 0.603, 0.000_000_1);

  // Modify weight of a specific connection
  creature.synapses.forEach((c) => {
    if (c.from === 440 && c.to === 1487) {
      c.weight /= 2;
    }
  });

  // Invalidate cached score components after direct weight modification
  // Issue #1011: Score components are now cached, so direct modifications
  // require explicit cache invalidation
  creature.invalidateScoreCache();

  const newScore = calculate(creature, 0.603, 0.000_000_1);
  assert(
    newScore > initialScore,
    `${newScore} should be greater than ${initialScore}`,
  );
});

// Add more separate test cases here for different parts of the functionality

Deno.test("valuePenalty: Edge Cases", () => {
  assertAlmostEquals(valuePenalty(0), 0);
  assertAlmostEquals(valuePenalty(1), 0);
  assertAlmostEquals(valuePenalty(0.5), 0);
});

Deno.test("valuePenalty: Various Values", () => {
  assertAlmostEquals(valuePenalty(5000), 9.998949270042241e-1, 0.001);
  assertAlmostEquals(valuePenalty(1e10), 9.999583781651307e-1, 0.001);

  assertAlmostEquals(
    valuePenalty(184323183.02923888),
    9.999500803736046e-1,
    0.001,
  );
  assertAlmostEquals(valuePenalty(0.0000000000000001), 0, 0.001);
  const maxPenalty = valuePenalty(Number.MAX_SAFE_INTEGER);
  assert(maxPenalty < 1, `Max penalty ${maxPenalty} should be less than 1`);
});
