/**
 * Cross-species breeding baseline harness (Issue #2654).
 *
 * Establishes the shared baseline for the cross-species breeding
 * improvement track (#2653). Loads a low-compatibility parent pair
 * (defaults vendored under `test/fixtures/cross-species/`) and runs
 * the standard breeding pipeline through `createCompatibleFather`
 * via `Offspring.breed()` N times, recording shared-neuron
 * proportions of each offspring vs each parent. Each downstream
 * strategy sub-issue (anchor-derived pseudo-UUIDs #2614, structural
 * alignment, subgraph transplant #2177) reuses this harness to
 * report a strict before/after run against the same baseline.
 *
 * ## Statistical protocol
 *
 * - **Test**: two-sample Mann–Whitney U (a.k.a. Wilcoxon rank-sum),
 *   two-sided, normal approximation with tie correction and
 *   continuity correction. Implemented in
 *   `src/utils/Statistics.ts::mannWhitneyU`.
 * - **Sample size**: `N = 200` offspring per parent pair (configurable
 *   via the `--n` flag below). The Mann–Whitney normal approximation
 *   is reliable from `N >= 20`; `N = 200` keeps the run well under the
 *   bench-time budget while giving each strategy a comfortable margin
 *   to demonstrate effect size.
 * - **Significance level**: `alpha = 0.05`. A strategy improves the
 *   baseline when both the mean shared-neuron proportion is higher
 *   **and** the two-sided p-value is `<= 0.05`.
 *
 * ## Output
 *
 * Prints a stable JSON object to stdout. The schema is intentionally
 * minimal so downstream tooling can `git diff` two runs to inspect
 * delta:
 *
 * ```json
 * {
 *   "issue": 2654,
 *   "n": 200,
 *   "mother": "europa.json",
 *   "father": "grq-cluster.json",
 *   "baselineCompatibility": 0.0,
 *   "vsMother":  { "n": 200, "mean": ..., "stddev": ..., "min": ..., "max": ..., "values": [...] },
 *   "vsFather":  { "n": 200, "mean": ..., "stddev": ..., "min": ..., "max": ..., "values": [...] },
 *   "minOfBoth": { "n": 200, "mean": ..., "stddev": ..., "min": ..., "max": ..., "values": [...] }
 * }
 * ```
 *
 * ## Reuse from a strategy sub-issue
 *
 * Each downstream strategy imports `runBaseline()` from this file,
 * passes its own breeding entry point (so the new strategy is
 * exercised), captures the resulting `values` array, and feeds both
 * `values` arrays into `mannWhitneyU()` to obtain the `p` value
 * against the baseline.
 *
 * ## Running
 *
 * ```
 * deno run --allow-read bench/CrossSpeciesBreedingProportion.ts [--n=200] [--out=path.json]
 * ```
 *
 * @module
 */

import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { describe } from "@utils/Statistics.ts";

const DEFAULT_N = 200;
const DEFAULT_MOTHER = "test/fixtures/cross-species/europa.json";
const DEFAULT_FATHER = "test/fixtures/cross-species/grq-cluster.json";

/**
 * Per-offspring shared-neuron measurement for one breed call.
 */
export interface OffspringSample {
  /** Shared-neuron proportion of offspring vs mother. */
  readonly vsMother: number;
  /** Shared-neuron proportion of offspring vs father. */
  readonly vsFather: number;
  /** `min(vsMother, vsFather)` — the worst-case alignment per child. */
  readonly minOfBoth: number;
}

/**
 * Result of running `runBaseline()` on a parent pair.
 */
export interface BaselineResult {
  /** Sample size actually produced (offspring that breeding returned). */
  readonly n: number;
  /** `geneticCompatibility(mother, father)` recorded once at start. */
  readonly baselineCompatibility: number;
  /** Per-offspring measurements. */
  readonly samples: OffspringSample[];
}

/**
 * Computes the proportion of `child`'s hidden-neuron wire keys that also
 * appear in `parent`'s hidden-neuron wire keys. Returns `1` when the
 * child has no hidden neurons (vacuous match — same convention as
 * `geneticCompatibility`).
 */
export function sharedNeuronProportion(
  child: Creature,
  parent: Creature,
): number {
  const childKeys = child.getHiddenNeuronWireKeys();
  if (childKeys.size === 0) return 1;
  const parentKeys = parent.getHiddenNeuronWireKeys();
  let matches = 0;
  for (const k of childKeys) {
    if (parentKeys.has(k)) matches++;
  }
  return matches / childKeys.size;
}

/**
 * Run the breeding pipeline N times against the same parent pair and
 * collect per-offspring shared-neuron proportions.
 *
 * Uses the standard `Offspring.breed()` entry point with
 * `interSpeciesCrossoverThreshold = 0`, which keeps breeding on the
 * default crossover path through `createCompatibleFather` — the path
 * the downstream strategies want to compare against.
 */
export function runBaseline(
  mother: Creature,
  father: Creature,
  n: number = DEFAULT_N,
): BaselineResult {
  const baselineCompatibility = geneticCompatibility(mother, father);
  const samples: OffspringSample[] = [];
  let attempts = 0;
  // Cap attempts at 4N so a high failure rate does not produce an
  // infinitely-looping bench.
  const maxAttempts = n * 4;
  while (samples.length < n && attempts < maxAttempts) {
    attempts++;
    const child = Offspring.breed(mother, father, {
      geneticCompatibilityThreshold: 0,
      interSpeciesCrossoverThreshold: 0,
      forwardOnly: true,
    });
    if (!child) continue;
    const vsMother = sharedNeuronProportion(child, mother);
    const vsFather = sharedNeuronProportion(child, father);
    samples.push({
      vsMother,
      vsFather,
      minOfBoth: Math.min(vsMother, vsFather),
    });
  }
  return { n: samples.length, baselineCompatibility, samples };
}

/**
 * Summarise the per-axis distributions and emit a JSON payload that is
 * stable enough to `git diff` between runs.
 */
export function summarise(
  result: BaselineResult,
  motherLabel: string,
  fatherLabel: string,
): Record<string, unknown> {
  const vsMother = result.samples.map((s) => s.vsMother);
  const vsFather = result.samples.map((s) => s.vsFather);
  const minOfBoth = result.samples.map((s) => s.minOfBoth);

  const fmt = (values: number[]) => {
    const d = describe(values);
    return {
      n: d.n,
      mean: round(d.mean),
      stddev: round(d.stddev),
      min: round(d.min),
      max: round(d.max),
      values: values.map((v) => round(v)),
    };
  };

  return {
    issue: 2654,
    n: result.n,
    mother: motherLabel,
    father: fatherLabel,
    baselineCompatibility: round(result.baselineCompatibility),
    vsMother: fmt(vsMother),
    vsFather: fmt(vsFather),
    minOfBoth: fmt(minOfBoth),
  };
}

function round(x: number, digits = 6): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

/**
 * Parse a `--key=value` flag from `Deno.args`, returning `undefined`
 * when absent.
 */
function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of Deno.args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

async function loadCreature(path: string): Promise<Creature> {
  const json = JSON.parse(await Deno.readTextFile(path));
  const c = Creature.fromJSON(json);
  c.validate();
  return c;
}

if (import.meta.main) {
  const n = Number(flag("n") ?? DEFAULT_N);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid --n value: ${flag("n")}`);
    Deno.exit(2);
  }
  const motherPath = flag("mother") ?? DEFAULT_MOTHER;
  const fatherPath = flag("father") ?? DEFAULT_FATHER;
  const outPath = flag("out");

  const mother = await loadCreature(motherPath);
  const father = await loadCreature(fatherPath);

  const result = runBaseline(mother, father, n);
  const payload = summarise(
    result,
    motherPath.split("/").pop() ?? motherPath,
    fatherPath.split("/").pop() ?? fatherPath,
  );
  const text = JSON.stringify(payload, null, 2) + "\n";
  if (outPath) {
    await Deno.writeTextFile(outPath, text);
    console.error(`wrote ${outPath} (${result.n} offspring)`);
  } else {
    console.log(text);
  }
}
