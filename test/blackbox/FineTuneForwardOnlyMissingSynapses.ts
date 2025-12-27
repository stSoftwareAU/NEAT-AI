import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { fineTuneImprovement } from "../../src/blackbox/FineTune.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

Deno.test(
  "fineTuneImprovement (forward-only) must not introduce backward synapses when copying missing synapses between different neuron orderings",
  () => {
    // Two valid forward-only creatures can share the same neuron UUIDs but have
    // different internal ordering. Copying a synapse by UUID across those
    // orderings can create a backward/recurrent connection in the target.
    //
    // This test builds two minimal forward-only exports with reversed hidden
    // neuron ordering. Each creature is valid on its own. Fine-tune attempts to
    // union missing synapses; in forward-only mode it must skip any synapse that
    // would become backward in the target ordering.

    const base: Pick<
      CreatureExport,
      "semanticVersion" | "forwardOnly" | "input" | "output" | "tags"
    > = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      tags: [],
    };

    // Ordering A: input-0, h1, h2, output-0
    const exportA: CreatureExport = {
      ...base,
      neurons: [
        { uuid: "h1", type: "hidden", squash: "LOGISTIC", bias: 0 },
        { uuid: "h2", type: "hidden", squash: "LOGISTIC", bias: 0 },
        { uuid: "output-0", type: "output", squash: "LOGISTIC", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 1 },
        { fromUUID: "h1", toUUID: "h2", weight: 1 },
        { fromUUID: "h2", toUUID: "output-0", weight: 1 },
      ],
    };

    // Ordering B: input-0, h2, h1, output-0
    // Synapse h2 -> h1 is forward in this ordering.
    const exportB: CreatureExport = {
      ...base,
      neurons: [
        { uuid: "h2", type: "hidden", squash: "LOGISTIC", bias: 0 },
        { uuid: "h1", type: "hidden", squash: "LOGISTIC", bias: 0 },
        { uuid: "output-0", type: "output", squash: "LOGISTIC", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h2", weight: 1 },
        { fromUUID: "h2", toUUID: "h1", weight: 1 },
        { fromUUID: "h1", toUUID: "output-0", weight: 1 },
      ],
    };

    const fittest = Creature.fromJSON(exportA);
    const previous = Creature.fromJSON(exportB);

    fittest.forwardOnly = true;
    previous.forwardOnly = true;
    fittest.semanticVersion = "4.0.0";
    previous.semanticVersion = "4.0.0";

    // Ensure both are valid forward-only before fine-tuning.
    fittest.validate({ forwardOnly: true });
    previous.validate({ forwardOnly: true });

    // Ensure fineTuneImprovement actually runs (it requires scores to differ).
    fittest.score = 10;
    previous.score = 9;

    const tunedPopulation = fineTuneImprovement(
      fittest,
      previous,
      false, // feedbackLoop=false => forward-only run
      3,
      false,
    );

    assert(
      tunedPopulation.length > 0,
      "Expected at least one tuned creature to be generated",
    );

    for (const tuned of tunedPopulation) {
      tuned.validate({ forwardOnly: true });
    }
  },
);
