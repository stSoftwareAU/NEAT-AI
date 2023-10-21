import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.204.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { calculate } from "../src/architecture/Score.ts";

Deno.test("Score", () => {
  const creature = Network.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/large.json")),
  );

  const scoreA = calculate(creature, 0.603, 0.000_000_1);

  assertAlmostEquals(scoreA, -0.603_132);

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
    if (n.uuid == "d049ceac-84d6-4c59-a057-630eefbc03d1") {
      n.bias /= 2;
    }
  });

  const scoreC = calculate(creature, 0.603, 0.000_000_1);
  assert(scoreC > scoreB, `${scoreC} should be greater than ${scoreB}`);
});
