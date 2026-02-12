import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";
import type { NeuronStateInterface } from "../../../src/architecture/CreatureState.ts";

Deno.test("chooseNeurons: error-guided selection prefers high-error neurons", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });

  const creatureJSON = creature.exportJSON();

  // Build neuron error data: assign high error to a few specific neurons
  const neuronErrors = new Map<string, NeuronStateInterface>();
  const hiddenNeurons = creatureJSON.neurons.filter(
    (n) => n.type === "hidden" || n.type === "output",
  );

  // Give a few neurons very high error
  const highErrorUUIDs = new Set<string>();
  for (let i = 0; i < Math.min(3, hiddenNeurons.length); i++) {
    const uuid = hiddenNeurons[i].uuid;
    highErrorUUIDs.add(uuid);
    neuronErrors.set(uuid, {
      count: 100,
      totalBias: 0,
      totalAdjustedBias: 0,
      hintValue: 0,
      maximumActivation: 1,
      minimumActivation: -1,
      totalErrorAbsolute: 1000, // Very high error
    });
  }

  // Give remaining neurons very low error
  for (let i = 3; i < hiddenNeurons.length; i++) {
    const uuid = hiddenNeurons[i].uuid;
    neuronErrors.set(uuid, {
      count: 100,
      totalBias: 0,
      totalAdjustedBias: 0,
      hintValue: 0,
      maximumActivation: 1,
      minimumActivation: -1,
      totalErrorAbsolute: 0.001, // Very low error
    });
  }

  const result = chooseNeurons(creatureJSON, config, neuronErrors);

  // High-error neurons should be preferentially selected
  let highErrorSelected = 0;
  for (const uuid of highErrorUUIDs) {
    if (result.has(uuid)) {
      highErrorSelected++;
    }
  }

  // With error-guided selection, high-error neurons should be much more likely to be selected
  assert(
    highErrorSelected > 0,
    `At least one high-error neuron should be selected, but got ${highErrorSelected}`,
  );
});

Deno.test("chooseNeurons: works without neuron errors (backward compatible)", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });

  // Call without neuronErrors parameter — should still work
  const result = chooseNeurons(creature.exportJSON(), config);

  const validNeurons = creature.neurons.filter((neuron) =>
    neuron.type === "hidden" || neuron.type === "output"
  );
  const expectedSize = Math.ceil(validNeurons.length * config.sparseRatio);

  // Should select approximately the expected number
  assert(
    Math.abs(result.size - expectedSize) <= 1,
    `Expected ~${expectedSize} neurons, got ${result.size}`,
  );
});

Deno.test("chooseNeurons: sparseRatio 1 returns all neurons regardless of errors", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 1,
  });

  // Even with neuron errors, sparseRatio=1 should select all
  const neuronErrors = new Map<string, NeuronStateInterface>();
  const result = chooseNeurons(creature.exportJSON(), config, neuronErrors);

  const validNeurons = creature.neurons.filter((neuron) =>
    neuron.type === "hidden" || neuron.type === "output"
  );

  assertEquals(
    result.size,
    validNeurons.length,
    "sparseRatio=1 should select all neurons",
  );
});
