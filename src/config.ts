/*******************************************************************************
                                      CONFIG
*******************************************************************************/

import { Rate } from "./methods/Rate.ts";

const rateMap = new Map();
const names: string[] = [];

function init() {
  const rateValues = Object.values(Rate);
  for (let i = rateValues.length; i--;) {
    const v = rateValues[i];
    rateMap.set(v.name, v);
    names.push(v.name);
  }
}
init();

// deno-lint-ignore ban-types
export function findRatePolicy(ratePolicy: string): Function {
  // console.info("Rate Policy", ratePolicy);
  return rateMap.get(ratePolicy);
}

export function randomPolicyName(): string {
  const index = Math.floor(names.length * Math.random());

  return names[index];
}
