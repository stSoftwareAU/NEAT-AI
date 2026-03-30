import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "@architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

Deno.test(
  "applyCoordinatedStructuralCandidate: remove+add preserves synapse type/tags when adjusting weight",
  () => {
    const base: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      neurons: [
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "output-0",
          weight: 0.01,
          type: "condition",
          tags: [{ name: "original", value: "yes" }],
        },
      ],
    };
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.001,
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
          weight: 0.02,
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);
    const exported = mutated.exportJSON();
    normaliseCreatureExport(exported);
    const synapse = exported.synapses.find((s) =>
      s.fromId === 0 && s.toId === -1
    );
    assertExists(synapse);
    assertEquals(synapse.weight, 0.02);
    assertEquals(synapse.type, "condition");
    assertEquals(synapse.tags, [{ name: "original", value: "yes" }]);
  },
);
