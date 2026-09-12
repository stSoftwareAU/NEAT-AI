/**
 * Issue #3927 — does a sub-sampled fitness score rank our creatures the way
 * the full corpus does?
 *
 * This is the evidence gate for the whole multi-fidelity sweep (#3919). Issue
 * #3926 made a sampled corpus obtainable; nothing has ever measured whether
 * the ordering it produces is the same ordering. Jin (2011) §2/§4 is emphatic
 * that ordering — not accuracy — is the property selection consumes, so a
 * cheap fitness is safe exactly when it preserves ranks and unsafe otherwise,
 * however good its absolute error looks.
 *
 * What it does:
 *   1. Loads a population of real creatures from a directory of `*.json`.
 *   2. Scores every creature over the **full** corpus. That ordering is the
 *      ground truth every other fidelity is judged against.
 *   3. For each sampled rate, scores every creature over each distinct stride
 *      **phase** of that rate, and reports Spearman ρ, Kendall τ, top-1/3/5
 *      agreement, score-gap resolution in absolute score units, phase-to-phase
 *      spread, and wall-clock.
 *   4. Applies Issue #3927's three failure signals and names the cheapest safe
 *      rate — or reports that none is safe, which is a result, not an error.
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   scripts/rank_fidelity_sweep.ts \
 *   --creatures=/path/to/creature-samples \
 *   --corpus=/data/trainData-binary \
 *   --rates=1,0.5,0.25,0.1,0.05,0.01 --phases=4
 * ```
 *
 * `--corpus` names the real corpus. `--synthetic-records=<n>` stands in for it
 * when the production corpus is not reachable; the two are mutually exclusive
 * and the corpus provenance is stamped on every line of output, so a table
 * measured against synthetic data can never be read as a production result.
 *
 * This is a measurement harness, not a production code path: nothing under
 * `src/` imports it, and it changes no scoring behaviour.
 */

import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import {
  adjacentGaps,
  assertFidelityRate,
  assessRate,
  distinctPhaseCount,
  type FidelityThresholds,
  gapResolution,
  kendallTau,
  median,
  type PhaseSpread,
  phaseSpread,
  type RateVerdict,
  recommendRate,
  spearmanRho,
  strideForRate,
  stridePhaseIndices,
  topKAgreement,
} from "./lib/rankFidelity.ts";

/** The full corpus — the fidelity every other one is judged against. */
const FULL_RATE = 1;
/** Records per `.bin` shard, as production publishes them. */
const RECORDS_PER_SHARD = 2_000;
/** Population sizes below this cannot resolve a top-5 agreement. */
const MIN_TOP_K_POPULATION = 5;
/**
 * The `k`s `markdownReport` prints as fixed columns. A sweep that did not
 * measure them would print `NaN` cells and hand `assessRate` a top-1 that was
 * never taken, so they are required rather than defaulted.
 */
const REPORTED_TOP_K = [1, 3, 5];

/** Where the corpus came from — stamped on every report. */
export type CorpusProvenance = "production" | "synthetic";

/** One rate/phase stratum's measurement. */
export interface PhaseResult {
  readonly phase: number;
  readonly records: number;
  /** Wall-clock to score the whole population over this stratum. */
  readonly msElapsed: number;
  /** Per-creature error, in the population's input order. */
  readonly errors: readonly number[];
  readonly spearmanRho: number;
  readonly kendallTau: number;
  /** Top-k agreement keyed by k. */
  readonly topK: Readonly<Record<number, number>>;
  readonly gapResolution: number;
}

/** Summary statistics over the phases of one rate. */
export interface Spread {
  readonly min: number;
  readonly mean: number;
  readonly max: number;
}

/** One rate's measurement, aggregated over its phases. */
export interface RateResult {
  readonly rate: number;
  readonly stride: number;
  /** Distinct strata measured — capped by the stride, never inflated. */
  readonly phasesMeasured: number;
  /**
   * Records in phase 0's stratum. Later phases hold one fewer when the corpus
   * does not divide by the stride; the per-phase counts are in `phases`.
   */
  readonly records: number;
  readonly phases: readonly PhaseResult[];
  readonly spearmanRho: Spread;
  readonly kendallTau: Spread;
  /** Top-k agreement summarised across phases, keyed by k. */
  readonly topK: Readonly<Record<number, Spread>>;
  /** The coarsest gap any phase of this rate failed to order. */
  readonly gapResolutionWorst: number;
  readonly phaseSpread: PhaseSpread;
  readonly msPerPassMean: number;
  /** `msPerPassMean` as a fraction of the full-corpus pass. */
  readonly ratioToFull: number;
  /**
   * `null` for the full corpus: it is the ground truth, so it cannot disagree
   * with itself and is not assessed.
   */
  readonly verdict: RateVerdict | null;
}

/** The full sweep. */
export interface SweepResult {
  readonly corpusProvenance: CorpusProvenance;
  readonly records: number;
  readonly population: number;
  readonly creatureNames: readonly string[];
  /** Full-corpus error per creature — the ground-truth ordering. */
  readonly truthErrors: readonly number[];
  readonly truthSpread: {
    readonly best: number;
    readonly worst: number;
    readonly smallestAdjacentGap: number;
    readonly medianAdjacentGap: number;
  };
  readonly thresholds: FidelityThresholds;
  readonly rates: readonly RateResult[];
  /** The cheapest rate that tripped no failure signal, or `null`. */
  readonly recommendedRate: number | null;
}

/** What the sweep needs; the CLI below assembles it from argv. */
export interface SweepOptions {
  readonly creatures: readonly Creature[];
  readonly creatureNames: readonly string[];
  readonly corpus: readonly DataRecordInterface[];
  readonly corpusProvenance: CorpusProvenance;
  readonly rates: readonly number[];
  /** Phases requested per rate; a rate with fewer strata reports fewer. */
  readonly phases: number;
  readonly topK: readonly number[];
  /** The finest improvement the search accepts, in score units. */
  readonly acceptGap: number;
  /** Top-1 agreement below this is a failure signal. */
  readonly minTop1: number;
  /**
   * Wall-clock source, default `performance.now()`. Injected so a smoke test
   * drives a virtual clock: a unit test must assert what the harness measured
   * over, never how long a machine took (AGENTS.md testing policy).
   */
  readonly now?: () => number;
}

/**
 * Every rate must be a fidelity, and the full corpus must be among them: the
 * ground-truth ordering everything is reported against is the full corpus, so
 * it has to be scored.
 */
function assertRates(rates: readonly number[]): void {
  for (const rate of rates) assertFidelityRate(rate);
  if (!rates.includes(FULL_RATE)) {
    throw new Error(
      `--rates must include ${FULL_RATE}: the ground-truth ordering is the ` +
        `full corpus, so the full corpus has to be scored`,
    );
  }
}

/** Scores the whole population over one corpus directory, once. */
async function scorePopulation(
  creatures: readonly Creature[],
  dataDir: string,
  now: () => number,
): Promise<{ errors: number[]; msElapsed: number }> {
  const cost = Costs.find("MSE");
  const errors: number[] = [];
  const started = now();
  for (const creature of creatures) {
    // Sequential on purpose: concurrent scoring would measure the host's
    // parallelism rather than the per-record cost being compared.
    // deno-lint-ignore no-await-in-loop
    const { error } = await creature.evaluateDir(dataDir, cost, false);
    if (!Number.isFinite(error)) {
      throw new Error(`non-finite score from ${dataDir}: ${error}`);
    }
    errors.push(error);
  }
  return { errors, msElapsed: now() - started };
}

/** Publishes `rows` as the `.bin` shards a run is pointed at. */
function publishStratum(rows: readonly DataRecordInterface[]): string {
  if (rows.length === 0) {
    throw new Error("refusing to publish an empty stratum");
  }
  return makeDataDir([...rows], RECORDS_PER_SHARD, {
    input: rows[0].input.length,
    output: rows[0].output.length,
  });
}

/** min / mean / max of a non-empty sample. */
function summarise(values: readonly number[]): Spread {
  if (values.length === 0) {
    throw new Error("nothing to summarise — no phase produced a value");
  }
  let total = 0;
  for (const value of values) total += value;
  return {
    min: Math.min(...values),
    mean: total / values.length,
    max: Math.max(...values),
  };
}

/** Refuses a population the harness cannot compare, before anything is scored. */
function assertPopulation(
  options: SweepOptions,
): void {
  if (options.creatures.length !== options.creatureNames.length) {
    throw new Error(
      `${options.creatures.length} creatures but ` +
        `${options.creatureNames.length} names`,
    );
  }
  if (options.creatures.length < MIN_TOP_K_POPULATION) {
    throw new Error(
      `at least ${MIN_TOP_K_POPULATION} creatures are needed to report ` +
        `top-5 agreement, got ${options.creatures.length}`,
    );
  }
  if (options.corpus.length === 0) {
    throw new Error("the corpus holds no records — nothing to score");
  }
  for (const k of options.topK) {
    if (!Number.isInteger(k) || k < 1 || k > options.creatures.length) {
      throw new Error(
        `top-k ${k} is outside [1, ${options.creatures.length}]`,
      );
    }
  }
  for (const k of REPORTED_TOP_K) {
    if (!options.topK.includes(k)) {
      throw new Error(
        `top-k must include ${REPORTED_TOP_K.join(", ")} — the report has a ` +
          `column for each and would otherwise print a figure never measured`,
      );
    }
  }
  const { input, output } = options.corpus[0];
  for (let i = 0; i < options.creatures.length; i++) {
    const creature = options.creatures[i];
    if (creature.input !== input.length || creature.output !== output.length) {
      throw new Error(
        `${options.creatureNames[i]} is ${creature.input}→${creature.output} ` +
          `but the corpus is ${input.length}→${output.length}`,
      );
    }
  }
}

/** Runs the sweep and returns the full evidence table. */
export async function measureRankFidelity(
  options: SweepOptions,
): Promise<SweepResult> {
  assertRates(options.rates);
  assertPopulation(options);
  const now = options.now ?? (() => performance.now());
  const total = options.corpus.length;

  // Descending, so the full corpus is scored before anything is compared to it.
  const ordered = [...options.rates].sort((a, b) => b - a);
  let truthErrors: number[] | null = null;
  let fullMs = 0;
  const results: RateResult[] = [];

  for (const rate of ordered) {
    const stride = strideForRate(rate);
    const phaseCount = distinctPhaseCount(rate, options.phases);
    const phases: PhaseResult[] = [];

    for (let phase = 0; phase < phaseCount; phase++) {
      const indices = stridePhaseIndices(total, rate, phase);
      const rows = indices.map((index) => options.corpus[index]);
      const dir = publishStratum(rows);
      try {
        // deno-lint-ignore no-await-in-loop
        const { errors, msElapsed } = await scorePopulation(
          options.creatures,
          dir,
          now,
        );
        if (truthErrors === null) {
          if (rate !== FULL_RATE) {
            throw new Error(
              `rate ${rate} was scored before the full corpus — there is no ` +
                `ground-truth ordering to compare it against`,
            );
          }
          truthErrors = errors;
          fullMs = msElapsed;
          // Checked here, before any correlation is attempted, so the report
          // names the real problem rather than failing inside Spearman.
          if (adjacentGaps(truthErrors).length === 0) {
            throw new Error(
              "every creature scored identically on the full corpus — " +
                "there is no ordering to preserve, so rank fidelity is " +
                "unmeasurable",
            );
          }
        }
        const topK: Record<number, number> = {};
        for (const k of options.topK) {
          topK[k] = topKAgreement(truthErrors, errors, k);
        }
        phases.push({
          phase,
          records: rows.length,
          msElapsed,
          errors,
          spearmanRho: spearmanRho(truthErrors, errors),
          kendallTau: kendallTau(truthErrors, errors),
          topK,
          gapResolution: gapResolution(truthErrors, errors),
        });
      } finally {
        // deno-lint-ignore no-await-in-loop
        await Deno.remove(dir, { recursive: true });
      }
    }

    if (phases.length === 0) {
      throw new Error(`rate ${rate} produced no measurement`);
    }
    const topK: Record<number, Spread> = {};
    for (const k of options.topK) {
      topK[k] = summarise(phases.map((p) => p.topK[k]));
    }
    const spread = phaseSpread(phases.map((p) => p.errors));
    const msPerPassMean = summarise(phases.map((p) => p.msElapsed)).mean;
    const gapResolutionWorst = Math.max(
      ...phases.map((p) => p.gapResolution),
    );
    results.push({
      rate,
      stride,
      phasesMeasured: phases.length,
      records: phases[0].records,
      phases,
      spearmanRho: summarise(phases.map((p) => p.spearmanRho)),
      kendallTau: summarise(phases.map((p) => p.kendallTau)),
      topK,
      gapResolutionWorst,
      phaseSpread: spread,
      msPerPassMean,
      ratioToFull: msPerPassMean / fullMs,
      // Filled in below, once the ground-truth ordering has produced the
      // adjacent-gap threshold the failure signals are stated against.
      verdict: null,
    });
  }

  if (truthErrors === null) {
    throw new Error("the full corpus was never scored — no ground truth");
  }
  const gaps = adjacentGaps(truthErrors);
  const thresholds: FidelityThresholds = {
    minTop1: options.minTop1,
    acceptGap: options.acceptGap,
    adjacentGap: median(gaps),
  };
  const assessed = results.map((result) =>
    result.rate === FULL_RATE ? result : {
      ...result,
      verdict: assessRate({
        rate: result.rate,
        // Present by construction: `assertPopulation` refuses a sweep whose
        // top-k set omits the ks the verdict and the report are stated over.
        top1: result.topK[1].mean,
        gapResolution: result.gapResolutionWorst,
        phaseSpreadMax: result.phaseSpread.max,
      }, thresholds),
    }
  );

  return {
    corpusProvenance: options.corpusProvenance,
    records: total,
    population: options.creatures.length,
    creatureNames: [...options.creatureNames],
    truthErrors,
    truthSpread: {
      best: Math.min(...truthErrors),
      worst: Math.max(...truthErrors),
      smallestAdjacentGap: Math.min(...gaps),
      medianAdjacentGap: median(gaps),
    },
    thresholds,
    rates: assessed,
    recommendedRate: recommendRate(
      assessed
        .map((result) => result.verdict)
        .filter((verdict): verdict is RateVerdict => verdict !== null),
    ),
  };
}

/** The evidence table, as committed Markdown. */
export function markdownReport(result: SweepResult): string {
  const lines: string[] = [];
  lines.push(
    `Corpus: **${result.corpusProvenance}**, ${result.records} records; ` +
      `population: ${result.population} creatures.`,
    "",
    "| Rate | Stride | Phases | Records | Spearman ρ (min–max) | " +
      "Kendall τ (min–max) | Top-1 | Top-3 | Top-5 | Gap resolution | " +
      "Phase spread (max) | ms / pass | vs full |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | " +
      "--- | --- |",
  );
  for (const rate of result.rates) {
    const spreadCell = Number.isNaN(rate.phaseSpread.max)
      ? "n/a"
      : rate.phaseSpread.max.toExponential(2);
    lines.push(
      `| ${rate.rate} | ${rate.stride} | ${rate.phasesMeasured} | ` +
        `${rate.records} | ${rate.spearmanRho.min.toFixed(4)}–` +
        `${rate.spearmanRho.max.toFixed(4)} | ` +
        `${rate.kendallTau.min.toFixed(4)}–` +
        `${rate.kendallTau.max.toFixed(4)} | ` +
        `${rate.topK[1].mean.toFixed(3)} | ` +
        `${rate.topK[3].mean.toFixed(3)} | ` +
        `${rate.topK[5].mean.toFixed(3)} | ` +
        `${rate.gapResolutionWorst.toExponential(2)} | ${spreadCell} | ` +
        `${rate.msPerPassMean.toFixed(0)} | ${rate.ratioToFull.toFixed(3)} |`,
    );
  }
  lines.push(
    "",
    `Full-corpus scores span ${result.truthSpread.best.toPrecision(8)} – ` +
      `${result.truthSpread.worst.toPrecision(8)}; smallest adjacent gap ` +
      `${result.truthSpread.smallestAdjacentGap.toExponential(2)}, median ` +
      `${result.truthSpread.medianAdjacentGap.toExponential(2)}.`,
    "",
    "### Verdict",
    "",
  );
  for (const rate of result.rates) {
    if (rate.verdict === null) continue;
    lines.push(
      rate.verdict.safe
        ? `- Rate ${rate.rate}: **safe** — no failure signal tripped.`
        : `- Rate ${rate.rate}: **unsafe** — ${
          rate.verdict.failures.join("; ")
        }.`,
    );
  }
  const sampled = result.rates.filter((rate) => rate.verdict !== null);
  lines.push(
    "",
    sampled.length === 0
      // Only the full corpus was scored, so there is nothing to recommend.
      // Saying "no rate is safe" here would report a finding never measured.
      ? "**No sampled rate was measured** — the sweep scored only the full " +
        "corpus, so it reaches no verdict on any fidelity."
      : result.recommendedRate === null
      ? "**No sampled rate is safe.** Every rate measured trips at least one " +
        "of Issue #3927's failure signals, so the full corpus stays the " +
        "fitness of record."
      : `**Recommended rate: ${result.recommendedRate}** — the cheapest rate ` +
        `that tripped no failure signal.`,
  );
  return lines.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function stringArg(args: string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function numberArg(args: string[], name: string, fallback: number): number {
  const raw = stringArg(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} is not a number`);
  return value;
}

/** Loads every `*.json` creature in `dir`, in sorted name order. */
export function loadCreatures(
  dir: string,
  minCreatures: number,
): { creatures: Creature[]; names: string[] } {
  const names = [...Deno.readDirSync(dir)]
    .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (names.length < minCreatures) {
    throw new Error(
      `${dir} holds ${names.length} creatures, fewer than the ` +
        `${minCreatures} required. Pass --min-creatures to acknowledge a ` +
        `smaller population rather than reporting one silently.`,
    );
  }
  const creatures = names.map((name) =>
    Creature.fromJSON(JSON.parse(Deno.readTextFileSync(`${dir}/${name}`)))
  );
  return { creatures, names };
}

/**
 * Reads exactly `limit` records from a corpus directory of `.bin` shards.
 *
 * Shards are read in **lexicographic name order**, which makes the harness
 * reproducible but is *not* the order a run streams them in:
 * `readDatasetDirEntriesSync` in `src/architecture/DatasetIO.ts` returns raw
 * `Deno.readDirSync` order. Record order matters here because a stride draws
 * its strata from it, so a corpus whose records carry an order that means
 * something — a time series, say — must be presented to this harness in that
 * order for the phase columns to describe real strata.
 */
export function loadCorpus(
  dir: string,
  inputs: number,
  outputs: number,
  limit: number,
): DataRecordInterface[] {
  const values = inputs + outputs;
  const bytesPerRecord = values * Float32Array.BYTES_PER_ELEMENT;
  const shards = [...Deno.readDirSync(dir)]
    .filter((entry) => entry.isFile && entry.name.endsWith(".bin"))
    .map((entry) => entry.name)
    .sort();
  if (shards.length === 0) {
    throw new Error(`${dir} holds no .bin shards`);
  }
  const records: DataRecordInterface[] = [];
  for (const shard of shards) {
    if (records.length >= limit) break;
    const bytes = Deno.readFileSync(`${dir}/${shard}`);
    if (bytes.length % bytesPerRecord !== 0) {
      throw new Error(
        `${shard} is ${bytes.length} bytes, not a whole number of ` +
          `${bytesPerRecord}-byte ${inputs}→${outputs} records`,
      );
    }
    const floats = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.length / Float32Array.BYTES_PER_ELEMENT,
    );
    for (let at = 0; at + values <= floats.length && records.length < limit;) {
      records.push({
        input: floats.slice(at, at + inputs),
        output: floats.slice(at + inputs, at + values),
      });
      at += values;
    }
  }
  if (records.length < limit) {
    throw new Error(
      `${dir} holds ${records.length} records, fewer than the ${limit} ` +
        `asked for — lower --records rather than measuring a shorter corpus ` +
        `than the one reported`,
    );
  }
  return records;
}

if (import.meta.main) {
  const args = Deno.args;
  const creaturesDir = stringArg(args, "creatures");
  if (!creaturesDir) {
    throw new Error(
      "--creatures=<dir> is required: the sweep measures a real population",
    );
  }
  const corpusDir = stringArg(args, "corpus");
  const syntheticRecords = stringArg(args, "synthetic-records");
  if ((corpusDir === undefined) === (syntheticRecords === undefined)) {
    throw new Error(
      "pass exactly one of --corpus=<dir> or --synthetic-records=<n>: a " +
        "table has to say which corpus produced it",
    );
  }

  const { creatures, names } = loadCreatures(
    creaturesDir,
    numberArg(args, "min-creatures", 50),
  );
  const inputs = creatures[0].input;
  const outputs = creatures[0].output;

  let corpus: DataRecordInterface[];
  let provenance: CorpusProvenance;
  if (corpusDir !== undefined) {
    // No default: a corpus of hundreds of millions of records with an implied
    // cap would score a prefix and report it as the full-corpus ground truth.
    if (stringArg(args, "records") === undefined) {
      throw new Error(
        "--records=<n> is required with --corpus: the ground-truth ordering " +
          "is whatever this harness scores, so how much of the corpus that " +
          "is has to be stated rather than defaulted",
      );
    }
    corpus = loadCorpus(
      corpusDir,
      inputs,
      outputs,
      numberArg(args, "records", 0),
    );
    provenance = "production";
  } else {
    const { createSeededRng, generateTrainingData } = await import(
      "../test/propagate/large/ProductionScaleCreature.ts"
    );
    const count = Number(syntheticRecords);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`--synthetic-records must be a positive integer`);
    }
    corpus = generateTrainingData(
      inputs,
      outputs,
      count,
      createSeededRng(numberArg(args, "seed", 3927)),
    );
    provenance = "synthetic";
  }

  const ratesArg = stringArg(args, "rates");
  const result = await measureRankFidelity({
    creatures,
    creatureNames: names,
    corpus,
    corpusProvenance: provenance,
    rates: ratesArg
      ? ratesArg.split(",").map(Number)
      : [1, 0.5, 0.25, 0.1, 0.05, 0.01],
    phases: numberArg(args, "phases", 4),
    topK: [1, 3, 5],
    acceptGap: numberArg(args, "accept-gap", 1e-5),
    minTop1: numberArg(args, "min-top1", 0.9),
  });

  console.log(markdownReport(result));
  const out = stringArg(args, "json");
  if (out) Deno.writeTextFileSync(out, JSON.stringify(result, null, 2));
}
