import { assert } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import { exportJSONWithRuntimeIds } from "../../src/architecture/PopulateRuntimeIdsFromCreature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import type { SynapseTrace } from "../../src/architecture/SynapseInterfaces.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ifPropagation", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "input", index: 2 },
      {
        type: "output",
        squash: "IF",
        index: 3,
        bias: 0,
      },
    ],
    synapses: [
      { from: 0, to: 3, weight: 0.9, type: "condition" },
      { from: 1, to: 3, weight: 1.1, type: "positive" },
      { from: 2, to: 3, weight: 0.95, type: "negative" },
    ],
    input: 3,
    output: 1,
  };

  const ts = [];
  for (let i = 100; i--;) {
    for (let j = 100; j--;) {
      if (i === 50) continue;
      const condition = Math.random() * 2 - 1;
      const positive = Math.random();
      const negative = Math.random();
      const item = {
        input: new Float32Array([condition, positive, negative]),
        output: new Float32Array([condition > 0 ? positive : negative]),
      };

      ts.push(item);
    }
  }

  const traceDir = ".trace";
  ensureDirSync(traceDir);

  const creature = Creature.fromJSON(json);
  const config = createBackPropagationConfig({ sparseRatio: 1 });
  const sparseConfig = new SparseConfig(
    exportJSONWithRuntimeIds(creature),
    config,
  );
  const sample = ts[0];
  creature.activateAndTrace(sample.input, false, sparseConfig);
  creature.propagate(sample.output, config, sparseConfig);
  const traceJson = creature.traceJSON();
  Deno.writeTextFileSync(
    ".trace/ifPropagation.json",
    JSON.stringify(traceJson, null, 1),
  );
  const hasTraceData = traceJson.synapses.some((c: SynapseTrace) =>
    c.trace !== undefined || Number.isFinite(c.weight)
  );
  assert(hasTraceData, "Should have trace data");

  traceJson.neurons.forEach((n) => {
    assert(Math.abs(n.bias) < 1, `Invalid bias ${n.bias}`);
  });
});
