/**
 * Tests for the recommendedDnaSharingStrategy export.
 *
 * Issue #2496: After the DNA-sharing bake-off across the four primitives plus
 * the NoOp baseline, `PruningTemplateStrategy` was the only primitive that
 * produced a robust positive lift on every seed (1, 7, 42). The bake-off
 * write-up lives in `docs/dna-sharing-bake-off-results.md`. This test pins
 * the documented winner to the exported symbol so the two cannot drift.
 *
 * The knob-tuning primitive it beat was retired in #3554 (zero lift, and no
 * consumer ever set the `dnaSharingMode` option it stamped). The inter-island
 * knob defaults that option gated are now locked by
 * `test/config/InterIslandKnobDefaults.ts`.
 */

import { assertEquals } from "@std/assert";
import { recommendedDnaSharingStrategy } from "@transfer/mod.ts";

Deno.test("recommendedDnaSharingStrategy - pinned to bake-off winner", () => {
  // Documented winner in docs/dna-sharing-bake-off-results.md (Issue #2496).
  assertEquals(recommendedDnaSharingStrategy, "PruningTemplate");
});
