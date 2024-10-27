import { assertAlmostEquals } from "@std/assert/almost-equals";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";

Deno.test("chooseNeurons", () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      Deno.readTextFileSync("test/Propagate/large/creature.json"),
    ),
  );

  const config = createBackPropagationConfig({
    sparseRatio: 0.05,
  });
  const result = chooseNeurons(creature.exportJSON(), config);

  const validNeurons = creature.neurons.filter((neuron) =>
    neuron.type === "hidden" || neuron.type === "output"
  );
  const expectedSize = Math.ceil(validNeurons.length * config.sparseRatio);
  assertAlmostEquals(result.size, expectedSize, 1);
});
