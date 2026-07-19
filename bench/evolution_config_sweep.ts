/**
 * Issue #3400 — Evolution-mode / population / sample-rate configuration sweep.
 *
 * The #3396 milestone's success metric is **score improvement per wall-clock
 * hour** inside the production learn/sampler time-boxes. `worker/learn.sh`
 * (GRQ) chooses the evolution-mode flags, `populationSize`, `trainingSampleRate`
 * and `sparseRatio` those runs use; this sweep measures those choices
 * head-to-head on the production-scale synthetic topology so a recommendation
 * rests on before/after evidence rather than intuition.
 *
 * It is a thin, deterministic orchestration layer over the #3398 score-per-hour
 * harness ([`score_per_hour_harness.ts`](./score_per_hour_harness.ts)):
 *   1. Expand a set of sweep axes (population × sample-rate × flag combos) into
 *      the cartesian product of labelled configs.
 *   2. Run each labelled config through the harness in the **same session** on
 *      the **same** synthetic `bench/` data — the apples-to-apples comparison
 *      the issue's Failure-Detection section requires.
 *   3. Rank the results by score-per-hour and flag any config whose final best
 *      score regressed below a designated baseline point (a pure speed-up that
 *      reaches a worse score is not a win).
 *   4. Emit a machine-readable JSON table and a human-readable Markdown table
 *      as the detection artefact to attach to this issue and any cross-repo GRQ
 *      issue.
 *
 * Determinism: with the harness defaults (`trainPerGen=0`,
 * `discoverySampleRate=-1`) every point is pure seeded neuroevolution, so the
 * per-config score trajectory is byte-reproducible; only wall-clock timing (and
 * therefore score/hour) varies with machine load. The pure functions below are
 * unit-tested; the CLI drives the real evolution runs.
 *
 * Silent-failure guard (Issue #3234): a duplicate sweep label, a missing
 * baseline label, or an empty sweep throws rather than silently producing a
 * partial or misleading table.
 */

import {
  type HarnessConfig,
  type HarnessResult,
  runScorePerHourHarness,
  withConfigDefaults,
} from "./score_per_hour_harness.ts";

/** One choice on a single sweep axis: a label fragment + the overrides it sets. */
export interface AxisValue {
  /** Short tag used to build the point label (e.g. `pop20`, `rate0.1`). */
  readonly tag: string;
  /** Harness-config overrides this choice applies (deep-merged for extraOptions). */
  readonly overrides: Partial<HarnessConfig>;
}

/** A sweep axis — one tunable dimension with the choices to try for it. */
export interface SweepAxis {
  /** Human name of the dimension (e.g. `population`). */
  readonly name: string;
  readonly values: readonly AxisValue[];
}

/** A fully-labelled sweep point: label + the overrides to merge onto the base. */
export interface SweepPoint {
  readonly label: string;
  readonly overrides: Partial<HarnessConfig>;
}

/** A materialised sweep point: label + the concrete harness config to run. */
export interface SweepConfig {
  readonly label: string;
  readonly config: HarnessConfig;
}

/** Distilled, table-ready result for a single sweep point. */
export interface SweepEntry {
  readonly label: string;
  readonly populationSize: number;
  /** `trainingSampleRate` if the point set one via extraOptions, else `null`. */
  readonly trainingSampleRate: number | null;
  /** `sparseRatio` if the point set one via extraOptions, else `null`. */
  readonly sparseRatio: number | null;
  readonly generations: number;
  readonly initialBestFitness: number;
  readonly finalBestFitness: number;
  readonly bestFitness: number;
  readonly totalElapsedMs: number;
  readonly scorePerHour: number;
}

/** A detected final-score regression of a point below the baseline point. */
export interface ScoreRegression {
  readonly label: string;
  /** `finalBestFitness - baselineFinalBestFitness` (negative = regressed). */
  readonly delta: number;
}

/**
 * Deep-merge a config override onto a base config. All fields are shallow
 * except `extraOptions`, which is merged key-by-key so two axes can each
 * contribute different `NeatOptions` knobs to the same point.
 */
export function mergeConfig(
  base: HarnessConfig,
  overrides: Partial<HarnessConfig>,
): HarnessConfig {
  const mergedExtra = (base.extraOptions || overrides.extraOptions)
    ? { ...base.extraOptions, ...overrides.extraOptions }
    : undefined;
  return withConfigDefaults({
    ...base,
    ...overrides,
    extraOptions: mergedExtra,
  });
}

/**
 * Expand a list of sweep axes into the cartesian product of labelled points.
 * The label of a point joins each axis choice's tag with `+`; overrides from
 * every axis are deep-merged. An empty axis list yields a single unmodified
 * point (label `base`).
 */
export function expandAxes(axes: readonly SweepAxis[]): SweepPoint[] {
  let points: SweepPoint[] = [{ label: "base", overrides: {} }];
  for (const axis of axes) {
    if (axis.values.length === 0) {
      throw new Error(`Sweep axis '${axis.name}' has no values (Issue #3400)`);
    }
    const next: SweepPoint[] = [];
    for (const point of points) {
      for (const value of axis.values) {
        const label = point.label === "base"
          ? value.tag
          : `${point.label}+${value.tag}`;
        const mergedExtra =
          (point.overrides.extraOptions || value.overrides.extraOptions)
            ? {
              ...point.overrides.extraOptions,
              ...value.overrides.extraOptions,
            }
            : undefined;
        next.push({
          label,
          overrides: {
            ...point.overrides,
            ...value.overrides,
            ...(mergedExtra ? { extraOptions: mergedExtra } : {}),
          },
        });
      }
    }
    points = next;
  }
  return points;
}

/**
 * Materialise sweep points into runnable configs against a base config.
 * Throws on a duplicate label (Issue #3234 — a silently-collapsed sweep would
 * hide a config from the comparison table).
 */
export function buildSweepConfigs(
  base: HarnessConfig,
  points: readonly SweepPoint[],
): SweepConfig[] {
  if (points.length === 0) {
    throw new Error("Sweep has no points to run (Issue #3400)");
  }
  const seen = new Set<string>();
  return points.map((point) => {
    if (seen.has(point.label)) {
      throw new Error(
        `Duplicate sweep label '${point.label}' — labels must be unique so no ` +
          "config is dropped from the comparison (Issue #3234)",
      );
    }
    seen.add(point.label);
    return { label: point.label, config: mergeConfig(base, point.overrides) };
  });
}

/** Distil a harness result into a table-ready sweep entry. */
export function summariseEntry(
  label: string,
  config: HarnessConfig,
  result: HarnessResult,
): SweepEntry {
  const extra = config.extraOptions ?? {};
  const rate = extra.trainingSampleRate;
  const sparse = extra.sparseRatio;
  return {
    label,
    populationSize: config.populationSize,
    trainingSampleRate: typeof rate === "number" ? rate : null,
    sparseRatio: typeof sparse === "number" ? sparse : null,
    generations: result.scoreTrajectory.length,
    initialBestFitness: result.initialBestFitness,
    finalBestFitness: result.finalBestFitness,
    bestFitness: result.bestFitness,
    totalElapsedMs: result.totalElapsedMs,
    scorePerHour: result.scorePerHour,
  };
}

/**
 * Rank sweep entries best-first by score-per-hour, tie-broken by final best
 * score then label so the order is deterministic.
 */
export function rankSweep(entries: readonly SweepEntry[]): SweepEntry[] {
  return [...entries].sort((a, b) => {
    if (b.scorePerHour !== a.scorePerHour) {
      return b.scorePerHour - a.scorePerHour;
    }
    if (b.finalBestFitness !== a.finalBestFitness) {
      return b.finalBestFitness - a.finalBestFitness;
    }
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/**
 * Find entries whose final best score regressed below the baseline point's
 * final best score beyond a relative tolerance. This is the machine-independent
 * guardrail: a faster config that reaches a worse score is a regression, not a
 * win. Throws if the baseline label is not present (fail loud, Issue #3234).
 */
export function findScoreRegressions(
  entries: readonly SweepEntry[],
  baselineLabel: string,
  relTolerance = 1e-6,
): ScoreRegression[] {
  const baseline = entries.find((e) => e.label === baselineLabel);
  if (!baseline) {
    throw new Error(
      `Baseline label '${baselineLabel}' is not in the sweep — cannot check ` +
        "for regressions (Issue #3234)",
    );
  }
  const allowance = Math.abs(baseline.finalBestFitness) * relTolerance;
  const regressions: ScoreRegression[] = [];
  for (const entry of entries) {
    if (entry.label === baselineLabel) continue;
    if (entry.finalBestFitness < baseline.finalBestFitness - allowance) {
      regressions.push({
        label: entry.label,
        delta: entry.finalBestFitness - baseline.finalBestFitness,
      });
    }
  }
  return regressions;
}

/** Format a number compactly for the Markdown table. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(3);
  return n.toFixed(3);
}

/**
 * Render a ranked sweep as a GitHub-flavoured Markdown table. The baseline row
 * is tagged so reviewers can read the before/after at a glance.
 */
export function formatSweepMarkdown(
  entries: readonly SweepEntry[],
  baselineLabel: string,
): string {
  const ranked = rankSweep(entries);
  const header =
    "| Rank | Config | Population | trainingSampleRate | sparseRatio | Gens | Final best score | Score/hour | vs baseline |";
  const sep = "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  const baseline = entries.find((e) => e.label === baselineLabel);
  const baseScorePerHour = baseline?.scorePerHour ?? 0;
  const rows = ranked.map((e, i) => {
    const deltaPct = baseScorePerHour !== 0
      ? ((e.scorePerHour - baseScorePerHour) / Math.abs(baseScorePerHour)) * 100
      : 0;
    const tag = e.label === baselineLabel
      ? "baseline"
      : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
    return `| ${i + 1} | ${e.label} | ${e.populationSize} | ${
      e.trainingSampleRate ?? "—"
    } | ${e.sparseRatio ?? "—"} | ${e.generations} | ${
      fmt(e.finalBestFitness)
    } | ${fmt(e.scorePerHour)} | ${tag} |`;
  });
  return [header, sep, ...rows].join("\n");
}

/**
 * Run every sweep config sequentially through the harness in the current
 * session and return the distilled entries in input order. Sequential (not
 * parallel) so the score/hour timings are not distorted by configs contending
 * for the same cores.
 */
export async function runSweep(
  configs: readonly SweepConfig[],
  runner: (config: HarnessConfig) => Promise<HarnessResult> =
    runScorePerHourHarness,
): Promise<SweepEntry[]> {
  const entries: SweepEntry[] = [];
  for (const { label, config } of configs) {
    // Sequential is deliberate: running configs concurrently would make them
    // contend for the same cores and distort the score/hour timings we measure.
    // deno-lint-ignore no-await-in-loop
    const result = await runner(config);
    entries.push(summariseEntry(label, config, result));
  }
  return entries;
}

// ──────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────

/** Parse a comma-separated list of finite numbers, or `undefined` if absent. */
function numList(raw: string | undefined): number[] | undefined {
  if (raw === undefined) return undefined;
  const values = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) {
        throw new Error(`'${s}' is not a finite number`);
      }
      return n;
    });
  if (values.length === 0) throw new Error("empty numeric list");
  return values;
}

/** Build the sweep axes from CLI list flags (Issue #3400). */
export function buildAxesFromLists(lists: {
  populations?: number[];
  trainingSampleRates?: number[];
  sparseRatios?: number[];
}): SweepAxis[] {
  const axes: SweepAxis[] = [];
  if (lists.populations && lists.populations.length > 0) {
    axes.push({
      name: "population",
      values: lists.populations.map((p) => ({
        tag: `pop${p}`,
        overrides: { populationSize: p },
      })),
    });
  }
  if (lists.trainingSampleRates && lists.trainingSampleRates.length > 0) {
    axes.push({
      name: "trainingSampleRate",
      values: lists.trainingSampleRates.map((r) => ({
        tag: `rate${r}`,
        overrides: { extraOptions: { trainingSampleRate: r } },
      })),
    });
  }
  if (lists.sparseRatios && lists.sparseRatios.length > 0) {
    axes.push({
      name: "sparseRatio",
      values: lists.sparseRatios.map((s) => ({
        tag: `sparse${s}`,
        overrides: { extraOptions: { sparseRatio: s } },
      })),
    });
  }
  return axes;
}

function parseCliArgs(args: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) map.set(match[1], match[2]);
    else if (arg.startsWith("--")) map.set(arg.slice(2), "true");
  }
  return map;
}

async function main(args: string[]): Promise<number> {
  const map = parseCliArgs(args);
  const num = (key: string): number | undefined => {
    const raw = map.get(key);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`--${key} must be a finite number, got '${raw}'`);
    }
    return value;
  };

  const scaleRaw = map.get("scale");
  if (
    scaleRaw !== undefined && scaleRaw !== "default" &&
    scaleRaw !== "grq-cluster" && scaleRaw !== "grq-3397"
  ) {
    throw new Error(
      `--scale must be one of default|grq-cluster|grq-3397, got '${scaleRaw}'`,
    );
  }

  const base = withConfigDefaults({
    seed: num("seed"),
    scale: scaleRaw as HarnessConfig["scale"] | undefined,
    inputCount: num("inputs"),
    outputCount: num("outputs"),
    sampleCount: num("samples"),
    populationSize: num("population"),
    maxGenerations: num("max-generations"),
    timeBudgetMs: num("time-budget-ms"),
    threads: num("threads"),
    trainPerGen: num("train-per-gen"),
    discoverySampleRate: num("discovery-sample-rate"),
  });

  const axes = buildAxesFromLists({
    populations: numList(map.get("populations")) ?? [base.populationSize],
    trainingSampleRates: numList(map.get("training-sample-rates")),
    sparseRatios: numList(map.get("sparse-ratios")),
  });

  const points = expandAxes(axes);
  const configs = buildSweepConfigs(base, points);
  const baselineLabel = map.get("baseline-label") ?? configs[0].label;
  if (!configs.some((c) => c.label === baselineLabel)) {
    throw new Error(
      `--baseline-label='${baselineLabel}' is not one of the sweep points: ` +
        configs.map((c) => c.label).join(", "),
    );
  }

  console.error(
    `Running ${configs.length} sweep configs on scale=${base.scale} ` +
      `(${base.maxGenerations} gens cap, seed=${base.seed}); ` +
      `baseline=${baselineLabel}`,
  );

  const entries = await runSweep(configs);
  const regressions = findScoreRegressions(entries, baselineLabel);
  const markdown = formatSweepMarkdown(entries, baselineLabel);

  console.log("\n" + markdown + "\n");
  if (regressions.length > 0) {
    console.error("Final-score regressions vs baseline (not a win):");
    for (const r of regressions) {
      console.error(`  - ${r.label}: Δ final score ${r.delta}`);
    }
  } else {
    console.error("No final-score regression vs baseline in this sweep.");
  }

  const output = {
    schemaVersion: 1,
    scale: base.scale,
    seed: base.seed,
    maxGenerations: base.maxGenerations,
    timeBudgetMs: base.timeBudgetMs,
    trainPerGen: base.trainPerGen,
    baselineLabel,
    entries: rankSweep(entries),
    regressions,
  };

  const out = map.get("out");
  if (out) {
    await Deno.writeTextFile(out, JSON.stringify(output, null, 2) + "\n");
    console.error(`Wrote sweep JSON to ${out}`);
  }
  const md = map.get("md");
  if (md) {
    await Deno.writeTextFile(md, markdown + "\n");
    console.error(`Wrote sweep table to ${md}`);
  }

  return 0;
}

if (import.meta.main) {
  main(Deno.args)
    .then((code) => {
      if (code !== 0) Deno.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    });
}
