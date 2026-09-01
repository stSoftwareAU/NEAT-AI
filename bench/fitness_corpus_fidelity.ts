/**
 * Issue #3926 — wall-clock per generation against corpora of different
 * fidelity.
 *
 * The multi-fidelity claim is arithmetic, not algorithmic: scoring a corpus
 * one tenth the size does roughly one tenth of the per-record work, so a
 * generation costs roughly one tenth of the wall-clock. This harness measures
 * that claim rather than assuming it — the issue is explicit that a result
 * which does *not* scale must be reported, not tuned away.
 *
 * What it does:
 *   1. Generates the GRQ sampler creature deterministically — the `grq-3926`
 *      preset, 5,317 neurons / 39,031 synapses / 2,511 inputs, forward-only.
 *   2. Materialises one full corpus and the sampled corpora derived from it,
 *      each as a single `.bin` shard, exactly as NEAT-AI-Refinery publishes.
 *      A sampled corpus is a **stride** of the full one, so every fidelity
 *      scores the same distribution of records.
 *   3. Scores a population against each corpus and reports milliseconds per
 *      generation, plus the ratio against the full corpus.
 *
 * Nothing here changes the scorer, `RustScorerConfig`, or either bridge: each
 * fidelity is an ordinary dataset directory handed to `evaluateDir`.
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   bench/fitness_corpus_fidelity.ts \
 *   --records=8000 --rates=1,0.5,0.1 --population=4 --seed=3926
 * ```
 *
 * Silent-failure guard (Issue #3234): a fidelity that produced no timing, or a
 * corpus whose record count does not match the rate it was cut at, throws.
 */

import { Creature } from "@creature";
import { Costs } from "@costs";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { readFitnessCorpusProvenance } from "@architecture/FitnessCorpusProvenance.ts";
import {
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "../test/propagate/large/ProductionScaleCreature.ts";

/** One fidelity's measurement. */
export interface FidelityMeasurement {
  /** Fitness sample rate the corpus was cut at. */
  readonly rate: number;
  /** Records the corpus holds. */
  readonly records: number;
  /** Bytes on disk. */
  readonly bytes: number;
  /** Wall-clock for one generation — scoring the whole population once. */
  readonly msPerGeneration: number;
  /** `msPerGeneration` as a fraction of the full-corpus generation. */
  readonly ratioToFull: number;
}

const INPUTS = 2511;
const OUTPUTS = 1;
const BYTES_PER_RECORD = (INPUTS + OUTPUTS) * 4;

interface HarnessOptions {
  records: number;
  rates: number[];
  population: number;
  seed: number;
  /**
   * Wall-clock source, default `performance.now()`. Injected so a smoke test
   * can drive a virtual clock: a unit test must assert what the harness
   * *measured over*, never how long a machine took (AGENTS.md testing policy).
   */
  now?: () => number;
}

/** Writes `rows` as the single `.bin` shard Refinery publishes. */
function publishCorpus(
  rows: DataRecordInterface[],
  rate: number,
  sourceRecords: number,
): string {
  const dir = Deno.makeTempDirSync({ prefix: `fidelity-${rate}-` });
  const values = new Float32Array(rows.length * (INPUTS + OUTPUTS));
  let at = 0;
  for (const row of rows) {
    values.set(row.input, at);
    at += INPUTS;
    values.set(row.output, at);
    at += OUTPUTS;
  }
  const name = `sample-${Math.round(rate * 100)}.bin`;
  Deno.writeFileSync(`${dir}/${name}`, new Uint8Array(values.buffer));
  Deno.writeTextFileSync(
    `${dir}/manifest.json`,
    JSON.stringify(
      {
        manifest_version: 1,
        tool: { name: "bench/fitness_corpus_fidelity.ts", version: "1" },
        transform: { name: "sample", parameters: { rate } },
        record_shape: {
          inputs: INPUTS,
          outputs: OUTPUTS,
          record_values: INPUTS + OUTPUTS,
          bytes_per_record: BYTES_PER_RECORD,
          encoding: "float32",
        },
        source: { path: "synthetic", record_count: sourceRecords },
        output: { file: name, record_count: rows.length },
      },
      null,
      2,
    ),
  );
  return dir;
}

/**
 * Takes every `1/rate`-th record, so each fidelity draws from the same
 * distribution and the comparison isolates corpus *size*.
 */
function stride(
  rows: DataRecordInterface[],
  rate: number,
): DataRecordInterface[] {
  if (rate >= 1) return rows;
  const step = Math.round(1 / rate);
  return rows.filter((_, i) => i % step === 0);
}

/** Scores `population` creatures against `dataDir` once. */
async function timeGeneration(
  population: Creature[],
  dataDir: string,
  now: () => number,
): Promise<number> {
  const cost = Costs.find("MSE");
  const started = now();
  for (const creature of population) {
    // Sequential on purpose: concurrent scoring would measure the host's
    // parallelism, not the per-record cost this harness exists to compare.
    // deno-lint-ignore no-await-in-loop
    const { error } = await creature.evaluateDir(dataDir, cost, false);
    if (!Number.isFinite(error)) {
      throw new Error(`non-finite score from ${dataDir}: ${error}`);
    }
  }
  return now() - started;
}

/** Runs the sweep and returns one measurement per rate. */
export async function measureFidelities(
  options: HarnessOptions,
): Promise<FidelityMeasurement[]> {
  const rng = createSeededRng(options.seed);
  const creature = generateProductionCreature(INPUTS, OUTPUTS, rng, {
    scale: "grq-3926",
  });
  const population = Array.from(
    { length: options.population },
    () => Creature.fromJSON(creature),
  );
  const full = generateTrainingData(INPUTS, OUTPUTS, options.records, rng);
  const now = options.now ?? (() => performance.now());

  const measurements: FidelityMeasurement[] = [];
  let fullMs = 0;
  for (const rate of options.rates) {
    const rows = stride(full, rate);
    const dir = publishCorpus(rows, rate, full.length);
    try {
      const provenance = readFitnessCorpusProvenance(dir);
      if (provenance.recordCount !== rows.length) {
        throw new Error(
          `corpus provenance disagrees with the corpus: ` +
            `${provenance.recordCount} vs ${rows.length}`,
        );
      }
      // Warm the page cache and the WASM topology so the timed pass measures
      // scoring, not first-touch.
      // deno-lint-ignore no-await-in-loop
      await timeGeneration([population[0]], dir, now);
      // deno-lint-ignore no-await-in-loop
      const msPerGeneration = await timeGeneration(population, dir, now);
      if (!(msPerGeneration > 0)) {
        throw new Error(`no timing recorded for rate ${rate}`);
      }
      if (rate === options.rates[0]) fullMs = msPerGeneration;
      measurements.push({
        rate,
        records: rows.length,
        bytes: rows.length * BYTES_PER_RECORD,
        msPerGeneration,
        ratioToFull: fullMs === 0 ? 1 : msPerGeneration / fullMs,
      });
    } finally {
      // deno-lint-ignore no-await-in-loop
      await Deno.remove(dir, { recursive: true });
    }
  }

  if (measurements.length === 0) {
    throw new Error("no fidelities measured — nothing to report");
  }
  return measurements;
}

function numberArg(args: string[], name: string, fallback: number): number {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.slice(name.length + 3));
  if (!Number.isFinite(value)) throw new Error(`--${name} is not a number`);
  return value;
}

function markdownTable(measurements: FidelityMeasurement[]): string {
  const rows = measurements.map((m) =>
    `| ${m.rate} | ${m.records} | ${
      (m.bytes / 1024 / 1024).toFixed(1)
    } MiB | ` +
    `${m.msPerGeneration.toFixed(0)} | ${m.ratioToFull.toFixed(3)} |`
  );
  return [
    "| Fitness sample rate | Records | Corpus | ms / generation | vs full |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

if (import.meta.main) {
  const args = Deno.args;
  const ratesArg = args.find((a) => a.startsWith("--rates="));
  const options: HarnessOptions = {
    records: numberArg(args, "records", 8000),
    rates: ratesArg
      ? ratesArg.slice("--rates=".length).split(",").map(Number)
      : [1, 0.5, 0.1],
    population: numberArg(args, "population", 4),
    seed: numberArg(args, "seed", 3926),
  };

  const measurements = await measureFidelities(options);
  console.log(markdownTable(measurements));
  console.log(JSON.stringify({ options, measurements }, null, 2));
}
