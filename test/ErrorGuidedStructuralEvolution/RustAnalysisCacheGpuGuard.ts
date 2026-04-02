/**
 * Tests for RustAnalysisCache GPU-aware guard (Issue #2142).
 *
 * Validates that ensureRustCombinedAnalysis does NOT hardcode
 * requireGpu: false, allowing the GPU guard in analyzeParallel()
 * to properly block calls when GPU is unavailable.
 */
import { assertEquals } from "@std/assert";
import { ensureRustCombinedAnalysis } from "@architecture/ErrorGuidedStructuralEvolution/RustAnalysisCache.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

/**
 * Builds a minimal creature for testing.
 */
function buildMinimalCreature(): Creature {
  return Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1.0 },
    ],
  });
}

Deno.test({
  name:
    "ensureRustCombinedAnalysis omits requireGpu so GPU guard can protect FFI calls (Issue #2142)",
  sanitizeResources: false,
  fn: () => {
    // Capture what analyzeParallel receives to verify requireGpu is not false
    let capturedInput: Record<string, unknown> | undefined;
    const creature = buildMinimalCreature();

    const deps = {
      isRustDiscoveryEnabled: () => true,
      analyzeParallel: (
        input: Record<string, unknown>,
      ): { success: boolean; error?: string } => {
        capturedInput = input;
        return { success: false, error: "test stub" };
      },
    };

    const logCalls: Array<{ scope: string; reason: string }> = [];

    ensureRustCombinedAnalysis(
      creature,
      "/tmp/test.parquet",
      deps as unknown as Parameters<typeof ensureRustCombinedAnalysis>[2],
      undefined, // no cache
      undefined, // no deadline
      [], // empty focus list
      true, // includeSynapse
      false, // includeNeuron
      (scope, _focusList, reason) => {
        logCalls.push({ scope, reason });
      },
    );

    // The key assertion: requireGpu must NOT be explicitly false.
    // It should be undefined (omitted) so the GPU guard in analyzeParallel()
    // can block the call when no GPU is available.
    assertEquals(
      capturedInput !== undefined,
      true,
      "analyzeParallel should have been called",
    );
    assertEquals(
      capturedInput!.requireGpu !== false,
      true,
      `requireGpu should not be false, got: ${capturedInput!.requireGpu}`,
    );
  },
});
