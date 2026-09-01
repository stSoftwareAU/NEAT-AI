/**
 * FitnessCorpusProvenance.ts — what corpus a run actually scored against.
 *
 * Issue #3926: fitness is evaluated over **every** record in the dataset
 * directory a run is given. The cheaper-fidelity knob therefore lives in the
 * data pipeline, not in the scorer argv: NEAT-AI-Refinery publishes a sampled
 * corpus, and evolution is pointed at that directory instead of the full one.
 * `RustScorerConfig`, `RustScorerBridge` and `BatchRustScorerBridge` are
 * untouched by that choice — the directory is the only thing that changes.
 *
 * The cost of that simplicity is ambiguity: two directories of `.bin` files
 * look identical, so a run cannot say which fidelity produced its score. A
 * Refinery-published corpus carries a `manifest.json` beside its records
 * recording exactly that, and this module reads it.
 *
 * ```text
 * trainData-binary-sampler/
 * ├── manifest.json      ← how this corpus was made
 * └── sample-10.bin      ← the corpus scored against
 * ```
 *
 * Two rules shape the reader:
 *
 * 1. **A directory with no manifest is a full corpus.** That is the
 *    unsampled, full-fidelity path every production run takes today, and it
 *    reports rate `1`.
 * 2. **A manifest that is present but unreadable fails loud.** Treating a
 *    corrupt provenance record as "no manifest" would report full fidelity for
 *    a run that scored a tenth of the corpus — a masked fault of exactly the
 *    class Issue #3234 forbids.
 *
 * This is **not** `trainingSampleRate`. That option
 * (`src/architecture/training/TrainingSetup.ts`) samples records for
 * **backpropagation** and never reaches the scoring path. See
 * [`docs/config/TRAINING.md`](../../docs/config/TRAINING.md).
 *
 * @module FitnessCorpusProvenance
 */

import { DatasetError } from "@errors/DatasetError.ts";

/** File name Refinery publishes the provenance record under. */
export const FITNESS_CORPUS_MANIFEST_FILE = "manifest.json";

/**
 * Default width of the agreement band, in standard deviations of the binomial
 * the sampler draws from. Five sigma leaves a ~6e-7 false-alarm rate, so a
 * failure is a real mismatch rather than sampling noise.
 */
export const DEFAULT_SAMPLE_RATE_SIGMAS = 5;

/** Provenance of the corpus a run scores its fitness against. */
export interface FitnessCorpusProvenance {
  /** The dataset directory this describes. */
  readonly dataDir: string;
  /** True when the corpus holds fewer records than the source it came from. */
  readonly sampled: boolean;
  /**
   * The fitness sample rate the producer **stated** — the product of the
   * `rate` parameters of every `sample` stage. `1` for a full corpus.
   */
  readonly declaredSampleRate: number;
  /**
   * The fitness sample rate actually **achieved** — published records divided
   * by source records. `1` for a full corpus, and for a transform (such as
   * `quantise`) that rewrites records without dropping any.
   */
  readonly effectiveSampleRate: number;
  /** Records in the corpus scored against; `null` without a manifest. */
  readonly recordCount: number | null;
  /** Records in the corpus it was derived from; `null` without a manifest. */
  readonly sourceRecordCount: number | null;
  /** Transform names applied, first to last; empty for a full corpus. */
  readonly transforms: readonly string[];
  /** Published corpus file name; `null` without a manifest. */
  readonly corpusFile: string | null;
  /** Path of the source corpus it was derived from; `null` without one. */
  readonly sourcePath: string | null;
}

/** The full-fidelity answer: every record of the corpus it was given. */
function fullCorpus(dataDir: string): FitnessCorpusProvenance {
  return {
    dataDir,
    sampled: false,
    declaredSampleRate: 1,
    effectiveSampleRate: 1,
    recordCount: null,
    sourceRecordCount: null,
    transforms: [],
    corpusFile: null,
    sourcePath: null,
  };
}

function corrupt(manifestPath: string, detail: string): DatasetError {
  return new DatasetError(
    `unreadable corpus provenance in ${manifestPath}: ${detail}`,
    "CORRUPT_PROVENANCE",
    manifestPath,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a non-negative integer field, or throws naming the field. */
function requireCount(
  container: Record<string, unknown>,
  field: string,
  manifestPath: string,
): number {
  const value = container[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw corrupt(manifestPath, `${field} is not a record count (${value})`);
  }
  return value;
}

/** The ordered transform records — a pipeline's stages, or the single one. */
function transformStages(
  manifest: Record<string, unknown>,
  manifestPath: string,
): Record<string, unknown>[] {
  const pipeline = manifest.pipeline;
  if (pipeline !== undefined) {
    if (!Array.isArray(pipeline)) {
      throw corrupt(manifestPath, "pipeline is not an array of stages");
    }
    return pipeline.map((stage, index) => {
      if (!isRecord(stage)) {
        throw corrupt(manifestPath, `pipeline stage ${index} is not an object`);
      }
      return stage;
    });
  }

  const transform = manifest.transform;
  if (!isRecord(transform)) {
    throw corrupt(manifestPath, "transform is missing");
  }
  return [transform];
}

/** The `rate` of one `sample` stage, or `1` for any other transform. */
function stageSampleRate(
  stage: Record<string, unknown>,
  manifestPath: string,
): number {
  if (stage.name !== "sample") return 1;

  const parameters = stage.parameters;
  const rate = isRecord(parameters) ? parameters.rate : undefined;
  if (typeof rate !== "number" || !(rate > 0) || rate > 1) {
    throw corrupt(
      manifestPath,
      `sample stage rate is outside (0, 1] (${rate})`,
    );
  }
  return rate;
}

/**
 * Reads the provenance of the corpus in `dataDir`.
 *
 * A directory with no `manifest.json` is the full corpus — the path every
 * production run takes today — and reports a sample rate of `1`. A manifest
 * that cannot be parsed is a fault, not a full corpus.
 *
 * @param dataDir - The dataset directory a run scores against
 * @returns What produced that corpus, and at what fitness sample rate
 * @throws {DatasetError} `CORRUPT_PROVENANCE` when a manifest is present but
 *   cannot be read as one
 */
export function readFitnessCorpusProvenance(
  dataDir: string,
): FitnessCorpusProvenance {
  const manifestPath = `${dataDir}/${FITNESS_CORPUS_MANIFEST_FILE}`;

  let text: string;
  try {
    text = Deno.readTextFileSync(manifestPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return fullCorpus(dataDir);
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw corrupt(manifestPath, (error as Error).message);
  }
  if (!isRecord(parsed)) {
    throw corrupt(manifestPath, "manifest is not a JSON object");
  }

  const stages = transformStages(parsed, manifestPath);
  const declaredSampleRate = stages.reduce(
    (rate, stage) => rate * stageSampleRate(stage, manifestPath),
    1,
  );

  const source = parsed.source;
  const output = parsed.output;
  if (!isRecord(source)) throw corrupt(manifestPath, "source is missing");
  if (!isRecord(output)) throw corrupt(manifestPath, "output is missing");

  const sourceRecordCount = requireCount(source, "record_count", manifestPath);
  const recordCount = requireCount(output, "record_count", manifestPath);
  if (sourceRecordCount === 0) {
    throw corrupt(manifestPath, "source record_count is zero");
  }

  const corpusFile = output.file;
  if (typeof corpusFile !== "string" || corpusFile.length === 0) {
    throw corrupt(manifestPath, "output file name is missing");
  }

  const effectiveSampleRate = recordCount / sourceRecordCount;

  return {
    dataDir,
    sampled: recordCount < sourceRecordCount,
    declaredSampleRate,
    effectiveSampleRate,
    recordCount,
    sourceRecordCount,
    transforms: stages.map((stage) =>
      typeof stage.name === "string" ? stage.name : "unknown"
    ),
    corpusFile,
    sourcePath: typeof source.path === "string" ? source.path : null,
  };
}

/** How wide an agreement band {@link assertFitnessCorpusSampleRate} allows. */
export interface SampleRateAgreementOptions {
  /**
   * Width of the band in binomial standard deviations.
   * Default {@link DEFAULT_SAMPLE_RATE_SIGMAS}.
   */
  sigmas?: number;
}

/**
 * Asserts the corpus really was drawn at the rate its manifest states.
 *
 * The sampler keeps each record independently with probability `rate`, so the
 * achieved rate is a binomial mean and will not land exactly on the declared
 * one. The band is `sigmas` standard deviations of that binomial wide; a rate
 * of `1` has zero variance and so must be met exactly.
 *
 * A corpus that is *not* the size it claims has not been verified — checking
 * the record counts is the difference between provenance and a label.
 *
 * @param provenance - As returned by {@link readFitnessCorpusProvenance}
 * @param options - Band width override
 * @throws {DatasetError} `CORRUPT_PROVENANCE` when the achieved rate is
 *   outside the band
 */
export function assertFitnessCorpusSampleRate(
  provenance: FitnessCorpusProvenance,
  options: SampleRateAgreementOptions = {},
): void {
  if (provenance.sourceRecordCount === null) return;

  const sigmas = options.sigmas ?? DEFAULT_SAMPLE_RATE_SIGMAS;
  const rate = provenance.declaredSampleRate;
  const n = provenance.sourceRecordCount;
  const tolerance = sigmas * Math.sqrt((rate * (1 - rate)) / n);
  const drift = Math.abs(provenance.effectiveSampleRate - rate);

  if (drift > tolerance) {
    throw corrupt(
      `${provenance.dataDir}/${FITNESS_CORPUS_MANIFEST_FILE}`,
      `declared sample rate ${rate} but kept ${provenance.recordCount} of ` +
        `${n} records (${provenance.effectiveSampleRate}), outside the ` +
        `${sigmas}-sigma band of ±${tolerance}`,
    );
  }
}
