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
  /**
   * Bytes one record of the published corpus occupies, from `record_shape`;
   * `null` when the manifest does not state a geometry.
   */
  readonly bytesPerRecord: number | null;
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
    bytesPerRecord: null,
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

/** Throws `DIRECTORY_MISSING` when `dataDir` is not a directory on disk. */
function assertCorpusDirectoryExists(dataDir: string): void {
  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(dataDir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new DatasetError(
        `corpus directory ${dataDir} does not exist`,
        "DIRECTORY_MISSING",
        dataDir,
      );
    }
    throw error;
  }
  if (!stat.isDirectory) {
    throw new DatasetError(
      `corpus path ${dataDir} is not a directory`,
      "DIRECTORY_MISSING",
      dataDir,
    );
  }
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
  // A record count is a whole number of records. A fraction means the producer
  // computed it rather than counted it, and every rate derived from it is
  // meaningless — so it is a fault, not a value to round.
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw corrupt(manifestPath, `${field} is not a record count (${value})`);
  }
  return value;
}

/**
 * Bytes per record of the **published** corpus, from `record_shape`. Absent
 * geometry is `null`; a present-but-nonsensical one is a fault.
 */
function readBytesPerRecord(
  manifest: Record<string, unknown>,
  manifestPath: string,
): number | null {
  const shape = manifest.record_shape;
  if (shape === undefined) return null;
  if (!isRecord(shape)) {
    throw corrupt(manifestPath, "record_shape is not an object");
  }
  const bytes = shape.bytes_per_record;
  if (bytes === undefined) return null;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    throw corrupt(manifestPath, `bytes_per_record is not a size (${bytes})`);
  }
  return bytes;
}

/** Schema revision of the manifest this reader understands. */
export const SUPPORTED_MANIFEST_VERSION = 1;

/**
 * Refuses a manifest written to a schema this reader does not know.
 *
 * Reading a future revision with this revision's rules would answer confidently
 * about fields that have moved — the manifest is provenance, so a wrong answer
 * is worse than no answer. A manifest that states no version is read as the
 * original schema, which had none.
 */
function assertSupportedManifestVersion(
  manifest: Record<string, unknown>,
  manifestPath: string,
): void {
  const version = manifest.manifest_version;
  if (version === undefined) return;
  if (version !== SUPPORTED_MANIFEST_VERSION) {
    throw corrupt(
      manifestPath,
      `manifest_version ${version} is not supported (this reader reads ` +
        `${SUPPORTED_MANIFEST_VERSION})`,
    );
  }
}

/**
 * The corpus this one was derived from. Absent is `null`; a present-but-
 * malformed path is a fault — reporting it as absent would lose the provenance
 * this module exists to carry.
 */
function readSourcePath(
  source: Record<string, unknown>,
  manifestPath: string,
): string | null {
  const path = source.path;
  if (path === undefined) return null;
  if (typeof path !== "string" || path.length === 0) {
    throw corrupt(manifestPath, `source path is not a path (${path})`);
  }
  return path;
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

/** The name of one transform stage. A stage that does not name itself is a fault. */
function stageName(
  stage: Record<string, unknown>,
  manifestPath: string,
): string {
  const name = stage.name;
  // An absent or misspelt name would otherwise be read as "some transform that
  // is not `sample`", i.e. rate 1 — full fidelity reported for a corpus that
  // may hold a tenth of the records.
  if (typeof name !== "string" || name.length === 0) {
    throw corrupt(
      manifestPath,
      `transform stage does not name itself (${name})`,
    );
  }
  return name;
}

/** The `rate` of one `sample` stage, or `1` for any other transform. */
function stageSampleRate(
  stage: Record<string, unknown>,
  manifestPath: string,
): number {
  if (stageName(stage, manifestPath) !== "sample") return 1;

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
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    // NotFound covers both "no manifest" and "no corpus at all". Only the
    // first is a full corpus; answering rate 1 for a directory that is not
    // there would state a fidelity nothing was scored at.
    assertCorpusDirectoryExists(dataDir);
    return fullCorpus(dataDir);
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

  assertSupportedManifestVersion(parsed, manifestPath);

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
  // A corpus with no records produces no score. Reporting it as a fidelity
  // would put a rate on a run that measured nothing.
  if (recordCount === 0) {
    throw corrupt(manifestPath, "output record_count is zero");
  }

  const corpusFile = output.file;
  if (typeof corpusFile !== "string" || corpusFile.length === 0) {
    throw corrupt(manifestPath, "output file name is missing");
  }

  const sourcePath = readSourcePath(source, manifestPath);

  const effectiveSampleRate = recordCount / sourceRecordCount;

  return {
    dataDir,
    sampled: recordCount < sourceRecordCount,
    declaredSampleRate,
    effectiveSampleRate,
    recordCount,
    sourceRecordCount,
    transforms: stages.map((stage) => stageName(stage, manifestPath)),
    corpusFile,
    bytesPerRecord: readBytesPerRecord(parsed, manifestPath),
    sourcePath: sourcePath ?? null,
  };
}

/** Extension the training path treats as corpus data (`dataFiles`). */
const CORPUS_EXTENSION = ".bin";

/**
 * Measures the corpus **a run would actually score** and holds the manifest to
 * it.
 *
 * Without this, every check in this module compares manifest fields to other
 * manifest fields — a document verifying itself. Record count × bytes per
 * record is the one claim the file system can settle, so it is settled there.
 *
 * Every `.bin` in the directory is measured, not just the one the manifest
 * names: fitness reads the whole directory
 * ({@link module:architecture/training/TrainingSetup.dataFiles}), so a leftover
 * shard beside the published corpus is scored even though the manifest never
 * mentions it. Weighing only the named file would pass a directory holding
 * twice the records it claims.
 */
function assertPublishedCorpusMatchesManifest(
  provenance: FitnessCorpusProvenance,
): void {
  const { corpusFile, bytesPerRecord, recordCount, dataDir } = provenance;
  if (corpusFile === null || recordCount === null) return;
  const manifestPath = `${dataDir}/${FITNESS_CORPUS_MANIFEST_FILE}`;

  // No geometry means the bytes cannot settle the record count, and the only
  // check left would be the manifest against itself. Verifying nothing while
  // reporting success is the masked fault this function exists to prevent.
  if (bytesPerRecord === null) {
    throw corrupt(
      manifestPath,
      "record_shape.bytes_per_record is absent, so the corpus cannot be " +
        "verified against the bytes on disk",
    );
  }

  let published = 0;
  let namedFileSeen = false;
  const scored: string[] = [];
  for (const entry of Deno.readDirSync(dataDir)) {
    if (!entry.isFile || !entry.name.endsWith(CORPUS_EXTENSION)) continue;
    scored.push(entry.name);
    if (entry.name === corpusFile) namedFileSeen = true;
    published += Deno.statSync(`${dataDir}/${entry.name}`).size;
  }

  if (!namedFileSeen) {
    throw corrupt(manifestPath, `published corpus ${corpusFile} is missing`);
  }

  const expected = recordCount * bytesPerRecord;
  if (published !== expected) {
    throw corrupt(
      manifestPath,
      `${scored.sort().join(", ")} hold ${published} bytes but the manifest ` +
        `claims ${recordCount} records of ${bytesPerRecord} bytes ` +
        `(${expected})`,
    );
  }
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
 * the record counts is the difference between provenance and a label. Every
 * `.bin` a run would score is measured on disk first, so the manifest is
 * checked against the bytes rather than against itself: a manifest that lies
 * self-consistently, and a directory carrying a shard the manifest never
 * mentions, both fail. A manifest that states no record geometry cannot be
 * checked against the bytes at all, and is refused rather than passed.
 *
 * @param provenance - As returned by {@link readFitnessCorpusProvenance}
 * @param options - Band width override
 * @throws {DatasetError} `CORRUPT_PROVENANCE` when the corpus is not the size
 *   its manifest states, when the manifest states no geometry to check it
 *   against, or when the achieved rate is outside the band
 */
export function assertFitnessCorpusSampleRate(
  provenance: FitnessCorpusProvenance,
  options: SampleRateAgreementOptions = {},
): void {
  if (provenance.sourceRecordCount === null) return;

  assertPublishedCorpusMatchesManifest(provenance);

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
