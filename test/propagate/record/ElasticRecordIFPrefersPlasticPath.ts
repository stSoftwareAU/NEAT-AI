import { assert } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { ArcTan } from "@methods/activations/types/ArcTan.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("record(IF): prefers plastic positive-branch paths over saturated ArcTan parents", () => {
  // IF output chooses positive branch when condition > 0.
  // We provide two positive sources:
  // - hidden-arctan saturated (raw ~1e12)
  // - hidden-relu normal (raw ~1)
  //
  // record() should recurse into hidden-relu and avoid attributing massive
  // value-space error to the saturated ArcTan parent.
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-arctan", type: "hidden", squash: ArcTan.NAME, bias: 0 },
      { uuid: "hidden-relu", type: "hidden", squash: ReLU.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IF.NAME, bias: 0 },
    ],
    synapses: [
      // Make condition positive.
      { fromUUID: "input-1", toUUID: "output-0", weight: 1, type: "condition" },

      // Drive hidden nodes.
      {
        fromUUID: "input-0",
        toUUID: "hidden-arctan",
        weight: 1_000_000_000_000,
      },
      { fromUUID: "input-0", toUUID: "hidden-relu", weight: 1 },

      // Two positive branches into IF.
      {
        fromUUID: "hidden-arctan",
        toUUID: "output-0",
        weight: 1,
        type: "positive",
      },
      {
        fromUUID: "hidden-relu",
        toUUID: "output-0",
        weight: 1,
        type: "positive",
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
  creature.activateAndTrace(new Float32Array([1, 1]), false, sparseConfig);

  const discoverMap = creature.record(new Float32Array([0]));
  // Neuron IDs are deterministic integers derived from UUID strings:
  // hidden-arctan → 1119681710, hidden-relu → 891054337
  const arctanRec = discoverMap.get(1119681710);
  const reluRec = discoverMap.get(891054337);

  assert(reluRec, "Expected record entry for hidden-relu");

  if (arctanRec) {
    const finite = arctanRec.errors.filter(Number.isFinite);
    const maxAbs = finite.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert(
      maxAbs < 1e9,
      `Expected ArcTan path to be de-emphasised, got maxAbs=${maxAbs}`,
    );
  }
});
