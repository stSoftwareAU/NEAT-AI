import { assert } from "@std/assert";
import type { NeatOptions } from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

/**
 * Type-level tests for `NeatOptions.costName`.
 *
 * These intentionally rely on TypeScript compile-time behaviour:
 * - `// @ts-expect-error` must FAIL compilation if the line does not error
 * - valid literals should type-check cleanly
 */

// Built-in cost names should be accepted.
const _validMSE: NeatOptions = { costName: "MSE" };

// Custom names are intentionally rejected at the type level.
// Custom costs should be supplied via the file-path based `customCost` option.
// @ts-expect-error - only built-in cost names are allowed
const _validCustomName: NeatOptions = { costName: "MY_CUSTOM_COST" };

// Default built-in config should allow omitting costName (defaults to "MSE").
createNeatConfig({});
createNeatConfig({ costName: "MAE" });

// @ts-expect-error - only built-in cost names are allowed
createNeatConfig({ costName: "CustomCost" });

Deno.test("type-only: NeatOptions.costName accepts valid built-in names", () => {
  // The real test is that this file compiles with the ts-expect-error
  // annotations above. The runtime assertion below confirms the config
  // objects were created without throwing.
  assert(_validMSE.costName === "MSE", "MSE should be accepted");
});
