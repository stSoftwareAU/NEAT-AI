import { assert } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../../src/propagate/sparse/SparseConfig.ts";

Deno.test("record: prefers plastic paths over saturated ArcTan parents", () => {
  // Two parallel parents feed the output:
  // - hidden-arctan is saturated (raw input ~1e6)
  // - hidden-relu is in a normal range (raw input ~1)
  //
  // We want record() attribution to push error back into hidden-relu, and avoid
  // calling record() on the saturated ArcTan parent (last resort).
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { uuid: "hidden-arctan", type: "hidden", squash: ArcTan.NAME, bias: 0 },
      { uuid: "hidden-relu", type: "hidden", squash: ReLU.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      // Force ArcTan extremely close to +π/2 (raw input ~1e12).
      {
        fromUUID: "input-0",
        toUUID: "hidden-arctan",
        weight: 1_000_000_000_000,
      },
      { fromUUID: "input-0", toUUID: "hidden-relu", weight: 1 },
      { fromUUID: "hidden-arctan", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-relu", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);
  const config = createBackPropagationConfig({
    sparseRatio: 1,
    disableRandomSamples: true,
    generations: 0,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  const _output = creature.activateAndTrace(
    new Float32Array([1]),
    false,
    sparseConfig,
  );

  // Current output is atan(1e12) + relu(1) ≈ 1.5708 + 1.
  // Request a much lower value so naive record() will attempt to push the ArcTan
  // parent out of saturation (which implies a massive raw-value move).
  const discoverMap = creature.record(new Float32Array([0]));

  const arctanRec = discoverMap.get("hidden-arctan");
  const reluRec = discoverMap.get("hidden-relu");

  // Expect the relu path to be the one we recurse into.
  assert(reluRec, "Expected record entry for hidden-relu");

  // We expect to avoid recording saturated ArcTan parent at all (preferred).
  // If it exists, it must not have been assigned a huge error.
  if (arctanRec) {
    const finite = arctanRec.errors.filter(Number.isFinite);
    const maxAbs = finite.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert(
      maxAbs < 1e9,
      `Expected ArcTan path to be de-emphasised, got maxAbs=${maxAbs}`,
    );
  } else {
    // Preferred behaviour: we do not recurse into the saturated ArcTan parent.
  }
});
