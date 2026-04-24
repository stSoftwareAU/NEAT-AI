/**
 * Batch Rust scorer bridge (Issue #2422).
 *
 * Invokes the external `rust_scorer` binary in directory mode — one process
 * per generation rather than one per creature — and reconciles the JSON map
 * response back to the in-memory population by filename stem (creature UUID).
 *
 * Contract with `NEAT-AI-scorer` (issue #17):
 *
 *   rust_scorer <creature.json | creatures_dir> <data_dir>
 *
 * When a directory is passed as the first argument, the scorer writes a
 * single JSON object to stdout keyed by the creature filename stem. Each
 * value is a record validated by `BatchScorerReconciler` — `{score, error,
 * recordCount, ...}`.
 *
 * Failures (missing keys, extra keys, malformed results, non-JSON stdout,
 * non-zero exit) surface as {@link BatchScorerError} so generation scoring
 * can fail fast rather than silently mis-score creatures. The caller can
 * then choose to fall back to the per-creature scoring path.
 *
 * @module BatchRustScorerBridge
 */

import { join, resolve } from "@std/path";
import type { Creature } from "@creature";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  BatchScorerError,
  type BatchScorerResult,
  reconcileBatchScorerOutput,
} from "./BatchScorerReconciler.ts";
import {
  __getBatchRunner,
  buildChildEnv,
  resolveProbeState,
} from "./RustScorerBridgeInternal.ts";

/**
 * Outcome of a batch scorer invocation.
 *
 * On success: `results` is a `Map<Creature, BatchScorerResult>` — callers
 * walk their population and apply the scorer output per creature.
 *
 * On a skip (disabled, unavailable, batch mode turned off): `results` is
 * `undefined`. Callers should fall back to the per-creature scoring path.
 */
export interface BatchScorerRunResult {
  results: Map<Creature, BatchScorerResult> | undefined;
  /** Number of scorer processes spawned (0 when skipped, 1 on success). */
  invocations: number;
}

/**
 * Score an entire population in a single `rust_scorer` invocation.
 *
 * Writes every creature in `creatures` to a temporary directory (one file per
 * creature named `<uuid>.json`), spawns the scorer once with `(creatures_dir,
 * data_dir)`, parses the top-level JSON map, and maps each entry back to its
 * in-memory creature via filename stem.
 *
 * The temporary directory and creature files are always cleaned up, even on
 * failure.
 *
 * @throws {BatchScorerError} when the scorer process succeeds but its output
 *   cannot be reconciled with the expected creature set (missing/extra keys,
 *   malformed results, non-JSON stdout). Callers can catch this and decide
 *   whether to abort the generation or retry with the per-creature path.
 */
export async function tryBatchScoreWithRustScorer(
  creatures: readonly Creature[],
  dataDir: string,
  config: RequiredRustScorerConfig,
): Promise<BatchScorerRunResult> {
  if (!config.enabled || !config.batch) {
    return { results: undefined, invocations: 0 };
  }
  if (creatures.length === 0) {
    return { results: new Map(), invocations: 0 };
  }

  const probe = await resolveProbeState(config);
  if (!probe.available) {
    return { results: undefined, invocations: 0 };
  }

  // Map each creature to the filename stem used on disk. UUID is the stable,
  // already-assigned identity (makeUUID is idempotent for creatures that
  // already have one).
  const creatureByStem = new Map<string, Creature>();
  for (const creature of creatures) {
    const uuid = creature.uuid ?? CreatureUtil.makeUUID(creature);
    if (creatureByStem.has(uuid)) {
      // Duplicate UUIDs in the input list are a caller bug — Fitness.calculate
      // deduplicates upstream. Failing fast prevents silent stem collisions.
      throw new Error(
        `Batch scorer: duplicate creature UUID in input list: ${uuid}`,
      );
    }
    creatureByStem.set(uuid, creature);
  }

  const expectedStems = Array.from(creatureByStem.keys());
  const runCommand = __getBatchRunner();

  const tmpBase = readEnvString("NEAT_AI_RUST_SCORER_TMP_DIR") ?? dataDir;
  const creaturesDir = await Deno.makeTempDir({
    dir: tmpBase,
    prefix: "neat-rust-scorer-batch-",
  });

  try {
    // Write every creature to `<uuid>.json` inside the batch directory.
    // Using the UUID as the stem keeps the reconciliation unambiguous.
    await Promise.all(
      expectedStems.map(async (stem) => {
        const creature = creatureByStem.get(stem)!;
        const path = join(creaturesDir, `${stem}.json`);
        await Deno.writeTextFile(
          path,
          JSON.stringify(creature.exportJSON()),
        );
      }),
    );

    const absoluteCreaturesDir = resolve(Deno.cwd(), creaturesDir);
    const absoluteDataDir = resolve(Deno.cwd(), dataDir);

    const result = await runCommand(
      config.binaryPath,
      [absoluteCreaturesDir, absoluteDataDir],
      {
        env: buildChildEnv(config.env),
        timeoutMs: config.timeoutMs,
      },
    );

    if (!result.success) {
      throw new BatchScorerError(
        `Rust scorer batch call failed (exit ${result.code}): ${
          trimForLog(result.stderr)
        }`,
        "INVALID_JSON",
      );
    }

    // `reconcileBatchScorerOutput` throws `BatchScorerError` on any parse or
    // key-set mismatch, so missing/extra keys surface as explicit errors per
    // the issue acceptance criteria.
    const reconciled = reconcileBatchScorerOutput(
      result.stdout,
      expectedStems,
    );

    const byCreature = new Map<Creature, BatchScorerResult>();
    for (const [stem, record] of reconciled) {
      const creature = creatureByStem.get(stem);
      if (!creature) {
        // Defensive — reconcile already rejects extras, so this is unreachable
        // unless the reconciler contract changes.
        throw new BatchScorerError(
          `Batch scorer returned result for unknown stem: ${stem}`,
          "EXTRA_KEYS",
          { extraKeys: [stem] },
        );
      }
      byCreature.set(creature, record);
    }

    return { results: byCreature, invocations: 1 };
  } finally {
    try {
      await Deno.remove(creaturesDir, { recursive: true });
    } catch {
      // Ignore cleanup errors — temp dir leak is less bad than masking the
      // underlying failure.
    }
  }
}

function readEnvString(key: string): string | undefined {
  try {
    const v = Deno.env.get(key);
    if (v === undefined || v.trim() === "") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

/** Matches the trim policy in `RustScorerBridge.ts` for consistent logs. */
function trimForLog(value: string, limit: number = 2000): string {
  if (!value) return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return collapsed.slice(0, limit) + "…";
}
