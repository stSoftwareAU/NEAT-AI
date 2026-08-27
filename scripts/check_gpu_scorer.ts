/**
 * Pre-flight for `./quality.sh --gpu-scorer` (Issue #3869).
 *
 * Builds a tiny two-creature directory plus a matching `.bin` corpus, scores
 * it twice with the resolved `rust_scorer` — once `--gpu off`, once
 * `--gpu on` — and classifies the pair with
 * {@link classifyGpuProbe}. The verdict comes from the scorer's own
 * `gpuBackend` field, never from `NEAT_SCORER_GPU`, so a lane that would have
 * silently scored on CPU cannot report itself green.
 *
 * Exit codes (quality.sh depends on all three):
 *
 * - `0` — a real GPU backend ran; the lane may proceed.
 * - `1` — fail loud: the probe is untrustworthy, or `--gpu on` succeeded and
 *   still reported `cpu-fallback`.
 * - `2` — clean skip: this host has no usable GPU. Not a failure.
 */
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { join, resolve } from "@std/path";
import { classifyGpuProbe, type ScorerRun } from "./lib/gpuScorerProbe.ts";

/** Exit code quality.sh reads as "no usable GPU — skip the lane". */
export const EXIT_NO_GPU = 2;

const INPUTS = 2;
const HIDDEN = 3;
const RECORDS = 32;

/** Deterministic source — a probe fixture must never vary between runs. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * A small forward-only 2→3→1 creature, well under the 256-neuron shader cap
 * so the GPU directory kernel can host the set.
 *
 * @param scale - per-creature weight multiplier, so the two probe creatures
 *   are not byte-identical and the payload carries two distinct entries
 */
function buildProbeCreature(scale: number): Creature {
  const neurons: CreatureInternal["neurons"] = [];
  for (let h = 0; h < HIDDEN; h++) {
    neurons.push({
      type: "hidden",
      index: INPUTS + h,
      bias: (0.15 - h * 0.1) * scale,
      squash: "LOGISTIC",
    });
  }
  neurons.push({
    type: "output",
    index: INPUTS + HIDDEN,
    bias: -0.2 * scale,
    squash: "LOGISTIC",
  });

  const synapses: CreatureInternal["synapses"] = [];
  for (let h = 0; h < HIDDEN; h++) {
    for (let i = 0; i < INPUTS; i++) {
      synapses.push({
        from: i,
        to: INPUTS + h,
        weight: (0.3 + 0.2 * h - 0.1 * i) * scale,
      });
    }
    synapses.push({
      from: INPUTS + h,
      to: INPUTS + HIDDEN,
      weight: (0.25 + 0.15 * h) * scale,
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: INPUTS,
    output: 1,
  });
  creature.forwardOnly = true;
  creature.fix();
  return creature;
}

function buildProbeDataSet(): DataRecordInterface[] {
  const rand = seededRandom(20260826);
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < RECORDS; i++) {
    rows.push({
      input: new Float32Array([rand(), rand()]),
      output: new Float32Array([0.7 + rand() * 0.25]),
    });
  }
  return rows;
}

/**
 * Resolve the scorer binary the same way quality.sh does: the explicit
 * environment override first, then `PATH`, then the sibling checkout.
 */
function resolveScorerBinary(): string | undefined {
  const explicit = Deno.env.get("NEAT_AI_RUST_SCORER_BINARY_PATH")?.trim();
  const candidates = [
    ...(explicit ? [explicit] : []),
    "../NEAT-AI-scorer/target/release/rust_scorer",
    `${Deno.env.get("HOME") ?? ""}/.cargo/bin/rust_scorer`,
  ];
  for (const candidate of candidates) {
    if (!candidate || !candidate.includes("/")) continue;
    try {
      if (Deno.statSync(candidate).isFile) return candidate;
    } catch {
      // Not at this path — try the next candidate.
    }
  }
  const bare = explicit && !explicit.includes("/") ? explicit : "rust_scorer";
  for (const dir of (Deno.env.get("PATH") ?? "").split(":")) {
    if (!dir) continue;
    const candidate = join(dir, bare);
    try {
      if (Deno.statSync(candidate).isFile) return candidate;
    } catch {
      // Not on this PATH entry.
    }
  }
  return undefined;
}

async function runScorer(
  binary: string,
  gpuMode: string,
  creaturesDir: string,
  dataDir: string,
): Promise<ScorerRun> {
  const command = new Deno.Command(binary, {
    args: ["--gpu", gpuMode, creaturesDir, dataDir],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function main(): Promise<void> {
  const binary = resolveScorerBinary();
  if (binary === undefined) {
    console.error(
      "❌ GPU scorer lane requested but rust_scorer was not found.",
    );
    console.error(
      "   Put it on PATH, pass --rust-scorer-bin=PATH, or clone ../NEAT-AI-scorer.",
    );
    Deno.exit(1);
  }

  const dataDir = resolve(makeDataDir(buildProbeDataSet(), RECORDS));
  const creaturesDir = await Deno.makeTempDir({ prefix: "gpu-scorer-probe-" });
  try {
    await Promise.all(
      [1, 1.4].map((scale, index) =>
        Deno.writeTextFile(
          join(creaturesDir, `probe-${index}.json`),
          JSON.stringify(buildProbeCreature(scale).exportJSON()),
        )
      ),
    );

    const control = await runScorer(binary, "off", creaturesDir, dataDir);
    const demanded = await runScorer(binary, "on", creaturesDir, dataDir);
    const verdict = classifyGpuProbe(control, demanded);

    switch (verdict.kind) {
      case "gpu":
        console.log(`✅ ${verdict.detail}`);
        return;
      case "skip":
        console.log(`⏭️  GPU scorer lane skipped — ${verdict.detail}`);
        Deno.exit(EXIT_NO_GPU);
        break;
      case "fail":
        console.error(`❌ ${verdict.detail}`);
        Deno.exit(1);
    }
  } finally {
    await Deno.remove(creaturesDir, { recursive: true });
    await Deno.remove(dataDir, { recursive: true });
  }
}

await main();
