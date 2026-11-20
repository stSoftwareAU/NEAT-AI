/**
 * Issue #4146 — reproduction on a production-scale fixture: a creature with
 * ~76,000 synapses (the captured hang creature has 63,317) trained in
 * predictive-coding mode with a task deadline shorter than one full iteration.
 *
 * Before the fix the trainer never read the deadline and ran the whole
 * iteration (and every later one) past it. With the fix it returns a
 * `timedOut` result one sample past the deadline.
 *
 * Run: `deno run -A bench/PredictiveCodingDeadlineLarge.ts [deadlineMs] [records]`
 */

import { Creature } from "@creature";
import { Costs } from "@costs";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "@config/PredictiveCodingConfig.ts";

const deadlineMs = Number(Deno.args[0] ?? 2_000);
const records = Number(Deno.args[1] ?? 2_000);
const inputs = 100;
const outputs = 10;

const creature = new Creature(inputs, outputs, {
  layers: [{ count: 300 }, { count: 150 }],
});
const dataSet: DataRecordInterface[] = [];
for (let r = 0; r < records; r++) {
  const input = new Float32Array(inputs);
  for (let i = 0; i < inputs; i++) input[i] = Math.random();
  const output = new Float32Array(outputs);
  for (let o = 0; o < outputs; o++) output[o] = Math.random();
  dataSet.push({ input, output });
}
const dir = makeDataDir(dataSet, records, { input: inputs, output: outputs });

console.log(
  `creature: ${creature.neurons.length} neurons, ${creature.synapses.length} synapses; ${records} records; deadline in ${deadlineMs} ms`,
);
const start = performance.now();
try {
  const result = trainDir(
    creature,
    dir,
    {
      iterations: 3,
      targetError: 0,
      disableRandomSamples: true,
      hardDeadlineTS: Date.now() + deadlineMs,
      predictiveCoding: { ...DEFAULT_PREDICTIVE_CODING_CONFIG, enabled: true },
    },
    Costs.find("MSE"),
  );
  const elapsed = Math.round(performance.now() - start);
  console.log(
    `elapsed=${elapsed}ms overshoot=${
      elapsed - deadlineMs
    }ms timedOut=${result.timedOut} bestMeasure=${result.bestMeasure} iteration=${result.iteration}`,
  );
} finally {
  Deno.removeSync(dir, { recursive: true });
}
