/**
 * Batch scorer result reconciliation (Issue #2423).
 *
 * The external batch scorer returns a single JSON object keyed by creature
 * filename stem, with each value being a result object containing numeric
 * fields (`score`, `error`, `recordCount`, …). This module provides strict
 * reconciliation so NEAT-AI never silently mis-scores a generation:
 *
 * - parses the payload (string or pre-parsed object) and fails fast on invalid
 *   JSON or non-object shapes;
 * - validates that the result key set exactly matches the expected set of
 *   creature filename stems (missing or extra keys both fail fast);
 * - validates that every result carries the required numeric fields with
 *   finite, sensible values (including integer, non-negative `recordCount`);
 * - emits actionable diagnostics naming the offending keys/fields.
 *
 * Failures are reported via {@link BatchScorerError} whose `reason` field
 * allows callers to branch on specific failure modes.
 *
 * @module BatchScorerReconciler
 */

export type BatchScorerErrorReason =
  | "INVALID_JSON"
  | "NOT_AN_OBJECT"
  | "MISSING_KEYS"
  | "EXTRA_KEYS"
  | "MALFORMED_RESULT";

/**
 * Typed error raised by {@link reconcileBatchScorerOutput} on any reconciliation
 * failure. Callers can catch and inspect `reason`, `missingKeys`, `extraKeys`,
 * and `malformedKeys` to emit structured diagnostics.
 */
export class BatchScorerError extends Error {
  override readonly name = "BatchScorerError";
  readonly reason: BatchScorerErrorReason;
  readonly missingKeys?: readonly string[];
  readonly extraKeys?: readonly string[];
  readonly malformedKeys?: readonly string[];

  constructor(
    message: string,
    reason: BatchScorerErrorReason,
    details?: {
      missingKeys?: readonly string[];
      extraKeys?: readonly string[];
      malformedKeys?: readonly string[];
    },
  ) {
    super(message);
    this.reason = reason;
    if (details?.missingKeys) this.missingKeys = details.missingKeys;
    if (details?.extraKeys) this.extraKeys = details.extraKeys;
    if (details?.malformedKeys) this.malformedKeys = details.malformedKeys;
  }
}

/**
 * Validated result for a single creature returned by the batch scorer.
 *
 * Additional numeric diagnostics emitted by the scorer are passed through
 * untouched so downstream consumers can surface them without modification.
 */
export interface BatchScorerResult {
  /** Fitness score the scorer assigned to this creature. */
  score: number;
  /** Aggregate cost/error value (finite). */
  error: number;
  /** Number of records the scorer evaluated against (non-negative integer). */
  recordCount: number;
  /** Passthrough for any additional fields the scorer chose to emit. */
  [extraField: string]: unknown;
}

/** Required numeric fields on each creature result. */
const REQUIRED_NUMERIC_FIELDS = ["score", "error", "recordCount"] as const;

/**
 * Reconcile raw batch scorer output against the expected set of creature
 * filename stems. Returns a `Map<stem, BatchScorerResult>` on success.
 * Throws a {@link BatchScorerError} on any reconciliation failure.
 *
 * @param raw - Either the raw JSON string emitted by the scorer or the already
 *   parsed value (e.g. from an in-process scorer).
 * @param expectedStems - The creature filename stems that must appear in the
 *   result. Duplicates are deduplicated before comparison.
 */
export function reconcileBatchScorerOutput(
  raw: unknown,
  expectedStems: Iterable<string>,
): Map<string, BatchScorerResult> {
  const parsed = parsePayload(raw);
  const expected = new Set(expectedStems);

  const actualKeys = Object.keys(parsed);
  checkKeySet(actualKeys, expected);

  const results = new Map<string, BatchScorerResult>();
  const malformedKeys: string[] = [];
  const malformedDetails: string[] = [];

  // Preserve the expected-stem iteration order so diagnostics are
  // deterministic for operators reading logs.
  for (const stem of expected) {
    const rawResult = parsed[stem];
    const validation = validateResult(rawResult);
    if (!validation.ok) {
      malformedKeys.push(stem);
      malformedDetails.push(`${stem}: ${validation.detail}`);
      continue;
    }
    results.set(stem, validation.value);
  }

  if (malformedKeys.length > 0) {
    throw new BatchScorerError(
      `Batch scorer returned malformed result(s) for ${malformedKeys.length} creature(s): ${
        malformedDetails.join("; ")
      }`,
      "MALFORMED_RESULT",
      { malformedKeys },
    );
  }

  return results;
}

/** Parse the raw payload (string or object) into a plain JSON object. */
function parsePayload(raw: unknown): Record<string, unknown> {
  let value: unknown;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new BatchScorerError(
        `Batch scorer output is not valid JSON: ${detail}`,
        "INVALID_JSON",
      );
    }
  } else {
    value = raw;
  }

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new BatchScorerError(
      `Batch scorer output must be a JSON object keyed by creature stem; got ${
        describeType(value)
      }`,
      "NOT_AN_OBJECT",
    );
  }

  return value as Record<string, unknown>;
}

/** Fail fast when the actual key set does not exactly match the expected. */
function checkKeySet(actualKeys: string[], expected: Set<string>): void {
  const actual = new Set(actualKeys);
  const missing: string[] = [];
  for (const stem of expected) {
    if (!actual.has(stem)) missing.push(stem);
  }
  const extra: string[] = [];
  for (const stem of actual) {
    if (!expected.has(stem)) extra.push(stem);
  }

  if (missing.length === 0 && extra.length === 0) return;

  // Build a single actionable message surfacing both problems when they co-occur
  // so operators can fix the scorer in one pass.
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `missing ${missing.length} expected result(s): ${missing.join(", ")}`,
    );
  }
  if (extra.length > 0) {
    parts.push(`${extra.length} unexpected result key(s): ${extra.join(", ")}`);
  }
  const message = `Batch scorer key set does not match expected creatures — ${
    parts.join("; ")
  }`;

  // Prefer MISSING_KEYS when any expected stem is absent because that is the
  // hard failure for generation scoring; extras alone are still a failure.
  const reason: BatchScorerErrorReason = missing.length > 0
    ? "MISSING_KEYS"
    : "EXTRA_KEYS";

  throw new BatchScorerError(message, reason, {
    missingKeys: missing.length > 0 ? missing : undefined,
    extraKeys: extra.length > 0 ? extra : undefined,
  });
}

/** Validate a single creature result object. Returns structured detail on failure. */
function validateResult(
  raw: unknown,
): { ok: true; value: BatchScorerResult } | {
  ok: false;
  detail: string;
  value?: never;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      detail: `result must be a JSON object, got ${describeType(raw)}`,
    };
  }
  const obj = raw as Record<string, unknown>;
  const problems: string[] = [];

  for (const field of REQUIRED_NUMERIC_FIELDS) {
    const value = obj[field];
    if (value === undefined) {
      problems.push(`missing numeric field \"${field}\"`);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(
        `field \"${field}\" must be a finite number, got ${
          describeType(value)
        }`,
      );
      continue;
    }
    if (field === "recordCount") {
      if (!Number.isInteger(value)) {
        problems.push(`field \"recordCount\" must be an integer, got ${value}`);
      } else if (value < 0) {
        problems.push(
          `field \"recordCount\" must be non-negative, got ${value}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    return { ok: false, detail: problems.join("; ") };
  }

  // Build a new plain object so the passthrough `[extra]` values are preserved
  // but the mandatory numeric fields are narrowed to `number`.
  const result: BatchScorerResult = {
    ...obj,
    score: obj.score as number,
    error: obj.error as number,
    recordCount: obj.recordCount as number,
  };
  return { ok: true, value: result };
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
