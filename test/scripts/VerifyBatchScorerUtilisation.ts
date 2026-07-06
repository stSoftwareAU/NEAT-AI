/**
 * Unit tests for the Issue #3238 practice-verification helpers.
 *
 * These pin the machine-checkable regression signals the parent #3233 relies
 * on: the shim spawn log is classified correctly (one-off `--help` probe vs
 * per-generation batch invocations), and a healthy run yields zero
 * discrepancies while each failure mode (no partition line, per-creature
 * fallback, count mismatch) is surfaced loudly rather than hidden.
 */

import { assertEquals } from "@std/assert";
import type { ScorerUtilisationTotals } from "@creature/ScorerUtilisationTotals.ts";
import {
  classifySpawns,
  detectDiscrepancies,
} from "../../scripts/verifyBatchScorerUtilisationLib.ts";

const HEALTHY: ScorerUtilisationTotals = {
  generations: 14,
  batchScorerInvocations: 14,
  creaturesBatchScored: 318,
  creaturesPerCreatureScored: 0,
  batchFallbackGenerations: 0,
};

Deno.test("classifySpawns splits the --help probe from batch invocations", () => {
  const lines = [
    "2026-07-06T17:36:06Z\t--help",
    "2026-07-06T17:36:07Z\t--cost MSE /tmp/creatures-a /tmp/data",
    "2026-07-06T17:36:07Z\t--cost MSE /tmp/creatures-b /tmp/data",
    "", // trailing blank from split("\n")
  ];
  const { probe, batch } = classifySpawns(lines);
  assertEquals(probe.length, 1);
  assertEquals(batch.length, 2);
});

Deno.test("classifySpawns handles an empty log", () => {
  const { probe, batch } = classifySpawns([""]);
  assertEquals(probe.length, 0);
  assertEquals(batch.length, 0);
});

Deno.test("detectDiscrepancies: healthy run has none", () => {
  const d = detectDiscrepancies(HEALTHY, 14, 14, 1);
  assertEquals(d, []);
});

Deno.test("detectDiscrepancies: missing partition line is flagged", () => {
  const d = detectDiscrepancies(HEALTHY, 0, 14, 1);
  assertEquals(d.length, 1);
  assertEquals(d[0].includes("Batch scorer partition"), true);
});

Deno.test("detectDiscrepancies: per-creature fallback is flagged", () => {
  const fellBack: ScorerUtilisationTotals = {
    generations: 14,
    batchScorerInvocations: 0,
    creaturesBatchScored: 0,
    creaturesPerCreatureScored: 318,
    batchFallbackGenerations: 14,
  };
  // partitionLines present (14), but every creature fell back; 0 batch spawns.
  const d = detectDiscrepancies(fellBack, 14, 0, 1);
  // creaturesBatchScored==0, batchFallbackGenerations>0, invocations!=generations.
  assertEquals(d.length, 3);
  assertEquals(
    d.some((m) => m.includes("creaturesBatchScored is 0")),
    true,
  );
  assertEquals(
    d.some((m) => m.includes("hit a batch fallback")),
    true,
  );
});

Deno.test("detectDiscrepancies: spawn/invocation mismatch is flagged", () => {
  // batchScorerInvocations (14) but only 13 OS batch spawns observed.
  const d = detectDiscrepancies(HEALTHY, 14, 13, 1);
  assertEquals(d.length, 1);
  assertEquals(
    d[0].includes("does not match OS-observed batch scorer spawns"),
    true,
  );
});

Deno.test("detectDiscrepancies: invocations != generations is flagged", () => {
  const uneven: ScorerUtilisationTotals = {
    generations: 14,
    batchScorerInvocations: 13,
    creaturesBatchScored: 300,
    creaturesPerCreatureScored: 0,
    batchFallbackGenerations: 0,
  };
  const d = detectDiscrepancies(uneven, 14, 13, 1);
  assertEquals(d.length, 1);
  assertEquals(d[0].includes("!= generations"), true);
});
