import {
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  analyzeSelectedNeuronsForHarmfulRemoval,
  calculateSquashError,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { TopologyError } from "../../src/errors/TopologyError.ts";

Deno.test("calculateSquashError - returns zero for identical arrays", () => {
  const ideal = [1.0, 2.0, 3.0];
  const actual = [1.0, 2.0, 3.0];
  const error = calculateSquashError(ideal, actual);
  assertEquals(error, 0);
});

Deno.test("calculateSquashError - returns correct MSE for differing arrays", () => {
  const ideal = [1.0, 2.0, 3.0];
  const actual = [1.1, 2.2, 2.8];
  const error = calculateSquashError(ideal, actual);
  // Each element MSE: (0.1^2)/1=0.01, (0.2^2)/1=0.04, (0.2^2)/1=0.04
  // Average: (0.01 + 0.04 + 0.04) / 3 = 0.03
  assertAlmostEquals(error, 0.03, 1e-4);
});

Deno.test("calculateSquashError - handles single element", () => {
  const ideal = [5.0];
  const actual = [3.0];
  const error = calculateSquashError(ideal, actual);
  // MSE of single element: (5-3)^2 / 1 = 4.0
  assertAlmostEquals(error, 4.0, 1e-4);
});

Deno.test("calculateSquashError - throws on undefined activation", () => {
  const ideal = [1.0, 2.0];
  const actual = [1.0]; // shorter array, second element is undefined
  assertThrows(
    () => calculateSquashError(ideal, actual),
    TopologyError,
    "Activation is undefined",
  );
});

Deno.test("calculateSquashError - consistent results across multiple calls", () => {
  const ideal = [0.5, -0.3, 1.2, 0.0];
  const actual = [0.4, -0.1, 1.0, 0.1];
  const error1 = calculateSquashError(ideal, actual);
  const error2 = calculateSquashError(ideal, actual);
  assertEquals(error1, error2);
});

Deno.test("calculateSquashError - handles large arrays", () => {
  const size = 10000;
  const ideal = Array.from({ length: size }, (_, i) => Math.sin(i));
  const actual = Array.from({ length: size }, (_, i) => Math.sin(i) + 0.01);
  const error = calculateSquashError(ideal, actual);
  // Each element: (0.01)^2 = 0.0001, average should be ~0.0001
  assertAlmostEquals(error, 0.0001, 1e-4);
});

Deno.test(
  "analyzeSelectedNeuronsForHarmfulRemoval loads records via wire uuid path",
  async () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-target", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-target", weight: 0.5 },
        { fromUUID: "hidden-target", toUUID: "output-0", weight: 0.5 },
      ],
    });
    const hiddenId = creature.exportJSON().neurons.find((neuron) =>
      neuron.uuid === "hidden-target"
    )?.id;
    assertEquals(typeof hiddenId, "number");

    let loadedPath: string | undefined;
    const result = await analyzeSelectedNeuronsForHarmfulRemoval(
      creature,
      [hiddenId!],
      async (neuronIdentifier: string) => {
        loadedPath = neuronIdentifier;
        return [{
          value: 1,
          activation: 1,
          errors: [1e11],
        }];
      },
      "/tmp/discovery",
      false,
      () => {},
    );

    assertEquals(loadedPath, "/tmp/discovery/hidden-target");
    assertEquals(result?.[0]?.neuronUuid, "hidden-target");
  },
);
