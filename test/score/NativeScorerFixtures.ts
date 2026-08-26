/**
 * Shared fixtures for the native-vs-TypeScript dataset scoring tests
 * (Issue #3854).
 *
 * Everything here is deterministic: a hand-written creature with fixed weights
 * and a seeded dataset, so a parity comparison between the two engines is a
 * statement about the engines and never about the fixture.
 */
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { isAbsolute, join } from "@std/path";

const INPUTS = 2;
const HIDDEN = 3;

/** Deterministic linear-congruential source — no `Math.random()` in fixtures. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * A small 2→3→1 creature with fixed weights and logistic squashes.
 *
 * Every output lands strictly inside `(0, 1)`, which keeps all seven built-in
 * costs well defined: `CROSS_ENTROPY` asserts on outputs outside `[0, 1]`, and
 * `MSLE`/`MAPE` need strictly positive values.
 *
 * @param selfLoop - add a recurrent `hidden→hidden` synapse so the creature
 *   genuinely carries state between records.
 * @param magnitudeScale - multiplier applied to every weight and bias. The
 *   default `1` keeps every magnitude at or below 1.0, where `valuePenalty()`
 *   returns 0 and the score's magnitude term is inert. A scale above ~2 pushes
 *   the magnitudes into the penalised decades so the term actually contributes
 *   (Issue #3867) — the score-formula comparison is otherwise blind to that
 *   part of the formula.
 */
export function buildScoringCreature(
  selfLoop = false,
  magnitudeScale = 1,
): Creature {
  const neurons: CreatureInternal["neurons"] = [];
  for (let h = 0; h < HIDDEN; h++) {
    neurons.push({
      type: "hidden",
      index: INPUTS + h,
      bias: (0.15 - h * 0.1) * magnitudeScale,
      squash: "LOGISTIC",
    });
  }
  neurons.push({
    type: "output",
    index: INPUTS + HIDDEN,
    bias: -0.2 * magnitudeScale,
    squash: "LOGISTIC",
  });

  const synapses: CreatureInternal["synapses"] = [];
  for (let h = 0; h < HIDDEN; h++) {
    for (let i = 0; i < INPUTS; i++) {
      synapses.push({
        from: i,
        to: INPUTS + h,
        weight: (0.3 + 0.2 * h - 0.1 * i) * magnitudeScale,
      });
    }
    synapses.push({
      from: INPUTS + h,
      to: INPUTS + HIDDEN,
      weight: (0.25 + 0.15 * h) * magnitudeScale,
    });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: INPUTS,
    output: 1,
  });
  creature.forwardOnly = !selfLoop;
  if (selfLoop) {
    creature.connect(INPUTS, INPUTS, 0.35 * magnitudeScale);
  }
  creature.fix();
  return creature;
}

/**
 * Deterministic dataset. Targets sit above the creature's outputs so the
 * `MSLE` sum `Σ(log t − log ŷ)` stays positive — `rust_scorer` rejects a
 * negative average error outright, which would mask a parity comparison
 * behind an exec failure.
 */
export function buildScoringDataSet(records = 64): DataRecordInterface[] {
  const rand = seededRandom(20260823);
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < records; i++) {
    rows.push({
      input: new Float32Array([rand(), rand()]),
      output: new Float32Array([0.7 + rand() * 0.25]),
    });
  }
  return rows;
}

/** Create a temporary `.bin` dataset directory for {@link buildScoringDataSet}. */
export function makeScoringDataDir(records = 64): string {
  return makeDataDir(buildScoringDataSet(records), records);
}

function isExecutableFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/**
 * Locate a real `rust_scorer` binary, mirroring how `quality.sh` resolves it:
 * the explicit environment override first, then `PATH`, then the sibling
 * `NEAT-AI-scorer` checkout. Returns `undefined` when none is available so a
 * contributor without the binary skips the live parity lane rather than
 * failing it.
 */
export function resolveRustScorerBinary(): string | undefined {
  let explicit: string | undefined;
  try {
    explicit = Deno.env.get("NEAT_AI_RUST_SCORER_BINARY_PATH")?.trim();
  } catch {
    return undefined;
  }
  if (explicit) {
    if (isAbsolute(explicit) || explicit.includes("/")) {
      return isExecutableFile(explicit) ? explicit : undefined;
    }
    const onPath = searchPath(explicit);
    if (onPath) return onPath;
  }

  const onPath = searchPath("rust_scorer");
  if (onPath) return onPath;

  for (
    const candidate of [
      "../NEAT-AI-scorer/target/release/rust_scorer",
      "../NEAT-AI-scorer/target/debug/rust_scorer",
    ]
  ) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function searchPath(name: string): string | undefined {
  let pathVar: string | undefined;
  try {
    pathVar = Deno.env.get("PATH") ?? undefined;
  } catch {
    return undefined;
  }
  if (!pathVar) return undefined;
  for (const dir of pathVar.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * GPU mode for every `rust_scorer` subprocess the suite spawns.
 *
 * Defaults to `off`: the default lane runs in parallel with the rest of the
 * suite and a wgpu context per process exhausts the host (the same reason
 * `quality.sh` sets `NEAT_SCORER_GPU=off`).
 *
 * Issue #3869 — `./quality.sh --gpu-scorer` exports `NEAT_SCORER_GPU=auto`
 * for its serialised `test/score/` lane, so the ambient value is carried
 * through instead of being pinned back to `off`. Pinning it here would make
 * the opt-in lane look like GPU coverage while every scorer call ran on the
 * CPU — exactly the false confidence the lane exists to remove.
 */
export function scorerGpuEnv(): Record<string, string> {
  let mode: string | undefined;
  try {
    mode = Deno.env.get("NEAT_SCORER_GPU")?.trim();
  } catch {
    // Env unreadable (a test without `env` permission) — keep the safe default.
  }
  return { NEAT_SCORER_GPU: mode && mode.length > 0 ? mode : "off" };
}

/**
 * Scorer config pointing at a real binary, with the lane's GPU mode
 * ({@link scorerGpuEnv}) applied.
 */
export function liveScorerConfig(
  binaryPath: string,
): RequiredRustScorerConfig {
  return {
    enabled: true,
    binaryPath,
    timeoutMs: 60_000,
    env: scorerGpuEnv(),
    batch: false,
    strict: true,
  };
}

/** The same config with the native path switched off — the TypeScript engine. */
export function typescriptScorerConfig(
  binaryPath: string,
): RequiredRustScorerConfig {
  return { ...liveScorerConfig(binaryPath), enabled: false };
}

/**
 * Relative difference between two error values, with an absolute floor so a
 * near-zero pair does not blow up the ratio.
 */
export function relativeDifference(a: number, b: number): number {
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale < 1e-12 ? diff : diff / scale;
}
