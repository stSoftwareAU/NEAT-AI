/**
 * Temporary GPU vs CPU evaluation comparer.
 *
 * Note (8-Jan-2026):
 * - Do NOT commit this file (it references private local paths).
 * - This script is intended to be created, run, and deleted.
 *
 * Australian English: behaviour, initialise, optimise.
 */

import { Costs } from "../src/Costs.ts";
import { Creature } from "../src/Creature.ts";
import { calculate as calculateScore } from "../src/architecture/Score.ts";
import { WorkerHandler } from "../src/multithreading/workers/WorkerHandler.ts";

type RunResult = {
  error: number;
  score: number;
  ms: number;
  ok: boolean;
  note?: string;
};

function argValue(flag: string): string | undefined {
  const idx = Deno.args.indexOf(flag);
  if (idx === -1) return undefined;
  return Deno.args[idx + 1];
}

function mustArg(flag: string): string {
  const v = argValue(flag);
  if (!v) throw new Error(`Missing required arg: ${flag} <value>`);
  return v;
}

function parseNumber(flag: string, fallback: number): number {
  const v = argValue(flag);
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${flag}: ${v}`);
  return n;
}

function normalisePath(p: string): string {
  if (p.startsWith("~/")) {
    const home = Deno.env.get("HOME");
    if (!home) return p;
    return `${home}/${p.slice(2)}`;
  }
  return p;
}

async function evaluateOnce(
  creatureJSONPath: string,
  dataDir: string,
  costName: string,
  growthCost: number,
  gpuEnabled: boolean,
  gpuStrict: boolean,
): Promise<RunResult> {
  // Ensure fresh env state for each run.
  Deno.env.set("NEAT_WGPU_ACTIVATION", gpuEnabled ? "1" : "0");
  // Strict mode forces WebGPU to be actually usable when enabled (no silent CPU fallback).
  Deno.env.set(
    "NEAT_WGPU_ACTIVATION_STRICT",
    gpuEnabled && gpuStrict ? "1" : "0",
  );

  const t0 = performance.now();

  const raw = await Deno.readTextFile(creatureJSONPath);
  const json = JSON.parse(raw);
  const creature = Creature.fromJSON(json);
  try {
    // Validate cost name up-front (throws on unknown).
    Costs.find(costName);

    // Use one worker (it internally connects to the shared WebGPU broker).
    const worker = new WorkerHandler(dataDir, costName as never, false);
    try {
      const r = await worker.evaluate(creature, false);
      const error = r.evaluate?.error ?? Number.POSITIVE_INFINITY;
      const t1 = performance.now();

      if (!Number.isFinite(error)) {
        return {
          ok: false,
          error,
          score: Number.NaN,
          ms: t1 - t0,
          note: "Non-finite error returned from worker evaluation",
        };
      }

      const score = calculateScore(creature, error, growthCost);
      return { ok: true, error, score, ms: t1 - t0 };
    } finally {
      worker.terminate();
    }
  } catch (e) {
    const t1 = performance.now();
    return {
      ok: false,
      error: Number.POSITIVE_INFINITY,
      score: Number.NaN,
      ms: t1 - t0,
      note: e instanceof Error ? e.message : String(e),
    };
  } finally {
    creature.dispose();
  }
}

async function main() {
  const creaturePath = normalisePath(
    mustArg("--creature"),
  );
  const dataDir = normalisePath(
    mustArg("--dataDir"),
  );
  const costName = argValue("--cost") ?? "MSE";
  const growthCost = parseNumber("--growthCost", 0);
  const repeats = Math.max(1, Math.floor(parseNumber("--repeats", 3)));
  const gpuStrict = (argValue("--gpuStrict") ?? "1") !== "0";

  console.log("Creature:", creaturePath);
  console.log("Data dir:", dataDir);
  console.log("Cost:", costName);
  console.log("Growth cost:", growthCost);
  console.log("Repeats:", repeats);
  console.log("GPU strict:", gpuStrict);
  console.log("");

  // Warm-up (CPU) to avoid one-time JIT noise.
  await evaluateOnce(creaturePath, dataDir, costName, growthCost, false, false);

  const cpu: RunResult[] = [];
  for (let i = 0; i < repeats; i++) {
    cpu.push(
      // deno-lint-ignore no-await-in-loop -- Sequential runs keep env toggles deterministic.
      await evaluateOnce(
        creaturePath,
        dataDir,
        costName,
        growthCost,
        false,
        false,
      ),
    );
  }
  const gpu: RunResult[] = [];
  for (let i = 0; i < repeats; i++) {
    gpu.push(
      // deno-lint-ignore no-await-in-loop -- Sequential runs keep env toggles deterministic.
      await evaluateOnce(
        creaturePath,
        dataDir,
        costName,
        growthCost,
        true,
        gpuStrict,
      ),
    );
  }

  const cpuOk = cpu.every((r) => r.ok);
  const gpuOk = gpu.every((r) => r.ok);
  if (!cpuOk) {
    console.log("CPU run failed:", cpu);
    Deno.exit(1);
  }
  if (!gpuOk) {
    console.log("GPU run failed:", gpu);
    console.log("");
    console.log(
      "This usually means strict GPU mode refused to run because exact equivalence cannot be proven for this creature's squash functions.",
    );
    Deno.exit(2);
  }

  const cpuBest = cpu.reduce((a, b) => (b.ms < a.ms ? b : a));
  const gpuBest = gpu.reduce((a, b) => (b.ms < a.ms ? b : a));

  console.log("CPU best:", cpuBest);
  console.log("GPU best:", gpuBest);
  console.log("");

  const sameError = Object.is(cpuBest.error, gpuBest.error);
  const sameScore = Object.is(cpuBest.score, gpuBest.score);

  console.log(
    "Same error:",
    sameError,
    "CPU:",
    cpuBest.error,
    "GPU:",
    gpuBest.error,
  );
  console.log(
    "Same score:",
    sameScore,
    "CPU:",
    cpuBest.score,
    "GPU:",
    gpuBest.score,
  );

  if (!sameError || !sameScore) {
    throw new Error("Mismatch: CPU vs GPU results differ.");
  }

  const speedup = cpuBest.ms / gpuBest.ms;
  console.log("");
  console.log(`Speedup (best-of-${repeats}): ${speedup.toFixed(2)}x`);
}

if (import.meta.main) {
  await main();
}
