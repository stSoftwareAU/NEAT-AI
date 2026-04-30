import { assert } from "@std/assert";
import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Regression test for issue #2497: a constant neuron that loses all outward
 * connections during forward-only breeding must be repaired, not rejected.
 *
 * The bug: in forward-only breeding, a constant neuron's outward connections
 * can all be dropped when those connections don't appear in the ref.synapses of
 * the hidden neurons that get included in the offspring (because those neurons
 * were selected from the other parent's version, which had different inward
 * connections). repairOrphanedConstants must restore at least one outward edge.
 */
Deno.test(
  "Offspring.breed: orphaned constant neuron is repaired in forward-only offspring",
  async () => {
    await initWasmForTests();

    // Mother: constant-bias → hidden-a and hidden-b; input feeds all hidden;
    // a more complex network ensures breed() returns offspring (not undefined).
    const mumJson: CreatureExport = {
      input: 2,
      output: 1,
      forwardOnly: true,
      semanticVersion: "4.0.0",
      neurons: [
        { type: "constant", uuid: "constant-bias", bias: 0.3 },
        { type: "hidden", uuid: "hidden-a", squash: IDENTITY.NAME, bias: 0.1 },
        { type: "hidden", uuid: "hidden-b", squash: IDENTITY.NAME, bias: 0.2 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.4 },
        { fromUUID: "input-1", toUUID: "hidden-a", weight: -0.1 },
        { fromUUID: "constant-bias", toUUID: "hidden-a", weight: 0.2 },
        { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 0.3 },
        { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.2 },
        { fromUUID: "constant-bias", toUUID: "hidden-b", weight: 0.15 },
        { fromUUID: "hidden-b", toUUID: "output-0", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 0.05 },
      ],
    };

    // Father: constant-bias → hidden-c only (different hidden uuid);
    // hidden-b is shared with mum but without the constant-bias connection.
    // When offspring gets hidden-b from father's ref (no constant-bias→hidden-b),
    // and hidden-c is NOT included, constant-bias has no outward connections.
    const dadJson: CreatureExport = {
      input: 2,
      output: 1,
      forwardOnly: true,
      semanticVersion: "4.0.0",
      neurons: [
        { type: "constant", uuid: "constant-bias", bias: 0.3 },
        { type: "hidden", uuid: "hidden-b", squash: IDENTITY.NAME, bias: 0.05 },
        { type: "hidden", uuid: "hidden-c", squash: IDENTITY.NAME, bias: 0.06 },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-b", weight: 0.11 },
        { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.12 },
        { fromUUID: "hidden-b", toUUID: "hidden-c", weight: 0.13 },
        { fromUUID: "constant-bias", toUUID: "hidden-c", weight: 0.25 },
        { fromUUID: "input-1", toUUID: "hidden-c", weight: 0.14 },
        { fromUUID: "hidden-c", toUUID: "output-0", weight: 0.15 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.16 },
      ],
    };

    const mum = Creature.fromJSON(mumJson);
    const dad = Creature.fromJSON(dadJson);
    mum.validate({ forwardOnly: true });
    dad.validate({ forwardOnly: true });

    let breedAttempts = 0;
    let validChildren = 0;
    // Run enough iterations to exercise the orphaned-constant repair path.
    for (let i = 0; i < 400; i++) {
      breedAttempts++;
      const child = Offspring.breed(mum, dad, { forwardOnly: true });
      if (!child) continue;
      // Must not throw — repairOrphanedConstants must fix any orphaned constants.
      child.validate({ forwardOnly: true });
      validChildren++;
    }

    assert(breedAttempts > 0, "Expected at least one breed attempt");
    assert(validChildren > 0, "Expected at least one valid forward-only offspring");
  },
);
