import { assert, assertEquals } from "@std/assert";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";

Deno.test("editAliases", () => {
  const dna: CrisprInterface = {
    id: "edit test",
    mode: "insert",
    synapses: [{
      fromId: 9762,
      toId: 9352,
      weight: 1,
    }],
  };
  const aliases: Record<number, number> = {
    9762: 1,
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.synapses);
  const synapse = result.synapses[0];
  assertEquals(synapse.fromId, 1);
});

Deno.test("editAliases rewrites toUUID", () => {
  const dna: CrisprInterface = {
    id: "toUUID-test",
    mode: "insert",
    synapses: [{
      fromId: 9336,
      toId: 9889,
      weight: 0.5,
    }, {
      fromId: 9896,
      toId: 9880,
      weight: 0.3,
    }],
  };
  const aliases: Record<number, number> = {
    9889: 9827,
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.synapses);
  assertEquals(result.synapses[0].toId, 9827);
  assertEquals(result.synapses[0].fromId, 9901);
  assertEquals(result.synapses[1].toId, 9906);
});

Deno.test("editAliases rewrites neuron uuid", () => {
  const dna: CrisprInterface = {
    id: "neuron-uuid-test",
    mode: "insert",
    neurons: [{
      id: 9261,
      type: "hidden",
      squash: "LOGISTIC",
      bias: 0,
    }, {
      id: 9657,
      type: "hidden",
      squash: "LOGISTIC",
      bias: 0.5,
    }],
    synapses: [{
      fromId: 9261,
      toId: 9657,
      weight: 1,
    }],
  };
  const aliases: Record<number, number> = {
    9261: 9999,
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.neurons);
  assertEquals(result.neurons[0].id, 9999);
  assertEquals(result.neurons[1].id, 9657);
  assertEquals(result.synapses[0].fromId, 9999);
});

Deno.test("editAliases no-op when alias matches nothing", () => {
  const dna: CrisprInterface = {
    id: "no-op-test",
    mode: "insert",
    neurons: [{
      id: 9810,
      type: "hidden",
      squash: "LOGISTIC",
      bias: 0,
    }],
    synapses: [{
      fromId: 9810,
      toId: -1,
      weight: 1,
    }],
  };
  const aliases: Record<number, number> = {
    99999: 88888,
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.neurons);
  assertEquals(result.neurons[0].id, 9810);
  assertEquals(result.synapses[0].fromId, 9810);
  assertEquals(result.synapses[0].toId, -1);
});
