import { assert, assertEquals } from "@std/assert";
import { CRISPR, type CrisprInterface } from "@reconstruct/CRISPR.ts";

Deno.test("editAliases resolves UUID aliases in synapse fromUUID", () => {
  const dna: CrisprInterface = {
    id: "uuid-fromUUID-test",
    mode: "append",
    synapses: [
      { fromUUID: "rsi-9d", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "macd-12", toUUID: "output-0", weight: 0.3 },
    ],
  };
  const uuidAliases: Record<string, string> = {
    "rsi-9d": "input-666",
    "macd-12": "input-777",
  };
  const result = CRISPR.editAliases(dna, uuidAliases);
  assert(result.synapses);
  assertEquals(result.synapses[0].fromUUID, "input-666");
  assertEquals(result.synapses[1].fromUUID, "input-777");
  // toUUID should remain unchanged
  assertEquals(result.synapses[0].toUUID, "output-0");
  assertEquals(result.synapses[1].toUUID, "output-0");
});

Deno.test("editAliases resolves UUID aliases in synapse toUUID", () => {
  const dna: CrisprInterface = {
    id: "uuid-toUUID-test",
    mode: "append",
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-label-a", weight: 0.7 },
    ],
  };
  const uuidAliases: Record<string, string> = {
    "hidden-label-a": "abc-123-def-456",
  };
  const result = CRISPR.editAliases(dna, uuidAliases);
  assert(result.synapses);
  assertEquals(result.synapses[0].toUUID, "abc-123-def-456");
  assertEquals(result.synapses[0].fromUUID, "input-0");
});

Deno.test("editAliases resolves UUID aliases in neuron uuid", () => {
  const dna: CrisprInterface = {
    id: "uuid-neuron-test",
    mode: "append",
    neurons: [
      { uuid: "hidden-label-x", type: "hidden", squash: "LOGISTIC", bias: 0 },
      { uuid: "keep-this-uuid", type: "hidden", squash: "LOGISTIC", bias: 0.5 },
    ],
    synapses: [
      { fromUUID: "hidden-label-x", toUUID: "keep-this-uuid", weight: 1 },
    ],
  };
  const uuidAliases: Record<string, string> = {
    "hidden-label-x": "real-uuid-999",
  };
  const result = CRISPR.editAliases(dna, uuidAliases);
  assert(result.neurons);
  assertEquals(result.neurons[0].uuid, "real-uuid-999");
  assertEquals(result.neurons[1].uuid, "keep-this-uuid");
  assertEquals(result.synapses[0].fromUUID, "real-uuid-999");
  assertEquals(result.synapses[0].toUUID, "keep-this-uuid");
});

Deno.test("editAliases UUID aliases no-op when nothing matches", () => {
  const dna: CrisprInterface = {
    id: "uuid-noop-test",
    mode: "append",
    neurons: [
      { uuid: "existing-uuid", type: "hidden", squash: "LOGISTIC", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "existing-uuid", weight: 1 },
    ],
  };
  const uuidAliases: Record<string, string> = {
    "nonexistent-label": "some-uuid",
  };
  const result = CRISPR.editAliases(dna, uuidAliases);
  assert(result.neurons);
  assertEquals(result.neurons[0].uuid, "existing-uuid");
  assertEquals(result.synapses[0].fromUUID, "input-0");
  assertEquals(result.synapses[0].toUUID, "existing-uuid");
});

Deno.test("editAliases numeric aliases still work (backward compatible)", () => {
  const abcId = 1096354;
  const xyzId = 1119193;
  const dna: CrisprInterface = {
    id: "backward-compat-test",
    mode: "insert",
    synapses: [{ fromId: abcId, toId: xyzId, weight: 1 }],
  };
  const aliases: Record<number, number> = { [abcId]: 1 };
  const result = CRISPR.editAliases(dna, aliases);
  assert(result.synapses);
  assertEquals(result.synapses[0].fromId, 1);
  assertEquals(result.synapses[0].toId, xyzId);
});

Deno.test("editAliases does not mutate original DNA", () => {
  const dna: CrisprInterface = {
    id: "immutability-test",
    mode: "append",
    neurons: [
      { uuid: "label-a", type: "hidden", squash: "LOGISTIC", bias: 0 },
    ],
    synapses: [
      { fromUUID: "label-a", toUUID: "output-0", weight: 1 },
    ],
  };
  const uuidAliases: Record<string, string> = { "label-a": "resolved-uuid" };
  const result = CRISPR.editAliases(dna, uuidAliases);
  // Original should be unchanged
  assert(dna.neurons);
  assertEquals(dna.neurons[0].uuid, "label-a");
  assertEquals(dna.synapses[0].fromUUID, "label-a");
  // Result should be updated
  assert(result.neurons);
  assertEquals(result.neurons[0].uuid, "resolved-uuid");
  assertEquals(result.synapses[0].fromUUID, "resolved-uuid");
});
