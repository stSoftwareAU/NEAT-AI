/**
 * Issue #3930 — raise an evaluation archive to run the Stage 1 study against.
 *
 * The study in `scripts/surrogate_feasibility.ts` needs an Issue #3929 archive.
 * The production one is not reachable from a container, and fabricating
 * `(descriptor, score)` pairs would measure the fabrication rather than the
 * search, so this script produces a **real** archive the only honest way there
 * is: it runs real evolutions with `evaluationArchive` enabled and lets the
 * exact-evaluation path write them.
 *
 * Every record it produces is a real descriptor of a real creature paired with
 * the exact score that creature really took, with the real parent lineage the
 * breeding path recorded. What is small about it is the **scale** — container
 * creatures on a synthetic corpus, not 5,300-neuron creatures on 21.2 GiB —
 * and the study stamps that on its report as `container-run` provenance so the
 * two can never be confused.
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   scripts/surrogate_archive_capture.ts \
 *   --out=/tmp/surrogate-archive --runs=3 --generations=8 --population=24
 * ```
 *
 * @module surrogate_archive_capture
 */

import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { EVALUATION_ARCHIVE_FILE_NAME } from "@config/EvaluationArchiveConfig.ts";
import { readEvaluationArchive } from "@archive/EvaluationArchiveFormat.ts";

/** A small deterministic generator, so a capture can be reproduced exactly. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — deterministic across platforms and good enough to sample a
    // regression target with.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * A deterministic regression corpus: a fixed non-linear function of the
 * inputs, so the population has a real objective to be ordered by and the
 * scores it takes are genuinely earned rather than noise.
 */
export function syntheticCorpus(
  inputs: number,
  records: number,
  rng: () => number,
): DataRecordInterface[] {
  if (!Number.isInteger(inputs) || inputs < 2) {
    throw new Error(`inputs must be an integer >= 2, got ${inputs}`);
  }
  if (!Number.isInteger(records) || records < 1) {
    throw new Error(`records must be a positive integer, got ${records}`);
  }
  const corpus: DataRecordInterface[] = [];
  for (let r = 0; r < records; r++) {
    const input = new Float32Array(inputs);
    for (let i = 0; i < inputs; i++) input[i] = rng() * 2 - 1;
    let target = 0;
    for (let i = 0; i < inputs; i++) {
      target += (i % 2 === 0 ? 1 : -1) * Math.sin(input[i] * (1 + i / inputs));
    }
    corpus.push({
      input,
      output: new Float32Array([Math.tanh(target / inputs)]),
    });
  }
  return corpus;
}

/** How a capture is shaped. */
export interface CaptureOptions {
  readonly directory: string;
  readonly runs: number;
  readonly generations: number;
  readonly population: number;
  readonly inputs: number;
  readonly records: number;
  readonly seed: number;
}

/**
 * Run the evolutions and return how many records reached the archive.
 *
 * Throws when the archive is empty afterwards: an archive-enabled run that
 * wrote nothing is a wiring fault, and reporting it as a clean capture is
 * exactly the silent failure the archive was built to avoid.
 */
export async function captureArchive(
  options: CaptureOptions,
): Promise<{ path: string; records: number; runs: string[] }> {
  const runIds: string[] = [];
  await Deno.mkdir(options.directory, { recursive: true });
  for (let run = 0; run < options.runs; run++) {
    const runId = `capture-${options.seed}-${run}`;
    runIds.push(runId);
    const rng = seededRng(options.seed + run * 7919);
    const corpus = syntheticCorpus(options.inputs, options.records, rng);
    const seed = new Creature(options.inputs, 1);
    // Sequential by design: each run is a separate archive writer, and the
    // retention bound assumes one live writer per directory.
    // deno-lint-ignore no-await-in-loop
    await seed.evolveDataSet(corpus, {
      iterations: options.generations,
      populationSize: options.population,
      threads: 1,
      seed: options.seed + run,
      targetError: 0,
      verbose: false,
      // No gradient step: the study is about predicting a score from
      // structure, and a container without the Rust back-propagation library
      // would otherwise spend every generation logging a training failure it
      // cannot act on.
      trainPerGen: 0,
      evaluationArchive: {
        enabled: true,
        directory: options.directory,
        runId,
        maxRecords: 100_000,
      },
    });
  }
  const path = `${options.directory}/${EVALUATION_ARCHIVE_FILE_NAME}`;
  const records = await readEvaluationArchive(path);
  if (records.length === 0) {
    throw new Error(
      `no evaluations reached ${path} — the archive was enabled but nothing ` +
        "was written, which is a wiring fault, not an empty run",
    );
  }
  return { path, records: records.length, runs: runIds };
}

/** `--name=value`, or `undefined`. */
function stringArg(args: readonly string[], name: string): string | undefined {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** `--name=<integer>`, or `fallback`. */
function intArg(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const raw = stringArg(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer, got '${raw}'`);
  }
  return value;
}

if (import.meta.main) {
  const args = Deno.args;
  const directory = stringArg(args, "out");
  if (directory === undefined) {
    throw new Error("--out=<dir> is required: the archive has to go somewhere");
  }
  const result = await captureArchive({
    directory,
    runs: intArg(args, "runs", 3),
    generations: intArg(args, "generations", 8),
    population: intArg(args, "population", 24),
    inputs: intArg(args, "inputs", 8),
    records: intArg(args, "records", 256),
    seed: intArg(args, "seed", 3930),
  });
  console.log(
    `${result.records} evaluations from ${result.runs.length} run(s) → ` +
      `${result.path}`,
  );
}
