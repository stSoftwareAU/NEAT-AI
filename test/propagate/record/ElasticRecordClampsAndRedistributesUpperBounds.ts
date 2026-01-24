import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

Deno.test(
  "Creature.record: clamps to ReLU6 upper bound and redistributes residue",
  () => {
    // Covers the "positive residue" clamp+redistribute path:
    // - ReLU6 activation range is [0, 6].
    // - Requesting a large positive output implies a large positive value-space error.
    // - Attribution initially allocates most share to the ReLU6 path, but clamping
    //   prevents requesting activation > 6. The leftover share must be redistributed.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { uuid: "relu6-hidden", type: "hidden", squash: ReLU6.NAME, bias: 0 },
        { uuid: "id-hidden", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "relu6-hidden", weight: 1 },
        { fromUUID: "input-0", toUUID: "id-hidden", weight: 1 },

        // Weight-based record scoring (shares ∝ w²) will favour relu6-hidden.
        { fromUUID: "relu6-hidden", toUUID: "output-0", weight: 1 },
        { fromUUID: "id-hidden", toUUID: "output-0", weight: 0.2 },
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

    // Current output ≈ relu6(1) + 0.2 = 1.2. Request far above ReLU6's max.
    const map = creature.record(new Float32Array([20]));

    const relu6Rec = map.get("relu6-hidden");
    const idRec = map.get("id-hidden");

    assert(relu6Rec, "expected a discovery record for relu6-hidden");
    assert(idRec, "expected a discovery record for id-hidden");

    assertEquals(relu6Rec.errors.length, 1);
    const relu6Max = relu6Rec.errors
      .filter(Number.isFinite)
      .reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert(
      relu6Max < 1e4,
      `expected ReLU6 record error to be bounded, got relu6Max=${relu6Max}`,
    );

    // Residue must be redistributed somewhere feasible.
    assert(idRec.errors.length > 0);
  },
);
