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
const SCORER = Deno.env.get("PROD_SCORER") ??
  `${Deno.cwd()}/../NEAT-AI-scorer/target/release/rust_scorer`;

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

function runWasm(creature: Creature, dataDir: string): {
  ms: number;
  error: number;
  score: number;
} {
  __setRustTrainDirEnabledForTests(false);
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
  const tmp = Deno.makeTempFileSync({ suffix: ".json" });
  writeCreature(tmp, creature);
  const score = scoreCreature(tmp, dataDir);
  Deno.removeSync(tmp);
  __setRustTrainDirEnabledForTests(undefined);
  return { ms, error: result.error, score };
}

function runRust(creature: Creature, dataDir: string): {
  ms: number;
  error: number;
  score: number;
} {
  const binary = findRustTrainDirBinary();
  if (!binary) throw new Error("neat_ai_backpropagation binary not found");

  __setRustTrainDirEnabledForTests(true);
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
  const tmp = Deno.makeTempFileSync({ suffix: ".json" });
  writeCreature(tmp, creature);
  const score = scoreCreature(tmp, dataDir);
  Deno.removeSync(tmp);
  __setRustTrainDirEnabledForTests(undefined);
  return { ms, error: result.error, score };
}

if (import.meta.main) {
  const baselineJson = JSON.parse(Deno.readTextFileSync(CREATURE_PATH));
  const baselinePath = join(Deno.makeTempDirSync(), "baseline.json");
  Deno.writeTextFileSync(baselinePath, JSON.stringify(baselineJson));
  const baselineScore = scoreCreature(baselinePath, DATA_DIR);

  console.log(`creature=${CREATURE_PATH}`);
  console.log(`data=${DATA_DIR}`);
  console.log(`epochs=${EPOCHS}`);
  console.log(`baseline_score=${baselineScore}`);

  const wasmCreature = Creature.fromJSON(
    structuredClone(baselineJson),
    false,
  );
  const wasm = runWasm(wasmCreature, DATA_DIR);
  console.log(
    `wasm_error=${wasm.error} wasm_score=${wasm.score} wasm_ms=${
      wasm.ms.toFixed(1)
    }`,
  );

  const rustCreature = Creature.fromJSON(
    structuredClone(baselineJson),
    false,
  );
  const rust = runRust(rustCreature, DATA_DIR);
  console.log(
    `rust_error=${rust.error} rust_score=${rust.score} rust_ms=${
      rust.ms.toFixed(1)
    }`,
  );

  const scoreDelta = rust.score - wasm.score;
  const speedup = wasm.ms / rust.ms;
  console.log(`score_delta_rust_minus_wasm=${scoreDelta}`);
  console.log(`speedup_wasm_over_rust=${speedup.toFixed(3)}`);
  console.log(
    `baseline_to_wasm=${wasm.score - baselineScore} baseline_to_rust=${
      rust.score - baselineScore
    }`,
  );
}
