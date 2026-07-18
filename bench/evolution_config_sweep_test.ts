/**
 * Issue #3400 — Tests for the evolution-mode / population / sample-rate sweep.
 *
 * These cover the pure orchestration logic (axis expansion, config
 * materialisation, ranking, regression detection, table formatting, and the
 * sequential runner with an injected fake harness) so a broken sweep fails in
 * the fast `deno test` suite before any real production-scale run is cited as
 * evidence. The real evolution runs live in the CLI, driven by
 * `deno task bench:evolution-sweep`.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildAxesFromLists,
  buildSweepConfigs,
  expandAxes,
  findScoreRegressions,
  formatSweepMarkdown,
  mergeConfig,
  rankSweep,
  runSweep,
  summariseEntry,
  type SweepConfig,
  type SweepEntry,
} from "./evolution_config_sweep.ts";
import {
  type HarnessConfig,
  type HarnessResult,
  summariseTrajectory,
  withConfigDefaults,
} from "./score_per_hour_harness.ts";

function baseConfig(): HarnessConfig {
  return withConfigDefaults({
    scale: "default",
    inputCount: 16,
    outputCount: 2,
    sampleCount: 8,
    populationSize: 20,
    maxGenerations: 4,
    seed: 3396,
  });
}

/** Build a fake harness result whose score/hour and final score are chosen. */
function fakeResult(
  config: HarnessConfig,
  finalBestFitness: number,
  totalElapsedMs: number,
): HarnessResult {
  const samples = [
    { generation: 1, elapsedMs: 0, bestFitness: -100, averageFitness: -110 },
    {
      generation: 2,
      elapsedMs: totalElapsedMs,
      bestFitness: finalBestFitness,
      averageFitness: finalBestFitness - 1,
    },
  ];
  return summariseTrajectory(samples, totalElapsedMs, {
    config,
    topology: { neurons: 1, synapses: 1, inputs: 1 },
    usedRealTrainData: false,
  });
}

Deno.test("sweep: expandAxes builds the cartesian product with joined labels", () => {
  const axes = buildAxesFromLists({
    populations: [10, 20],
    trainingSampleRates: [0.1, 1.0],
  });
  const points = expandAxes(axes);
  assertEquals(points.length, 4);
  const labels = points.map((p) => p.label).sort();
  assertEquals(labels, [
    "pop10+rate0.1",
    "pop10+rate1",
    "pop20+rate0.1",
    "pop20+rate1",
  ]);
  // Each point sets population at top level and rate inside extraOptions.
  const p = points.find((p) => p.label === "pop10+rate0.1")!;
  assertEquals(p.overrides.populationSize, 10);
  assertEquals(p.overrides.extraOptions?.trainingSampleRate, 0.1);
});

Deno.test("sweep: expandAxes with no axes yields a single base point", () => {
  const points = expandAxes([]);
  assertEquals(points.length, 1);
  assertEquals(points[0].label, "base");
});

Deno.test("sweep: expandAxes rejects an empty axis (fail loud)", () => {
  assertThrows(
    () => expandAxes([{ name: "population", values: [] }]),
    Error,
    "no values",
  );
});

Deno.test("sweep: mergeConfig deep-merges extraOptions across overrides", () => {
  const base = withConfigDefaults({
    ...baseConfig(),
    extraOptions: { trainingSampleRate: 0.1 },
  });
  const merged = mergeConfig(base, {
    populationSize: 30,
    extraOptions: { sparseRatio: 0.2 },
  });
  assertEquals(merged.populationSize, 30);
  // Both the base rate and the override's sparse ratio survive the merge.
  assertEquals(merged.extraOptions?.trainingSampleRate, 0.1);
  assertEquals(merged.extraOptions?.sparseRatio, 0.2);
});

Deno.test("sweep: buildSweepConfigs rejects duplicate labels (fail loud)", () => {
  const dup = [
    { label: "pop10", overrides: { populationSize: 10 } },
    { label: "pop10", overrides: { populationSize: 10 } },
  ];
  assertThrows(
    () => buildSweepConfigs(baseConfig(), dup),
    Error,
    "Duplicate sweep label",
  );
});

Deno.test("sweep: buildSweepConfigs rejects an empty sweep (fail loud)", () => {
  assertThrows(() => buildSweepConfigs(baseConfig(), []), Error, "no points");
});

Deno.test("sweep: summariseEntry surfaces population and sample-rate knobs", () => {
  const config = mergeConfig(baseConfig(), {
    populationSize: 25,
    extraOptions: { trainingSampleRate: 0.3, sparseRatio: 0.07 },
  });
  const entry = summariseEntry("c", config, fakeResult(config, -40, 3_600_000));
  assertEquals(entry.populationSize, 25);
  assertEquals(entry.trainingSampleRate, 0.3);
  assertEquals(entry.sparseRatio, 0.07);
  assertEquals(entry.finalBestFitness, -40);
  // Gain = -40 - (-100) = 60 over 1 h → score/hour = 60.
  assertEquals(entry.scorePerHour, 60);
});

Deno.test("sweep: summariseEntry reports null for knobs a point did not set", () => {
  const config = baseConfig();
  const entry = summariseEntry("c", config, fakeResult(config, -50, 3_600_000));
  assertEquals(entry.trainingSampleRate, null);
  assertEquals(entry.sparseRatio, null);
});

Deno.test("sweep: rankSweep orders best score/hour first, deterministically", () => {
  const entries: SweepEntry[] = [
    entry("a", 10, -50),
    entry("b", 30, -50),
    entry("c", 20, -50),
  ];
  const ranked = rankSweep(entries).map((e) => e.label);
  assertEquals(ranked, ["b", "c", "a"]);
});

Deno.test("sweep: rankSweep tie-breaks equal score/hour by final score then label", () => {
  const entries: SweepEntry[] = [
    { ...entry("z", 10, -40) },
    { ...entry("a", 10, -40) },
    { ...entry("m", 10, -30) }, // better final score wins the tie
  ];
  const ranked = rankSweep(entries).map((e) => e.label);
  assertEquals(ranked, ["m", "a", "z"]);
});

Deno.test("sweep: findScoreRegressions flags a config that reaches a worse final score", () => {
  const entries: SweepEntry[] = [
    entry("baseline", 10, -40),
    entry("faster-worse", 100, -60), // much faster but worse final score
    entry("faster-equal", 100, -40),
  ];
  const regressions = findScoreRegressions(entries, "baseline");
  assertEquals(regressions.length, 1);
  assertEquals(regressions[0].label, "faster-worse");
  assert(regressions[0].delta < 0);
});

Deno.test("sweep: findScoreRegressions does not flag an equal-or-better final score", () => {
  const entries: SweepEntry[] = [
    entry("baseline", 10, -40),
    entry("better", 5, -20),
  ];
  assertEquals(findScoreRegressions(entries, "baseline").length, 0);
});

Deno.test("sweep: findScoreRegressions throws when the baseline label is absent (fail loud)", () => {
  assertThrows(
    () => findScoreRegressions([entry("a", 10, -40)], "missing"),
    Error,
    "not in the sweep",
  );
});

Deno.test("sweep: formatSweepMarkdown ranks rows and tags the baseline + deltas", () => {
  const entries: SweepEntry[] = [
    entry("pop10", 100, -40),
    entry("pop20", 200, -40),
  ];
  const md = formatSweepMarkdown(entries, "pop10");
  const lines = md.split("\n");
  assert(lines[0].includes("Score/hour"));
  // Best score/hour (pop20) ranks first; pop10 row is tagged 'baseline'.
  assert(lines[2].includes("pop20"));
  assert(lines[3].includes("pop10"));
  assert(lines[3].includes("baseline"));
  // pop20 is +100% vs the pop10 baseline.
  assert(lines[2].includes("+100.0%"));
});

Deno.test("sweep: runSweep runs each config through the injected harness in order", async () => {
  const base = baseConfig();
  const configs: SweepConfig[] = buildSweepConfigs(
    base,
    expandAxes(buildAxesFromLists({ populations: [10, 20, 30] })),
  );
  const seen: number[] = [];
  const fakeRunner = (config: HarnessConfig): Promise<HarnessResult> => {
    seen.push(config.populationSize);
    // Larger population → better final score here, so ranking is predictable.
    return Promise.resolve(
      fakeResult(config, -100 + config.populationSize, 3_600_000),
    );
  };
  const entries = await runSweep(configs, fakeRunner);
  assertEquals(seen, [10, 20, 30]); // sequential, input order
  assertEquals(entries.map((e) => e.label), ["pop10", "pop20", "pop30"]);
  // pop30 reached the best final score and thus the best score/hour.
  assertEquals(rankSweep(entries)[0].label, "pop30");
});

// ── helpers ──────────────────────────────────────────────────────

function entry(
  label: string,
  scorePerHour: number,
  finalBestFitness: number,
): SweepEntry {
  return {
    label,
    populationSize: 20,
    trainingSampleRate: null,
    sparseRatio: null,
    generations: 4,
    initialBestFitness: -100,
    finalBestFitness,
    bestFitness: finalBestFitness,
    totalElapsedMs: 3_600_000,
    scorePerHour,
  };
}
