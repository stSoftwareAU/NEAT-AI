import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  type CandidateSquash,
  type DiscoverRecord,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { ActivationInterface } from "../../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../../src/methods/activations/Activations.ts";
import { STEP } from "../../src/methods/activations/types/STEP.ts";
import { ActivationRange } from "../../src/propagate/ActivationRange.ts";

class LookupActivation implements ActivationInterface {
  public readonly range: ActivationRange;
  public mutationProbability = 1;
  #lookup: Map<number, number>;

  constructor(values: ReadonlyArray<{ input: number; output: number }>) {
    this.#lookup = new Map(values.map((entry) => [entry.input, entry.output]));
    this.range = new ActivationRange("LOOKUP", -1, 1);
  }

  getName(): string {
    return "LOOKUP";
  }

  squash(x: number): number {
    const value = this.#lookup.get(x);
    if (value !== undefined) {
      return value;
    }
    return this.range.limit(x);
  }
}

function makeStepLockedCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-step", squash: STEP.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-step", weight: 1 },
      { fromUUID: "hidden-step", toUUID: "output-0", weight: 1 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("squash estimates are computed in activation domain", () => {
  const creature = makeStepLockedCreature();
  const discover = new DiscoverStructure(creature, 30);

  const activations = Activations as unknown as {
    list: () => ActivationInterface[];
  };
  const originalList = activations.list;
  activations.list = () => [
    new LookupActivation([
      { input: -10, output: 1 },
      { input: -8, output: 1 },
      { input: -6, output: 1 },
    ]),
    new STEP(),
  ];

  const records: DiscoverRecord[] = [
    { activation: 0, value: -10, errors: [20] },
    { activation: 0, value: -8, errors: [16] },
    { activation: 0, value: -6, errors: [12] },
  ];

  const internal = discover as unknown as {
    findCandidateSquash: (
      neuronUUID: string,
      recs: DiscoverRecord[],
    ) => CandidateSquash | undefined;
    tempDir: string;
  };

  try {
    const candidate = internal.findCandidateSquash("hidden-step", records);
    assert(candidate, "Expected a squash candidate to be suggested.");
    assertAlmostEquals(candidate.currentError, 1, 1e-6);
  } finally {
    activations.list = originalList;
    try {
      Deno.removeSync(internal.tempDir, { recursive: true });
    } catch {
      // Ignore if already cleaned.
    }
  }
});

function makeDilutedImpactCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-chain", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "hidden-chain", weight: 1 },
      { fromUUID: "hidden-chain", toUUID: "output-0", weight: 1e-6 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("squash estimates scale by neuron impact to avoid inflated expectations", () => {
  const creature = makeDilutedImpactCreature();
  const discover = new DiscoverStructure(creature, 30);

  const activations = Activations as unknown as {
    list: () => ActivationInterface[];
  };
  const originalList = activations.list;
  // Use large but not astronomically high errors to test scaling
  // Errors of 1000 will produce baseline errors around 1e6 (below 1e10 threshold)
  // but still large enough to test that improvement estimates are scaled down
  const largeError = 1000;

  activations.list = () => [
    new LookupActivation([
      { input: 0, output: largeError },
      { input: 0.1, output: largeError + 0.1 },
    ]),
    new STEP(),
  ];

  const records: DiscoverRecord[] = [
    { activation: 0, value: 0, errors: [largeError] },
    { activation: 0.1, value: 0.1, errors: [largeError] },
  ];

  const internal = discover as unknown as {
    findCandidateSquash: (
      neuronUUID: string,
      recs: DiscoverRecord[],
    ) => CandidateSquash | undefined;
    tempDir: string;
  };

  try {
    const candidate = internal.findCandidateSquash("hidden-chain", records);
    assert(
      candidate,
      "Expected diluted chain neuron to return a squash candidate.",
    );
    assert(
      candidate.expectedCreatureScoreGain < 1e-4,
      "Expected improvement should be scaled down by the neuron's tiny impact.",
    );
  } finally {
    activations.list = originalList;
    try {
      Deno.removeSync(internal.tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors to keep the test resilient on CI.
    }
  }
});
