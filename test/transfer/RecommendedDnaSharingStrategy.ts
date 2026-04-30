/**
 * Tests for the recommendedDnaSharingStrategy export.
 *
 * Issue #2496: After the DNA-sharing bake-off across the four primitives plus
 * the NoOp baseline, `PruningTemplateStrategy` was the only primitive that
 * produced a robust positive lift on every seed (1, 7, 42). The bake-off
 * write-up lives in `docs/dna-sharing-bake-off-results.md`. This test pins
 * the documented winner to the exported symbol so the two cannot drift.
 *
 * Also verifies the no-regression acceptance criterion: the default
 * `dnaSharingMode` parsed by `NeatConfig` remains `"default"` — flipping it
 * to `"aggressive"` was rejected by the bake-off because
 * `KnobTuningStrategy("aggressive")` produced zero lift on every seed.
 */

import { assertEquals } from "@std/assert";
import { recommendedDnaSharingStrategy } from "@transfer/mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("recommendedDnaSharingStrategy - pinned to bake-off winner", () => {
  // Documented winner in docs/dna-sharing-bake-off-results.md (Issue #2496).
  assertEquals(recommendedDnaSharingStrategy, "PruningTemplate");
});

Deno.test("recommendedDnaSharingStrategy - default dnaSharingMode unchanged", () => {
  // Acceptance criterion: existing default behaviour for unrelated
  // NeatOptions users is preserved. KnobTuning("aggressive") produced zero
  // lift in the bake-off so the default is *not* flipped — a NeatOptions
  // caller who supplies no dnaSharingMode keeps the "default" preset.
  const cfg = createNeatConfig({});
  assertEquals(cfg.dnaSharingMode, "default");
});
