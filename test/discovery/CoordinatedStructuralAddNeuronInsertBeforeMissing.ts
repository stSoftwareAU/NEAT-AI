import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

Deno.test(
  "applyCoordinatedStructuralCandidate: addNeuron with missing insertBefore is a no-op for forward-only creatures",
  () => {
    const base: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      neurons: [
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 0.25 }],
    };
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "addNeuron",
          neuronUuid: "hidden-6000",
          neuronType: "hidden",
          squash: IDENTITY.NAME,
          bias: 0,
          insertBeforeNeuronUuid: "does-not-exist",
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();

    assertEquals(
      exported.neurons.some((n) => n.uuid === "hidden-6000"),
      false,
    );
    assertEquals(exported.neurons.length, base.neurons.length);
    assertEquals(exported.synapses.length, base.synapses.length);
  },
);
