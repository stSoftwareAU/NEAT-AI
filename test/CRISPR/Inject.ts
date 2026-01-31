import { fail } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  type CrisprInterface,
  type NeatOptions,
} from "../../mod.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";

Deno.test("CRISPR inject", async () => {
  for (let attempt = 0; true; attempt++) {
    // deno-lint-ignore no-await-in-loop
    const successful = await doAttempt();
    if (successful) {
      break;
    }

    if (attempt > 100) {
      fail("Too many attempts");
    }
  }
});

async function doAttempt() {
  const base: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 2 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
        type: "output",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { weight: 0.3, fromUUID: "input-1", toUUID: "hidden-3" },

      { toUUID: "hidden-4", weight: -0.5, fromUUID: "hidden-3" },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const baseCreature = Creature.fromJSON(base);
  baseCreature.validate();

  const enhanced: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 2 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },
      { type: "hidden", uuid: "dna-a", squash: "ABSOLUTE", bias: 3.142 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
        type: "output",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { weight: 0.3, fromUUID: "input-1", toUUID: "hidden-3" },

      { toUUID: "hidden-4", weight: -0.5, fromUUID: "hidden-3" },
      { fromUUID: "dna-a", toUUID: "output-0", weight: 1 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
      { fromUUID: "input-2", toUUID: "dna-a", weight: 1 },
    ],
    input: 3,
    output: 2,
  };

  const dnaUsed: CrisprInterface = {
    id: "DNA-USED",
    mode: "insert",
    neurons: [
      { type: "hidden", uuid: "dna-a", squash: "ABSOLUTE", bias: 3.142 },
    ],
    synapses: [
      { fromUUID: "input-2", toUUID: "dna-a", weight: 1 },
      { fromUUID: "dna-a", toUUID: "output-0", weight: 1 },
    ],
  };
  const dnaUnused: CrisprInterface = {
    id: "DNA-UNUSED",
    mode: "insert",
    synapses: [
      { fromUUID: "input-1", toUUID: "output-0", weight: -10000 },
    ],
  };

  const enhancedCreature = Creature.fromJSON(enhanced);
  enhancedCreature.validate();
  const inputs: Float32Array[] = [];
  for (let i = 0; i < 100; i++) {
    inputs.push(
      new Float32Array([
        Math.random() * 3 - 1.5,
        Math.random() * 3 - 1.5,
        Math.random() * 3 - 1.5,
      ]),
    );
  }

  const ds: DataRecordInterface[] = [];

  inputs.forEach((input) => {
    const inputF32 = new Float32Array(input);
    ds.push({
      input: inputF32,
      output: new Float32Array(enhancedCreature.activate(inputF32, false)),
    });
  });
  const options: NeatOptions = {
    CRISPRs: [dnaUsed, dnaUnused],
    iterations: 10,
  };
  const evolvedCreature = Creature.fromJSON(baseCreature.exportJSON());
  await evolvedCreature.evolveDataSet(ds, options);

  const evolvedExport = evolvedCreature.exportJSON();
  console.info("evolvedExport", JSON.stringify(evolvedExport, null, 2));

  const shouldBeUsed = findDNA(evolvedExport, dnaUsed.id);

  if (!shouldBeUsed) {
    console.info("DNA should already be used");
    return false;
  }

  const shouldBeUnused = findDNA(evolvedExport, dnaUnused.id);

  if (shouldBeUnused) {
    console.info("DNA should NOT be used");
    return false;
  }
  return true;
}

function findDNA(creature: CreatureExport, dnaId: string) {
  let found = false;

  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    const id = getTag(neuron, "CRISPR");
    if (id === dnaId) {
      found = true;
      break;
    }
  }

  if (!found) {
    for (let i = 0; i < creature.synapses.length; i++) {
      const synapse = creature.synapses[i];
      const id = getTag(synapse, "CRISPR");
      if (id === dnaId) {
        found = true;
        break;
      }
    }
  }
  return found;
}
