/*******************************************************************************
                                      CONFIG
*******************************************************************************/

import { Cost } from "./methods/Cost.ts";
import { Rate } from "./methods/rate.js";

const costMap = new Map();

const rateMap = new Map();

function init() {
  const costValues = Object.values(Cost);
  for (let i = costValues.length; i--;) {
    const v = costValues[i];
    costMap.set(v.name, v);
  }

  const rateValues = Object.values(Rate);
  for (let i = rateValues.length; i--;) {
    const v = rateValues[i];
    rateMap.set(v.name, v);
  }
}
init();

export function findCost(costName: string) {
  return costMap.get(costName);
}

// deno-lint-ignore ban-types
export function findRatePolicy(ratePolicy: string): Function {
  return rateMap.get(ratePolicy);
}
