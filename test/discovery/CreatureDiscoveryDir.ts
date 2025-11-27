import { assertEquals, assertStrictEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type {
  DiscoveryDirInput,
  DiscoveryDirResult,
} from "../../src/discovery/DiscoveryRunner.ts";

function makeCreature() {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  return creature;
}

class StubRunner {
  #result: DiscoveryDirResult;
  lastInput?: DiscoveryDirInput;

  constructor(result: DiscoveryDirResult) {
    this.#result = result;
  }

  discoverDir(input: DiscoveryDirInput): Promise<DiscoveryDirResult> {
    this.lastInput = input;
    return Promise.resolve(this.#result);
  }
}

Deno.test("Creature.discoveryDir delegates to DiscoveryRunner and returns result", async () => {
  const expectedResult: DiscoveryDirResult = {
    discovery: {
      ID: "DISC-XYZ",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: undefined,
      candidateSquashes: undefined,
    },
    original: {
      error: 0.3,
      score: 0.7,
    },
    improvement: {
      changeType: "add-synapses",
      error: 0.25,
      score: 0.75,
      scoreDelta: 0.05,
      message: "add-synapses for discovery DISC-XYZ improved score by +0.0500.",
      creature: {
        input: 1,
        output: 1,
        neurons: [{
          type: "output",
          uuid: "output-0",
          squash: "IDENTITY",
          bias: 0,
        }],
        synapses: [
          { fromUUID: "input-0", toUUID: "output-0", weight: 0.7 },
        ],
      },
    },
  };

  const stubRunner = new StubRunner(expectedResult);
  const creature = makeCreature();

  const result = await creature.discoveryDir(
    "/tmp/discovery-data",
    {
      discoveryTimeOutMinutes: 1,
      costName: "MSE",
    },
    { runner: stubRunner },
  );

  assertEquals(result, expectedResult);
  assertStrictEquals(stubRunner.lastInput?.creature, creature);
  assertEquals(stubRunner.lastInput?.dataDir, "/tmp/discovery-data");
  assertEquals(stubRunner.lastInput?.options.discoveryTimeOutMinutes, 1);
});
