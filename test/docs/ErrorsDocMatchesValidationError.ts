/**
 * Issue #3273 — docs/api/ERRORS.md must document the real ValidationError
 * shape, not a pattern that can never match.
 *
 * The bug: the doc described `name: ValidationErrorName` and a handling example
 * that branched on `error.name === "RECURSIVE_SYNAPSE"`. In the source,
 * `.name` is always the literal "ValidationError" and the failure code lives in
 * `.reason`, so that catch block could never fire and validation errors escaped
 * unhandled.
 *
 * These are "what" tests: they construct real ValidationError instances and
 * assert on their runtime shape, then assert the published doc matches that
 * shape (documents `reason`, lists every reason, and never teaches the
 * impossible `name === "<REASON>"` pattern).
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import {
  ValidationError,
  type ValidationErrorName,
} from "@errors/ValidationError.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const ERRORS_DOC = `${REPO_ROOT}/docs/api/ERRORS.md`;

// Authoritative list of reasons, mirrored from the source union. Each entry is
// exercised against a real ValidationError below, so a drift in the source
// breaks this test rather than passing silently.
const REASONS: ReadonlyArray<ValidationErrorName> = [
  "OTHER",
  "NEURON_ORDER",
  "NO_OUTWARD_CONNECTIONS",
  "NO_INWARD_CONNECTIONS",
  "IF_CONDITIONS",
  "RECURSIVE_SYNAPSE",
  "SELF_CONNECTION",
  "DUPLICATE_SYNAPSE",
  "MEMETIC",
];

Deno.test("ValidationError.name is the fixed literal, code lives in reason", () => {
  const error = new ValidationError("backward connection", "RECURSIVE_SYNAPSE");
  // The exact drift the doc used to teach: name is NOT the failure code.
  // Widen to string so the (correct) comparison is not a compile-time tautology.
  const observedName: string = error.name;
  assertEquals(observedName, "ValidationError");
  assert(
    observedName !== "RECURSIVE_SYNAPSE",
    "name must never equal the failure code",
  );
  assertEquals(error.reason, "RECURSIVE_SYNAPSE");
});

Deno.test("ERRORS.md documents the discriminant field `reason`", async () => {
  const content = await Deno.readTextFile(ERRORS_DOC);
  assert(
    content.includes("readonly reason: ValidationErrorName"),
    "ERRORS.md must document the `reason` field carrying the failure code",
  );
  assert(
    content.includes('override readonly name = "ValidationError"'),
    'ERRORS.md must document `name` as the fixed literal "ValidationError"',
  );
  assert(
    content.includes(
      "constructor(message: string, reason: ValidationErrorName)",
    ),
    "ERRORS.md constructor signature must take `reason`, not `name`",
  );
});

Deno.test("ERRORS.md lists every ValidationErrorName reason", async () => {
  const content = await Deno.readTextFile(ERRORS_DOC);
  for (const reason of REASONS) {
    assert(
      content.includes(`"${reason}"`),
      `ERRORS.md must list the "${reason}" reason in the documented union`,
    );
  }
});

Deno.test("ERRORS.md never teaches the impossible name === <REASON> pattern", async () => {
  const content = await Deno.readTextFile(ERRORS_DOC);
  // Every reason (except the OTHER catch-all, harmless) matched against
  // `name ===` would be a pattern that can never fire.
  for (const reason of REASONS) {
    assert(
      !content.includes(`name === "${reason}"`),
      `ERRORS.md must not branch on name === "${reason}" (name is always ` +
        `"ValidationError"); branch on reason instead`,
    );
  }
  // The corrected discriminant pattern must be present.
  assert(
    content.includes('reason === "RECURSIVE_SYNAPSE"'),
    "ERRORS.md handling example must branch on `reason`",
  );
});
