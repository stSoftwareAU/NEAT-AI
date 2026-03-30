import { assert, assertNotEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { compactUnused } from "@compact/CompactUnused.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

Deno.test("Traced: compactUnused removes unused neurons from traced creature", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/traced.json"));

  const creature = Creature.fromJSON(json);
  creature.validate();

  const config = createBackPropagationConfig();

  const compact = compactUnused(creature.traceJSON(), config.plankConstant);
  if (compact) {
    compact.validate();
    assert(
      compact.neurons.length <= creature.neurons.length,
      "Compacted creature should have no more neurons than original",
    );
  }
});

Deno.test("Traced: applyLearnings modifies creature weights from trace data", () => {
  const json = JSON.parse(Deno.readTextFileSync("./test/data/traced.json"));

  const creature = Creature.fromJSON(json);
  creature.validate();

  const beforeJSON = JSON.stringify(creature.exportJSON());

  const config = createBackPropagationConfig();
  const sparseConfig = new SparseConfig(
    exportJSONWithRuntimeIds(creature),
    config,
  );

  creature.applyLearnings(config, sparseConfig);
  creature.validate();

  const afterJSON = JSON.stringify(creature.exportJSON());

  assertNotEquals(
    beforeJSON,
    afterJSON,
    "applyLearnings should modify the creature based on trace data",
  );
});
