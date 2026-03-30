import { assertThrows } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { assertValidSynapseReferences } from "@architecture/AssertValidSynapseReferences.ts";

Deno.test("assertValidSynapseReferences - valid export passes", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", id: 1_000_000, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 1_000_000, weight: 0.5 },
      { fromId: 1, toId: 1_000_000, weight: 0.3 },
      { fromId: 1_000_000, toId: -1, weight: 0.8 },
    ],
  };

  // Should not throw
  assertValidSynapseReferences(exported);
});

Deno.test("assertValidSynapseReferences - dangling fromId throws", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 9999, toId: -1, weight: 0.5 },
    ],
  };

  const error = assertThrows(
    () => assertValidSynapseReferences(exported),
    Error,
  );
  const msg = error.message;
  // Should mention the missing neuron ID
  if (!msg.includes("9999")) {
    throw new Error(`Expected error to mention neuron ID 9999, got: ${msg}`);
  }
  // Should mention fromId
  if (!msg.includes("fromId")) {
    throw new Error(`Expected error to mention 'fromId', got: ${msg}`);
  }
});

Deno.test("assertValidSynapseReferences - dangling toId throws", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 5555, weight: 0.5 },
    ],
  };

  const error = assertThrows(
    () => assertValidSynapseReferences(exported),
    Error,
  );
  const msg = error.message;
  if (!msg.includes("5555")) {
    throw new Error(`Expected error to mention neuron ID 5555, got: ${msg}`);
  }
  if (!msg.includes("toId")) {
    throw new Error(`Expected error to mention 'toId', got: ${msg}`);
  }
});

Deno.test("assertValidSynapseReferences - input neuron IDs are valid sources", () => {
  const exported: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0.1 },
      { fromId: 1, toId: -1, weight: 0.2 },
      { fromId: 2, toId: -1, weight: 0.3 },
    ],
  };

  // All input IDs (0, 1, 2) should be valid — should not throw
  assertValidSynapseReferences(exported);
});

Deno.test("assertValidSynapseReferences - empty synapses passes", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  // No synapses to validate — should not throw
  assertValidSynapseReferences(exported);
});

Deno.test("assertValidSynapseReferences - empty neurons with synapses throws", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 0,
    neurons: [],
    synapses: [
      { fromId: 0, toId: 1_000_000, weight: 0.5 },
    ],
  };

  assertThrows(
    () => assertValidSynapseReferences(exported),
    Error,
  );
});

Deno.test("assertValidSynapseReferences - context string included in error", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 7777, toId: -1, weight: 0.5 },
    ],
  };

  const error = assertThrows(
    () => assertValidSynapseReferences(exported, "after compact"),
    Error,
  );
  if (!error.message.includes("after compact")) {
    throw new Error(
      `Expected error to include context 'after compact', got: ${error.message}`,
    );
  }
});

Deno.test("assertValidSynapseReferences - output neuron IDs are valid targets", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 3,
    neurons: [
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -2, squash: "IDENTITY", bias: 0 },
      { type: "output", id: -3, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0.1 },
      { fromId: 0, toId: -2, weight: 0.2 },
      { fromId: 0, toId: -3, weight: 0.3 },
    ],
  };

  // All output IDs should be valid — should not throw
  assertValidSynapseReferences(exported);
});

Deno.test("assertValidSynapseReferences - constant neuron is valid", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", id: 1_000_001, squash: "IDENTITY", bias: 1 },
      { type: "output", id: -1, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 1_000_001, toId: -1, weight: 0.5 },
    ],
  };

  // Constant neuron should be in the valid set — should not throw
  assertValidSynapseReferences(exported);
});
