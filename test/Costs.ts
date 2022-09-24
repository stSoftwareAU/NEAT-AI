import { assert, assertAlmostEquals } from "https://deno.land/std@0.157.0/testing/asserts.ts";
import { Costs } from "../src/Costs.ts";
import { MSELimit } from "../src/costs/MSELimit.ts";

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
  const cost=new MSELimit();

  const exact=[-1,-0.5, 0, 0.5, 1];

  exact.forEach( v =>{
    const c=cost.calculate([v],[v]);

    assertAlmostEquals( c, 0, 0.000001, "Should be near zero for: " + v + " was: " + c);
  });

  const checks=[
    {
      target: [1],
      output: [2],
      error: 0
    },
    {
      target: [-0.51],
      output: [0.9],
      error: 3.9762
    }
  ];

  checks.forEach( check=> {
    const error=cost.calculate(check.target,check.output);


    assertAlmostEquals(error, check.error, 0.000001, "Should be near zero for: " + check + " was: " + error);
  });
});
