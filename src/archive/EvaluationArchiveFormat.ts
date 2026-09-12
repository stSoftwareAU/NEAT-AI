/**
 * EvaluationArchiveFormat.ts — the on-disk record shape of the evaluation
 * archive, and the only code allowed to decide whether a line is one
 * (Issue #3929).
 *
 * Split from the writer so the format has a single owner: a reader, the
 * append-time version check, and any future migration tool all validate through
 * the same three functions rather than each re-deriving what a valid record is.
 *
 * Nothing here coerces. A version mismatch, a torn line, or a wrong-length
 * descriptor throws, because a partially readable archive is not a smaller
 * archive — it is an archive whose contents are not what they claim.
 *
 * @module EvaluationArchiveFormat
 */

import { EvaluationArchiveError } from "@errors/EvaluationArchiveError.ts";
import {
  EVALUATION_DESCRIPTOR_LENGTH,
  EVALUATION_DESCRIPTOR_VERSION,
} from "@archive/EvaluationDescriptor.ts";

/** One archived evaluation. */
export interface EvaluationArchiveRecord {
  /** Layout version of {@link descriptor}. Readers refuse to mix versions. */
  readonly descriptorVersion: number;
  /** Run that produced the evaluation. */
  readonly runId: string;
  /** Generation index within that run. */
  readonly generation: number;
  /** Content-hash UUID (universally unique identifier) of the creature. */
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
  /**
   * UUID of the creature the `geneticDistanceToReference` descriptor slot was
   * measured against — the run's fittest at that generation. Absent when there
   * was no reference, in which case that slot carries its sentinel.
   *
   * That slot is the one **relative** entry in an otherwise absolute vector:
   * the reference moves whenever the fittest changes, and an archive appended
   * to across runs mixes references from different lineages. Recording the
   * origin is what keeps that visible — a consumer can group by it, or drop
   * the slot — instead of it being a silent drift the version gate cannot see.
   */
  readonly referenceUuid?: string;
  /** The fixed-length feature vector. */
  readonly descriptor: readonly number[];
}

/**
 * Parse one archive line into a record.
 *
 * @param line - The raw line, without its terminating newline.
 * @param path - Archive path, for the error message.
 * @param lineNumber - 1-based line number, for the error message.
 * @returns The parsed record. Its descriptor version is **not** yet checked —
 *   see {@link assertRecordVersion}.
 * @throws {EvaluationArchiveError} `MALFORMED_RECORD` when the line is not
 *   JSON (JavaScript Object Notation), or is missing a required field.
 */
export function parseRecordLine(
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
 * Refuse a record written under a different descriptor version or length.
 *
 * This is the fail-loud gate the archive's contract rests on: coercing here
 * would blend two feature spaces into one training set, and nothing downstream
 * would ever report the blend as an error.
 *
 * @param record - The parsed record.
 * @param path - Archive path, for the error message.
 * @param lineNumber - 1-based line number, for the error message.
 * @returns The same record, once it is known to be of this version.
 * @throws {EvaluationArchiveError} `DESCRIPTOR_VERSION_MISMATCH` or
 *   `DESCRIPTOR_LENGTH_MISMATCH`.
 */
export function assertRecordVersion(
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
      `${path}:${lineNumber} has a ${record.descriptor.length}-slot ` +
        `descriptor, but version ${EVALUATION_DESCRIPTOR_VERSION} has ` +
        `${EVALUATION_DESCRIPTOR_LENGTH} slots`,
      "DESCRIPTOR_LENGTH_MISMATCH",
    );
  }
  return record;
}

/**
 * Wrap a filesystem failure as a typed archive error.
 *
 * A consumer catching `EvaluationArchiveError` is promised every archive
 * failure; letting a raw permission or disk error escape would break that
 * promise for exactly the faults an operator most needs to see.
 *
 * @param error - The caught error.
 * @param path - Archive path, for the message.
 * @param operation - What was being attempted, for the message.
 * @returns The typed error to throw.
 */
export function toArchiveIoError(
  error: unknown,
  path: string,
  operation: string,
): EvaluationArchiveError {
  const detail = error instanceof Error ? error.message : String(error);
  return new EvaluationArchiveError(
    `failed to ${operation} evaluation archive ${path}: ${detail}`,
    "IO_FAILURE",
  );
}

/**
 * Read a whole archive.
 *
 * Every record is validated: a version mismatch, a malformed line, or a
 * wrong-length descriptor throws rather than being skipped.
 *
 * @param path - Archive file path.
 * @returns Every record, in write order (oldest first). An archive that was
 *   never written reads as empty — that is an absent archive, not a fault.
 * @throws {EvaluationArchiveError} On any invalid record, or on an I/O
 *   (input/output) failure other than the file being absent.
 */
export async function readEvaluationArchive(
  path: string,
): Promise<EvaluationArchiveRecord[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw toArchiveIoError(error, path, "read");
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
