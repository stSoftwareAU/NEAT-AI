/**
 * Issue #3271 — fact-check guard for docs/config/.
 *
 * Every example under `docs/config/` imports `createNeatConfig` (and, in
 * PRESETS.md, the built-in presets) from the package root `@stsoftware/neat-ai`,
 * which resolves to `mod.ts`. Those examples only compile if the public entry
 * point actually re-exports `createNeatConfig` and the `NeatConfig` type.
 *
 * These are "what" tests: `createNeatConfig` is imported from the public entry
 * point and invoked exactly as the docs show, then the returned configuration
 * is asserted — not a source-text grep.
 */

import { assert, assertEquals } from "@std/assert";
import {
  createNeatConfig,
  type NeatConfig,
  QUICK_START_PRESET,
} from "../../mod.ts";

Deno.test("mod.ts re-exports createNeatConfig (docs/config CORE_EVOLUTION example)", () => {
  const config: NeatConfig = createNeatConfig({
    populationSize: 50,
    iterations: 1_000,
    targetError: 0.05,
    mutationRate: 0.3,
    elitism: 1,
    costOfGrowth: 0.000_000_1,
  });
  assertEquals(config.populationSize, 50);
  assertEquals(config.iterations, 1_000);
  // The factory returns a frozen, validated configuration.
  assert(Object.isFrozen(config));
});

Deno.test("createNeatConfig accepts a spread preset with an override (docs/config PRESETS example)", () => {
  const config: NeatConfig = createNeatConfig({
    ...QUICK_START_PRESET,
    populationSize: 25, // override preset value
  });
  assertEquals(config.populationSize, 25);
  assert(Object.isFrozen(config));
});
