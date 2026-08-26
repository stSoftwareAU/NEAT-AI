/**
 * Recurrent directory-mode capability probe (Issue #3870).
 *
 * `rust_scorer` used to reject a directory-mode batch containing any
 * `forwardOnly=false` creature, because its per-chunk hot loop hard-coded the
 * flag (NEAT-AI-scorer#579). `Fitness` therefore partitioned the population and
 * sent every recurrent creature down the per-creature worker path. Since #579
 * landed the batch loop threads each creature's own flag, so a mixed population
 * can be scored in one invocation.
 *
 * Operators do not all upgrade at once, so the capability is **probed** rather
 * than assumed — the same shape as the `--cost` probe in
 * `RustScorerBridgeInternal.ts`. `--help` says nothing about recurrent
 * directory support (there is no `--version` either), so the only honest
 * question is the functional one: hand the binary a one-creature directory
 * holding a genuinely recurrent creature and a four-record dataset, and see
 * whether it scores it. An older binary refuses at load time (exit 1, no JSON)
 * and the partition stays in place; a newer one returns a score and the
 * partition is retired for that run.
 *
 * The answer is cached on the shared probe state, so the extra process is paid
 * at most once per scorer configuration per process — and only when a
 * population actually contains a recurrent creature worth batching.
 *
 * @module RecurrentDirectoryProbe
 */

import { join } from "@std/path";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { getLogger } from "@utils/Logger.ts";
import { reconcileBatchScorerOutput } from "./BatchScorerReconciler.ts";
import {
  __getBatchRunner,
  buildChildEnv,
  resolveProbeState,
} from "./RustScorerBridgeInternal.ts";

/** Filename stem of the probe creature, and therefore its result key. */
const PROBE_STEM = "neat-ai-recurrent-probe";

/**
 * Temp-directory prefix for the probe. Deliberately recognisable: it is what
 * distinguishes a probe invocation from a real batch in logs and in the test
 * doubles that stand in for the binary.
 */
const PROBE_DIR_PREFIX = "neat-rust-scorer-recurrent-probe-";

/**
 * A minimal creature with a genuine back edge (`output-0 → hidden-0`), so
 * `forwardOnly` is load-bearing rather than cosmetic — the shape
 * NEAT-AI-scorer's own `recurrent_directory_tdd.rs` uses.
 */
const PROBE_CREATURE_JSON = JSON.stringify({
  input: 1,
  output: 1,
  forwardOnly: false,
  semanticVersion: "4.0.0",
  neurons: [
    { type: "hidden", uuid: "hidden-0", bias: 0, squash: "IDENTITY" },
    { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
    { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    { fromUUID: "output-0", toUUID: "hidden-0", weight: 0.5 },
  ],
});

/**
 * Four `[input, output]` records, written in the `.bin` layout `makeDataDir`
 * produces: consecutive `f32` values, inputs then outputs, per record. All
 * strictly positive so the default MSE stays well defined.
 */
const PROBE_RECORDS = new Float32Array([
  0.25,
  0.5,
  0.5,
  0.75,
  0.75,
  1.0,
  1.0,
  1.25,
]);

/**
 * Whether the configured `rust_scorer` binary can score `forwardOnly=false`
 * creatures in directory mode.
 *
 * Never throws: any failure — a refusing binary, an unwritable temp base, a
 * timeout — answers `false`, which keeps the caller on the pre-#3870 partition.
 * That is a capability answer, not a masked fault: the creatures it covers are
 * still scored, by the per-creature path.
 *
 * @param config - the run's resolved scorer configuration.
 * @param tmpBaseDir - directory to create the probe's temporary files under,
 *   matching the batch bridge's policy for restricted environments.
 */
export async function resolveRecurrentDirectorySupport(
  config: RequiredRustScorerConfig,
  tmpBaseDir: string,
): Promise<boolean> {
  const probe = await resolveProbeState(config);
  if (!probe.available) return false;
  // Memoise the promise rather than the value so two concurrent callers share
  // one subprocess instead of racing to spawn two.
  probe.recurrentDirectory ??= runRecurrentProbe(config, tmpBaseDir);
  return await probe.recurrentDirectory;
}

async function runRecurrentProbe(
  config: RequiredRustScorerConfig,
  tmpBaseDir: string,
): Promise<boolean> {
  let root: string;
  try {
    root = await Deno.makeTempDir({
      dir: tmpBaseDir,
      prefix: PROBE_DIR_PREFIX,
    });
  } catch (error) {
    logDecline(
      config,
      `probe workspace could not be created: ${describe(error)}`,
    );
    return false;
  }

  try {
    const creaturesDir = join(root, "creatures");
    const dataDir = join(root, "data");
    await Deno.mkdir(creaturesDir);
    await Deno.mkdir(dataDir);
    await Deno.writeTextFile(
      join(creaturesDir, `${PROBE_STEM}.json`),
      PROBE_CREATURE_JSON,
    );
    await Deno.writeFile(
      join(dataDir, "0.bin"),
      new Uint8Array(PROBE_RECORDS.buffer),
    );

    const result = await __getBatchRunner()(
      config.binaryPath,
      [creaturesDir, dataDir],
      {
        // The question is a load-time one, so building a wgpu context to
        // answer it would be pure waste — and on a shared host, contention.
        env: buildChildEnv({ ...config.env, NEAT_SCORER_GPU: "off" }),
        timeoutMs: config.timeoutMs,
      },
    );

    if (!result.success) {
      logDecline(
        config,
        `directory-mode probe exited ${result.code}: ${
          trimForLog(result.stderr)
        }`,
      );
      return false;
    }

    // Reuse the batch reconciler so a binary that "succeeds" with unusable
    // output counts as unsupported rather than as a capability we then rely on.
    reconcileBatchScorerOutput(result.stdout, [PROBE_STEM]);
    return true;
  } catch (error) {
    logDecline(config, `directory-mode probe failed: ${describe(error)}`);
    return false;
  } finally {
    try {
      await Deno.remove(root, { recursive: true });
    } catch {
      // Ignore cleanup errors — a leaked temp dir is less bad than masking the
      // capability answer we just computed.
    }
  }
}

/**
 * One line per configuration explaining why recurrent creatures keep taking
 * the per-creature path. Silence here would look like the capability simply
 * does not exist.
 */
function logDecline(config: RequiredRustScorerConfig, detail: string): void {
  getLogger().info(
    `[NEAT-AI] Rust scorer at ${config.binaryPath} cannot batch recurrent ` +
      `creatures in directory mode (${detail}); they keep taking the ` +
      `per-creature path.`,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Matches the trim policy in the scorer bridges for consistent logs. */
function trimForLog(value: string, limit = 400): string {
  if (!value) return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit
    ? collapsed
    : collapsed.slice(0, limit) + "…";
}
