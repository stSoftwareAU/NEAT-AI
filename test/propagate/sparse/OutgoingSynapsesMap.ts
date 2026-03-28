import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import {
  buildOutgoingSynapsesMap,
  calculatePathsToOutput,
} from "../../../src/propagate/sparse/CalculatePathsToOutput.ts";

Deno.test("buildOutgoingSynapsesMap groups synapses by fromId", () => {
  const creature = makeCreature();
  const json = creature.exportInternalJSON();
  const map = buildOutgoingSynapsesMap(json);

  // Find actual neuron IDs from loaded creature
  const hidden3 = creature.neurons.find((n) =>
    n.type === "hidden" && n.squash === "BIPOLAR_SIGMOID"
  )!;
  const hidden4 = creature.neurons.find((n) =>
    n.type === "hidden" && n.squash === "ReLU6"
  )!;
  const output0 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "IDENTITY"
  )!;
  const output1 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "TANH"
  )!;
  const output3 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "Mish"
  )!;

  // hidden-3 has outgoing synapses to hidden-4, output-1
  const hidden3Outgoing = map.get(hidden3.id);
  assertEquals(hidden3Outgoing !== undefined, true);
  const hidden3Targets = hidden3Outgoing!.map((s) => s.toId!).sort();
  assertEquals(hidden3Targets, [hidden4.id, output1.id].sort());

  // hidden-4 has outgoing synapses to output-0, output-1, output-3
  const hidden4Outgoing = map.get(hidden4.id);
  assertEquals(hidden4Outgoing !== undefined, true);
  const hidden4Targets = hidden4Outgoing!.map((s) => s.toId!).sort();
  assertEquals(hidden4Targets, [output0.id, output1.id, output3.id].sort());
});

Deno.test("calculatePathsToOutput with cached map matches uncached", () => {
  const creature = makeCreature();
  const json = creature.exportInternalJSON();

  // Find actual neuron IDs from loaded creature
  const hidden3 = creature.neurons.find((n) =>
    n.type === "hidden" && n.squash === "BIPOLAR_SIGMOID"
  )!;
  const output1 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "TANH"
  )!;

  const chosenSet = new Set<number>([hidden3.id, output1.id]);

  // Without cached map (builds internally)
  const pathsUncached = calculatePathsToOutput(chosenSet, json);

  // With cached map
  const cachedMap = buildOutgoingSynapsesMap(json);
  const pathsCached = calculatePathsToOutput(chosenSet, json, cachedMap);

  assertEquals(pathsCached, pathsUncached);
});

Deno.test("calculatePathsToOutput with cached map finds correct paths", () => {
  const creature = makeCreature();
  const json = creature.exportInternalJSON();
  const cachedMap = buildOutgoingSynapsesMap(json);

  const hidden3 = creature.neurons.find((n) =>
    n.type === "hidden" && n.squash === "BIPOLAR_SIGMOID"
  )!;
  const hidden4 = creature.neurons.find((n) =>
    n.type === "hidden" && n.squash === "ReLU6"
  )!;
  const output0 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "IDENTITY"
  )!;
  const output1 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "TANH"
  )!;
  const output3 = creature.neurons.find((n) =>
    n.type === "output" && n.squash === "Mish"
  )!;

  const chosenSet = new Set<number>([hidden3.id, output1.id]);
  const paths = calculatePathsToOutput(chosenSet, json, cachedMap);

  const expectedPaths = new Set<number>([
    hidden3.id,
    hidden4.id,
    output1.id,
    output0.id,
    output3.id,
  ]);

  assertEquals(paths, expectedPaths);
});

Deno.test("buildOutgoingSynapsesMap handles creature with no synapses", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [],
    input: 1,
    output: 1,
  };

  const map = buildOutgoingSynapsesMap(json);
  assertEquals(map.size, 0);
});

Deno.test("calculatePathsToOutput with cached map handles isolated neurons", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "IDENTITY", uuid: "hidden-0", bias: 0 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  });
  const json = creature.exportInternalJSON();
  const hiddenNeuron = creature.neurons.find((n) => n.type === "hidden")!;

  const cachedMap = buildOutgoingSynapsesMap(json);
  const selected = new Set([hiddenNeuron.id]);

  const paths = calculatePathsToOutput(selected, json, cachedMap);

  // hidden-0 has no outgoing synapses, so only itself is in the path
  assertEquals(paths, new Set([hiddenNeuron.id]));
});

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", squash: "Cosine", uuid: "hidden-0", bias: -0.1 },
      { type: "hidden", squash: "ABSOLUTE", uuid: "hidden-1", bias: 0.2 },
      { type: "hidden", squash: "BENT_IDENTITY", uuid: "hidden-2", bias: -0.2 },
      {
        type: "hidden",
        squash: "BIPOLAR_SIGMOID",
        uuid: "hidden-3",
        bias: 0.3,
      },
      { type: "hidden", squash: "Exponential", uuid: "hidden-3a", bias: -0.35 },
      { type: "hidden", squash: "ReLU6", uuid: "hidden-4", bias: -0.3 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0.1 },
      { type: "output", squash: "TANH", uuid: "output-1", bias: 0.1 },
      { type: "output", squash: "Softplus", uuid: "output-2", bias: -0.2 },
      { type: "output", squash: "Mish", uuid: "output-3", bias: -0.15 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "input-2", toUUID: "hidden-3a", weight: 0.45 },
      { fromUUID: "hidden-3a", toUUID: "hidden-4", weight: 0.45 },
      { fromUUID: "input-2", toUUID: "hidden-3", weight: -0.4 },
      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: 0.4 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: -0.5 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "hidden-4", toUUID: "output-1", weight: -0.6 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "hidden-0", toUUID: "hidden-3", weight: 0.14 },
      { fromUUID: "hidden-1", toUUID: "hidden-3", weight: -0.11 },
      { fromUUID: "hidden-2", toUUID: "hidden-3", weight: 0.12 },
      { fromUUID: "hidden-3", toUUID: "output-1", weight: -0.16 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: 0.13 },
      { fromUUID: "input-0", toUUID: "output-1", weight: -0.18 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 0.12 },
      { fromUUID: "input-2", toUUID: "output-1", weight: -0.15 },
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.21 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.22 },
      { fromUUID: "hidden-0", toUUID: "hidden-2", weight: -0.3 },
      { fromUUID: "input-0", toUUID: "hidden-2", weight: -0.2 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "output-2", weight: 0.25 },
      { fromUUID: "hidden-4", toUUID: "output-3", weight: -0.25 },
    ],
    input: 3,
    output: 4,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}
