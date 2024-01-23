import { assertAlmostEquals } from "https://deno.land/std@0.212.0/assert/assert_almost_equals.ts";
import { accumulateBias } from "../../src/architecture/BackPropagation.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { NeuronState } from "../../src/architecture/CreatureState.ts";

Deno.test("AccumulateBias-Standard", () => {
  const ns = new NeuronState();

  const config = new BackPropagationConfig();
  accumulateBias(ns, 4, 2, config);

  assertAlmostEquals(ns.totalValue, 4, 0.1, JSON.stringify(ns, null, 2));
});

Deno.test("AccumulateBias-Limited", () => {
  const config = new BackPropagationConfig();
  config.maximumBiasAdjustmentScale = 5;
  const ns = new NeuronState();

  accumulateBias(ns, 40, 2, config);

  const expected = 12;
  assertAlmostEquals(
    ns.totalValue,
    expected,
    0.1,
    `expected: ${expected}, totalValue: ${ns.totalValue}`,
  );
});
