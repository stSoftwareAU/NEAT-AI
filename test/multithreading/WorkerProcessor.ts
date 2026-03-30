/**
 * Tests for WorkerProcessor utility functions.
 *
 * Issue #1698: Validates buildDiscoverResponsePayload and
 * clearDiscoverResultForGC helper functions.
 */
import { assertEquals, assertExists } from "@std/assert";
import {
  buildDiscoverResponsePayload,
  clearDiscoverResultForGC,
} from "../../src/multithreading/workers/WorkerProcessor.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";

function makeMinimalDiscoverResult(): DiscoverResult {
  return {
    ID: "test-discovery-123",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };
}

Deno.test("buildDiscoverResponsePayload: maps ID from result", () => {
  const result = makeMinimalDiscoverResult();
  const payload = buildDiscoverResponsePayload(result);
  assertEquals(payload.ID, "test-discovery-123");
});

Deno.test("buildDiscoverResponsePayload: omits undefined candidate arrays", () => {
  const result = makeMinimalDiscoverResult();
  const payload = buildDiscoverResponsePayload(result);

  assertEquals(payload.addHelpfulSynapses, undefined);
  assertEquals(payload.addHelpfulNeurons, undefined);
  assertEquals(payload.coordinatedStructuralCandidates, undefined);
  assertEquals(payload.removeHarmfulSynapse, undefined);
  assertEquals(payload.removeHarmfulNeurons, undefined);
  assertEquals(payload.removalCandidates, undefined);
  assertEquals(payload.candidateSquashes, undefined);
});

Deno.test("buildDiscoverResponsePayload: copies arrays to break reference sharing", () => {
  const result = makeMinimalDiscoverResult();
  const removalCandidates = [{
    neuronUuid: "hidden-1001",
    totalError: 0.5,
    impact: 0.001,
    reason: "low-impact",
  }];
  result.removalCandidates = removalCandidates;

  const payload = buildDiscoverResponsePayload(result);
  assertExists(payload.removalCandidates);
  assertEquals(payload.removalCandidates!.length, 1);
  assertEquals(payload.removalCandidates![0].neuronUuid, "hidden-1001");

  // Should be a new array (spread copy), not the same reference
  assertEquals(
    payload.removalCandidates !== removalCandidates,
    true,
    "should create a copy, not share reference",
  );
});

Deno.test("clearDiscoverResultForGC: nullifies populated arrays", () => {
  const result: DiscoverResult = {
    ID: "test",
    addHelpfulSynapses: [],
    addHelpfulNeurons: [],
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: [],
    removalCandidates: [],
    candidateSquashes: [],
  };

  clearDiscoverResultForGC(result);

  // After clearing, the arrays should be nullified (not undefined)
  // deno-lint-ignore no-explicit-any
  const r = result as any;
  assertEquals(r.addHelpfulSynapses, null);
  assertEquals(r.addHelpfulNeurons, null);
  assertEquals(r.removeHarmfulNeurons, null);
  assertEquals(r.removalCandidates, null);
  assertEquals(r.candidateSquashes, null);
});

Deno.test("clearDiscoverResultForGC: skips undefined arrays safely", () => {
  const result = makeMinimalDiscoverResult();
  // Should not throw when arrays are undefined
  clearDiscoverResultForGC(result);
  assertEquals(result.ID, "test-discovery-123");
});
