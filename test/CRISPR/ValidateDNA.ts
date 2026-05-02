import { assertThrows } from "@std/assert";
import { validateDNA } from "@reconstruct/validateDNA.ts";

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
  // Undefined mode defaults to "append" matching Upgrade.CRISPR behaviour.
  // Synapse must include valid source/target references for append-mode validation.
  const result = validateDNA({
    id: "test-dna",
    synapses: [{ from: 0, to: 1, weight: 1 }],
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

Deno.test("validateDNA - append-mode synapse missing all source references throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ to: 1, weight: 0.5 }],
      }),
    Error,
    "must have at least one source reference",
  );
});

Deno.test("validateDNA - append-mode synapse missing all target references throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ from: 0, weight: 0.5 }],
      }),
    Error,
    "must have at least one target reference",
  );
});

Deno.test("validateDNA - append-mode synapse with no references at all throws", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ weight: 0.5 }],
      }),
    Error,
    "must have at least one source reference",
  );
});

Deno.test("validateDNA - append-mode synapse with fromRelative/toRelative passes", () => {
  const result = validateDNA({
    id: "test-dna",
    mode: "append",
    synapses: [{ fromRelative: -1, toRelative: 0, weight: 0.5 }],
  });
  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - append-mode synapse with fromId/toId passes", () => {
  const result = validateDNA({
    id: "test-dna",
    mode: "append",
    synapses: [{ fromId: 0, toId: 1, weight: 0.5 }],
  });
  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - append-mode synapse with fromUUID/toUUID alone passes (Issue #2509)", () => {
  // UUID-only synapses are valid — Upgrade.CRISPR resolves fromUUID/toUUID
  // to fromId/toId after validateDNA runs, so validateDNA must recognise
  // UUID-only references without requiring a placeholder fromRelative.
  const result = validateDNA({
    id: "test-dna",
    mode: "append",
    synapses: [{
      fromUUID: "output-0",
      toUUID: "5a47061e-9c90-4126-93ed-abdfd27a1dae",
      weight: 0.5,
    }],
  });
  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - append-mode synapse with only fromUUID still requires a target reference", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ fromUUID: "output-0", weight: 0.5 }],
      }),
    Error,
    "must have at least one target reference",
  );
});

Deno.test("validateDNA - append-mode synapse with only toUUID still requires a source reference", () => {
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        mode: "append",
        synapses: [{ toUUID: "output-0", weight: 0.5 }],
      }),
    Error,
    "must have at least one source reference",
  );
});

Deno.test("validateDNA - insert-mode synapse with fromUUID/toUUID still passes", () => {
  // Regression: insert-mode already accepted UUID-only synapses; ensure
  // adding UUID recognition to append-mode does not break insert-mode.
  const result = validateDNA({
    id: "test-insert",
    mode: "insert",
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0 },
    ],
    synapses: [{ fromUUID: "a", toUUID: "b", weight: 0.5 }],
  });
  if (!result.id) {
    throw new Error("Expected validated DNA to be returned");
  }
});

Deno.test("validateDNA - default mode synapse missing source reference throws", () => {
  // When mode is omitted it defaults to "append", so the same validation applies
  assertThrows(
    () =>
      validateDNA({
        id: "test-dna",
        synapses: [{ to: 1, weight: 0.5 }],
      }),
    Error,
    "must have at least one source reference",
  );
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
