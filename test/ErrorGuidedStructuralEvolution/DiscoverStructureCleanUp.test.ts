import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  type CandidateNeuron,
  type CandidateSynapse,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

function makeMinimalCreature(): Creature {
  const exportJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.75 },
    ],
  };

  const creature = Creature.fromJSON(exportJSON);
  CreatureUtil.makeUUID(creature);
  creature.validate();
  return creature;
}

Deno.test("cleanUp clears neuron discovery references", async () => {
  const creature = makeMinimalCreature();
  const discovery = new DiscoverStructure(creature, 5);

  const internals = discovery as unknown as {
    initialized: boolean;
    discoveries: CandidateSynapse[];
    neuronDiscoveries: CandidateNeuron[];
  };

  internals.initialized = true;
  internals.discoveries = [{
    fromNeuronUUID: "hidden-0",
    toNeuronUUID: "output-0",
    weight: 0.5,
    expectedImprovementPercentage: 1,
    improvedCount: 1,
    totalCount: 1,
  }];
  internals.neuronDiscoveries = [{
    fromNeuronUUID: "hidden-0",
    toNeuronUUID: "output-0",
    incomingWeight: 0.5,
    outgoingWeight: 0.75,
    squash: IDENTITY.NAME,
    bias: 0,
    expectedImprovementPercentage: 1,
    improvedCount: 1,
    totalCount: 1,
  }];

  await discovery.cleanUp();

  const post = discovery as unknown as {
    discoveries: CandidateSynapse[] | null;
    neuronDiscoveries: CandidateNeuron[] | null;
  };

  assertEquals(post.discoveries, null);
  assertEquals(post.neuronDiscoveries, null);
});
