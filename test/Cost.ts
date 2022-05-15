import { Cost } from "../src/methods/cost.js";
import { assert } from "https://deno.land/std@0.139.0/testing/asserts.ts";

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
