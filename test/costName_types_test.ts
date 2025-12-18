import type { NeatOptions } from "../mod.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";

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

/**
 * Type-level tests for `createNeatConfig()` defaulting behaviour.
 *
 * The default cost name is currently "MSE". If callers provide a custom generic
 * cost union that does NOT include "MSE", then `costName` must be supplied to
 * avoid a runtime value that the type system says is impossible.
 */

// Default built-in config should allow omitting costName (defaults to "MSE").
createNeatConfig({});

// Custom configs must be explicit if they exclude the default "MSE".
createNeatConfig<"CustomCost">({ costName: "CustomCost" });
// @ts-expect-error - "MSE" is the runtime default, so omitting costName here is unsafe.
createNeatConfig<"CustomCost">({});

// If the custom union includes "MSE", omitting costName is safe and should compile.
createNeatConfig<"MSE" | "CustomCost">({});

Deno.test("type-only: NeatOptions.costName is restricted", () => {
  // Runtime is irrelevant; compilation is the test.
});
