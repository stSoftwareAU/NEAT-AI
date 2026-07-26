/**
 * Issue #3477 — tests for pooled / inlined weight accumulation in
 * `propagateUpdate`.
 *
 * `propagateUpdate` no longer allocates fresh growable arrays per neuron:
 *   - Coordination disabled (`biasWeightCoordinationFactor >= 1`): each
 *     candidate weight is applied inline with no scratch arrays.
 *   - Coordination enabled (`< 1`): the current/candidate/source scratch
 *     arrays are reused from the shared `state.backpropBuffers` pool, sized to
 *     the maximum fan-in.
 *
 * These are "what" tests: they assert on training output (finite, changed,
 * deterministic) — not on the allocation mechanism. A stale-buffer leak through
 * the shared pool would surface as NaN weights or as non-deterministic output
 * between two identical training runs; both are asserted here.
 *
 * Australian English: behaviour, neighbour.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

/**
 * Build a feed-forward creature that mixes a wide fan-in output neuron with
 * narrow fan-in hidden neurons, so the shared buffer pool is grown by a large
 * neuron and then reused by smaller ones within a single training pass.
 */
function buildMixedFanInCreature(): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  const inputCount = 6;
  const hiddenUUIDs: string[] = [];
  // Narrow-fan-in hidden neurons: each takes two inputs.
  for (let i = 0; i < 8; i++) {
    const uuid = `hidden-${i}`;
    hiddenUUIDs.push(uuid);
    neurons.push({ type: "hidden", uuid, squash: "TANH", bias: 0.1 * i - 0.3 });
    synapses.push({
      fromUUID: `input-${i % inputCount}`,
      toUUID: uuid,
      weight: 0.2 + i * 0.03,
    });
    synapses.push({
      fromUUID: `input-${(i + 1) % inputCount}`,
      toUUID: uuid,
      weight: -0.15 + i * 0.02,
    });
  }

  // Wide-fan-in output neuron: connects every hidden neuron and every input.
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  for (let i = 0; i < inputCount; i++) {
    synapses.push({ fromUUID: `input-${i}`, toUUID: "output-0", weight: 0.1 });
  }
  for (const uuid of hiddenUUIDs) {
    synapses.push({ fromUUID: uuid, toUUID: "output-0", weight: 0.05 });
  }

  return { input: inputCount, output: 1, neurons, synapses };
}

const INPUT = new Float32Array([0.9, -0.4, 0.6, 0.2, -0.8, 0.5]);
const TARGET = new Float32Array([0.35]);

function trainAndExport(
  json: CreatureExport,
  coordinationFactor: number,
): CreatureExport {
  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 0.05,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: 4,
    biasWeightCoordinationFactor: coordinationFactor,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  for (let i = 0; i < 20; i++) {
    creature.activateAndTrace(INPUT, false, sparseConfig);
    creature.propagate(TARGET, config, sparseConfig);
  }
  creature.applyLearnings(config, sparseConfig);
  return creature.exportJSON();
}

function allWeightsFinite(exported: CreatureExport): boolean {
  return exported.synapses.every((s) => Number.isFinite(s.weight)) &&
    exported.neurons.every((n) =>
      n.bias === undefined || Number.isFinite(n.bias)
    );
}

for (const factor of [1, 0.2]) {
  const mode = factor >= 1 ? "coordination disabled" : "coordination enabled";

  Deno.test(`propagateUpdate pooling (${mode}): produces finite weights`, () => {
    const json = buildMixedFanInCreature();
    const exported = trainAndExport(json, factor);
    assert(
      allWeightsFinite(exported),
      "All weights and biases must remain finite after training",
    );
  });

  Deno.test(`propagateUpdate pooling (${mode}): training changes weights`, () => {
    const json = buildMixedFanInCreature();
    const before = json.synapses.map((s) => s.weight);
    const exported = trainAndExport(json, factor);
    const changed = exported.synapses.some((s, i) =>
      Math.abs((s.weight ?? 0) - (before[i] ?? 0)) > 1e-9
    );
    assert(changed, "Training must update at least one weight");
  });

  Deno.test(`propagateUpdate pooling (${mode}): deterministic through shared pool`, () => {
    // Two back-to-back creatures with the same varied fan-in must produce
    // bit-identical training output. Any stale value carried across neurons
    // through the shared state.backpropBuffers pool would break equality.
    const runA = trainAndExport(buildMixedFanInCreature(), factor);
    const runB = trainAndExport(buildMixedFanInCreature(), factor);

    assertEquals(runA.synapses.length, runB.synapses.length);
    for (let i = 0; i < runA.synapses.length; i++) {
      assertEquals(
        runA.synapses[i].weight,
        runB.synapses[i].weight,
        `synapse ${i} weight must be deterministic`,
      );
    }
    for (let i = 0; i < runA.neurons.length; i++) {
      assertEquals(
        runA.neurons[i].bias,
        runB.neurons[i].bias,
        `neuron ${i} bias must be deterministic`,
      );
    }
  });
}
