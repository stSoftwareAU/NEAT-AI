import { assertAlmostEquals } from "https://deno.land/std@0.212.0/assert/assert_almost_equals.ts";
import { accumulateWeight } from "../../src/architecture/BackPropagation.ts";
import { ConnectionState } from "../../src/architecture/CreatureState.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";

Deno.test("AccumulateWeight-Standard", () => {
  const cs = new ConnectionState();
  cs.averageWeight = 1;
  cs.count = 1;
  const config = new BackPropagationConfig();
  accumulateWeight(1, cs, 4, 2, config);

  assertAlmostEquals(cs.averageWeight, 1.5, 0.1, JSON.stringify(cs, null, 2));
});

Deno.test("AccumulateWeight-Limited", () => {
  const config = new BackPropagationConfig();
  config.maximumWeightAdjustmentScale = 5;
  const cs = new ConnectionState();
  cs.averageWeight = 3;
  cs.count = 1;

  accumulateWeight(0, cs, 40, 2, config);

  const unlimitedExpected = (3 + (40 / 2)) / 2;
  const expected = (3 + 5) / 2;
  assertAlmostEquals(
    cs.averageWeight,
    expected,
    0.1,
    `Unlimited: ${unlimitedExpected} expected: ${expected}, average: ${cs.averageWeight}`,
  );
});
