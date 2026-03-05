import { assertEquals, assertThrows } from "@std/assert";
import { CrisprError } from "../../src/errors/CrisprError.ts";
import { validateDNA } from "../../src/reconstruct/validateDNA.ts";

Deno.test("validateDNA throws CrisprError with INVALID_DNA code for null DNA", () => {
  try {
    validateDNA(null);
    throw new Error("Expected validateDNA to throw");
  } catch (e) {
    if (!(e instanceof CrisprError)) {
      throw new Error(
        `Expected CrisprError but got ${(e as Error).constructor.name}`,
      );
    }
    assertEquals(e.code, "INVALID_DNA");
  }
});

Deno.test("validateDNA throws CrisprError for non-object DNA", () => {
  assertThrows(
    () => validateDNA("not-an-object"),
    CrisprError,
    "non-null object",
  );
});

Deno.test("validateDNA throws CrisprError for missing id", () => {
  assertThrows(
    () => validateDNA({ synapses: [] }),
    CrisprError,
    "'id' must be a non-empty string",
  );
});

Deno.test("validateDNA throws CrisprError for invalid mode", () => {
  assertThrows(
    () => validateDNA({ id: "test", mode: "bad", synapses: [] }),
    CrisprError,
    "'mode' must be",
  );
});

Deno.test("validateDNA throws CrisprError for non-array neurons", () => {
  assertThrows(
    () => validateDNA({ id: "test", neurons: "bad", synapses: [] }),
    CrisprError,
    "'neurons' must be an array",
  );
});

Deno.test("validateDNA throws CrisprError for non-array synapses", () => {
  assertThrows(
    () => validateDNA({ id: "test", synapses: "bad" }),
    CrisprError,
    "'synapses' must be an array",
  );
});

Deno.test("validateDNA throws CrisprError for null neuron", () => {
  assertThrows(
    () => validateDNA({ id: "test", neurons: [null], synapses: [] }),
    CrisprError,
    "must be a non-null object",
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

Deno.test("validateDNA throws CrisprError for output neuron in insert mode", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        mode: "insert",
        neurons: [{ type: "output", squash: "IDENTITY", bias: 0 }],
        synapses: [],
      }),
    CrisprError,
    "must not contain output neurons",
  );
});

Deno.test("validateDNA throws CrisprError for invalid squash", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        neurons: [{ type: "hidden", squash: "", bias: 0.1 }],
        synapses: [],
      }),
    CrisprError,
    "'squash' must be a non-empty string",
  );
});

Deno.test("validateDNA throws CrisprError for non-finite bias", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        neurons: [{ type: "hidden", squash: "RELU", bias: Infinity }],
        synapses: [],
      }),
    CrisprError,
    "'bias' must be a finite number",
  );
});

Deno.test("validateDNA throws CrisprError for null synapse", () => {
  assertThrows(
    () => validateDNA({ id: "test", synapses: [null] }),
    CrisprError,
    "must be a non-null object",
  );
});

Deno.test("validateDNA throws CrisprError for non-finite weight", () => {
  assertThrows(
    () => validateDNA({ id: "test", synapses: [{ weight: NaN }] }),
    CrisprError,
    "'weight' must be a finite number",
  );
});

Deno.test("validateDNA throws CrisprError for insert-mode 'from' field", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        mode: "insert",
        synapses: [{ weight: 0.5, from: 0 }],
      }),
    CrisprError,
    "must not use 'from'",
  );
});

Deno.test("validateDNA throws CrisprError for insert-mode 'to' field", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        mode: "insert",
        synapses: [{ weight: 0.5, to: 1 }],
      }),
    CrisprError,
    "must not use 'to'",
  );
});

Deno.test("validateDNA throws CrisprError for insert-mode 'fromRelative'", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        mode: "insert",
        synapses: [{ weight: 0.5, fromRelative: 0 }],
      }),
    CrisprError,
    "must not use 'fromRelative'",
  );
});

Deno.test("validateDNA throws CrisprError for insert-mode 'toRelative'", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test",
        mode: "insert",
        synapses: [{ weight: 0.5, toRelative: 0 }],
      }),
    CrisprError,
    "must not use 'toRelative'",
  );
});
