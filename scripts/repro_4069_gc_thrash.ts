/**
 * Issue #4069 reproduction: run `evolveDir` on a synthetic creature of the
 * #4060 field size (8,200 hidden neurons, ~58k synapses) with a 5 s
 * `setInterval` heartbeat that logs heap and timer lag. Diagnostic only; the
 * findings are in docs/troubleshooting/MEMORY.md. Size knobs: R_INPUTS,
 * R_HIDDEN, R_FAN_IN, R_RECORDS.
 *
 * deno run -A --config deno.json \
 *   --v8-flags=--max-old-space-size=2163,--trace-gc \
 *   scripts/repro_4069_gc_thrash.ts < /dev/null
 *
 * @module
 */
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { Logger } from "@utils/Logger.ts";

const INPUTS = Number(Deno.env.get("R_INPUTS") ?? 200);
const OUTPUTS = 4;
const HIDDEN = Number(Deno.env.get("R_HIDDEN") ?? 8200);
const FAN_IN = Number(Deno.env.get("R_FAN_IN") ?? 7);
const RECORDS = Number(Deno.env.get("R_RECORDS") ?? 4000);

const t0 = performance.now();
const ts = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(7);
const heapMB = () => (Deno.memoryUsage().heapUsed / 1048576).toFixed(0);
const out = (s: string) => console.log(`[${ts()}s] ${s}`);

// Heartbeat: the same main-thread timer queue the setInterval deadline poll uses.
let last = performance.now();
let maxLag = 0;
setInterval(() => {
  const now = performance.now();
  const lag = now - last - 5000;
  last = now;
  if (lag > maxLag) maxLag = lag;
  out(
    `[heartbeat] heap=${heapMB()}MB lag=${lag.toFixed(0)}ms maxLag=${
      maxLag.toFixed(0)
    }ms`,
  );
}, 5000);

let seed = 42;
const rnd =
  () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const hex = (n: number) => n.toString(16).padStart(12, "0");
const uuidOf = (i: number) => `00000000-0000-4000-8000-${hex(i)}`;
const squashes = ["TANH", "LOGISTIC", "IDENTITY", "RELU"];

const neurons: Record<string, unknown>[] = [];
const synapses: Record<string, unknown>[] = [];
const sources: string[] = [];
for (let i = 0; i < INPUTS; i++) sources.push(`input-${i}`);
const used = new Set<string>();
for (let h = 0; h < HIDDEN; h++) {
  const u = uuidOf(h);
  neurons.push({
    type: "hidden",
    uuid: u,
    bias: rnd() - 0.5,
    squash: squashes[h % 4],
  });
  const picked = new Set<string>();
  while (picked.size < FAN_IN) {
    picked.add(sources[Math.floor(rnd() * sources.length)]);
  }
  for (const f of picked) {
    synapses.push({ weight: (rnd() - 0.5) * 0.2, fromUUID: f, toUUID: u });
    used.add(f);
  }
  sources.push(u);
}
for (let o = 0; o < OUTPUTS; o++) {
  neurons.push({
    type: "output",
    uuid: `output-${o}`,
    bias: 0,
    squash: "IDENTITY",
  });
}
for (let h = 0; h < HIDDEN; h++) {
  const u = uuidOf(h);
  if (!used.has(u)) {
    synapses.push({
      weight: (rnd() - 0.5) * 0.2,
      fromUUID: u,
      toUUID: `output-${h % OUTPUTS}`,
    });
  }
}
const creature = Creature.fromJSON({
  semanticVersion: "4.0.0",
  forwardOnly: true,
  neurons,
  synapses,
  input: INPUTS,
  output: OUTPUTS,
} as never);
out(
  `creature built: ${creature.neurons.length} neurons, ${creature.synapses.length} synapses, heap=${heapMB()}MB`,
);

const records = [];
for (let r = 0; r < RECORDS; r++) {
  const input = new Float32Array(INPUTS);
  for (let i = 0; i < INPUTS; i++) input[i] = rnd() * 2 - 1;
  const output = new Float32Array(OUTPUTS);
  for (let o = 0; o < OUTPUTS; o++) {
    output[o] = Math.tanh(input[o] + input[o + 1]);
  }
  records.push({ input, output });
}
const dataSetDir = makeDataDir(records, 1000);
const creatureStore = await Deno.makeTempDir({ prefix: "repro-4069-store-" });

const line = (...a: unknown[]) => out(a.map(String).join(" "));
const logger: Logger = { debug: line, info: line, warn: line, error: line };

out(`evolveDir start heap=${heapMB()}MB`);
const result = await creature.evolveDir(dataSetDir, {
  populationSize: 5,
  timeoutMinutes: 6,
  threads: 1,
  heavyTaskWorkerCount: 1,
  iterations: 1000,
  creatureStore,
  logger,
  verbose: true,
} as never);
out(
  `evolveDir returned: ${JSON.stringify(result).slice(0, 400)} maxLag=${
    maxLag.toFixed(0)
  }ms`,
);
await Deno.remove(dataSetDir, { recursive: true });
await Deno.remove(creatureStore, { recursive: true });
Deno.exit(0);
