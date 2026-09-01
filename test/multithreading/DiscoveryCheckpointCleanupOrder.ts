/**
 * The worker's result checkpoint must survive the discovery cleanup that owns
 * its directory (GRQ #4609).
 *
 * Source logs `GRQ-11-nigel-*.log` / `GRQ-26-sloth.log` carried, one line
 * apart:
 *
 * ```
 * Discovery <uuid> cleanup complete.
 * Worker processing error: NotFound: No such file or directory (os error 2):
 *   writefile '.discovery/<uuid>/worker-result-checkpoint.json'
 *     at async persistDiscoverResultCheckpoint (WorkerProcessor.ts:98:3)
 * ```
 *
 * `DataRecorder.runCleanup` had left `.discovery/<uuid>/` being removed in the
 * background, and `WorkerProcessor.process` wrote the checkpoint into it. Every
 * completed Discovery task lost the analysis it had just paid minutes for.
 *
 * These tests assert the **artefact** — the checkpoint file and its contents —
 * not the absence of a throw, and they order events with a promise the test
 * controls rather than with elapsed time.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  buildDiscoverResponsePayload,
  discoverResultCheckpointPath,
  persistDiscoverResultCheckpoint,
  persistDiscoverResultCheckpointOrReport,
} from "@multithreading/workers/WorkerProcessor.ts";
import { trackDiscoveryCleanup } from "@discovery/DiscoveryCleanupBarrier.ts";
import { removeDiscoveryTempDir } from "@discovery/DiscoveryTempDirRemoval.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/** A completed analysis of the shape the source logs lost: 17 squashes, 21 removals. */
function completedDiscoverResult(id: string): DiscoverResult {
  return {
    ID: id,
    candidateSquashes: Array.from({ length: 17 }, (_, i) => ({
      neuronUuid: `squash-${i}`,
      squash: "IDENTITY",
      improvement: i / 100,
    })),
    removalCandidates: Array.from({ length: 21 }, (_, i) => ({
      neuronUuid: `removal-${i}`,
      totalError: 1,
      impact: i / 100,
      reason: "low-impact",
    })),
  } as unknown as DiscoverResult;
}

/** A discovery run directory with a parquet file in it, as a real run leaves. */
async function makeRunDir(
  uuid: string,
): Promise<{ base: string; run: string }> {
  const base = await Deno.makeTempDir({ prefix: "grq-4609-discovery-" });
  const run = join(base, uuid);
  await Deno.mkdir(run, { recursive: true });
  await Deno.writeTextFile(join(run, "discovery_data.parquet"), "parquet");
  return { base, run };
}

/**
 * Starts the recursive removal `runCleanup` leaves in flight, held on a gate
 * the test releases. `state.removed` flips once the directory has actually
 * gone, so ordering is asserted from observed events rather than from elapsed
 * time.
 */
function startHeldCleanup(runDir: string, discoveryId: string): {
  release: () => void;
  state: { removed: boolean };
} {
  const state = { removed: false };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const cleanup = removeDiscoveryTempDir(runDir, {
    remove: async (dir) => {
      await gate;
      await Deno.remove(dir, { recursive: true });
      state.removed = true;
    },
  });
  trackDiscoveryCleanup(discoveryId, cleanup);

  return { release, state };
}

Deno.test(
  "worker checkpoint is on disk after a Discovery task whose cleanup was in flight (GRQ #4609)",
  async () => {
    const uuid = "102e5edb-53f5-5634-b422-9f8b2576ff29";
    const { base, run } = await makeRunDir(uuid);
    try {
      const result = completedDiscoverResult(uuid);
      const checkpointPath = discoverResultCheckpointPath(uuid, base);
      const { release, state } = startHeldCleanup(run, uuid);

      let wroteAfterRemoval = false;
      const write = persistDiscoverResultCheckpoint(result, checkpointPath)
        .then(() => {
          wroteAfterRemoval = state.removed;
        });

      release();
      await write;

      assert(
        wroteAfterRemoval,
        "the checkpoint was written while the run directory was still being removed",
      );

      // The artefact, not the absence of a throw: the completed analysis is
      // recoverable from disk once the task has finished.
      const roundTrip = JSON.parse(await Deno.readTextFile(checkpointPath));
      assertEquals(roundTrip.ID, uuid);
      assertEquals(roundTrip.candidateSquashes.length, 17);
      assertEquals(roundTrip.removalCandidates.length, 21);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
);

Deno.test(
  "the checkpoint leaves exactly one run directory under the discovery base (GRQ #4609/#3790)",
  async () => {
    const uuid = "202e5edb-53f5-5634-b422-9f8b2576ff29";
    const { base, run } = await makeRunDir(uuid);
    try {
      const checkpointPath = discoverResultCheckpointPath(uuid, base);
      const { release } = startHeldCleanup(run, uuid);

      const write = persistDiscoverResultCheckpoint(
        completedDiscoverResult(uuid),
        checkpointPath,
      );
      release();
      await write;

      // A second top-level directory here fails GRQ's snapshot (Issue #3790).
      const topLevel: string[] = [];
      for await (const entry of Deno.readDir(base)) topLevel.push(entry.name);
      assertEquals(topLevel, [uuid]);

      const runEntries: string[] = [];
      for await (const entry of Deno.readDir(run)) runEntries.push(entry.name);
      assertEquals(runEntries, ["worker-result-checkpoint.json"]);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  },
);

Deno.test(
  "a checkpoint that cannot be written is reported loudly and keeps the analysis (GRQ #4609)",
  async () => {
    const uuid = "302e5edb-53f5-5634-b422-9f8b2576ff29";
    const base = await Deno.makeTempDir({ prefix: "grq-4609-unwritable-" });
    const logs: string[] = [];
    const original = getLogger();
    const capturing: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    };
    setLogger(capturing);
    try {
      // A file where the run directory should be: `mkdir` cannot succeed.
      await Deno.writeTextFile(join(base, uuid), "not a directory");
      const checkpointPath = discoverResultCheckpointPath(uuid, base);
      const result = completedDiscoverResult(uuid);

      const persisted = await persistDiscoverResultCheckpointOrReport(
        result,
        checkpointPath,
      );

      assertEquals(
        persisted,
        undefined,
        "no path is reported when nothing was written",
      );
      assert(
        logs.some((line) => line.includes("checkpoint NOT written")),
        `expected a loud checkpoint failure, got: ${JSON.stringify(logs)}`,
      );

      // The completed analysis still crosses the wire, and no reader is told
      // about a checkpoint that does not exist.
      const payload = buildDiscoverResponsePayload(result, {
        resultCheckpointPath: persisted,
      });
      assertEquals(payload.resultCheckpointPath, undefined);
      assertEquals(payload.candidateSquashes?.length, 17);
      assertEquals(payload.removalCandidates?.length, 21);
    } finally {
      setLogger(original);
      await Deno.remove(base, { recursive: true });
    }
  },
);
