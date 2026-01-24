import { assert } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

Deno.test("Creature.record: ArcTan near-saturation target does not explode value-space errors", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: ArcTan.NAME,
        bias: 0,
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1_000_000,
      },
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

  // Ask for a target *inside* the valid ArcTan range, but extremely close to +π/2.
  // Without additional guarding, tan(target) can be astronomically large even though the
  // activation difference is tiny, which makes record() errors misleadingly huge.
  const upper = Math.PI / 2;
  // Push closer than 1e-9: tan(π/2 - 1e-12) is ~1e12 which historically caused
  // value-space errors that dominate Explorer MSE.
  const expected = new Float32Array([upper - 1e-12]);
  const map = creature.record(expected);
  const rec = map.get("output-0");
  assert(rec, "Expected a record for output-0");

  const err = rec.errors[0];
  assert(Number.isFinite(err), `Expected finite error, got ${err}`);
  assert(
    Math.abs(err) < 1e9,
    `Expected near-saturation error to be bounded, got ${err}`,
  );
});
