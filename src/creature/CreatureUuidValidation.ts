/**
 * Creature UUID validation at the deserialisation boundary (Issue #3670).
 *
 * `Creature.fromJSON` / `loadFrom` accept JSON authored anywhere — a
 * downloaded pretrained model, a checkpoint from a shared training run, a
 * file from a colleague. The `uuid` field of that JSON is later concatenated
 * into filesystem paths (discovery temp directories, trace stores, failed
 * training dumps), one of which is deleted with
 * `Deno.remove(..., { recursive: true })`. An unvalidated `uuid` of
 * `"../../.."` therefore becomes a path-traversal primitive with a
 * destructive sink (CWE-22).
 *
 * Validating once here closes every downstream sink at the boundary rather
 * than at each call site. Failing closed is correct: a creature whose `uuid`
 * is not a UUID is malformed regardless of intent.
 *
 * @module CreatureUuidValidation
 */

import { ValidationError } from "@errors/ValidationError.ts";

/**
 * Canonical 8-4-4-4-12 hexadecimal UUID layout, case-insensitive.
 *
 * Deliberately looser than `@std/uuid`'s `validate`, which additionally
 * pins the version nibble to 1-8 and the variant nibble to 8/9/a/b. Creature
 * uuids persisted by earlier releases are not all version/variant conformant,
 * and rejecting them would break loading existing model files for no security
 * gain: the layout check alone already excludes every `/`, `\`, `.`, and NUL,
 * so no accepted value can act as a path-traversal component.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest rendering of a rejected value included in an error message. */
const MAX_REPORTED_LENGTH = 128;

/**
 * Render an untrusted value for an error message without leaking a huge
 * payload or raw control characters into logs.
 */
function describe(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = Object.prototype.toString.call(value);
  }
  return text.length > MAX_REPORTED_LENGTH
    ? `${text.slice(0, MAX_REPORTED_LENGTH)}…`
    : text;
}

/**
 * Assert that a creature `uuid` read from untrusted JSON is a canonical UUID.
 *
 * An absent (`undefined`) uuid is allowed — `CreatureExport` deliberately
 * omits it and `CreatureUtil.makeUUID` fills it in later. Any present value
 * must match the canonical 8-4-4-4-12 hexadecimal UUID layout; anything else
 * throws.
 *
 * @param uuid The raw value taken from the JSON payload.
 * @param source Tag describing the calling site (e.g. `"fromJSON"`),
 *   included in the error so production logs identify the upstream pipeline.
 * @returns The validated uuid, or `undefined` when none was supplied.
 * @throws {ValidationError} When `uuid` is present but not a valid UUID.
 */
export function assertValidCreatureUuid(
  uuid: unknown,
  source: string,
): string | undefined {
  if (uuid === undefined) return undefined;

  if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) {
    throw new ValidationError(
      `Invalid creature uuid ${describe(uuid)} (source=${source}): ` +
        `expected a canonical UUID. Refusing to load — an arbitrary uuid ` +
        `reaches the filesystem as a path component.`,
      "OTHER",
    );
  }

  return uuid;
}
