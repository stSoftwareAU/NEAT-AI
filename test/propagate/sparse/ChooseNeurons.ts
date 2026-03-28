import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";

Deno.test("chooseNeurons selects approximately sparseRatio fraction of eligible neurons", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });
  const result = chooseNeurons(creature.exportInternalJSON(), config);

  const validNeurons = creature.neurons.filter((neuron) =>
    neuron.type === "hidden" || neuron.type === "output"
  );
  const expectedSize = Math.ceil(validNeurons.length * config.sparseRatio);
  assertAlmostEquals(result.size, expectedSize, 1);
});
