import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.204.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { calculate, valuePenalty } from "../src/architecture/Score.ts";

Deno.test("Score", () => {
  const creature = Network.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/large.json")),
  );

  const scoreA = calculate(creature, 0.603, 0.000_000_1);

  assertAlmostEquals(scoreA, -0.603_132, 0.000_001);

  creature.connections.forEach((c) => {
    if (c.from == 636 && c.to == 860) {
      console.info(c);
      c.weight /= 2;
    }
  });

  const scoreB = calculate(creature, 0.603, 0.000_000_1);

  assert(scoreB > scoreA, `${scoreB} should be greater than ${scoreA}`);

  let biggestBias = 0;
  creature.nodes.forEach((n) => {
    if (n.bias != Infinity) {
      const b = Math.abs(n.bias);
      if (b > biggestBias) {
        biggestBias = b;
        console.info(n.uuid, n.bias);
      }
    }
  });

  creature.connections.forEach((c) => {
    if (c.from == 636 && c.to == 860) {
      console.info(c);
      c.weight = 1;
    }
  });
  const scoreC = calculate(creature, 0.603, 0.000_000_1);

  creature.nodes.forEach((n) => {
    if (n.uuid == "d049ceac-84d6-4c59-a057-630eefbc03d1") {
      const b = n.bias;
      n.bias = b / 2;
    }
  });

  const scoreD = calculate(creature, 0.603, 0.000_000_1);
  assert(scoreD > scoreC, `${scoreD} should be greater than ${scoreC}`);
});

Deno.test("valuePenalty", () => {
  assertAlmostEquals(valuePenalty(0), 0);
  assertAlmostEquals(valuePenalty(1), 0);
  assertAlmostEquals(valuePenalty(-1), 0);
  assertAlmostEquals(valuePenalty(0.5), 0);

  assertAlmostEquals(valuePenalty(5000), 1.895, 0.001);
  assertAlmostEquals(valuePenalty(1e10), 1.958, 0.001);
  assertAlmostEquals(valuePenalty(1e100), 1.996, 0.001);
  assertAlmostEquals(valuePenalty(1e200), 1.998, 0.001);
  assertAlmostEquals(valuePenalty(184323183.02923888), 1.95, 0.001);
});
