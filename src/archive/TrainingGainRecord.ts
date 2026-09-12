/**
 * TrainingGainRecord.ts — the on-disk record shape of the training-gain log, and
 * the only code allowed to decide whether a line is one (Issue #3934).
 *
 * One record is one **real training event**: a creature the memetic rule chose
 * for a gradient step, the design point it had before the step, the rank the
 * rule chose it at, and what the step realised. Gain is not stored — it is
 * `scoreAfter - scoreBefore` and storing a derived column is how a log comes to
 * disagree with itself.
 *
 * Nothing here coerces. A version mismatch, a torn line, or a wrong-length
 * descriptor throws, because a partially readable log is not a smaller log — it
 * is a log whose contents are not what they claim.
 *
 * @module TrainingGainRecord
 */

import { TrainingGainLogError } from "@errors/TrainingGainLogError.ts";
import {
  EVALUATION_DESCRIPTOR_LENGTH,
  EVALUATION_DESCRIPTOR_VERSION,
} from "@archive/EvaluationDescriptor.ts";

/**
 * How a training event ended.
 *
 * `failed` is recorded rather than dropped: a dispatched gradient step that
 * never produced a score still consumed a heavy worker slot, and a log that
 * quietly omitted those would report a gain per unit wall-clock that no run
 * ever achieved.
 */
export type TrainingEventOutcome = "trained" | "failed";

/** One recorded training event. */
export interface TrainingGainRecord {
  /** Layout version of {@link descriptor}. Readers refuse to mix versions. */
  readonly descriptorVersion: number;
  /** Run that dispatched the gradient step. */
  readonly runId: string;
  /** Generation index within that run. */
  readonly generation: number;
  /** Content-hash UUID (universally unique identifier) of the creature. */
  readonly uuid: string;
  /**
   * Rank the selection rule saw the creature at: `0` is the fittest creature of
   * the score-sorted population, `1` the next, and so on.
   *
   * This is the whole point of the record. The current rule takes the top
   * `trainPerGen` ranks, so a correlation between this column and the realised
   * gain is the evidence that the rule allocates local search by anything other
   * than present fitness.
   */
  readonly rank: number;
  /** Creatures the rank was taken over — the finite-score population size. */
  readonly rankedPopulation: number;
  /**
   * Score the creature carried into the gradient step — the one the fitness
   * phase measured, which is what the selection rule ranked it on.
   */
  readonly scoreBefore: number;
  /**
   * Score after the step; absent when the step produced none.
   *
   * **Derived from the training error, not from a fresh fitness evaluation.**
   * It is `calculateScore(trainedCreature, trainingError, costOfGrowth)`, so the
   * pair `(scoreBefore, scoreAfter)` is exactly as comparable as the pair the
   * run's own regression guard compares (`isTrainingErrorRegression`) — no more.
   * A consumer that needs a like-for-like reading must re-evaluate the trained
   * creature itself; `errorBefore` / `errorAfter` carry the two errors that
   * comparison is actually made on.
   */
  readonly scoreAfter?: number;
  /** Training error the creature carried in, when the run had it tagged. */
  readonly errorBefore?: number;
  /** Training error the step reported, when it reported one. */
  readonly errorAfter?: number;
  /**
   * Wall-clock the dispatched step cost, in milliseconds.
   *
   * Measured from dispatch to the outcome settling, so it includes the time the
   * task waited for a worker — which is what the run actually paid.
   */
  readonly wallClockMs: number;
  /** How the event ended. */
  readonly outcome: TrainingEventOutcome;
  /** Wall-clock instant the event was dispatched. */
  readonly dispatchedAt: string;
  /**
   * UUID of the creature the `geneticDistanceToReference` descriptor slot was
   * measured against. Absent when there was no reference, in which case that
   * slot carries its sentinel.
   */
  readonly referenceUuid?: string;
  /** The fixed-length feature vector of the creature **before** the step. */
  readonly descriptor: readonly number[];
}

/**
 * Realised gain of a training event: the score the step bought.
 *
 * A `failed` event has no post-training score, so it has no gain — `undefined`,
 * never `0`. Treating a failed step as a zero-gain step would let the analysis
 * average a fault in with a measurement.
 *
 * > [!IMPORTANT]
 * > The two scores are **not measured the same way**. `scoreBefore` is the
 * > exact score the fitness phase computed over the whole corpus;
 * > `scoreAfter` is derived from the training error the worker returned, over
 * > whatever the trainer sampled. The difference is therefore a mix of "the
 * > step helped" and "the two measurements disagree", and on a production log
 * > that second term is not small. Use {@link trainingErrorGain} when you need
 * > a like-for-like reading; use this one only when the run re-scored the
 * > trained creature exactly, as the Stage 1 study does.
 *
 * @param record - The event.
 * @returns `scoreAfter - scoreBefore`, or `undefined` when the step produced no
 *   score.
 */
export function trainingGain(record: TrainingGainRecord): number | undefined {
  if (record.scoreAfter === undefined) return undefined;
  if (!Number.isFinite(record.scoreAfter)) return undefined;
  if (!Number.isFinite(record.scoreBefore)) return undefined;
  return record.scoreAfter - record.scoreBefore;
}

/**
 * The like-for-like reading: how much the training error fell.
 *
 * Both terms come from the same instrument — the trainer's own error over the
 * data it trained on — so unlike {@link trainingGain} this subtracts two
 * commensurable quantities. Positive means the error fell, which is the
 * direction "better" points in for every other column here.
 *
 * @param record - The event.
 * @returns `errorBefore - errorAfter`, or `undefined` when the run did not tag
 *   both errors (there is no reading, which is not the same as no change).
 */
export function trainingErrorGain(
  record: TrainingGainRecord,
): number | undefined {
  const { errorBefore, errorAfter } = record;
  if (errorBefore === undefined || errorAfter === undefined) return undefined;
  if (!Number.isFinite(errorBefore) || !Number.isFinite(errorAfter)) {
    return undefined;
  }
  return errorBefore - errorAfter;
}

/**
 * Parse one log line into a record.
 *
 * @param line - The raw line, without its terminating newline.
 * @param path - Log path, for the error message.
 * @param lineNumber - 1-based line number, for the error message.
 * @returns The parsed record. Its descriptor version is **not** yet checked —
 *   see {@link assertTrainingGainVersion}.
 * @throws {TrainingGainLogError} `MALFORMED_RECORD` when the line is not JSON
 *   (JavaScript Object Notation), or is missing a required field.
 */
export function parseTrainingGainLine(
  line: string,
  path: string,
  lineNumber: number,
): TrainingGainRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "MALFORMED_RECORD",
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is not a training-gain record`,
      "MALFORMED_RECORD",
    );
  }
  const record = parsed as Partial<TrainingGainRecord>;
  if (typeof record.descriptorVersion !== "number") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} has no descriptorVersion`,
      "MALFORMED_RECORD",
    );
  }
  if (typeof record.uuid !== "string" || typeof record.rank !== "number") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is missing uuid or rank`,
      "MALFORMED_RECORD",
    );
  }
  if (typeof record.scoreBefore !== "number") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is missing scoreBefore`,
      "MALFORMED_RECORD",
    );
  }
  if (typeof record.wallClockMs !== "number") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is missing wallClockMs`,
      "MALFORMED_RECORD",
    );
  }
  if (
    typeof record.generation !== "number" ||
    typeof record.rankedPopulation !== "number"
  ) {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is missing generation or rankedPopulation`,
      "MALFORMED_RECORD",
    );
  }
  if (typeof record.runId !== "string") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} is missing runId`,
      "MALFORMED_RECORD",
    );
  }
  // An event with no outcome is the worst of the malformed cases to accept: a
  // failed step and a trained one cost the same wall-clock and mean opposite
  // things, so a record that does not say which is not a weaker observation,
  // it is an unusable one.
  if (record.outcome !== "trained" && record.outcome !== "failed") {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} has no recognised outcome, got ` +
        `${JSON.stringify(record.outcome)}`,
      "MALFORMED_RECORD",
    );
  }
  if (!Array.isArray(record.descriptor)) {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} has no descriptor vector`,
      "MALFORMED_RECORD",
    );
  }
  return record as TrainingGainRecord;
}

/**
 * Refuse a record written under a different descriptor version or length.
 *
 * This is the fail-loud gate the log's contract rests on: coercing here would
 * blend two feature spaces into one training set, and nothing downstream would
 * ever report the blend as an error.
 *
 * @param record - The parsed record.
 * @param path - Log path, for the error message.
 * @param lineNumber - 1-based line number, for the error message.
 * @returns The same record, once it is known to be of this version.
 * @throws {TrainingGainLogError} `DESCRIPTOR_VERSION_MISMATCH` or
 *   `DESCRIPTOR_LENGTH_MISMATCH`.
 */
export function assertTrainingGainVersion(
  record: TrainingGainRecord,
  path: string,
  lineNumber: number,
): TrainingGainRecord {
  if (record.descriptorVersion !== EVALUATION_DESCRIPTOR_VERSION) {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} was written with descriptor version ` +
        `${record.descriptorVersion}, but this build reads version ` +
        `${EVALUATION_DESCRIPTOR_VERSION}. Refusing to mix feature spaces.`,
      "DESCRIPTOR_VERSION_MISMATCH",
    );
  }
  if (record.descriptor.length !== EVALUATION_DESCRIPTOR_LENGTH) {
    throw new TrainingGainLogError(
      `${path}:${lineNumber} has a ${record.descriptor.length}-slot ` +
        `descriptor, but version ${EVALUATION_DESCRIPTOR_VERSION} has ` +
        `${EVALUATION_DESCRIPTOR_LENGTH} slots`,
      "DESCRIPTOR_LENGTH_MISMATCH",
    );
  }
  return record;
}

/**
 * Wrap a filesystem failure as a typed log error.
 *
 * A consumer catching `TrainingGainLogError` is promised every log failure;
 * letting a raw permission or disk error escape would break that promise for
 * exactly the faults an operator most needs to see.
 *
 * @param error - The caught error.
 * @param path - Log path, for the message.
 * @param operation - What was being attempted, for the message.
 * @returns The typed error to throw.
 */
export function toTrainingGainIoError(
  error: unknown,
  path: string,
  operation: string,
): TrainingGainLogError {
  const detail = error instanceof Error ? error.message : String(error);
  return new TrainingGainLogError(
    `failed to ${operation} training-gain log ${path}: ${detail}`,
    "IO_FAILURE",
  );
}

/**
 * Read a whole training-gain log.
 *
 * Every record is validated: a version mismatch, a malformed line, or a
 * wrong-length descriptor throws rather than being skipped.
 *
 * @param path - Log file path.
 * @returns Every record, in write order (oldest first). A log that was never
 *   written reads as empty — that is an absent log, not a fault.
 * @throws {TrainingGainLogError} On any invalid record, or on an I/O
 *   (input/output) failure other than the file being absent.
 */
export async function readTrainingGainLog(
  path: string,
): Promise<TrainingGainRecord[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw toTrainingGainIoError(error, path, "read");
  }
  const records: TrainingGainRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    records.push(
      assertTrainingGainVersion(
        parseTrainingGainLine(line, path, i + 1),
        path,
        i + 1,
      ),
    );
  }
  return records;
}
