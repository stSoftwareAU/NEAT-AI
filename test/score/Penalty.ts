import { assert, assertAlmostEquals, fail } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { calculate, valuePenalty } from "../../src/architecture/Score.ts";
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

  const expectedScore = 0.396_802;
  assertAlmostEquals(score, expectedScore, 0.000_001, `Score was: ${score}`);
});

Deno.test("Score: Weight change should affect score", () => {
  const creature = setupCreature();
  const initialScore = calculate(creature, 0.603, 0.000_000_1);

  let maxWeight = 0;
  let maxConnection;
  creature.synapses.forEach((c) => {
    const absWeight = Math.abs(c.weight);
    if (absWeight > maxWeight) {
      maxWeight = absWeight;
      maxConnection = c;
    }
  });
  console.log(maxConnection);

  // Modify weight of a specific connection
  creature.synapses.forEach((c) => {
    if (c.from === 440 && c.to === 1487) {
      c.weight /= 2;
    }
  });

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
