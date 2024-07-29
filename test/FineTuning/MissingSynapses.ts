import { assert } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { fineTuneImprovement } from "../../src/architecture/FineTune.ts";
import { addTag } from "https://deno.land/x/tags@v1.0.2/src/TagsInterface.ts";

const baseCreatureJSON: CreatureExport = {
  neurons: [
    {
      uuid: "hidden-0",
      bias: 0.1,
      type: "hidden",
      squash: "TANH",
    },
    {
      uuid: "hidden-1",
      bias: 0.2,
      type: "hidden",
      squash: "LOGISTIC",
    },
    {
      uuid: "output-0",
      bias: 0.4,
      type: "output",
      squash: "IF",
    },
    {
      uuid: "output-1",
      bias: -0.3,
      type: "output",
      squash: "RELU",
    },
  ],
  synapses: [
    {
      weight: -0.05643947781091945,
      fromUUID: "input-0",
      toUUID: "hidden-0",
    },
    {
      weight: -0.05312834974349934,
      fromUUID: "input-0",
      toUUID: "hidden-1",
    },
    {
      weight: 0.0306819508373688,
      fromUUID: "input-1",
      toUUID: "output-0",
      type: "negative",
    },

    {
      weight: -0.03496077324134794,
      fromUUID: "hidden-0",
      toUUID: "output-0",
      type: "condition",
    },
    {
      weight: -0.09636098569100936,
      fromUUID: "hidden-1",
      toUUID: "output-0",
      type: "positive",
    },
    {
      weight: 0.08808051749556417,
      fromUUID: "hidden-1",
      toUUID: "output-1",
    },
  ],
  "input": 2,
  "output": 2,
};

function makeFittest(): Creature {
  const fittest = Creature.fromJSON(baseCreatureJSON);
  addTag(fittest, "score", "-0.2");
  fittest.validate();
  fittest.connect(0, 5, 0.1);
  return fittest;
}

function makePrevious(): Creature {
  const previous = Creature.fromJSON(baseCreatureJSON);
  addTag(previous, "score", "-0.3");
  previous.validate();
  previous.connect(1, 5, -0.1);
  return previous;
}

Deno.test("FineTune-missing synapses", () => {
  const fittest = makeFittest();

  const previous = makePrevious();

  const tunedCreatures = fineTuneImprovement(
    fittest,
    previous,
    3,
  );

  assert(
    tunedCreatures.length == 3,
    "We should have detected THREE changes was: " + tunedCreatures.length,
  );
  tunedCreatures.forEach((creature) => {
    check(creature);
  });
});

function check(creature: Creature) {
  console.info(creature.exportJSON());
  creature.validate();

  const fittestSynapse = creature.getSynapse(0, 5);
  assert(fittestSynapse, "Synapse from 0 to 5 should exist");
  const previousSynapse = creature.getSynapse(1, 5);
  assert(previousSynapse, "Synapse from 1 to 5 should exist");
}
