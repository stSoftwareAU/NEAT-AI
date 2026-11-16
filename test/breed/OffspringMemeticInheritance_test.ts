import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";

Deno.test("offspring: crossover preserves usable maternal memetic history", () => {
  const mother = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "shared-hidden", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-hidden", weight: 1 },
      { fromUUID: "input-1", toUUID: "shared-hidden", weight: 2 },
      { fromUUID: "shared-hidden", toUUID: "output-0", weight: 3 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 4 },
    ],
  });
  const father = Creature.fromJSON(mother.exportJSON());
  for (const synapse of father.synapses) synapse.weight += 0.5;
  father.neurons[2].bias += 0.5;
  father.neurons[3].bias += 0.5;
  mother.memetic = {
    generation: 2,
    score: -0.3,
    biases: { [mother.neurons[2].id]: 0 },
    weights: {
      [mother.neurons[0].id]: [{ toId: mother.neurons[2].id, weight: 0.5 }],
    },
  };
  const originalRng = getRandomNumberGenerator();

  try {
    setRandomNumberGenerator(createSeededRng(4099));
    let child: Creature | undefined;
    for (let attempt = 0; attempt < 20 && !child; attempt++) {
      child = Offspring.breed(mother, father);
    }

    assert(child, "different parental parameters permit a non-clone child");
    child.validate();
    assert(child.memetic, "compatible crossover retains the maternal history");
    assertEquals(child.memetic.score, -0.3);
    assertEquals(child.memetic.generation, 2);
    const exported = child.exportJSON();
    const reloaded = Creature.fromJSON(exported);
    reloaded.validate();
    assertEquals(reloaded.exportJSON().memetic, exported.memetic);
    assertEquals(mother.memetic.biases[mother.neurons[2].id], 0);
  } finally {
    setRandomNumberGenerator(originalRng);
  }
});
