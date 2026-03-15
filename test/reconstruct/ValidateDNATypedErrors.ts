import { assertEquals, assertThrows } from "@std/assert";
import { CrisprError } from "../../src/errors/CrisprError.ts";
import { validateDNA } from "../../src/reconstruct/validateDNA.ts";

// These tests verify that validateDNA throws CrisprError (not generic Error)
// with correct error codes. Full error message coverage is in test/CRISPR/ValidateDNA.ts.

Deno.test("validateDNA throws CrisprError with INVALID_DNA code for null DNA", () => {
  const error = assertThrows(
    () => validateDNA(null),
    CrisprError,
    "non-null object",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("validateDNA throws CrisprError for non-object DNA", () => {
  assertThrows(
    () => validateDNA("not-an-object"),
    CrisprError,
    "non-null object",
  );
});

Deno.test("validateDNA throws CrisprError for invalid neuron type", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        neurons: [{ type: "input", squash: "RELU", bias: 0.1 }],
        synapses: [],
      }),
    CrisprError,
    "'type' must be",
  );
});

Deno.test("validateDNA throws CrisprError for non-finite weight", () => {
  assertThrows(
    () => validateDNA({ id: "test", synapses: [{ weight: NaN }] }),
    CrisprError,
    "'weight' must be a finite number",
  );
});
