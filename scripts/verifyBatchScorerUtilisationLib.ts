/**
 * Pure helpers for the Issue #3238 batch-scorer practice verification.
 *
 * Kept separate from the run harness (`verifyBatchScorerUtilisation3238.ts`) so
 * the spawn-classification and discrepancy-detection logic — the machine-checkable
 * signals the parent #3233 relies on to catch a batching regression — can be
 * unit-tested without spawning the real `rust_scorer` binary.
 */

import type { ScorerUtilisationTotals } from "@creature/ScorerUtilisationTotals.ts";

/** Split shim spawn log lines into the one-off `--help` cost probe and the
 * per-generation batch scoring invocations. */
export interface SpawnClassification {
  readonly probe: string[];
  readonly batch: string[];
}

/**
 * Classify `rust_scorer` launches recorded by the shim. The batch bridge probes
 * the binary once with `--help` to detect `--cost` support (Issue #2745); that
 * probe is not a scoring pass. Every other launch is a batch scoring invocation.
 */
export function classifySpawns(spawnLines: string[]): SpawnClassification {
  const nonEmpty = spawnLines.filter((l) => l.trim().length > 0);
  return {
    probe: nonEmpty.filter((l) => l.includes("--help")),
    batch: nonEmpty.filter((l) => !l.includes("--help")),
  };
}

/**
 * Return the list of discrepancies that make this verification a FAILURE.
 * An empty list means batch use + one-invocation-per-generation held. Never
 * hides a fault: a missing partition line, a per-creature fallback, or a
 * count mismatch each yields an explicit message (Issue #3234).
 */
export function detectDiscrepancies(
  util: ScorerUtilisationTotals,
  partitionLineCount: number,
  batchSpawnCount: number,
  probeSpawnCount: number,
): string[] {
  const discrepancies: string[] = [];
  if (partitionLineCount === 0) {
    discrepancies.push(
      "No '[NEAT-AI] Batch scorer partition' log line was emitted — the batch " +
        "path was NOT taken.",
    );
  }
  if (util.creaturesBatchScored === 0) {
    discrepancies.push(
      "scorerUtilisation.creaturesBatchScored is 0 — every creature fell back " +
        "to the per-creature worker path.",
    );
  }
  if (util.batchFallbackGenerations > 0) {
    discrepancies.push(
      `${util.batchFallbackGenerations} generation(s) hit a batch fallback.`,
    );
  }
  if (util.batchScorerInvocations !== batchSpawnCount) {
    discrepancies.push(
      `scorerUtilisation.batchScorerInvocations (${util.batchScorerInvocations}) ` +
        `does not match OS-observed batch scorer spawns (${batchSpawnCount}, ` +
        `excluding ${probeSpawnCount} one-off --help cost probe(s)).`,
    );
  }
  if (util.batchScorerInvocations !== util.generations) {
    discrepancies.push(
      `batchScorerInvocations (${util.batchScorerInvocations}) != generations ` +
        `(${util.generations}) — expected exactly one batch invocation per ` +
        `generation.`,
    );
  }
  return discrepancies;
}
