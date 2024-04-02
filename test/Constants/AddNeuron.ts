import { ensureDirSync } from "https://deno.land/std@0.221.0/fs/ensure_dir.ts";
import { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { assertEquals } from "https://deno.land/std@0.221.0/assert/mod.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "constant", uuid: "skip-me", bias: 1 },
      { type: "constant", uuid: "skip-me2", bias: 1 },
      { type: "hidden", uuid: "hidden-0", squash: "CLIPPED", bias: 2.5 },

      { type: "constant", uuid: "third-one", bias: 1 },
      { type: "hidden", uuid: "hidden-1", squash: "CLIPPED", bias: -0.1 },
      { type: "constant", uuid: "second-one", bias: 1 },
      { type: "hidden", uuid: "hidden-2", squash: "CLIPPED", bias: -0.2 },
      { type: "constant", uuid: "first-one", bias: 1 },

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
      { fromUUID: "skip-me", toUUID: "output-0", weight: -0.5 },
      { fromUUID: "skip-me2", toUUID: "output-0", weight: -0.4 },
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "input-0", toUUID: "hidden-1", weight: -0.2 },
      { fromUUID: "input-0", toUUID: "hidden-2", weight: -0.1 },

      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.6 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "first-one", toUUID: "output-1", weight: 0.8 },
      { fromUUID: "second-one", toUUID: "output-0", weight: 0.9 },
      { fromUUID: "hidden-0", toUUID: "output-1", weight: 0.1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "third-one", toUUID: "output-0", weight: 1.1 },

      { fromUUID: "hidden-1", toUUID: "output-1", weight: 0.1 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.2 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("AddNeuron", () => {
  const creature = makeCreature();

  const traceDir = ".test/AddNeuron";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < 100; i++) {
    const tmpCreature = Creature.fromJSON(creature.exportJSON());
    tmpCreature.addNeuron();
    tmpCreature.validate();
    assertEquals("skip-me", tmpCreature.neurons[3].uuid);
    assertEquals("skip-me2", tmpCreature.neurons[4].uuid);

    if (tmpCreature.neurons.length <= creature.neurons.length) {
      throw new Error("Neuron not added");
    }
  }
});
