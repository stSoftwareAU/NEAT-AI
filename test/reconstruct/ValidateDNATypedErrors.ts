import { assertEquals, assertThrows } from "@std/assert";
import { CrisprError } from "@errors/CrisprError.ts";
import { validateDNA } from "@reconstruct/validateDNA.ts";

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

Deno.test("validateDNA throws CrisprError with INVALID_DNA code for non-object DNA", () => {
  const error = assertThrows(
    () => validateDNA("not-an-object"),
    CrisprError,
    "non-null object",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("validateDNA throws CrisprError with INVALID_DNA code for invalid neuron type", () => {
  const error = assertThrows(
    () =>
      validateDNA({
        id: "test",
        neurons: [{ type: "input", squash: "RELU", bias: 0.1 }],
        synapses: [],
      }),
    CrisprError,
    "'type' must be",
  );
  assertEquals(error.code, "INVALID_DNA");
});

Deno.test("validateDNA throws CrisprError with INVALID_DNA code for non-finite weight", () => {
  const error = assertThrows(
    () => validateDNA({ id: "test", synapses: [{ weight: NaN }] }),
    CrisprError,
    "'weight' must be a finite number",
  );
  assertEquals(error.code, "INVALID_DNA");
});
