/**
 * Issue #2967 — fact-check guard for docs/api/.
 *
 * The API reference must match the actual exported surface. These tests import
 * the symbols newly documented in the split sub-docs straight from the public
 * entry point (`mod.ts`) and exercise the doc examples, so the documentation
 * cannot silently drift from the real API.
 *
 * These are "what" tests: each imported symbol is invoked or its documented
 * default value is asserted — not a source-text grep.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  costNameToTaskDescriptor,
  type CostRange,
  type CostTopology,
  Creature,
  creatureForProblem,
  DEAD_FEATURE_VARIANCE_THRESHOLD,
  DEFAULT_SELECTION_PRESSURE_CONFIG,
  DISCOVERY_FOCUSED_PRESET,
  FAST_CONVERGENCE_PRESET,
  HIGH_DIMENSIONAL_INPUT_THRESHOLD,
  LARGE_NETWORK_PRESET,
  MEMORY_CONSTRAINED_PRESET,
  OTHER_COST_NAME,
  OTHER_TASK_DESCRIPTOR,
  type ProblemSpec,
  QUICK_START_PRESET,
  type RequiredSelectionPressureConfig,
  scanTrainingData,
  type TaskDescriptor,
} from "../../mod.ts";

Deno.test("CreatureFactory: creatureForProblem builds a creature from a ProblemSpec", () => {
  const spec: ProblemSpec = { inputs: 4, outputs: 2, cost: "MSE" };
  const creature = creatureForProblem(spec);
  assert(creature instanceof Creature);
  assertEquals(creature.input, 4);
  assertEquals(creature.output, 2);
});

Deno.test("CreatureFactory: scanTrainingData summarises a dataset", () => {
  const scan = scanTrainingData([
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ]);
  assertEquals(scan.sampleCount, 2);
  assertEquals(scan.inputMean.length, 2);
  assertEquals(scan.outputMean.length, 1);
});

Deno.test("CreatureFactory: documented constants carry their published values", () => {
  assertEquals(DEAD_FEATURE_VARIANCE_THRESHOLD, 1e-8);
  assertEquals(HIGH_DIMENSIONAL_INPUT_THRESHOLD, 100);
});

Deno.test("SelectionPressureConfig defaults match the documented table", () => {
  const cfg: RequiredSelectionPressureConfig =
    DEFAULT_SELECTION_PRESSURE_CONFIG;
  assertEquals(cfg.power, 4);
  assertEquals(cfg.tournamentSize, 5);
  assertEquals(cfg.tournamentProbability, 0.5);
  assertEquals(cfg.adaptiveTournament, true);
  assertEquals(cfg.adaptiveTournamentMinSize, 3);
  assertEquals(cfg.adaptiveTournamentSqrtExponent, 0.5);
  assertEquals(cfg.adaptiveTournamentCapFraction, 0.1);
});

Deno.test("CostTaskDescriptor maps built-in and custom cost names", () => {
  const mse: TaskDescriptor = costNameToTaskDescriptor("MSE");
  assertExists(mse.costName);
  const range: CostRange = mse.range;
  const topology: CostTopology = mse.topology;
  assertExists(range);
  assertExists(topology);

  // Custom (unknown) costs collapse to the OTHER sentinel without leaking.
  const custom = costNameToTaskDescriptor("MY_CUSTOM_COST");
  assertEquals(custom.costName, OTHER_COST_NAME);
  assertEquals(custom, OTHER_TASK_DESCRIPTOR);
});

Deno.test("All documented presets are spreadable NeatOptions shapes", () => {
  for (
    const preset of [
      QUICK_START_PRESET,
      FAST_CONVERGENCE_PRESET,
      LARGE_NETWORK_PRESET,
      MEMORY_CONSTRAINED_PRESET,
      DISCOVERY_FOCUSED_PRESET,
    ]
  ) {
    const merged = { ...preset, populationSize: 7 };
    assertEquals(merged.populationSize, 7);
    assert(typeof preset === "object" && preset !== null);
  }
});
