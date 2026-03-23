import { assert, assertEquals } from "@std/assert";
import { CRISPR, type CrisprInterface } from "../../src/reconstruct/CRISPR.ts";
Deno.test("editAliases", () => {
  const abcId = 1096354;
  const xyzId = 1119193;
  const dna: CrisprInterface = {
    id: "edit test",
    mode: "insert",
    synapses: [{ fromId: abcId, toId: xyzId, weight: 1 }],
  };
  const aliases: Record<number, number> = { [abcId]: 1 };
  const result = CRISPR.editAliases(dna, aliases);
  assert(result.synapses);
  assertEquals(result.synapses[0].fromId, 1);
});
Deno.test("editAliases rewrites toUUID", () => {
  const source1Id = 1747326271;
  const oldDestId = 153121992;
  const source2Id = 1747326272;
  const unchangedDestId = 902955788;
  const newDestId = 1331674351;
  const dna: CrisprInterface = {
    id: "toUUID-test",
    mode: "insert",
    synapses: [
      { fromId: source1Id, toId: oldDestId, weight: 0.5 },
      { fromId: source2Id, toId: unchangedDestId, weight: 0.3 },
    ],
  };
  const aliases: Record<number, number> = { [oldDestId]: newDestId };
  const result = CRISPR.editAliases(dna, aliases);
  assert(result.synapses);
  assertEquals(result.synapses[0].toId, newDestId);
  assertEquals(result.synapses[0].fromId, source1Id);
  assertEquals(result.synapses[1].toId, unchangedDestId);
});
Deno.test("editAliases rewrites neuron uuid", () => {
  const oldNeuronId = 1801349071;
  const keepThisId = 651196066;
  const newNeuronId = 1408835592;
  const dna: CrisprInterface = {
    id: "neuron-uuid-test",
    mode: "insert",
    neurons: [
      { id: oldNeuronId, type: "hidden", squash: "LOGISTIC", bias: 0 },
      { id: keepThisId, type: "hidden", squash: "LOGISTIC", bias: 0.5 },
    ],
    synapses: [{ fromId: oldNeuronId, toId: keepThisId, weight: 1 }],
  };
  const aliases: Record<number, number> = { [oldNeuronId]: newNeuronId };
  const result = CRISPR.editAliases(dna, aliases);
  assert(result.neurons);
  assertEquals(result.neurons[0].id, newNeuronId);
  assertEquals(result.neurons[1].id, keepThisId);
  assertEquals(result.synapses[0].fromId, newNeuronId);
});
Deno.test("editAliases no-op when alias matches nothing", () => {
  const neuron1Id = 1338473111;
  const dna: CrisprInterface = {
    id: "no-op-test",
    mode: "insert",
    neurons: [{ id: neuron1Id, type: "hidden", squash: "LOGISTIC", bias: 0 }],
    synapses: [{ fromId: neuron1Id, toId: -1, weight: 1 }],
  };
  const aliases: Record<number, number> = { 99999: 88888 };
  const result = CRISPR.editAliases(dna, aliases);
  assert(result.neurons);
  assertEquals(result.neurons[0].id, neuron1Id);
  assertEquals(result.synapses[0].fromId, neuron1Id);
  assertEquals(result.synapses[0].toId, -1);
});
