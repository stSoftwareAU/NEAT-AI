import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test(
  "applyCoordinatedStructuralCandidate: removeNeuron cleans memetic references to avoid MEMETIC validation errors",
  () => {
    const base: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      // Keep this at 3.x so we can detect accidental `fix({ forwardOnly: true })`
      // calls (which bump to 4.0.0).
      semanticVersion: "3.2.1",
      neurons: [
        { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
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
          "hidden-0": 0.1,
        },
      },
    };
    const creature = Creature.fromJSON(base);

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

    assertEquals(exported.neurons.some((n) => n.uuid === "hidden-0"), false);
    assertEquals(exported.memetic, undefined);
    assertEquals(exported.semanticVersion, "3.2.1");
  },
);
