import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { CoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import { applyCoordinatedStructuralCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/ApplyCoordinatedStructuralCandidate.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test(
  "applyCoordinatedStructuralCandidate: removeNeuron cleans up orphaned neurons to avoid forward-only fix() bumping semanticVersion (7-Jan-2026)",
  () => {
    const base: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      semanticVersion: "3.9.0",
      neurons: [
        { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0.0 },
        { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0.0 },
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0.0 },
      ],
      synapses: [
        // Keep a valid direct path so that pruning the orphaned branch remains valid.
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.1 },
        // Branch that will become orphaned after removing hidden-b.
        { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.2 },
        { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 0.3 },
        { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.4 },
      ],
    };
    const creature = Creature.fromJSON(base);

    const candidate: CoordinatedStructuralCandidate = {
      type: "coordinated_structural",
      expectedCreatureScoreGain: 0.01,
      operations: [
        {
          type: "removeNeuron",
          neuronUuid: "hidden-b",
        },
      ],
    };

    const mutated = applyCoordinatedStructuralCandidate(creature, candidate);

    // Regression: without orphan cleanup, validate() throws NO_OUTWARD_CONNECTIONS for hidden-a,
    // triggering fix({ forwardOnly: true }) which bumps semanticVersion 3.x.x -> 4.0.0.
    assertEquals(mutated.semanticVersion, "3.9.0");

    const exported = mutated.exportJSON();
    assertEquals(exported.neurons.some((n) => n.uuid === "hidden-b"), false);
    assertEquals(exported.neurons.some((n) => n.uuid === "hidden-a"), false);
    assertEquals(
      exported.synapses.some((s) =>
        s.fromUUID === "input-0" && s.toUUID === "hidden-a"
      ),
      false,
    );
  },
);
