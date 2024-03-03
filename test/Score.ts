import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";
import { calculate, valuePenalty } from "../src/architecture/Score.ts";

function setupCreature() {
  return Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/large.json")),
  );
}

Deno.test("Score: Calculation with given parameters", () => {
  const creature = setupCreature();
  const score = calculate(creature, 0.603, 0.000_000_1);
  assertAlmostEquals(score, -0.603_132, 0.000_001);
});

Deno.test("Score: Weight change should affect score", () => {
  const creature = setupCreature();
  const initialScore = calculate(creature, 0.603, 0.000_000_1);

  // Modify weight of a specific connection
  creature.synapses.forEach((c) => {
    if (c.from === 636 && c.to === 860) {
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
  assertAlmostEquals(valuePenalty(-1), 0);
  assertAlmostEquals(valuePenalty(0.5), 0);
});

Deno.test("valuePenalty: Various Values", () => {
  assertAlmostEquals(valuePenalty(5000), 1.895, 0.001);
  assertAlmostEquals(valuePenalty(1e10), 1.958, 0.001);
  assertAlmostEquals(valuePenalty(1e100), 1.996, 0.001);
  assertAlmostEquals(valuePenalty(1e200), 1.998, 0.001);
  assertAlmostEquals(valuePenalty(184323183.02923888), 1.95, 0.001);
});
