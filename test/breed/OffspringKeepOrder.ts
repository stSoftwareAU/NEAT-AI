import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";

function makeMum() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "common-a", squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", uuid: "mum-a", squash: "IDENTITY", bias: -0.9 },

      { type: "hidden", uuid: "common-b", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "mum-b", squash: "IDENTITY", bias: -0.8 },

      { type: "hidden", uuid: "common-c", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "mum-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "common-d", squash: "IDENTITY", bias: 0.1 },
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
      { fromUUID: "input-0", toUUID: "common-b", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "common-a", weight: -0.3 },
      { fromUUID: "common-a", toUUID: "mum-a", weight: 0.3 },
      { fromUUID: "mum-a", toUUID: "common-b", weight: 0.3 },

      { fromUUID: "common-b", toUUID: "mum-b", weight: 0.6 },
      { fromUUID: "mum-b", toUUID: "common-c", weight: 0.31 },
      { fromUUID: "common-c", toUUID: "mum-c", weight: 0.33 },
      { fromUUID: "mum-c", toUUID: "common-d", weight: 0.33 },
      { fromUUID: "common-c", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "common-d", toUUID: "output-0", weight: 0.32 },
      { fromUUID: "common-a", toUUID: "output-1", weight: 0.34 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeDad() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "common-a", squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", uuid: "dad-a", squash: "IDENTITY", bias: -0.9 },

      { type: "hidden", uuid: "common-b", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "dad-b", squash: "IDENTITY", bias: -0.8 },
      { type: "hidden", uuid: "dad-b2", squash: "IDENTITY", bias: -0.8 },

      { type: "hidden", uuid: "dad-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "common-d", squash: "IDENTITY", bias: 0.1 },
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
      { fromUUID: "input-0", toUUID: "common-b", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "common-a", weight: -0.3 },
      { fromUUID: "common-a", toUUID: "dad-a", weight: 0.3 },
      { fromUUID: "dad-a", toUUID: "common-b", weight: 0.3 },

      { fromUUID: "common-b", toUUID: "dad-b", weight: 0.6 },
      { fromUUID: "dad-b", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "common-a", toUUID: "dad-b2", weight: 0.33 },
      { fromUUID: "dad-b2", toUUID: "dad-c", weight: 0.33 },
      { fromUUID: "dad-c", toUUID: "common-d", weight: 0.33 },
      { fromUUID: "dad-b", toUUID: "output-1", weight: 0.32 },
      { fromUUID: "common-d", toUUID: "output-0", weight: 0.33 },
      { fromUUID: "common-a", toUUID: "output-1", weight: 0.32 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("Offspring.breed preserves valid neuron ordering", () => {
  const mum = makeMum();
  const dad = makeDad();

  let successCount = 0;
  for (let i = 0; i < 10; i++) {
    const child = Offspring.breed(mum, dad);
    if (!child) continue;

    child.validate();
    successCount++;

    // input → constants (optional) → hiddens → outputs (matches creatureValidate)
    let lastType: "input" | "constant" | "hidden" | "output" = "input";
    for (const neuron of child.neurons) {
      if (neuron.type === "input") {
        assertEquals(lastType, "input", "Input neurons must come first");
      } else if (neuron.type === "constant") {
        assert(
          lastType === "input" || lastType === "constant",
          "Constants must follow inputs and precede hiddens",
        );
        lastType = "constant";
      } else if (neuron.type === "hidden") {
        assert(
          lastType === "input" || lastType === "constant" ||
            lastType === "hidden",
          "Hidden neurons must come after inputs and constants",
        );
        lastType = "hidden";
      } else if (neuron.type === "output") {
        lastType = "output";
      }
    }

    // Verify offspring has correct dimensions
    assertEquals(child.input, 3, "Input count preserved");
    assertEquals(child.output, 2, "Output count preserved");
  }

  assert(successCount > 0, "Should produce at least one valid offspring");
});
