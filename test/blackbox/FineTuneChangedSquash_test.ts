import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { fineTuneImprovement } from "../../src/blackbox/FineTune.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";

Deno.test("fine tuning: shared weights remain tunable after the target activation changes", () => {
  const previous = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [{
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0.25,
    }],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 1 }],
  });
  previous.score = -0.2;
  const current = Creature.fromJSON(previous.exportJSON());
  current.score = -0.1;
  current.neurons[1].setSquash("LOGISTIC");
  current.synapses[0].weight = 2;
  const originalRng = getRandomNumberGenerator();

  try {
    setRandomNumberGenerator(createSeededRng(4099));
    const candidates = fineTuneImprovement(current, previous, false, 3);

    assert(
      candidates.length > 0,
      "the shared weight still permits fine tuning",
    );
    for (const candidate of candidates) {
      assertEquals(candidate.neurons[1].squash, "LOGISTIC");
      assertEquals(candidate.neurons[1].bias, 0.25);
      assert(candidate.synapses[0].weight !== 2);
      const deltas = Object.values(candidate.memetic?.weights ?? {}).flat();
      assertEquals(deltas.map((delta) => delta.weight), [1]);
    }
  } finally {
    setRandomNumberGenerator(originalRng);
  }
});
