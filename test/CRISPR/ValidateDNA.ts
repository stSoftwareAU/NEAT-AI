import { assertThrows } from "@std/assert";
import { validateDNA } from "../../src/reconstruct/validateDNA.ts";

Deno.test("validateDNA - missing id throws descriptive error", () => {
  assertThrows(
    () =>
      validateDNA({
        mode: "append",
        synapses: [{ weight: 1 }],
      }),
    Error,
    "'id' must be a non-empty string",
  );
});

Deno.test("validateDNA - empty id throws descriptive error", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "  ",
        mode: "append",
        synapses: [{ weight: 1 }],
      }),
    Error,
    "'id' must be a non-empty string",
  );
});

Deno.test("validateDNA - invalid mode throws descriptive error", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "replace",
        synapses: [{ weight: 1 }],
      }),
    Error,
    '\'mode\' must be "insert" or "append"',
  );
});

Deno.test("validateDNA - missing mode defaults to append (no throw)", () => {
  // Undefined mode defaults to "append" matching Upgrade.CRISPR behaviour
  const result = validateDNA({
    id: "test-dna",
    synapses: [{ weight: 1 }],
  });
  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - missing weight throws descriptive error", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ from: 0, to: 1 }],
      }),
    Error,
    "'weight' must be a finite number",
  );
});

Deno.test("validateDNA - non-finite weight throws descriptive error", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ from: 0, to: 1, weight: Infinity }],
      }),
    Error,
    "'weight' must be a finite number",
  );
});

Deno.test("validateDNA - insert-mode with static from index throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "insert",
        synapses: [{ from: 0, toUUID: "abc", weight: 1 }],
      }),
    Error,
    "insert-mode DNA must not use 'from'",
  );
});

Deno.test("validateDNA - insert-mode with static to index throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "insert",
        synapses: [{ fromUUID: "abc", to: 5, weight: 1 }],
      }),
    Error,
    "insert-mode DNA must not use 'to'",
  );
});

Deno.test("validateDNA - insert-mode with fromRelative throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "insert",
        synapses: [{ fromRelative: 0, toUUID: "abc", weight: 1 }],
      }),
    Error,
    "insert-mode DNA must not use 'fromRelative'",
  );
});

Deno.test("validateDNA - insert-mode with toRelative throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "insert",
        synapses: [{ fromUUID: "abc", toRelative: 5, weight: 1 }],
      }),
    Error,
    "insert-mode DNA must not use 'toRelative'",
  );
});

Deno.test("validateDNA - insert-mode with output neurons throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "insert",
        neurons: [
          { type: "output", squash: "LOGISTIC", bias: 0 },
        ],
        synapses: [{ fromUUID: "a", toUUID: "b", weight: 1 }],
      }),
    Error,
    "insert-mode DNA must not contain output neurons",
  );
});

Deno.test("validateDNA - neuron missing type throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        neurons: [
          { squash: "LOGISTIC", bias: 0 },
        ],
        synapses: [{ weight: 1 }],
      }),
    Error,
    '\'type\' must be "output" or "hidden"',
  );
});

Deno.test("validateDNA - neuron missing squash throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        neurons: [
          { type: "hidden", bias: 0 },
        ],
        synapses: [{ weight: 1 }],
      }),
    Error,
    "'squash' must be a non-empty string",
  );
});

Deno.test("validateDNA - neuron missing bias throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        neurons: [
          { type: "hidden", squash: "LOGISTIC" },
        ],
        synapses: [{ weight: 1 }],
      }),
    Error,
    "'bias' must be a finite number",
  );
});

Deno.test("validateDNA - valid append-mode DNA passes", () => {
  const result = validateDNA({
    id: "test-dna",
    mode: "append",
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { from: 0, to: 1, weight: 0.8 },
    ],
  });

  // Should return the validated DNA without throwing
  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - valid insert-mode DNA passes", () => {
  const result = validateDNA({
    id: "test-insert",
    mode: "insert",
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.5 },
    ],
    synapses: [
      { fromUUID: "a", toUUID: "b", weight: 0.8 },
    ],
  });

  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - accepts legacy 'nodes' and 'connections' fields", () => {
  const result = validateDNA({
    id: "legacy-dna",
    mode: "append",
    nodes: [
      { type: "hidden", squash: "LOGISTIC", bias: 0 },
    ],
    connections: [
      { from: 0, to: 1, weight: 1 },
    ],
  });

  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - null input throws", () => {
  assertThrows(
    () => validateDNA(null),
    Error,
    "DNA must be a non-null object",
  );
});

Deno.test("validateDNA - missing synapses throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
      }),
    Error,
    "'synapses' must be an array",
  );
});
