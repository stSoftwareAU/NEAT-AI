import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import {
  buildOutgoingSynapsesMap,
  calculatePathsToOutput,
} from "../../../src/propagate/sparse/CalculatePathsToOutput.ts";

Deno.test("buildOutgoingSynapsesMap groups synapses by fromUUID", () => {
  const creature = makeCreature();
  const json = creature.exportJSON();
  const map = buildOutgoingSynapsesMap(json);

  // hidden-3 has outgoing synapses to hidden-4, output-1
  const hidden3Outgoing = map.get("hidden-3");
  assertEquals(hidden3Outgoing !== undefined, true);
  const hidden3Targets = hidden3Outgoing!.map((s) => s.toUUID).sort();
  assertEquals(hidden3Targets, ["hidden-4", "output-1"].sort());

  // hidden-4 has outgoing synapses to output-0, output-1, output-3
  const hidden4Outgoing = map.get("hidden-4");
  assertEquals(hidden4Outgoing !== undefined, true);
  const hidden4Targets = hidden4Outgoing!.map((s) => s.toUUID).sort();
  assertEquals(hidden4Targets, ["output-0", "output-1", "output-3"].sort());
});

Deno.test("calculatePathsToOutput with cached map matches uncached", () => {
  const creature = makeCreature();
  const json = creature.exportJSON();

  const chosenSet = new Set<string>();
  chosenSet.add("hidden-3");
  chosenSet.add("output-1");

  // Without cached map (builds internally)
  const pathsUncached = calculatePathsToOutput(chosenSet, json);

  // With cached map
  const cachedMap = buildOutgoingSynapsesMap(json);
  const pathsCached = calculatePathsToOutput(chosenSet, json, cachedMap);

  assertEquals(pathsCached, pathsUncached);
});

Deno.test("calculatePathsToOutput with cached map finds correct paths", () => {
  const creature = makeCreature();
  const json = creature.exportJSON();
  const cachedMap = buildOutgoingSynapsesMap(json);

  const chosenSet = new Set<string>();
  chosenSet.add("hidden-3");
  chosenSet.add("output-1");

  const paths = calculatePathsToOutput(chosenSet, json, cachedMap);

  const expectedPaths = new Set<string>();
  expectedPaths.add("hidden-3");
  expectedPaths.add("hidden-4");
  expectedPaths.add("output-1");
  expectedPaths.add("output-0");
  expectedPaths.add("output-3");

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
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", squash: "IDENTITY", uuid: "hidden-0", bias: 0 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };

  const cachedMap = buildOutgoingSynapsesMap(json);
  const selected = new Set(["hidden-0"]);

  const paths = calculatePathsToOutput(selected, json, cachedMap);

  // hidden-0 has no outgoing synapses, so only itself is in the path
  assertEquals(paths, new Set(["hidden-0"]));
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
