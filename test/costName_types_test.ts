import type { NeatOptions } from "../mod.ts";

/**
 * Type-level tests for `NeatOptions.costName`.
 *
 * These intentionally rely on TypeScript compile-time behaviour:
 * - `// @ts-expect-error` must FAIL compilation if the line does not error
 * - valid literals should type-check cleanly
 */

// Valid built-in costs should be accepted.
const _validMSE: NeatOptions = { costName: "MSE" };
const _validMAE: NeatOptions = { costName: "MAE" };

// Invalid cost names should be rejected at compile time.
// @ts-expect-error - "XYZ" is not a built-in cost name.
const _invalid: NeatOptions = { costName: "XYZ" };

// Escape hatch: callers with custom costs can widen the generic parameter.
const _custom: NeatOptions<"MSE" | "XYZ"> = { costName: "XYZ" };

Deno.test("type-only: NeatOptions.costName is restricted", () => {
  // Runtime is irrelevant; compilation is the test.
});

