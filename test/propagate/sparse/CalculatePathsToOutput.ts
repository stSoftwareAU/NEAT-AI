import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { calculatePathsToOutput } from "../../../src/propagate/sparse/CalculatePathsToOutput.ts";

Deno.test("calculatePathsToOutput", () => {
  const creature = makeCreature();

  const chosenSet = new Set<string>();
  chosenSet.add("hidden-3");
  chosenSet.add("output-1");

  const paths = calculatePathsToOutput(chosenSet, creature.exportJSON());

  console.log(paths);
  const expectedPaths = new Set<string>();
  expectedPaths.add("hidden-3");
  expectedPaths.add("hidden-4");
  expectedPaths.add("output-1");
  expectedPaths.add("output-0");
  expectedPaths.add("output-3");

  assertEquals(paths, expectedPaths);
});

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        squash: "Cosine",
        uuid: "hidden-0",
        bias: -0.1,
      },
      {
        type: "hidden",
        squash: "ABSOLUTE",
        uuid: "hidden-1",
        bias: 0.2,
      },
      {
        type: "hidden",
        squash: "BENT_IDENTITY",
        uuid: "hidden-2",
        bias: -0.2,
      },
      {
        type: "hidden",
        squash: "BIPOLAR_SIGMOID",
        uuid: "hidden-3",
        bias: 0.3,
      },
      {
        type: "hidden",
        squash: "Exponential",
        uuid: "hidden-3a",
        bias: -0.35,
      },
      {
        type: "hidden",
        squash: "ReLU6",
        uuid: "hidden-4",
        bias: -0.3,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 0.1,
      },
      {
        type: "output",
        squash: "TANH",
        uuid: "output-1",
        bias: 0.1,
      },
      {
        type: "output",
        squash: "Softplus",
        uuid: "output-2",
        bias: -0.2,
      },
      {
        type: "output",
        squash: "Mish",
        uuid: "output-3",
        bias: -0.15,
      },
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
