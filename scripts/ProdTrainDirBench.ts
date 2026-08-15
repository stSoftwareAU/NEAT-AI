/**
 * Production trainDir parity + speed: WASM TypeScript loop vs rust
 * `neat_ai_backpropagation train` on a production-scale creature / corpus.
 *
 * Usage:
 *   PROD_CREATURE=/path/to/network.json \
 *   PROD_DATA_DIR=/path/to/binaries \
 *   deno run --allow-all --config deno.json scripts/ProdTrainDirBench.ts
 *
 * Env:
 *   PROD_EPOCHS          (default 1)
 *   PROD_LEARNING_RATE   (default 0.01)
 *   PROD_SKIP_SCORE=1    skip rust_scorer
 *   PROD_RUST_ONLY=1     skip the WASM train path (full-corpus friendly)
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
const EPOCHS = Number(Deno.env.get("PROD_EPOCHS") ?? "1");
const LEARNING_RATE = Number(Deno.env.get("PROD_LEARNING_RATE") ?? "0.01");
const SKIP_SCORE = Deno.env.get("PROD_SKIP_SCORE") === "1";
const RUST_ONLY = Deno.env.get("PROD_RUST_ONLY") === "1";
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

function scoreCreature(creaturePath: string, dataDir: string): {
  score: number;
  error: number;
  complexityPenalty: number;
  recordCount: number;
  timeTaken: number;
} {
  const out = new Deno.Command(SCORER, {
    args: ["--gpu", "off", creaturePath, dataDir],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!out.success) {
    throw new Error(
      `rust_scorer failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  const text = new TextDecoder().decode(out.stdout).trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`could not parse rust_scorer JSON: ${text}`);
  }
  const score = Number(parsed.score);
  const error = Number(parsed.error);
  const complexityPenalty = Number(parsed.complexityPenalty);
  const recordCount = Number(parsed.recordCount);
  const timeTaken = Number(parsed.timeTaken);
  if (!Number.isFinite(score) || !Number.isFinite(error)) {
    throw new Error(`rust_scorer JSON missing score/error: ${text}`);
  }
  return {
    score,
    error,
    complexityPenalty: Number.isFinite(complexityPenalty)
      ? complexityPenalty
      : NaN,
    recordCount: Number.isFinite(recordCount) ? recordCount : NaN,
    timeTaken: Number.isFinite(timeTaken) ? timeTaken : NaN,
  };
}

function writeCreature(path: string, creature: Creature): void {
  Deno.writeTextFileSync(path, JSON.stringify(creature.exportJSON()));
}

function runTrain(
  creature: Creature,
  dataDir: string,
  rust: boolean,
): {
  ms: number;
  error: number;
  score: number | undefined;
  scorerError: number | undefined;
} {
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
      learningRate: LEARNING_RATE,
    },
    Costs.find("MSE"),
  );
  const ms = performance.now() - start;
  let score: number | undefined;
  let scorerError: number | undefined;
  if (!SKIP_SCORE) {
    const tmp = Deno.makeTempFileSync({ suffix: ".json" });
    writeCreature(tmp, creature);
    const scored = scoreCreature(tmp, dataDir);
    score = scored.score;
    scorerError = scored.error;
    Deno.removeSync(tmp);
  }
  __setRustTrainDirEnabledForTests(undefined);
  return { ms, error: result.error, score, scorerError };
}

if (import.meta.main) {
  const baselineJson = JSON.parse(Deno.readTextFileSync(CREATURE_PATH));
  const input = Number(baselineJson.input);
  const output = Number(baselineJson.output);
  const records = countRecords(DATA_DIR, input + output);

  console.log(`creature=${CREATURE_PATH}`);
  console.log(`data=${DATA_DIR}`);
  console.log(`epochs=${EPOCHS}`);
  console.log(`learning_rate=${LEARNING_RATE}`);
  console.log(`records=${records}`);
  console.log(`rust_only=${RUST_ONLY}`);

  let baselineScore: number | undefined;
  let baselineError: number | undefined;
  if (!SKIP_SCORE) {
    console.log("scoring_baseline...");
    const scoreStart = performance.now();
    const baselinePath = join(Deno.makeTempDirSync(), "baseline.json");
    Deno.writeTextFileSync(baselinePath, JSON.stringify(baselineJson));
    const scored = scoreCreature(baselinePath, DATA_DIR);
    baselineScore = scored.score;
    baselineError = scored.error;
    console.log(
      `baseline_score=${baselineScore} baseline_error=${baselineError} ` +
        `complexity_penalty=${scored.complexityPenalty} ` +
        `score_ms=${(performance.now() - scoreStart).toFixed(1)} ` +
        `scorer_time_taken=${scored.timeTaken}`,
    );
  }

  if (!RUST_ONLY) {
    const wasmCreature = Creature.fromJSON(
      structuredClone(baselineJson),
      false,
    );
    const wasm = runTrain(wasmCreature, DATA_DIR, false);
    const wasmRecPerSec = records * EPOCHS / (wasm.ms / 1000);
    console.log(
      `wasm_train_error=${wasm.error} wasm_score=${wasm.score ?? "skipped"} ` +
        `wasm_scorer_error=${wasm.scorerError ?? "skipped"} ` +
        `wasm_ms=${wasm.ms.toFixed(1)} wasm_records_per_sec=${
          wasmRecPerSec.toFixed(1)
        }`,
    );
    if (baselineScore !== undefined && wasm.score !== undefined) {
      console.log(`baseline_to_wasm=${wasm.score - baselineScore}`);
    }
  }

  const rustCreature = Creature.fromJSON(
    structuredClone(baselineJson),
    false,
  );
  console.log("training_rust...");
  const rust = runTrain(rustCreature, DATA_DIR, true);
  const rustRecPerSec = records * EPOCHS / (rust.ms / 1000);
  console.log(
    `rust_train_error=${rust.error} rust_score=${rust.score ?? "skipped"} ` +
      `rust_scorer_error=${rust.scorerError ?? "skipped"} ` +
      `rust_ms=${rust.ms.toFixed(1)} rust_records_per_sec=${
        rustRecPerSec.toFixed(1)
      }`,
  );

  if (baselineScore !== undefined && rust.score !== undefined) {
    const delta = rust.score - baselineScore;
    console.log(`baseline_to_rust=${delta}`);
    if (baselineError !== undefined && rust.scorerError !== undefined) {
      console.log(
        `baseline_error_to_rust=${rust.scorerError - baselineError}`,
      );
    }
    console.log(
      delta > 0
        ? "verdict=rust_fitter_than_baseline"
        : delta < 0
        ? "verdict=rust_worse_than_baseline"
        : "verdict=rust_unchanged_vs_baseline",
    );
  }
}
