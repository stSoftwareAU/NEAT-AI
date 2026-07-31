/**
 * Locks the inter-island DNA-sharing knob defaults (Issue #3554).
 *
 * These four knobs (#2173, #2174, #2175, #2455) used to take their defaults
 * from `DEFAULT_DNA_SHARING_PRESET` in `src/config/DnaSharingPreset.ts`. The
 * `dnaSharingMode` preset layer was retired in #3554 — nobody set it and the
 * default preset was defined to equal the per-knob defaults — so the literals
 * now live inline in `createNeatConfig()`. This test carries over the
 * assertions that used to guard that equality, so inlining cannot silently
 * shift behaviour for existing callers.
 */

import { assert, assertEquals } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("inter-island knobs - defaults unchanged after retiring the preset", () => {
  const config = createNeatConfig({});
  assertEquals(config.diversityBreedingRate, 0);
  assertEquals(config.interSpeciesCrossoverThreshold, 0.1);
  assertEquals(config.geneticCompatibilityThreshold, 0.3);
  assertEquals(config.compatibilityGating.enabled, true);
  assertEquals(config.compatibilityGating.power, 1.5);
  assertEquals(config.compatibilityGating.maxDraws, 3);

  // Cross-field invariant the preset layer also had to honour.
  assert(
    config.interSpeciesCrossoverThreshold <=
      config.geneticCompatibilityThreshold,
    "interSpeciesCrossoverThreshold must be <= geneticCompatibilityThreshold",
  );
});

Deno.test("inter-island knobs - explicit values still win over the defaults", () => {
  const config = createNeatConfig({
    diversityBreedingRate: 0.123,
    interSpeciesCrossoverThreshold: 0.05,
    compatibilityGating: { power: 2.5 },
  });
  assertEquals(config.diversityBreedingRate, 0.123);
  assertEquals(config.interSpeciesCrossoverThreshold, 0.05);
  assertEquals(config.compatibilityGating.power, 2.5);
  // Unspecified gating fields keep their defaults.
  assertEquals(config.compatibilityGating.enabled, true);
  assertEquals(config.compatibilityGating.maxDraws, 3);
});

Deno.test("inter-island knobs - a non-boolean gating enabled falls back to the default", () => {
  const config = createNeatConfig({
    compatibilityGating: { enabled: "yes" as unknown as boolean },
  });
  assertEquals(config.compatibilityGating.enabled, true);
});
