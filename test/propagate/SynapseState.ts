import { assertEquals } from "@std/assert";
import { SynapseState } from "@propagate/SynapseState.ts";

Deno.test("SynapseState - initialises all counters to zero and optional fields to undefined", () => {
  const ss = new SynapseState();
  assertEquals(ss.count, 0);
  assertEquals(ss.totalPositiveActivation, 0);
  assertEquals(ss.totalNegativeActivation, 0);
  assertEquals(ss.countNegativeActivations, 0);
  assertEquals(ss.countPositiveActivations, 0);
  assertEquals(ss.totalPositiveAdjustedValue, 0);
  assertEquals(ss.totalNegativeAdjustedValue, 0);
  assertEquals(ss.batchAverageWeight, undefined);
  assertEquals(ss.used, undefined);
});
