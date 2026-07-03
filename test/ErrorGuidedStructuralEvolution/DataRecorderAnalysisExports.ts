/**
 * Guards the public export surface of `DataRecorderAnalysis.ts` (Issue #3212).
 *
 * The stall-detection tuning constants `DEFAULT_PER_CHUNK_GRACE_MS` and
 * `STALL_WARMUP_MIN_COMPLETED_CHUNKS` are consumed only inside their defining
 * module, so they must stay module-private rather than being over-exported.
 * These tests inspect the module namespace object at runtime — a behavioural
 * check that fails if the `export` keyword is ever re-added — while confirming
 * the genuinely public helpers remain reachable.
 */
import { assertEquals } from "@std/assert";

const mod = await import(
  "@architecture/ErrorGuidedStructuralEvolution/DataRecorderAnalysis.ts"
) as Record<string, unknown>;

Deno.test("DataRecorderAnalysis - stall tuning constants are not over-exported", () => {
  assertEquals(mod.DEFAULT_PER_CHUNK_GRACE_MS, undefined);
  assertEquals(mod.STALL_WARMUP_MIN_COMPLETED_CHUNKS, undefined);
});

Deno.test("DataRecorderAnalysis - genuine public surface stays exported", () => {
  assertEquals(typeof mod.runAnalysisLoop, "function");
  assertEquals(typeof mod.chunkFocusList, "function");
  assertEquals(typeof mod.formatStallMemoryDiagnostics, "function");
});
