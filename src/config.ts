/*******************************************************************************
                                      CONFIG
*******************************************************************************/

import { Cost } from "./methods/cost.js";
import { Rate } from "./methods/rate.js";

export function findCost(costName: string) {
  const values = Object.values(Cost);
  for (let i = values.length; i--;) {
    const v = values[i];

    if (v.name == costName) {
      return v;
    }
  }

  throw "Invalid cost: " + costName;
}

// deno-lint-ignore ban-types
export function findRatePolicy(ratePolicy: string): Function {
  const values = Object.values(Rate);
  for (let i = values.length; i--;) {
    const v = values[i];

    if (v.name == ratePolicy) {
      return v;
    }
  }

  throw "Invalid cost: " + ratePolicy;
}
