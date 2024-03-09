import { fail } from "https://deno.land/std@0.219.1/assert/mod.ts";
import { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { ensureDirSync } from "https://deno.land/std@0.219.1/fs/mod.ts";

function makeMum() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "A", squash: "CLIPPED", bias: 2.5 },
      { type: "hidden", uuid: "B", squash: "INVERSE", bias: -0.1 },
      { type: "hidden", uuid: "C", squash: "IF", bias: 0 },
      { type: "hidden", uuid: "hidden-4", squash: "IDENTITY", bias: 0 },
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
      { fromUUID: "input-0", toUUID: "A", weight: -0.3 },
      {
        fromUUID: "input-0",
        toUUID: "B",
        weight: -0.3,
      },
      { fromUUID: "B", toUUID: "output-1", weight: 0.3 },
      {
        fromUUID: "A",
        toUUID: "B",
        weight: 0.3,
      },

      { fromUUID: "C", toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "input-0",
        toUUID: "C",
        weight: 0.31,
        type: "condition",
      },
      {
        fromUUID: "B",
        toUUID: "C",
        weight: 0.33,
        type: "negative",
      },
      {
        fromUUID: "input-2",
        toUUID: "C",
        weight: 0.32,
        type: "positive",
      },
      { fromUUID: "input-1", toUUID: "hidden-4", weight: 0.7 },
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

function makeDad() {
  const json: CreatureExport = {
    neurons: [
      { type: "constant", uuid: "first-one", bias: 1 },
      { type: "constant", uuid: "second-one", bias: 1 },
      { type: "constant", uuid: "third-one", bias: 1 },

      { type: "hidden", uuid: "A", squash: "CLIPPED", bias: 2.5 },
      { type: "hidden", uuid: "B", squash: "INVERSE", bias: -0.1 },
      { type: "hidden", uuid: "C", squash: "IF", bias: 0 },
      { type: "hidden", uuid: "hidden-4", squash: "IDENTITY", bias: 0 },
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
      { fromUUID: "input-0", toUUID: "A", weight: -0.3 },
      {
        fromUUID: "input-0",
        toUUID: "B",
        weight: -0.3,
      },
      { fromUUID: "B", toUUID: "output-1", weight: 0.3 },
      {
        fromUUID: "A",
        toUUID: "B",
        weight: 0.3,
      },

      { fromUUID: "C", toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "input-0",
        toUUID: "C",
        weight: 0.31,
        type: "condition",
      },
      {
        fromUUID: "B",
        toUUID: "C",
        weight: 0.33,
        type: "negative",
      },
      {
        fromUUID: "input-2",
        toUUID: "C",
        weight: 0.32,
        type: "positive",
      },
      { fromUUID: "input-1", toUUID: "hidden-4", weight: 0.7 },
      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
      { fromUUID: "first-one", toUUID: "output-1", weight: -0.1 },
      { fromUUID: "second-one", toUUID: "output-1", weight: -0.11 },
      { fromUUID: "third-one", toUUID: "output-1", weight: -0.12 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

const testDir = ".test/KeepSynapses";

Deno.test("KeepSynapses", () => {
  ensureDirSync(testDir);
  const mum = makeMum();
  Deno.writeTextFileSync(
    `${testDir}/mum.json`,
    JSON.stringify(mum.exportJSON(), null, 2),
  );
  const dad = makeDad();
  Deno.writeTextFileSync(
    `${testDir}/dad.json`,
    JSON.stringify(dad.exportJSON(), null, 2),
  );
  for (let i = 0; i < 10; i++) {
    const child = Offspring.bread(mum, dad);
    if (child) check(child);
  }

  for (let i = 0; i < 10; i++) {
    const child = Offspring.bread(dad, mum);
    if (child) check(child);
  }
});

function check(child: Creature) {
  child.validate();

  const a = child.neurons.find((n) => {
    return n.uuid == "A";
  });
  const b = child.neurons.find((n) => {
    return n.uuid == "B";
  });
  const c = child.neurons.find((n) => {
    return n.uuid == "C";
  });

  const a2b = child.getSynapse(a?.index ?? 0, b?.index ?? 0);
  if (!a2b) {
    Deno.writeTextFileSync(
      `${testDir}/child.json`,
      JSON.stringify(child.exportJSON(), null, 2),
    );
    fail("A no longer points to B");
  }
  const b2c = child.getSynapse(b?.index ?? 0, c?.index ?? 0);
  if (!b2c) {
    Deno.writeTextFileSync(
      `${testDir}/child.json`,
      JSON.stringify(child.exportJSON(), null, 2),
    );
    fail("B no longer points to C");
  }
}
