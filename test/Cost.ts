import { Cost } from "../src/methods/Cost.ts";
import { assert } from "https://deno.land/std@0.156.0/testing/asserts.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function findCost(costName: string) {
  const values = Object.values(Cost);
  for (let i = values.length; i--;) {
    const v = values[i];

    if (v.name == costName) {
      return v;
    }
  }
}

Deno.test("byName", () => {
  const costName = "M" + "AE";
  console.info(Object.values(Cost));
  const list = [
    Cost.MAE,
    Cost["MAE"],
    findCost(costName),
  ];
  // console.info( list);
  list.forEach((fn) => {
    assert(typeof (fn) === "function", "Should be a function: " + typeof (fn));
  });
});

Deno.test("calculate cost", () => {
  const checks = [
    { target: [0.8], output: [0.9] },
    { target: [0.9], output: [0.8] },
    { target: [-0.8], output: [-0.9] },
    { target: [-0.9], output: [-0.8] },

    { target: [0.5], output: [0.5] },
    { target: [-0.5], output: [0.5] },
  ];

  checks.forEach((check) => {
    const rBinary = Cost.BINARY(check.target, check.output);

    console.info("BINARY", check, rBinary);

    const rce = Cost.CROSS_ENTROPY(check.target, check.output);

    console.info("CROSS_ENTROPY", check, rce);

    const hr = Cost.HINGE(check.target, check.output);

    console.info("HINGE", check, hr);

    const mae = Cost.MAE(check.target, check.output);

    console.info("MAE", check, mae);

    const mape = Cost.MAPE(check.target, check.output);

    console.info("MAPE", check, mape);
    const mse = Cost.MSE(check.target, check.output);

    console.info("MSE", check, mse);
    const msle = Cost.MSLE(check.target, check.output);

    console.info("MSLE", check, msle);
  });
});
