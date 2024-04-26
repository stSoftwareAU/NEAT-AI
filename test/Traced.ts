import { ensureDirSync } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { Creature } from "../mod.ts";
import { BackPropagationConfig } from "../src/architecture/BackPropagation.ts";
import { compactUnused } from "../src/compact/CompactUnused.ts";

Deno.test("Traced", async () => {
  const traceDir = ".trace";
  ensureDirSync(traceDir);
  const json = JSON.parse(Deno.readTextFileSync("./test/data/traced.json"));

  const creature = Creature.fromJSON(json);

  Deno.writeTextFileSync(
    `${traceDir}/A.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  const config = new BackPropagationConfig();

  const compact = await compactUnused(json, config.plankConstant);
  if (compact) {
    Deno.writeTextFileSync(
      `${traceDir}/C.json`,
      JSON.stringify(compact.exportJSON(), null, 2),
    );
  }

  creature.applyLearnings(config);

  Deno.writeTextFileSync(
    `${traceDir}/B.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );
});
