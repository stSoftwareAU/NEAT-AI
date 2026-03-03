import { assert, assertEquals } from "@std/assert";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";

Deno.test("editAliases", () => {
  const dna: CrisprInterface = {
    id: "edit test",
    mode: "insert",
    synapses: [{
      fromUUID: "abc",
      toUUID: "xyz",
      weight: 1,
    }],
  };
  const aliases: Record<string, string> = {
    "abc": "input-1",
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.synapses);
  const synapse = result.synapses[0];
  assertEquals(synapse.fromUUID, "input-1");
});

Deno.test("editAliases rewrites toUUID", () => {
  const dna: CrisprInterface = {
    id: "toUUID-test",
    mode: "insert",
    synapses: [{
      fromUUID: "source-1",
      toUUID: "old-dest",
      weight: 0.5,
    }, {
      fromUUID: "source-2",
      toUUID: "unchanged-dest",
      weight: 0.3,
    }],
  };
  const aliases: Record<string, string> = {
    "old-dest": "new-dest",
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.synapses);
  assertEquals(result.synapses[0].toUUID, "new-dest");
  assertEquals(result.synapses[0].fromUUID, "source-1");
  assertEquals(result.synapses[1].toUUID, "unchanged-dest");
});

Deno.test("editAliases rewrites neuron uuid", () => {
  const dna: CrisprInterface = {
    id: "neuron-uuid-test",
    mode: "insert",
    neurons: [{
      uuid: "old-neuron-id",
      type: "hidden",
      squash: "LOGISTIC",
      bias: 0,
    }, {
      uuid: "keep-this-id",
      type: "hidden",
      squash: "LOGISTIC",
      bias: 0.5,
    }],
    synapses: [{
      fromUUID: "old-neuron-id",
      toUUID: "keep-this-id",
      weight: 1,
    }],
  };
  const aliases: Record<string, string> = {
    "old-neuron-id": "new-neuron-id",
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.neurons);
  assertEquals(result.neurons[0].uuid, "new-neuron-id");
  assertEquals(result.neurons[1].uuid, "keep-this-id");
  assertEquals(result.synapses[0].fromUUID, "new-neuron-id");
});

Deno.test("editAliases no-op when alias matches nothing", () => {
  const dna: CrisprInterface = {
    id: "no-op-test",
    mode: "insert",
    neurons: [{
      uuid: "neuron-1",
      type: "hidden",
      squash: "LOGISTIC",
      bias: 0,
    }],
    synapses: [{
      fromUUID: "neuron-1",
      toUUID: "output-0",
      weight: 1,
    }],
  };
  const aliases: Record<string, string> = {
    "nonexistent-key": "some-value",
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.neurons);
  assertEquals(result.neurons[0].uuid, "neuron-1");
  assertEquals(result.synapses[0].fromUUID, "neuron-1");
  assertEquals(result.synapses[0].toUUID, "output-0");
});
