import type { ActivationFunction } from "./MakeActivationFunctionInterface.ts";

import { generate as generateV5Sync } from "../architecture/SyncV5.ts";

export type FunctionCache = {
  key: string;
  function?: ActivationFunction;
};

const NAMESPACE = "8e4ab65a-26fb-4b8e-b780-7510d8f5dc63";

export function findActivationFunction(
  functionBody: string,
  cache: FunctionCache,
  suffix?: string,
): ActivationFunction | undefined {
  const te = new TextEncoder();
  const textKey = functionBody + (suffix ? +"//" + suffix : "");
  const cacheKey = te.encode(textKey);

  const uuid = generateV5Sync(NAMESPACE, cacheKey);
  if (cache.key == uuid && cache.function) {
    return cache.function!;
  } else {
    delete cache.function;
    cache.key = uuid;
  }
}
