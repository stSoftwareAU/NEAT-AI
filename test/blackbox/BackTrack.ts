import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { fineTuneImprovement } from "../../src/blackbox/FineTune.ts";
import type { CreatureExport } from "../../mod.ts";
import { retry } from "../../src/blackbox/Retry.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 3 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },

      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeFittest() {
  const creature = makeCreature();
  creature.score = -0.1;
  return creature;
}

function makePrevious() {
  const creature = makeCreature();
  creature.neurons[3].bias = 3.1;
  creature.synapses[2].weight = 0.5;
  creature.score = -0.2;

  return creature;
}

Deno.test("backtrack", () => {
  const fittest = makeFittest();
  const previous = makePrevious();

  const population = fineTuneImprovement(
    fittest,
    previous,
  );

  assert(population.length > 0);

  population.forEach((creature, indx) => {
    if (indx % 3 == 0) {
      delete creature.memetic;
    }
    if (indx % 2 == 0) {
      assert(previous.score);
      creature.score = previous.score + Math.random();
    } else {
      assert(previous.score);
      creature.score = previous.score - Math.random();
    }
  });

  const backtrackPopulation = retry(population, "BACKWARDS");

  assertEquals(backtrackPopulation.length, 2);
});
