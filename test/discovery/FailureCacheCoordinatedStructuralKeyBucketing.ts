import { assert } from "@std/assert";
import { assertEquals } from "@std/assert/equals";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { buildCacheKey } from "../../src/discovery/FailureCache.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

function makeCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.01 }],
  };
  return Creature.fromJSON(base);
}

Deno.test(
  "buildCacheKey: coordinated-structural buckets addSynapse weight by exponent (stable under normal training drift)",
  () => {
    const creature = makeCreature();

    const specA: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "removeSynapse",
          fromNeuronUuid: "input-0",
          toNeuronUuid: "output-0",
        },
        {
          type: "addSynapse",
          fromNeuronUuid: "input-0",
          toNeuronUuid: "output-0",
          weight: 0.07451205, // e-2
        },
      ],
    };

    const specA2: CoordinatedStructuralCandidate = {
      ...specA,
      operations: [
        specA.operations[0],
        {
          type: "addSynapse",
          fromNeuronUuid: "input-0",
          toNeuronUuid: "output-0",
          weight: 0.0999, // also e-2
        },
      ],
    };

    const specB: CoordinatedStructuralCandidate = {
      ...specA,
      operations: [
        specA.operations[0],
        {
          type: "addSynapse",
          fromNeuronUuid: "input-0",
          toNeuronUuid: "output-0",
          weight: 0.1001, // e-1
        },
      ],
    };

    const candidateA: DiscoveryCandidate = {
      creature,
      change: {
        type: "coordinated-structural",
        coordinatedStructuralCandidate: specA,
      },
    };
    const candidateA2: DiscoveryCandidate = {
      creature,
      change: {
        type: "coordinated-structural",
        coordinatedStructuralCandidate: specA2,
      },
    };
    const candidateB: DiscoveryCandidate = {
      creature,
      change: {
        type: "coordinated-structural",
        coordinatedStructuralCandidate: specB,
      },
    };

    const keyA = buildCacheKey(candidateA);
    const keyA2 = buildCacheKey(candidateA2);
    const keyB = buildCacheKey(candidateB);

    assert(keyA.includes("coordinated-structural"));
    assertEquals(
      keyA,
      keyA2,
      "Expected coordinated-structural key to ignore exact float differences within same exponent",
    );
    assert(
      keyA !== keyB,
      "Expected coordinated-structural key to differ when weight exponent differs",
    );
  },
);
