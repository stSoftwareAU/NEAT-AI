/**
 * Creature input/output shape validation at the deserialisation boundary
 * (Issue #3672).
 *
 * `loadFrom` pre-fills the input neurons straight from `json.input`, one
 * allocation per iteration, before any structural validation runs. The
 * `creatureValidate` check that rejects a bad count fires only at the end of
 * the load, so an untrusted model file could park the process there forever:
 * a negative count decremented away from zero and never terminated, and a
 * count of `1e8` requested a hundred million neurons. Validating the shape
 * first — before the loop, and before the lazily-initialised constructor
 * stores the value unchecked — closes both.
 *
 * `Number.isInteger` alone still admits `1e8`, so the ceiling matters as much
 * as the sign check.
 *
 * @module CreatureShapeValidation
 */

import { ValidationError } from "@errors/ValidationError.ts";

/**
 * Upper bound on the input or output neuron count accepted from JSON.
 *
 * Pinned to the hidden/constant neuron id floor in
 * `@architecture/NeuronId.ts`: an input neuron's id *is* its array index, and
 * hidden ids are allocated from 1,000,000 upwards, so any larger count would
 * collide with the hidden id space regardless of memory. No real topology
 * comes close — the largest creature the suite builds has thousands of
 * neurons, not millions.
 */
export const MAX_NEURON_COUNT = 1_000_000;

/**
 * Assert that the `input` and `output` counts read from untrusted JSON are
 * usable as loop and allocation bounds.
 *
 * Fails closed: the same predicate {@link creatureValidate} applies at the end
 * of a load, hoisted to run before anything is allocated.
 *
 * @param input The raw `input` count from the JSON payload.
 * @param output The raw `output` count from the JSON payload.
 * @param source Tag describing the calling site (e.g. `"fromJSON"`), included
 *   in the error so production logs identify the upstream pipeline.
 * @throws {ValidationError} When either count is not an integer in
 *   `[1, MAX_NEURON_COUNT]`.
 */
export function assertValidCreatureShape(
  input: unknown,
  output: unknown,
  source: string,
): void {
  assertCount(input, "input", source);
  assertCount(output, "output", source);
}

function assertCount(
  value: unknown,
  field: "input" | "output",
  source: string,
): void {
  if (
    typeof value !== "number" || !Number.isInteger(value) ||
    value < 1 || value > MAX_NEURON_COUNT
  ) {
    throw new ValidationError(
      `Invalid creature '${field}' count (source=${source}): expected an ` +
        `integer in [1, ${MAX_NEURON_COUNT}], got ${describe(value)}`,
      "OTHER",
    );
  }
}

/** Longest rendering of a rejected value included in an error message. */
const MAX_REPORTED_LENGTH = 64;

/** Render an untrusted value for an error message without leaking a payload. */
function describe(value: unknown): string {
  const text = typeof value === "string"
    ? `string ${JSON.stringify(value)}`
    : String(value);
  return text.length > MAX_REPORTED_LENGTH
    ? `${text.slice(0, MAX_REPORTED_LENGTH)}…`
    : text;
}
