import { assert } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Creature } from "../../src/Creature.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

Deno.test(
  "Mutator: forward-only repair must also satisfy IF_CONDITIONS after removing recurrent links",
  () => {
    const config = createNeatConfig({
      feedbackLoop: false,
    });
    const mutator = new Mutator(config);

    // Arrange: a pre-4.x forward-only creature where an IF neuron has 3 inbound
    // connections, but one is a back-connection (output -> hidden). Removing the
    // back-connection would leave only 2 inbound connections, triggering
    // IF_CONDITIONS unless repair adds a replacement forward connection.
    const tmp: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 0.1 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "hidden-0",
          weight: 0.2,
          type: "positive",
        },
        {
          fromUUID: "input-1",
          toUUID: "hidden-0",
          weight: -0.4,
          type: "condition",
        },
        // Illegal in forward-only: output -> hidden is a back connection.
        {
          fromUUID: "output-0",
          toUUID: "hidden-0",
          weight: 0.3,
          type: "negative",
        },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      ],
      // Use 3 inputs so the IF neuron index is > 2 and the IF_CONDITIONS
      // validation is actually enforced.
      input: 3,
      output: 1,
    };

    const creature = Creature.fromJSON(tmp);
    creature.forwardOnly = true;
    creature.semanticVersion = "2.0.0";

    // Act: run a harmless mutation to trigger the repair+validation path.
    mutator.mutateCreature(creature, { name: "MOD_WEIGHT" }, undefined);

    // Assert: creature remains valid forward-only and IF invariants are satisfied.
    creature.validate({ forwardOnly: true });
    assert(creature.forwardOnly === true);
  },
);
