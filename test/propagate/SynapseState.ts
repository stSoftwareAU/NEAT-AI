import { assertEquals } from "@std/assert";
import { SynapseState } from "../../src/propagate/SynapseState.ts";

Deno.test("SynapseState - default values", () => {
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

Deno.test("SynapseState - mutable properties", () => {
  const ss = new SynapseState();
  ss.count = 5;
  ss.totalPositiveActivation = 10.5;
  ss.totalNegativeActivation = 3.2;
  ss.countNegativeActivations = 2;
  ss.countPositiveActivations = 3;
  ss.totalPositiveAdjustedValue = 7.8;
  ss.totalNegativeAdjustedValue = -1.5;
  ss.batchAverageWeight = 0.42;
  ss.used = true;

  assertEquals(ss.count, 5);
  assertEquals(ss.totalPositiveActivation, 10.5);
  assertEquals(ss.totalNegativeActivation, 3.2);
  assertEquals(ss.countNegativeActivations, 2);
  assertEquals(ss.countPositiveActivations, 3);
  assertEquals(ss.totalPositiveAdjustedValue, 7.8);
  assertEquals(ss.totalNegativeAdjustedValue, -1.5);
  assertEquals(ss.batchAverageWeight, 0.42);
  assertEquals(ss.used, true);
});

Deno.test("SynapseState - independent instances", () => {
  const a = new SynapseState();
  const b = new SynapseState();
  a.count = 10;
  a.totalPositiveActivation = 5;
  assertEquals(b.count, 0);
  assertEquals(b.totalPositiveActivation, 0);
});
