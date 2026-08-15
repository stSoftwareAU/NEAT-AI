/**
 * Production trainDir parity + speed: WASM TypeScript loop vs rust
 * `neat_ai_backpropagation train` on a production-scale creature / corpus
 * slice.
 *
 * Usage:
 *   PROD_CREATURE=/path/to/network.json \
 *   PROD_DATA_DIR=/path/to/binaries \
 *   deno run --allow-all --config deno.json scripts/ProdTrainDirBench.ts
 */

import { Creature } from "@creature";
import { trainDir } from "@architecture/Training.ts";
import { Costs } from "@costs";
import {
  __setRustTrainDirEnabledForTests,
  findRustTrainDirBinary,
} from "@architecture/training/RustTrainDirBridge.ts";
import { join } from "@std/path";

const CREATURE_PATH = Deno.env.get("PROD_CREATURE");
const DATA_DIR = Deno.env.get("PROD_DATA_DIR");
if (!CREATURE_PATH || !DATA_DIR) {
  throw new Error(
    "Set PROD_CREATURE and PROD_DATA_DIR to a production-scale creature JSON " +
      "and a directory of little-endian f32 .bin records.",
  );
}
const EPOCHS = Number(Deno.env.get("PROD_EPOCHS") ?? "2");
const SKIP_SCORE = Deno.env.get("PROD_SKIP_SCORE") === "1";
const SCORER = Deno.env.get("PROD_SCORER") ??
  `${Deno.cwd()}/../NEAT-AI-scorer/target/release/rust_scorer`;

function countRecords(dataDir: string, floatsPerRecord: number): number {
  const bytesPer = floatsPerRecord * 4;
  let total = 0;
  for (const entry of Deno.readDirSync(dataDir)) {
    if (!entry.isFile || !entry.name.endsWith(".bin")) continue;
    total += Math.floor(
      Deno.statSync(join(dataDir, entry.name)).size / bytesPer,
    );
  }
  return total;
}

function scoreCreature(creaturePath: string, dataDir: string): number {
  const out = new Deno.Command(SCORER, {
    args: [creaturePath, dataDir],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!out.success) {
    throw new Error(
      `rust_scorer failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  const text = new TextDecoder().decode(out.stdout).trim();
  // rust_scorer prints a score line; take the last finite number.
  const nums = text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  const score = Number(nums[nums.length - 1]);
  if (!Number.isFinite(score)) {
    throw new Error(`could not parse rust_scorer output: ${text}`);
  }
  return score;
}

function writeCreature(path: string, creature: Creature): void {
  Deno.writeTextFileSync(path, JSON.stringify(creature.exportJSON()));
}

function runTrain(
  creature: Creature,
  dataDir: string,
  rust: boolean,
): { ms: number; error: number; score: number | undefined } {
  __setRustTrainDirEnabledForTests(rust);
  if (rust && findRustTrainDirBinary() === null) {
    throw new Error("neat_ai_backpropagation binary not found");
  }
  const start = performance.now();
  const result = trainDir(
    creature,
    dataDir,
    {
      iterations: EPOCHS,
      targetError: 0,
      disableRandomSamples: true,
      learningRate: 0.01,
    },
    Costs.find("MSE"),
  );
  const ms = performance.now() - start;
  let score: number | undefined;
  if (!SKIP_SCORE) {
    const tmp = Deno.makeTempFileSync({ suffix: ".json" });
    writeCreature(tmp, creature);
    score = scoreCreature(tmp, dataDir);
    Deno.removeSync(tmp);
  }
  __setRustTrainDirEnabledForTests(undefined);
  return { ms, error: result.error, score };
}

if (import.meta.main) {
  const baselineJson = JSON.parse(Deno.readTextFileSync(CREATURE_PATH));
  const input = Number(baselineJson.input);
  const output = Number(baselineJson.output);
  const records = countRecords(DATA_DIR, input + output);

  let baselineScore: number | undefined;
  if (!SKIP_SCORE) {
    const baselinePath = join(Deno.makeTempDirSync(), "baseline.json");
    Deno.writeTextFileSync(baselinePath, JSON.stringify(baselineJson));
    baselineScore = scoreCreature(baselinePath, DATA_DIR);
  }

  console.log(`creature=${CREATURE_PATH}`);
  console.log(`data=${DATA_DIR}`);
  console.log(`epochs=${EPOCHS}`);
  console.log(`records=${records}`);
  if (baselineScore !== undefined) {
    console.log(`baseline_score=${baselineScore}`);
  }

  const wasmCreature = Creature.fromJSON(
    structuredClone(baselineJson),
    false,
  );
  const wasm = runTrain(wasmCreature, DATA_DIR, false);
  const wasmRecPerSec = records * EPOCHS / (wasm.ms / 1000);
  console.log(
    `wasm_error=${wasm.error} wasm_score=${wasm.score ?? "skipped"} ` +
      `wasm_ms=${wasm.ms.toFixed(1)} wasm_records_per_sec=${
        wasmRecPerSec.toFixed(1)
      }`,
  );

  const rustCreature = Creature.fromJSON(
    structuredClone(baselineJson),
    false,
  );
  const rust = runTrain(rustCreature, DATA_DIR, true);
  const rustRecPerSec = records * EPOCHS / (rust.ms / 1000);
  console.log(
    `rust_error=${rust.error} rust_score=${rust.score ?? "skipped"} ` +
      `rust_ms=${rust.ms.toFixed(1)} rust_records_per_sec=${
        rustRecPerSec.toFixed(1)
      }`,
  );

  const speedup = wasm.ms / rust.ms;
  console.log(`speedup_wasm_over_rust=${speedup.toFixed(3)}`);
  if (
    baselineScore !== undefined && wasm.score !== undefined &&
    rust.score !== undefined
  ) {
    console.log(`score_delta_rust_minus_wasm=${rust.score - wasm.score}`);
    console.log(
      `baseline_to_wasm=${wasm.score - baselineScore} baseline_to_rust=${
        rust.score - baselineScore
      }`,
    );
  }
}
