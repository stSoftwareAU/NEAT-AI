import { assertAlmostEquals } from "https://deno.land/std@0.219.1/assert/mod.ts";
import { Costs } from "../src/Costs.ts";
import { MSELimit } from "../src/costs/MSELimit.ts";
import { TwelveSteps } from "../src/costs/TwelveSteps.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("calculate cost", () => {
  const checks = [
    { target: [0.8], output: [1.9] },
    { target: [0.8], output: [1] },
    { target: [0.8], output: [0.9] },
    { target: [0.9], output: [0.8] },
    { target: [-0.8], output: [-0.9] },
    { target: [-0.9], output: [-0.8] },

    { target: [0.5], output: [0.5] },
    { target: [-0.5], output: [0.5] },
  ];

  const names = [
    "BINARY",
    "CROSS_ENTROPY",
    "HINGE",
    "MAE",
    "MAPE",
    "MSE",
    "MSLE",
    "MSELimit",
    "12STEPS",
  ];

  checks.forEach((check) => {
    for (let i = names.length; i--;) {
      const name = names[i];
      const r = Costs.find(name).calculate(check.target, check.output);

      console.info(name, check, r);
    }
  });
});

Deno.test("MSELimit", () => {
  const cost = new MSELimit();

  const exact = [-1, -0.5, 0, 0.5, 1];

  exact.forEach((v) => {
    const c = cost.calculate([v], [v]);

    assertAlmostEquals(
      c,
      0,
      0.000001,
      "Should be near zero for: " + v + " was: " + c,
    );
  });

  const checks = [
    {
      target: [1],
      output: [2],
      error: 0,
    },
    {
      target: [-0.51],
      output: [0.9],
      error: 7.9524,
    },
    {
      target: [-0.51],
      output: [-0.1],
      error: 0.1681,
    },
    {
      target: [-0.3],
      output: [0.3],
      error: 0.72,
    },
  ];

  checks.forEach((check) => {
    const error = cost.calculate(check.target, check.output);

    assertAlmostEquals(
      error,
      check.error,
      0.000001,
      "Should be near zero for: " + JSON.stringify(check) + " was: " + error,
    );
  });
});

Deno.test("12StepsLimitA", () => {
  const cost = new TwelveSteps();

  const c1 = cost.calculate([1.1], [1.2]);
  const c2 = cost.calculate([1.1], [2]);

  assertAlmostEquals(
    c1,
    c2,
    0.000001,
    "Should be near zero was: " + c1 + ":" + c2,
  );
});

Deno.test("12StepsLimitB", () => {
  const cost = new TwelveSteps();

  const c1 = cost.calculate([1], [1.2]);
  const c2 = cost.calculate([1], [2]);

  assertAlmostEquals(
    c1,
    c2,
    0.000001,
    "Should be near zero was: " + c1 + ":" + c2,
  );
});

Deno.test("12Steps", () => {
  const cost = new TwelveSteps();

  const exact = [-1, -0.5, 0, 0.5, 1];

  exact.forEach((v) => {
    const c = cost.calculate([v], [v]);

    assertAlmostEquals(
      c,
      0,
      0.000001,
      "Should be near zero for: " + v + " was: " + c,
    );
  });

  const checks = [
    {
      target: [-1],
      output: [1.2],
      error: 1,
    },
    {
      target: [1],
      output: [1.2],
      error: 0.001,
    },
    {
      target: [-0.51],
      output: [0.9],
      error: 0.39762,
    },
    {
      target: [-0.51],
      output: [-0.1],
      error: 0.01681,
    },
    {
      target: [-0.3],
      output: [0.3],
      error: 0.036,
    },
    {
      target: [-1],
      output: [1],
      error: 0.800,
    },
    {
      target: [-2],
      output: [2],
      error: 1,
    },
  ];

  checks.forEach((check) => {
    const error = cost.calculate(check.target, check.output);

    assertAlmostEquals(
      error,
      check.error,
      0.000001,
      "Should be near zero for: " + JSON.stringify(check) + " was: " + error,
    );
  });
});
