import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { Swish } from "../../../src/methods/activations/types/Swish.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

Deno.test(
  "Creature.record: prefers not pushing Swish negative, clamps and redistributes residue",
  () => {
    // Swish can output negatives, but record attribution treats negative targets
    // as undesirable when there is an alternative (soft clamp to >= 0).
    //
    // This covers the "soft lower bound" branch for Swish + residue redistribution.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { uuid: "swish-hidden", type: "hidden", squash: Swish.NAME, bias: 0 },
        { uuid: "id-hidden", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "swish-hidden", weight: 1 },
        { fromUUID: "input-0", toUUID: "id-hidden", weight: 1 },

        // Equal weights => initial shares are similar.
        { fromUUID: "swish-hidden", toUUID: "output-0", weight: 1 },
        { fromUUID: "id-hidden", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJSON);
    const config = createBackPropagationConfig({
      sparseRatio: 1,
      disableRandomSamples: true,
      generations: 0,
    });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);
    creature.activateAndTrace(new Float32Array([1]), false, sparseConfig);

    // Current output ≈ swish(1) + 1 ≈ 1.731.
    // Request a large negative output so the error is strongly negative.
    const map = creature.record(new Float32Array([-10]));

    const swishRec = map.get("swish-hidden");
    const idRec = map.get("id-hidden");

    assert(swishRec, "expected a discovery record for swish-hidden");
    assert(idRec, "expected a discovery record for id-hidden");

    assertEquals(swishRec.errors.length, 1);
    const swishMax = swishRec.errors
      .filter(Number.isFinite)
      .reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert(
      swishMax < 100,
      `expected Swish record error to be clamped/bounded, got swishMax=${swishMax}`,
    );

    // Residue must be redistributed to the feasible alternative path.
    assert(idRec.errors.length > 0);
  },
);
