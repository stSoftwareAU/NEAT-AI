/**
 * Live numeric parity between the two scoring engines (Issue #3853).
 *
 * Every other parity check in the tree compares an engine against a transcribed
 * constant, or asserts only that both lanes go green. Neither can see a
 * disagreement inside a tolerance, which is how RMSE spent releases reporting
 * `mean(sqrt(e))` from TypeScript and `sqrt(mean(e))` from `rust_scorer`.
 *
 * This test runs the **real** `rust_scorer` binary and `evaluateDir` with the
 * scorer forced off over the **same** dataset, for all seven built-in costs on
 * both a forward-only and a recurrent creature, and asserts the two numbers
 * agree. It skips — loudly, by name — when the binary cannot be resolved, so
 * contributors without the scorer are unaffected while `./quality.sh` (which
 * requires the binary) always runs it.
 *
 * Two known divergences are deliberately kept out of the fixture rather than
 * papered over with a wider tolerance: output-range penalties, which the native
 * scorer has no concept of, and `feedbackLoop=true`, which its recurrent path
 * ignores. Both are tracked separately; this test uses no output ranges and
 * `feedbackLoop=false`.
 */
import { assert, assertAlmostEquals } from "@std/assert";
import { Costs } from "../../mod.ts";
import { BUILT_IN_COST_NAMES } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { join } from "@std/path";
import {
  buildFixtureCreature,
  buildFixtureDataSet,
  FIXTURE_RECORDS,
} from "../_costFixtures.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Forces `evaluateDir` down the TypeScript/WASM path regardless of environment. */
const SCORER_OFF: RequiredRustScorerConfig = {
  enabled: false,
  binaryPath: "rust_scorer",
  timeoutMs: 0,
  env: {},
  batch: false,
  strict: false,
};

/**
 * Agreement tolerance: 0.01% of the expected value, plus an absolute floor for
 * errors near zero. Both engines activate through the same NEAT-AI-core kernels
 * in f32, so the residual is float ordering noise, not algorithmic difference.
 * The RMSE defect this test was written for moved the reported value by ~2% —
 * two hundred times this bound.
 */
function tolerance(expected: number): number {
  return 1e-6 + 1e-4 * Math.abs(expected);
}

function isExecutableFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/**
 * Resolve the `rust_scorer` binary the same way `quality.sh` does: an explicit
 * `NEAT_AI_RUST_SCORER_BINARY_PATH`, then `PATH`, then a sibling checkout of
 * NEAT-AI-scorer. Returns `undefined` when the scorer is not installed.
 */
function resolveScorerBinary(): string | undefined {
  const configured = Deno.env.get("NEAT_AI_RUST_SCORER_BINARY_PATH")?.trim();
  if (configured) {
    if (configured.includes("/")) {
      return isExecutableFile(configured) ? configured : undefined;
    }
    const onPath = findOnPath(configured);
    if (onPath) return onPath;
  }

  const fromPath = findOnPath("rust_scorer");
  if (fromPath) return fromPath;

  const sibling = "../NEAT-AI-scorer/target/release/rust_scorer";
  return isExecutableFile(sibling) ? sibling : undefined;
}

function findOnPath(name: string): string | undefined {
  const path = Deno.env.get("PATH");
  if (!path) return undefined;
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

const SCORER_BINARY = resolveScorerBinary();

/** Score `dataDir` with the native binary and return its reported error. */
async function scoreWithRustScorer(
  binary: string,
  creaturePath: string,
  dataDir: string,
  costName: string,
): Promise<number> {
  const command = new Deno.Command(binary, {
    args: ["--cost", costName, creaturePath, dataDir],
    // Mirrors quality.sh: parallel GPU contexts are a throughput path, not a
    // correctness one, and several at once exhaust host memory.
    env: { NEAT_SCORER_GPU: "off" },
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  assert(
    result.success,
    `rust_scorer --cost ${costName} failed (exit ${result.code}): ${stderr}`,
  );
  const parsed = JSON.parse(stdout) as { error?: unknown };
  const error = Number(parsed.error);
  assert(
    Number.isFinite(error),
    `rust_scorer --cost ${costName} returned a non-finite error: ${stdout}`,
  );
  return error;
}

async function assertEngineParity(forwardOnly: boolean): Promise<void> {
  const binary = SCORER_BINARY!;
  await initWasmForTests();

  const dataDir = makeDataDir(buildFixtureDataSet(), FIXTURE_RECORDS);
  // The creature lives outside the dataset directory: both engines scan that
  // directory for `.bin` records and a stray JSON file has no business there.
  const creatureDir = await Deno.makeTempDir({ prefix: "scorer-parity-" });
  const creaturePath = join(creatureDir, "creature.json");
  try {
    const creature = buildFixtureCreature(forwardOnly);
    await Deno.writeTextFile(
      creaturePath,
      JSON.stringify(creature.exportJSON()),
    );

    const scored = await Promise.all(
      BUILT_IN_COST_NAMES.map(async (costName) => ({
        costName,
        ts: (await creature.evaluateDir(
          dataDir,
          Costs.find(costName),
          false,
          undefined,
          undefined,
          SCORER_OFF,
        )).error,
        rust: await scoreWithRustScorer(
          binary,
          creaturePath,
          dataDir,
          costName,
        ),
      })),
    );

    for (const { costName, ts, rust } of scored) {
      assertAlmostEquals(
        ts,
        rust,
        tolerance(rust),
        `${costName} (forwardOnly=${forwardOnly}): TypeScript reported ` +
          `${ts}, rust_scorer reported ${rust}`,
      );
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    await Deno.remove(creatureDir, { recursive: true });
  }
}

Deno.test({
  name:
    "rust_scorer parity: forward-only creature agrees with evaluateDir on every built-in cost",
  ignore: SCORER_BINARY === undefined,
  async fn() {
    await assertEngineParity(true);
  },
});

Deno.test({
  name:
    "rust_scorer parity: recurrent creature agrees with evaluateDir on every built-in cost",
  ignore: SCORER_BINARY === undefined,
  async fn() {
    await assertEngineParity(false);
  },
});
