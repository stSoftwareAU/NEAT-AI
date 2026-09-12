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
import {
  EVALUATION_ARCHIVE_FILE_NAME,
  type RequiredEvaluationArchiveConfig,
} from "@config/EvaluationArchiveConfig.ts";
import { EvaluationArchiveError } from "@errors/EvaluationArchiveError.ts";
import { getLogger } from "@utils/Logger.ts";
import { lineageOf } from "@archive/CreatureLineage.ts";
import {
  computeEvaluationDescriptor,
  EVALUATION_DESCRIPTOR_VERSION,
} from "@archive/EvaluationDescriptor.ts";
import {
  assertRecordVersion,
  type EvaluationArchiveRecord,
  parseRecordLine,
  toArchiveIoError,
} from "@archive/EvaluationArchiveFormat.ts";

/** Fidelity of a score obtained over the whole corpus: ground truth. */
export const EXACT_FIDELITY = 1;

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
function compactionSlack(maxRecords: number): number {
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

  /** Evaluations declined since the last flush because the score was not finite. */
  private skippedNonFinite = 0;

  /** Evaluations declined since the last flush because the creature had no UUID. */
  private skippedUnidentified = 0;

  /** Issue #4004: records this instance has buffered, run-to-date. */
  private recordedCount = 0;
  /** Issue #4004: how many of those named at least one parent. */
  private recordedWithParents = 0;

  constructor(config: RequiredEvaluationArchiveConfig) {
    this.config = config;
    this.path = `${config.directory}/${EVALUATION_ARCHIVE_FILE_NAME}`;
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
      // describes the runtime, not the design point. Counted, not hidden —
      // `flush` reports the tally.
      this.skippedNonFinite++;
      return;
    }
    const uuid = creature.uuid;
    if (uuid === undefined) {
      // Unjoinable to any other observation of the same creature, and a
      // fabricated key is worse than a missing row. Still counted, because an
      // archive quietly recording nothing is the failure this tally exists to
      // surface.
      this.skippedUnidentified++;
      return;
    }

    const approach = getTag(creature, "approach");
    const referenceUuid = this.reference?.uuid;
    const parents = lineageOf(creature);
    // Issue #4004: a lineage-aware consumer cannot tell a genuinely parentless
    // creature (a seed, a random immigrant) from a derivation the run forgot to
    // record, so the archive counts the difference and `flush` announces it.
    this.recordedCount++;
    if (parents.length > 0) this.recordedWithParents++;
    this.buffer.push({
      descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
      runId: this.config.runId,
      generation: this.generation,
      uuid,
      parents,
      operators: entry.operators ?? [],
      ...(approach ? { approach } : {}),
      score: entry.score,
      ...(entry.error !== undefined && Number.isFinite(entry.error)
        ? { error: entry.error }
        : {}),
      fidelity,
      recordedAt: Temporal.Now.instant().toString(),
      // The genetic-distance slot is measured against *this* creature, so the
      // record says which one. Without it the slot is a number whose origin
      // moved every time the fittest changed — a feature space that drifts
      // silently, which is precisely what the version contract forbids.
      ...(referenceUuid !== undefined ? { referenceUuid } : {}),
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
    this.reportSkipped();
    if (this.buffer.length === 0) return;
    this.reportLineageCoverage();
    const pending = this.buffer;
    this.buffer = [];

    try {
      await Deno.mkdir(this.config.directory, { recursive: true });
      if (this.onDiskCount === undefined) {
        this.onDiskCount = await inspectArchive(this.path);
      }

      const chunk = pending.map((record) => JSON.stringify(record)).join("\n") +
        "\n";
      await Deno.writeTextFile(this.path, chunk, { append: true });
      this.onDiskCount += pending.length;
    } catch (error) {
      // The failure is loud, and the generation's records survive it: a caller
      // that fixes the fault and flushes again loses nothing. Discarding them
      // here would make a loud error quietly destructive.
      this.buffer = [...pending, ...this.buffer];
      throw error instanceof EvaluationArchiveError
        ? error
        : toArchiveIoError(error, this.path, "append to");
    }

    const { maxRecords } = this.config;
    if (this.onDiskCount > maxRecords + compactionSlack(maxRecords)) {
      this.onDiskCount = await compactArchive(this.path, maxRecords);
    }
  }

  /**
   * Issue #4004: what fraction of the records this instance wrote name a
   * parent, run-to-date.
   *
   * The `parents` field is only provenance a consumer can build on when it is
   * actually populated, so the number the archive carries is readable rather
   * than left for a downstream study to discover. `fraction` is `0` for an
   * archive that has recorded nothing.
   *
   * @returns Records written, how many named a parent, and the ratio.
   */
  get lineageCoverage(): {
    readonly records: number;
    readonly withParents: number;
    readonly fraction: number;
  } {
    return {
      records: this.recordedCount,
      withParents: this.recordedWithParents,
      fraction: this.recordedCount === 0
        ? 0
        : this.recordedWithParents / this.recordedCount,
    };
  }

  /**
   * Report, once per flush, any evaluations `record` declined to archive.
   *
   * An archive that silently stopped writing is worse than a run that stops, so
   * the two legitimate skips are counted and announced rather than absorbed.
   * The tally resets each flush so the message names this generation.
   */
  private reportSkipped(): void {
    if (this.skippedNonFinite === 0 && this.skippedUnidentified === 0) return;
    getLogger().warn(
      `[NEAT-AI] Evaluation archive skipped ${this.skippedNonFinite} ` +
        `non-finite score(s) and ${this.skippedUnidentified} creature(s) ` +
        `without a UUID; those evaluations are not in the archive.`,
    );
    this.skippedNonFinite = 0;
    this.skippedUnidentified = 0;
  }

  /**
   * Issue #4004: announce, once per flush, how much provenance the archive is
   * actually carrying.
   *
   * The `parents` field was populated for under 1 % of records and nothing said
   * so, which is how a downstream study spent its budget before discovering the
   * field was empty. The run-to-date ratio is logged with the generation's own,
   * so a regression to an unpopulated field is visible where the archive is
   * written rather than months later.
   */
  private reportLineageCoverage(): void {
    const generationRecords = this.buffer.length;
    let generationWithParents = 0;
    for (const record of this.buffer) {
      if (record.parents.length > 0) generationWithParents++;
    }
    const percent = (count: number, total: number) =>
      total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);
    getLogger().info(
      `[NEAT-AI] Evaluation archive lineage: ${generationWithParents}/` +
        `${generationRecords} record(s) this generation name a parent ` +
        `(${percent(generationWithParents, generationRecords)}%), ` +
        `${this.recordedWithParents}/${this.recordedCount} run-to-date ` +
        `(${percent(this.recordedWithParents, this.recordedCount)}%).`,
    );
  }
}

/**
 * Count the records already in an archive and check the versions at both ends.
 *
 * Streams the file rather than reading it whole: at the default retention bound
 * the archive is tens of megabytes, and this runs on the first flush of every
 * run.
 *
 * **Both ends, not every line.** Validating all 100,000 records on every run
 * start would cost more than the archive saves, and the two ends are where a
 * foreign version actually appears: the first record dates the archive, and the
 * last is what a newer build most recently appended. `readEvaluationArchive`
 * remains the exhaustive check — this is the cheap gate that stops *this* run
 * adding a second feature space to a file that already holds one.
 *
 * @param path - Archive file path.
 * @returns The number of records on disk; `0` when the file does not exist.
 * @throws {EvaluationArchiveError} When either end carries a foreign descriptor
 *   version, is malformed, or the file cannot be read.
 */
async function inspectArchive(path: string): Promise<number> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw toArchiveIoError(error, path, "open");
  }
  try {
    const decoder = new TextDecoder();
    const buffer = new Uint8Array(64 * 1024);
    let lines = 0;
    let firstLine = "";
    let firstLineComplete = false;
    /** Bytes seen since the last newline — the line currently being read. */
    let currentLine: number[] = [];
    /** The most recent complete line, whatever position it ended up in. */
    let lastCompleteLine = "";
    let trailingBytes = false;

    for (;;) {
      // deno-lint-ignore no-await-in-loop
      const read = await file.read(buffer);
      if (read === null) break;
      const slice = buffer.subarray(0, read);
      if (!firstLineComplete) {
        const newlineAt = slice.indexOf(0x0a);
        firstLine += decoder.decode(
          newlineAt === -1 ? slice : slice.subarray(0, newlineAt),
          { stream: newlineAt === -1 },
        );
        if (newlineAt !== -1) firstLineComplete = true;
      }
      for (let i = 0; i < read; i++) {
        if (slice[i] === 0x0a) {
          lines++;
          lastCompleteLine = new TextDecoder().decode(
            new Uint8Array(currentLine),
          );
          currentLine = [];
        } else {
          currentLine.push(slice[i]);
        }
      }
      trailingBytes = slice[read - 1] !== 0x0a;
    }

    if (lines === 0 && !trailingBytes) return 0;
    // A final line without its newline is a torn write. Count it so retention
    // still bounds the file, and check it — the reader would fail on it anyway,
    // and failing here names the fault before more is appended beneath it.
    const tail = trailingBytes
      ? new TextDecoder().decode(new Uint8Array(currentLine))
      : lastCompleteLine;
    const total = trailingBytes ? lines + 1 : lines;

    assertRecordVersion(parseRecordLine(firstLine, path, 1), path, 1);
    if (total > 1) {
      assertRecordVersion(parseRecordLine(tail, path, total), path, total);
    }
    return total;
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
