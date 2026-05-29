/**
 * Issue #2791: tests for the auto-scaled default `trainPerGen`.
 *
 * Verifies that supervised (built-in cost) configurations scale the default
 * number of per-generation training sessions with the population, while
 * custom / unrecognised costs keep the conservative default of 1.
 */

import { assertEquals } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  EVOLUTION_ONLY_TRAIN_PER_GEN,
  resolveDefaultTrainPerGen,
  SUPERVISED_TRAIN_PER_GEN_FRACTION,
} from "@config/TrainPerGen.ts";

Deno.test("resolveDefaultTrainPerGen - scales with population for supervised costs", () => {
  // 50 * 0.2 = 10
  assertEquals(resolveDefaultTrainPerGen(50, "MSE"), 10);
  // 100 * 0.2 = 20
  assertEquals(resolveDefaultTrainPerGen(100, "CROSS_ENTROPY"), 20);
  // 30 * 0.2 = 6
  assertEquals(resolveDefaultTrainPerGen(30, "HINGE"), 6);
});

Deno.test("resolveDefaultTrainPerGen - never below 1 for tiny supervised populations", () => {
  // 2 * 0.2 = 0.4 -> round 0 -> clamped to 1
  assertEquals(resolveDefaultTrainPerGen(2, "MSE"), 1);
  // 3 * 0.2 = 0.6 -> round 1
  assertEquals(resolveDefaultTrainPerGen(3, "MAE"), 1);
});

Deno.test("resolveDefaultTrainPerGen - never exceeds the population size", () => {
  // A pathological fraction would still be capped at populationSize.
  // 4 * 0.2 = 0.8 -> round 1, well within population.
  const result = resolveDefaultTrainPerGen(4, "HINGE");
  assertEquals(result <= 4, true);
  assertEquals(result, 1);
});

Deno.test("resolveDefaultTrainPerGen - custom/unknown costs stay at the conservative default", () => {
  assertEquals(
    resolveDefaultTrainPerGen(50, "MY_CUSTOM_COST"),
    EVOLUTION_ONLY_TRAIN_PER_GEN,
  );
  assertEquals(resolveDefaultTrainPerGen(200, "OTHER"), 1);
});

Deno.test("resolveDefaultTrainPerGen - matches the documented fraction", () => {
  const populationSize = 75;
  const expected = Math.round(
    populationSize * SUPERVISED_TRAIN_PER_GEN_FRACTION,
  );
  assertEquals(resolveDefaultTrainPerGen(populationSize, "MSE"), expected);
});

Deno.test("createNeatConfig - default trainPerGen scales for the default (MSE) cost", () => {
  const config = createNeatConfig({});
  // Default population 50, default cost MSE -> 10.
  assertEquals(config.trainPerGen, 10);
});

Deno.test("createNeatConfig - default trainPerGen tracks an explicit population size", () => {
  const config = createNeatConfig({ populationSize: 100, costName: "MSE" });
  assertEquals(config.trainPerGen, 20);
});

Deno.test("createNeatConfig - explicit trainPerGen always wins over the scaled default", () => {
  assertEquals(createNeatConfig({ trainPerGen: 3 }).trainPerGen, 3);
  // Explicit 0 (evolution-only) is honoured even with a supervised cost.
  assertEquals(createNeatConfig({ trainPerGen: 0 }).trainPerGen, 0);
});
