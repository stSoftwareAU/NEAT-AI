/*******************************************************************************
                                      CONFIG
*******************************************************************************/

import { Rate } from "./methods/Rate.ts";

const rateMap = new Map();

function init() {
  const rateValues = Object.values(Rate);
  for (let i = rateValues.length; i--;) {
    const v = rateValues[i];
    rateMap.set(v.name, v);
  }
}
init();

// deno-lint-ignore ban-types
export function findRatePolicy(ratePolicy: string): Function {
  return rateMap.get(ratePolicy);
}
