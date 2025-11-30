import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const IF_SELF_CONNECTION_FIXTURE: CreatureInternal = {
  semanticVersion: "0.0.1",
  input: 3,
  output: 1,
  neurons: [
    {
      type: "input",
      squash: "LOGISTIC",
      index: 0,
    },
    {
      type: "input",
      squash: "LOGISTIC",
      index: 1,
    },
    {
      type: "input",
      squash: "LOGISTIC",
      index: 2,
    },
    {
      type: "hidden",
      squash: "IF",
      bias: 0.0,
      index: 3,
    },
    {
      type: "output",
      squash: "TANH",
      bias: 0.0,
      index: 4,
    },
  ],
  synapses: [
    {
      weight: 0.5,
      from: 0,
      to: 3,
      type: "condition",
    },
    {
      weight: -0.4,
      from: 1,
      to: 3,
      type: "negative",
    },
    {
      weight: 0.3,
      from: 2,
      to: 3,
      type: "positive",
    },
    {
      weight: -0.1,
      from: 0,
      to: 4,
    },
    {
      weight: 0.2,
      from: 3,
      to: 3,
    },
  ],
};

Deno.test("IF hidden neuron keeps an outward connection after fix", () => {
  const creature = Creature.fromJSON(IF_SELF_CONNECTION_FIXTURE);

  const hiddenIndex = 3;
  const outwardBefore = creature.outwardConnections(hiddenIndex);
  assert(
    outwardBefore.length === 1 &&
      outwardBefore[0].to === hiddenIndex,
    "Precondition failed: expected only a self connection before fix()",
  );

  creature.fix();

  const outwardAfter = creature.outwardConnections(hiddenIndex);

  assert(
    outwardAfter.length > 0,
    "Hidden neuron should have an outward connection after fix()",
  );
  assert(
    outwardAfter.some((conn) => conn.to !== hiddenIndex),
    "Hidden neuron should connect outward to another neuron after fix()",
  );

  creatureValidate(creature);
});
