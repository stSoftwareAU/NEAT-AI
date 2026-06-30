import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import type { Neuron } from "@architecture/Neuron.ts";
import { Mutation } from "@neat/Mutation.ts";
import { CRISPR } from "@reconstruct/CRISPR.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Count neurons by type. CRISPR's observable effect on topology is a change in
 * these counts (a demoted output becomes hidden, new neurons are appended), so
 * asserting on the counts checks *what* the transform produced rather than the
 * exact serialisation of the export (Issue #2835).
 */
function neuronTypeCounts(creature: Creature): Record<string, number> {
  return creature.neurons.reduce((acc: Record<string, number>, neuron) => {
    acc[neuron.type] = (acc[neuron.type] ?? 0) + 1;
    return acc;
  }, {});
}

/** Squash functions of the output neurons, in declaration order. */
function outputSquashes(creature: Creature): string[] {
  return creature.neurons
    .filter((neuron) => neuron.type === "output")
    .map((neuron) => neuron.squash ?? "");
}

/** Number of neurons carrying the CRISPR tag for the given DNA id. */
function taggedNeuronCount(creature: Creature, dnaId: string): number {
  return creature.neurons.filter((neuron) => getTag(neuron, "CRISPR") === dnaId)
    .length;
}

/** Number of synapses carrying the CRISPR tag for the given DNA id. */
function taggedSynapseCount(creature: Creature, dnaId: string): number {
  return creature.synapses.filter((synapse) =>
    getTag(synapse, "CRISPR") === dnaId
  ).length;
}

/** Deterministic, spread-out sample input of the requested width. */
function sampleInput(size: number): Float32Array {
  return Float32Array.from({ length: size }, (_, i) => ((i % 7) - 3) / 10);
}

/**
 * Assert the DNA-SANE aggregation contract (Issue #3144).
 *
 * The rewrite appends three outputs — MINIMUM, MEAN, MAXIMUM — each wired to
 * the three previous outputs (now demoted to hidden). Demotion preserves a
 * neuron's wiring, bias and squash, so the demoted outputs compute exactly what
 * the *original* network's outputs computed for the same input. That gives us a
 * spec-derived oracle (`demoted`) for the appended outputs.
 *
 * Rather than pinning opaque activation floats pasted from a run — which drift
 * when the activation backend changes even though the MIN/MEAN/MAX behaviour is
 * unchanged — assert the relationship directly: out[0] is the minimum of the
 * demoted outputs, out[1] their mean, out[2] their maximum, each offset by the
 * appended output's own bias.
 */
function assertSaneAggregation(
  creature: Creature,
  out: Float32Array,
  demoted: Float32Array,
): void {
  const outputs = creature.neurons.filter((neuron) => neuron.type === "output");
  assertEquals(
    outputs.map((neuron) => neuron.squash ?? ""),
    ["MINIMUM", "MEAN", "MAXIMUM"],
    "appended outputs use the MIN/MEAN/MAX squashes in order",
  );

  const demotedValues = Array.from(demoted);
  assertEquals(demotedValues.length, 3, "three demoted outputs aggregated");
  const mean = demotedValues.reduce((sum, value) => sum + value, 0) /
    demotedValues.length;

  assertAlmostEquals(
    out[0],
    Math.min(...demotedValues) + outputs[0].bias,
    1e-6,
    "MINIMUM output equals the smallest demoted output (plus its bias)",
  );
  assertAlmostEquals(
    out[1],
    mean + outputs[1].bias,
    1e-6,
    "MEAN output equals the mean of the demoted outputs (plus its bias)",
  );
  assertAlmostEquals(
    out[2],
    Math.max(...demotedValues) + outputs[2].bias,
    1e-6,
    "MAXIMUM output equals the largest demoted output (plus its bias)",
  );
}

function loadNetwork(): Creature {
  return Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/CRISPR/network.json")),
  );
}

function loadDNA(name: string) {
  return JSON.parse(Deno.readTextFileSync(`test/data/CRISPR/${name}`));
}

Deno.test("CRISPR", () => {
  const network = loadNetwork();
  network.validate();
  const before = neuronTypeCounts(network);
  const beforeSynapses = network.synapses.length;

  const crispr = new CRISPR(network);
  const networkIF = crispr.cleaveDNA(loadDNA("DNA-IF.json")) as Creature;
  networkIF.validate();

  const after = neuronTypeCounts(networkIF);
  // The input layer is untouched; the original output is demoted to hidden and
  // a new LOGISTIC hidden neuron plus a new IF output neuron are appended.
  assertEquals(after.input, before.input, "input count unchanged");
  assertEquals(after.output, 1, "still a single output");
  assertEquals(
    after.hidden,
    before.hidden + 2,
    "demoted output + appended hidden neuron",
  );
  assertEquals(
    outputSquashes(networkIF),
    ["IF"],
    "output neuron now uses the introduced IF squash",
  );
  // DNA-IF defines four connections; each becomes a new synapse.
  assertEquals(
    networkIF.synapses.length,
    beforeSynapses + 4,
    "four CRISPR synapses added",
  );
  // Introduced neurons (hidden + output) and synapses carry the DNA's tag.
  assertEquals(taggedNeuronCount(networkIF, "Industry Model"), 2);
  assertEquals(taggedSynapseCount(networkIF, "Industry Model"), 4);

  // The transformed network computes a finite output: the IF gate selects the
  // positive branch for this input.
  const out = networkIF.activate(sampleInput(network.input));
  assertEquals(out.length, 1);
  assertAlmostEquals(out[0], 1, 1e-6, "IF gate selects the positive branch");
});

Deno.test("CRISPR_twice", () => {
  const network = loadNetwork();
  network.validate();
  const dna = loadDNA("DNA-IF.json");

  const once = new CRISPR(network).cleaveDNA(dna) as Creature;
  assert(once);
  once.validate();

  const twice = new CRISPR(once).cleaveDNA(dna) as Creature;
  twice.validate();

  // Re-applying the same DNA is idempotent: cleaveDNA detects the existing
  // CRISPR tag and returns the creature unchanged, so the topology matches the
  // single-application result exactly.
  assertEquals(
    neuronTypeCounts(twice),
    neuronTypeCounts(once),
    "second application leaves the neuron layout unchanged",
  );
  assertEquals(
    twice.synapses.length,
    once.synapses.length,
    "no extra synapses on re-application",
  );
  assertEquals(outputSquashes(twice), ["IF"]);
  assertEquals(taggedNeuronCount(twice, "Industry Model"), 2);
  assertEquals(taggedSynapseCount(twice, "Industry Model"), 4);

  const input = sampleInput(network.input);
  assertAlmostEquals(
    twice.activate(input)[0],
    once.activate(input)[0],
    1e-6,
    "idempotent re-application computes the same output",
  );
});

Deno.test("CRISPR-Volume", () => {
  const network = loadNetwork();
  network.validate();
  const before = neuronTypeCounts(network);
  const beforeSynapses = network.synapses.length;

  const crispr = new CRISPR(network);
  const networkIF = crispr.cleaveDNA(loadDNA("DNA-VOLUME.json")) as Creature;
  networkIF.validate();

  const after = neuronTypeCounts(networkIF);
  // DNA-VOLUME appends a single MINIMUM output and demotes the previous output
  // to hidden — no extra hidden neuron is defined by the DNA.
  assertEquals(after.input, before.input, "input count unchanged");
  assertEquals(after.output, 1, "still a single output");
  assertEquals(
    after.hidden,
    before.hidden + 1,
    "previous output demoted to hidden",
  );
  assertEquals(
    outputSquashes(networkIF),
    ["MINIMUM"],
    "output neuron now uses the introduced MINIMUM squash",
  );
  // DNA-VOLUME defines two connections.
  assertEquals(
    networkIF.synapses.length,
    beforeSynapses + 2,
    "two CRISPR synapses added",
  );
  assertEquals(taggedNeuronCount(networkIF, "Volume Recommendation"), 1);
  assertEquals(taggedSynapseCount(networkIF, "Volume Recommendation"), 2);

  const out = networkIF.activate(sampleInput(network.input));
  assertEquals(out.length, 1);
  assertAlmostEquals(out[0], -0.2, 1e-5, "MINIMUM output is deterministic");
});

Deno.test("REMOVE", () => {
  const networkTXT = Deno.readTextFileSync("test/data/CRISPR/network.json");
  const network = Creature.fromJSON(JSON.parse(networkTXT));
  network.validate();
  const crispr = new CRISPR(network);
  const dnaTXT = Deno.readTextFileSync("test/data/CRISPR/DNA-IF.json");

  const networkIF = crispr.cleaveDNA(JSON.parse(dnaTXT)) as Creature;
  (networkIF as Creature).validate();

  for (let pos = networkIF.neurons.length; pos--;) {
    const node = networkIF.neurons[pos] as Neuron;
    const tag = getTag(node, "CRISPR");
    if (tag) {
      for (let attempts = 0; attempts < 10; attempts++) {
        node.mutate(Mutation.MOD_SQUASH.name);
      }

      const tag = getTag(node, "CRISPR");
      assert(!tag, "Should have removed CRISPR tag");
    }
  }

  networkIF.fix();
  const crispr2 = new CRISPR(networkIF);

  const networkIF2 = crispr2.cleaveDNA(JSON.parse(dnaTXT)) as Creature;

  (networkIF2 as Creature).validate();
});

Deno.test("CRISPR-multi-outputs1", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },
      { type: "hidden", squash: "LOGISTIC", bias: -0.5, index: 4, uuid: "h2" },
      { type: "hidden", squash: "LOGISTIC", bias: 0, index: 5, uuid: "h3" },
      { type: "hidden", squash: "LOGISTIC", bias: 0.5, index: 6, uuid: "h4" },
      { type: "hidden", squash: "MEAN", bias: -0.25, index: 7, uuid: "h5" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 8,
        uuid: "h6",
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 9,
        uuid: "h7",
        bias: 0,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 10,
        uuid: "h8",
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 3, to: 8, weight: 0.2 },
      { from: 0, to: 8, weight: 0.25 },
      { from: 3, to: 4, weight: 0.3 },
      { from: 2, to: 5, weight: 0.4 },
      { from: 5, to: 10, weight: 0.4 },
      { from: 1, to: 6, weight: 0.5 },
      { from: 4, to: 7, weight: 0.7 },
      { from: 6, to: 8, weight: 0.8 },
      { from: 7, to: 9, weight: 0.9 },
    ],
    input: 3,
    output: 3,
  };
  const network = Creature.fromJSON(json);
  network.validate();
  const before = neuronTypeCounts(network);
  const beforeSynapses = network.synapses.length;

  const crispr = new CRISPR(network);
  const networkSANE = Creature.fromJSON(
    crispr.cleaveDNA(loadDNA("DNA-SANE.json")),
  );
  networkSANE.validate();

  const after = neuronTypeCounts(networkSANE);
  // DNA-SANE appends three outputs (MINIMUM, MEAN, MAXIMUM) and demotes the
  // three previous outputs to hidden.
  assertEquals(after.input, before.input, "input count unchanged");
  assertEquals(after.output, 3, "three outputs after the rewrite");
  assertEquals(
    after.hidden,
    before.hidden + 3,
    "three previous outputs demoted to hidden",
  );
  assertEquals(outputSquashes(networkSANE), ["MINIMUM", "MEAN", "MAXIMUM"]);
  // DNA-SANE defines nine connections (three per new output).
  assertEquals(
    networkSANE.synapses.length,
    beforeSynapses + 9,
    "nine CRISPR synapses added",
  );
  assertEquals(taggedNeuronCount(networkSANE, "Sane Output"), 3);
  assertEquals(taggedSynapseCount(networkSANE, "Sane Output"), 9);

  // The transformed network honours the MIN/MEAN/MAX aggregation contract over
  // the demoted outputs for a fixed input (Issue #3144). A fresh copy of the
  // pre-CRISPR network yields the demoted-output values (demotion preserves
  // their wiring), giving a spec-derived oracle rather than frozen floats.
  const fixedInput = new Float32Array([0.1, 0.2, 0.3]);
  const demoted = Creature.fromJSON(json).activate(fixedInput);
  const out = networkSANE.activate(fixedInput);
  assertEquals(out.length, 3);
  assertSaneAggregation(networkSANE, out, demoted);
});

Deno.test("CRISPR-multi-outputs2", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 4,
        uuid: "h6",
        bias: 0,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 5,
        uuid: "h7",
        bias: 0,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 6,
        uuid: "h8",
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 2, to: 4, weight: 0.2 },
      { from: 3, to: 5, weight: 0.3 },
      { from: 2, to: 6, weight: 0.4 },
    ],
    input: 3,
    output: 3,
  };
  const network = Creature.fromJSON(json);
  network.validate();
  const before = neuronTypeCounts(network);
  const beforeSynapses = network.synapses.length;

  const crispr = new CRISPR(network);
  const networkSANE = Creature.fromJSON(
    crispr.cleaveDNA(loadDNA("DNA-SANE.json")),
  );
  networkSANE.validate();

  const after = neuronTypeCounts(networkSANE);
  assertEquals(after.input, before.input, "input count unchanged");
  assertEquals(after.output, 3, "three outputs after the rewrite");
  assertEquals(
    after.hidden,
    before.hidden + 3,
    "three previous outputs demoted to hidden",
  );
  assertEquals(outputSquashes(networkSANE), ["MINIMUM", "MEAN", "MAXIMUM"]);
  assertEquals(
    networkSANE.synapses.length,
    beforeSynapses + 9,
    "nine CRISPR synapses added",
  );
  assertEquals(taggedNeuronCount(networkSANE, "Sane Output"), 3);
  assertEquals(taggedSynapseCount(networkSANE, "Sane Output"), 9);

  // Same MIN/MEAN/MAX aggregation contract over the demoted outputs (Issue
  // #3144); the pre-CRISPR network supplies the demoted-output oracle.
  const fixedInput = new Float32Array([0.1, 0.2, 0.3]);
  const demoted = Creature.fromJSON(json).activate(fixedInput);
  const out = networkSANE.activate(fixedInput);
  assertEquals(out.length, 3);
  assertSaneAggregation(networkSANE, out, demoted);
});

Deno.test("CRISPR-uuid", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: -1, index: 3, uuid: "h1" },
      {
        type: "output",
        squash: "IDENTITY",
        index: 4,
        bias: 0.1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        index: 5,
        bias: 0.2,
      },
      {
        type: "output",
        squash: "LOGISTIC",
        index: 6,
        bias: 0.3,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 0.1 },
      { from: 2, to: 4, weight: 0.2 },
      { from: 3, to: 5, weight: 0.3 },
      { from: 2, to: 6, weight: 0.4 },
    ],
    input: 3,
    output: 3,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  const crispr = new CRISPR(creature);
  const dna = JSON.parse(Deno.readTextFileSync(
    "test/data/CRISPR/DNA-proximity-to-delisting.json",
  ));
  const tmpCreature = crispr.cleaveDNA(dna);
  assert(tmpCreature);
  const networkSANE = Creature.fromJSON(tmpCreature);
  networkSANE.validate();
  const synapseWithComment = networkSANE.synapses.find((s) =>
    "Negative weight to trigger on ≤ 0" === getTag(s, "comment")
  );
  assert(synapseWithComment, "Should have comment");
});
