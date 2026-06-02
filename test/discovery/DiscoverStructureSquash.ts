import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type {
  CandidateSquash,
  DiscoverRecord,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { findCandidateSquash } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { calculateNeuronImpact } from "@architecture/ErrorGuidedStructuralEvolution/NeuronImpact.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { STEP } from "@methods/activations/types/STEP.ts";
import { ActivationRange } from "@propagate/ActivationRange.ts";

// Integer IDs computed from deterministic UUID hash.
const ID_HIDDEN_STEP = 891010353; // "hidden-step"
const ID_HIDDEN_CHAIN = 1836654946; // "hidden-chain"

// Issue #2849: These tests previously reached the private
// `DiscoverStructure.findCandidateSquash` method through an `as unknown as`
// cast, coupling them to the class's internal factoring. The squash-selection
// logic is exposed as a documented public function in DiscoverSquashAnalysis.ts,
// so we drive it directly. The observable WHAT — which squash candidate gets
// suggested and its error/impact scaling — is unchanged.

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

/**
 * Builds an impact function with the same estimator/index-map caching the
 * DiscoverStructure facade uses, so `findCandidateSquash` sees identical
 * behaviour to the production call site.
 */
function makeImpactFn(
  creature: Creature,
): (neuronId: number, derivativeMap?: Map<number, number>) => number {
  let estimator:
    | ReturnType<typeof calculateNeuronImpact>["estimator"]
    | undefined;
  let indexMap: Map<number, number> | undefined;
  return (neuronId, derivativeMap) => {
    const result = calculateNeuronImpact(
      creature,
      neuronId,
      estimator,
      indexMap,
      derivativeMap,
    );
    estimator = result.estimator;
    indexMap = result.indexMap;
    return result.impact;
  };
}

// Discovery logging is irrelevant to these assertions.
const noopLog = () => {};

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

  try {
    const candidate: CandidateSquash | undefined = findCandidateSquash(
      creature,
      ID_HIDDEN_STEP,
      records,
      makeImpactFn(creature),
      false,
      noopLog,
    );
    assert(candidate, "Expected a squash candidate to be suggested.");
    assertAlmostEquals(candidate.currentError, 1, 1e-6);
  } finally {
    activations.list = originalList;
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

  try {
    const candidate: CandidateSquash | undefined = findCandidateSquash(
      creature,
      ID_HIDDEN_CHAIN,
      records,
      makeImpactFn(creature),
      false,
      noopLog,
    );
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
  }
});
