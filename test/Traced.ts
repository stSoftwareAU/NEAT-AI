import { ensureDirSync } from "@std/fs";
import { Creature } from "../mod.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { compactUnused } from "../src/compact/CompactUnused.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

Deno.test("Traced", () => {
  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const json = JSON.parse(Deno.readTextFileSync("./test/data/traced.json"));

  const creature = Creature.fromJSON(json);

  Deno.writeTextFileSync(
    `${traceDir}/A.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );
  const config = createBackPropagationConfig();

  const compact = compactUnused(json, config.plankConstant);
  if (compact) {
    Deno.writeTextFileSync(
      `${traceDir}/C.json`,
      JSON.stringify(compact.exportJSON(), null, 1),
    );
  }
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  creature.applyLearnings(config, sparseConfig);

  Deno.writeTextFileSync(
    `${traceDir}/B.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );
});
