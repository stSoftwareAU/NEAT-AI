/**
 * EvaluationArchive.ts — the append-only `(design point, true fitness)` archive
 * (Issue #3929).
 *
 * NEAT-AI computes tens of thousands of exact evaluations per lineage and keeps
 * none of them: `Fitness.calculate` attaches a score to a creature and the pair
 * evaporates when the creature is culled. Every surrogate in
 * [Jin (2011)](../../docs/comparison/REFERENCES.md) needs exactly that pair to
 * exist first, and Jin treats managing the set — what is kept, what is retired
 * — as part of the method rather than a detail. This module is that set.
 *
 * ```mermaid
 * flowchart LR
 *   E[exact score on the<br/>true-evaluation path] --> R[record: descriptor +<br/>score + fidelity + provenance]
 *   R --> B[in-memory buffer]
 *   B -->|once per generation| F[flush: one append<br/>to the JSONL archive]
 *   F --> T{over the<br/>retention bound?}
 *   T -->|no| D[(archive)]
 *   T -->|yes| C[compact: keep the<br/>newest maxRecords] --> D
 *   A[racing-abandoned<br/>partial score] -.->|never recorded| D
 * ```
 *
 * Three properties hold, and every one of them is load-bearing:
 *
 * - **Exact scores only.** A partial score from racing (Issue #3928) or a
 *   sampled score (Issue #3926) is not ground truth. `fidelity` is required on
 *   every record and the exact-evaluation path passes {@link EXACT_FIDELITY};
 *   anything outside `(0, 1]` is refused rather than stored.
 * - **One feature space.** Every record carries its
 *   {@link EVALUATION_DESCRIPTOR_VERSION}, and both opening for append and
 *   reading refuse a mismatch loudly — never coerce.
 * - **Bounded on disk.** The newest {@link RequiredEvaluationArchiveConfig.maxRecords}
 *   records are kept; older ones are dropped. See
 *   [`docs/EVALUATION_ARCHIVE.md`](../../docs/EVALUATION_ARCHIVE.md).
 *
 * Cost: one `O(neurons + synapses)` descriptor per exact evaluation and **one**
 * file append per generation, against a generation that scores a 21 GiB corpus
 * in minutes. Measured in `bench/EvaluationArchiveOverhead.ts`.
 *
 * @module EvaluationArchive
 */

import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import type { RequiredEvaluationArchiveConfig } from "@config/EvaluationArchiveConfig.ts";
import { EvaluationArchiveError } from "@errors/EvaluationArchiveError.ts";
import { lineageOf } from "@archive/CreatureLineage.ts";
import {
  computeEvaluationDescriptor,
  EVALUATION_DESCRIPTOR_LENGTH,
  EVALUATION_DESCRIPTOR_VERSION,
} from "@archive/EvaluationDescriptor.ts";

/** Fidelity of a score obtained over the whole corpus: ground truth. */
export const EXACT_FIDELITY = 1;

/** One archived evaluation. */
export interface EvaluationArchiveRecord {
  /** Layout version of {@link descriptor}. Readers refuse to mix versions. */
  readonly descriptorVersion: number;
  /** Run that produced the evaluation. */
  readonly runId: string;
  /** Generation index within that run. */
  readonly generation: number;
  /** Content-hash UUID of the creature scored. */
  readonly uuid: string;
  /** UUIDs of the parents it was bred from; empty when it was not bred. */
  readonly parents: readonly string[];
  /** Mutation operators applied to it, when the run's telemetry knew them. */
  readonly operators: readonly string[];
  /** The pipeline stage that produced it (`approach` tag), when tagged. */
  readonly approach?: string;
  /** The exact score. */
  readonly score: number;
  /** The raw error the score was derived from, when finite. */
  readonly error?: number;
  /** Corpus fraction the score was obtained over; `1` is ground truth. */
  readonly fidelity: number;
  /** Wall-clock instant the evaluation was archived. */
  readonly recordedAt: string;
  /** The fixed-length feature vector. */
  readonly descriptor: readonly number[];
}

/** Everything `record()` needs that is not derivable from the creature. */
export interface EvaluationArchiveEntry {
  /** The exact score. */
  readonly score: number;
  /** Corpus fraction the score covers. Must be in `(0, 1]`. */
  readonly fidelity: number;
  /** The raw error, when the caller has it. */
  readonly error?: number;
  /** Operators applied to the creature, when known. */
  readonly operators?: readonly string[];
}

/**
 * How far past {@link RequiredEvaluationArchiveConfig.maxRecords} the archive is
 * allowed to grow before it compacts.
 *
 * Compaction rewrites the file, so compacting on every generation once the
 * bound is reached would turn a bounded archive into an unbounded cost. Slack
 * amortises the rewrite to `O(1)` per record: with the default 100k bound the
 * file is rewritten once per 10k records, which at ~20 evaluations a generation
 * is once every 500 generations. The floor keeps a deliberately tiny archive
 * from rewriting itself on every flush.
 *
 * The bound a caller asked for is therefore an "at least" — the file settles
 * between `maxRecords` and `maxRecords + slack` records, which is what
 * `docs/EVALUATION_ARCHIVE.md` documents.
 *
 * @param maxRecords - The configured retention bound.
 * @returns Records of overshoot tolerated before a rewrite.
 */
export function compactionSlack(maxRecords: number): number {
  return Math.max(64, Math.floor(maxRecords / 10));
}

/**
 * Append-only archive of exact fitness evaluations.
 *
 * Instances are created only when `evaluationArchive.enabled` is set, so the
 * default run constructs nothing and touches no disk.
 */
export class EvaluationArchive {
  private readonly config: RequiredEvaluationArchiveConfig;
  /** Absolute-or-relative path of the archive file. */
  readonly path: string;

  /** Records awaiting their generation's single append. */
  private buffer: EvaluationArchiveRecord[] = [];

  /** Generation index stamped onto new records. */
  private generation = 0;
  /** Reference creature for the genetic-distance descriptor slot. */
  private reference: Creature | undefined;

  /** Records already on disk. `undefined` until the file has been inspected. */
  private onDiskCount: number | undefined;

  constructor(config: RequiredEvaluationArchiveConfig) {
    this.config = config;
    this.path = `${config.directory}/${config.fileName}`;
  }

  /**
   * Start a generation: later records are stamped with `generation` and their
   * genetic-distance slot is measured against `reference`.
   *
   * @param generation - The run's generation index.
   * @param reference - The current fittest creature, or `undefined` when the
   *   run has not produced one yet.
   */
  beginGeneration(generation: number, reference?: Creature): void {
    this.generation = generation;
    this.reference = reference;
  }

  /** Records buffered since the last {@link flush}. */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Buffer one evaluation.
   *
   * Synchronous and allocation-light: it computes the descriptor and appends to
   * an in-memory array. Nothing touches disk until {@link flush}.
   *
   * A creature with no UUID is **not** archived — the record would be
   * unjoinable to any other observation of the same creature, and a fabricated
   * key is worse than a missing row. The exact-evaluation path always has one.
   *
   * @param creature - The creature that was scored.
   * @param entry - The score, its fidelity, and any provenance the caller has.
   * @throws {EvaluationArchiveError} When `fidelity` is outside `(0, 1]` or the
   *   score is not finite.
   */
  record(creature: Creature, entry: EvaluationArchiveEntry): void {
    const { fidelity } = entry;
    if (!Number.isFinite(fidelity) || fidelity <= 0 || fidelity > 1) {
      throw new EvaluationArchiveError(
        `evaluation archive fidelity must be in (0, 1], got ${fidelity}`,
        "INVALID_FIDELITY",
      );
    }
    if (!Number.isFinite(entry.score)) {
      // A creature that took `-Infinity` for a WASM panic never earned a
      // fitness reading; archiving it would teach a surrogate a number that
      // describes the runtime, not the design point.
      return;
    }
    const uuid = creature.uuid;
    if (uuid === undefined) return;

    const approach = getTag(creature, "approach");
    this.buffer.push({
      descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
      runId: this.config.runId,
      generation: this.generation,
      uuid,
      parents: lineageOf(creature),
      operators: entry.operators ?? [],
      ...(approach ? { approach } : {}),
      score: entry.score,
      ...(entry.error !== undefined && Number.isFinite(entry.error)
        ? { error: entry.error }
        : {}),
      fidelity,
      recordedAt: Temporal.Now.instant().toString(),
      descriptor: computeEvaluationDescriptor(creature, this.reference),
    });
  }

  /**
   * Append everything buffered to the archive in a single write, then enforce
   * the retention bound.
   *
   * A no-op when nothing is buffered, so calling it every generation costs
   * nothing on the generations that archived nothing.
   *
   * @throws {EvaluationArchiveError} When the existing archive was written
   *   under a different descriptor version.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const pending = this.buffer;
    this.buffer = [];

    await Deno.mkdir(this.config.directory, { recursive: true });
    if (this.onDiskCount === undefined) {
      this.onDiskCount = await inspectArchive(this.path);
    }

    const chunk = pending.map((record) => JSON.stringify(record)).join("\n") +
      "\n";
    await Deno.writeTextFile(this.path, chunk, { append: true });
    this.onDiskCount += pending.length;

    const { maxRecords } = this.config;
    if (this.onDiskCount > maxRecords + compactionSlack(maxRecords)) {
      this.onDiskCount = await compactArchive(this.path, maxRecords);
    }
  }

  /**
   * Flush anything outstanding and release the reference creature.
   *
   * There is no file handle to close — every write is a self-contained append —
   * so this exists so a caller can end a run without inspecting the buffer.
   */
  async close(): Promise<void> {
    await this.flush();
    this.reference = undefined;
  }
}

/**
 * Count the records already in an archive and check its descriptor version.
 *
 * Streams the file rather than reading it whole: at the default bound the
 * archive is tens of megabytes, and this runs on the first flush of every run.
 *
 * @param path - Archive file path.
 * @returns The number of records on disk; `0` when the file does not exist.
 * @throws {EvaluationArchiveError} When the first record's descriptor version
 *   is not the current one, or its first line is not a record.
 */
async function inspectArchive(path: string): Promise<number> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
  try {
    const decoder = new TextDecoder();
    const chunk = new Uint8Array(64 * 1024);
    let lines = 0;
    let firstLine = "";
    let firstLineComplete = false;
    let trailingBytes = false;
    for (;;) {
      // deno-lint-ignore no-await-in-loop
      const read = await file.read(chunk);
      if (read === null) break;
      const slice = chunk.subarray(0, read);
      const newlineAt = slice.indexOf(0x0a);
      if (!firstLineComplete) {
        firstLine += decoder.decode(
          newlineAt === -1 ? slice : slice.subarray(0, newlineAt),
          { stream: newlineAt === -1 },
        );
        if (newlineAt !== -1) firstLineComplete = true;
      }
      for (let i = 0; i < read; i++) {
        if (slice[i] === 0x0a) lines++;
      }
      trailingBytes = read > 0 && slice[read - 1] !== 0x0a;
    }
    if (lines === 0 && !trailingBytes) return 0;
    assertRecordVersion(parseRecordLine(firstLine, path, 1), path, 1);
    // A final line without its newline is a torn write; count it so retention
    // still bounds the file, and let the reader fail loudly on it.
    return trailingBytes ? lines + 1 : lines;
  } finally {
    file.close();
  }
}

/**
 * Drop the oldest records so only the newest `maxRecords` remain.
 *
 * @param path - Archive file path.
 * @param maxRecords - Records to retain.
 * @returns The number of records left on disk.
 */
async function compactArchive(
  path: string,
  maxRecords: number,
): Promise<number> {
  const text = await Deno.readTextFile(path);
  const lines = text.split("\n").filter((line) => line.length > 0);
  const retained = lines.slice(Math.max(0, lines.length - maxRecords));
  const temporary = `${path}.compacting`;
  await Deno.writeTextFile(temporary, retained.join("\n") + "\n");
  await Deno.rename(temporary, path);
  return retained.length;
}

/** Parse one archive line, failing loudly on anything that is not a record. */
function parseRecordLine(
  line: string,
  path: string,
  lineNumber: number,
): EvaluationArchiveRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "MALFORMED_RECORD",
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} is not an evaluation record`,
      "MALFORMED_RECORD",
    );
  }
  const record = parsed as Partial<EvaluationArchiveRecord>;
  if (typeof record.descriptorVersion !== "number") {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} has no descriptorVersion`,
      "MALFORMED_RECORD",
    );
  }
  if (typeof record.uuid !== "string" || typeof record.score !== "number") {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} is missing uuid or score`,
      "MALFORMED_RECORD",
    );
  }
  if (!Array.isArray(record.descriptor)) {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} has no descriptor vector`,
      "MALFORMED_RECORD",
    );
  }
  return record as EvaluationArchiveRecord;
}

/**
 * Refuse a record written under a different descriptor version.
 *
 * This is the fail-loud gate the archive's contract rests on: coercing here
 * would blend two feature spaces into one training set.
 */
function assertRecordVersion(
  record: EvaluationArchiveRecord,
  path: string,
  lineNumber: number,
): EvaluationArchiveRecord {
  if (record.descriptorVersion !== EVALUATION_DESCRIPTOR_VERSION) {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} was written with descriptor version ` +
        `${record.descriptorVersion}, but this build reads version ` +
        `${EVALUATION_DESCRIPTOR_VERSION}. Refusing to mix feature spaces.`,
      "DESCRIPTOR_VERSION_MISMATCH",
    );
  }
  if (record.descriptor.length !== EVALUATION_DESCRIPTOR_LENGTH) {
    throw new EvaluationArchiveError(
      `${path}:${lineNumber} has a ${record.descriptor.length}-slot descriptor, ` +
        `but version ${EVALUATION_DESCRIPTOR_VERSION} has ` +
        `${EVALUATION_DESCRIPTOR_LENGTH} slots`,
      "DESCRIPTOR_LENGTH_MISMATCH",
    );
  }
  return record;
}

/**
 * Read a whole archive.
 *
 * Every record is validated: a version mismatch, a malformed line, or a
 * wrong-length descriptor throws rather than being skipped. A partially
 * readable archive is not a smaller archive — it is an archive whose contents
 * are not what they claim.
 *
 * @param path - Archive file path.
 * @returns Every record, in write order (oldest first).
 * @throws {EvaluationArchiveError} On any invalid record.
 */
export async function readEvaluationArchive(
  path: string,
): Promise<EvaluationArchiveRecord[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  const records: EvaluationArchiveRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    records.push(
      assertRecordVersion(parseRecordLine(line, path, i + 1), path, i + 1),
    );
  }
  return records;
}
