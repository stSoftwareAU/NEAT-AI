import { assertEquals } from "@std/assert";
import type { CoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

// Integer ID for hidden-0 (explicit id in fixture).
const HIDDEN_0_ID = 5000; // "hidden-0"

Deno.test(
  "applyCoordinatedStructuralCandidate: removeNeuron cleans memetic references to avoid MEMETIC validation errors",
  () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      forwardOnly: true,
      // Keep this at 3.x so we can detect accidental `fix({ forwardOnly: true })`
      // calls (which bump to 4.0.0).
      semanticVersion: "3.2.1",
      neurons: [
        {
          uuid: "hidden-0",
          id: 5000,
          type: "hidden",
          squash: IDENTITY.NAME,
          bias: 0.1,
        },
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
        // Preserve a valid topology after removal (output still has an inbound edge).
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.05 },
      ],
      memetic: {
        generation: 1,
        score: 0,
        // Empty weights keeps this test focused on the missing neuron-level cleanup.
        weights: {},
        biases: {
          [HIDDEN_0_ID]: 0.1,
        },
      },
    });

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "removeNeuron",
          neuronUuid: "hidden-0",
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();
    normaliseCreatureExport(exported);

    assertEquals(exported.neurons.some((n) => n.uuid === "hidden-0"), false);
    assertEquals(exported.memetic, undefined);
    assertEquals(exported.semanticVersion, "3.2.1");
  },
);
