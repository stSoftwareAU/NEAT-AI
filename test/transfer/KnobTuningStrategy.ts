/**
 * Tests for the KnobTuningStrategy primitive (Issue #2492).
 *
 * Covers:
 * - Aggressive preset values (range, ordering, invariant compliance).
 * - Default preset preserves the existing per-knob defaults so existing
 *   user configs do not silently shift behaviour.
 * - `createNeatConfig({ dnaSharingMode: "aggressive" })` applies the
 *   preset and still satisfies the
 *   `interSpeciesCrossoverThreshold <= geneticCompatibilityThreshold`
 *   invariant.
 * - Explicit user values still win over the preset default.
 * - `KnobTuningStrategy.prepare` stamps a `dnaSharingMode` tag on the
 *   recipient and is idempotent.
 * - Strategy is exported from `@transfer/mod.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  AGGRESSIVE_DNA_SHARING_PRESET,
  DEFAULT_DNA_SHARING_PRESET,
  getDnaSharingPreset,
  KNOB_TUNING_TAG_NAME,
  KnobTuningStrategy,
  readDnaSharingModeTag,
} from "@transfer/mod.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("DnaSharingPreset - default preset matches existing per-knob defaults", () => {
  // The default preset MUST equal the values previously hard-coded in
  // createNeatConfig() so existing user configs do not silently shift.
  assertEquals(DEFAULT_DNA_SHARING_PRESET.diversityBreedingRate, 0);
  assertEquals(DEFAULT_DNA_SHARING_PRESET.interSpeciesCrossoverThreshold, 0.1);
  assertEquals(DEFAULT_DNA_SHARING_PRESET.geneticCompatibilityThreshold, 0.3);
  assertEquals(DEFAULT_DNA_SHARING_PRESET.compatibilityGating.enabled, true);
  assertEquals(DEFAULT_DNA_SHARING_PRESET.compatibilityGating.power, 1.5);
  assertEquals(DEFAULT_DNA_SHARING_PRESET.compatibilityGating.maxDraws, 3);
});

Deno.test("DnaSharingPreset - aggressive preset widens gating and increases diversity", () => {
  const a = AGGRESSIVE_DNA_SHARING_PRESET;
  const d = DEFAULT_DNA_SHARING_PRESET;

  assert(
    a.diversityBreedingRate > d.diversityBreedingRate,
    "aggressive must raise diversityBreedingRate",
  );
  assert(
    a.interSpeciesCrossoverThreshold < d.interSpeciesCrossoverThreshold,
    "aggressive must lower interSpeciesCrossoverThreshold",
  );
  assert(
    a.compatibilityGating.power < d.compatibilityGating.power,
    "aggressive must lower gating power (wider acceptance)",
  );
  assert(
    a.compatibilityGating.maxDraws > d.compatibilityGating.maxDraws,
    "aggressive must raise gating maxDraws",
  );

  // All knobs must remain inside their per-knob bounds.
  assert(a.diversityBreedingRate >= 0 && a.diversityBreedingRate <= 1);
  assert(
    a.interSpeciesCrossoverThreshold >= 0 &&
      a.interSpeciesCrossoverThreshold <= 1,
  );
  assert(
    a.geneticCompatibilityThreshold >= 0 &&
      a.geneticCompatibilityThreshold <= 1,
  );
  assert(a.compatibilityGating.power >= 0);
  assert(
    Number.isInteger(a.compatibilityGating.maxDraws) &&
      a.compatibilityGating.maxDraws >= 1,
  );

  // Cross-field invariant must hold for the preset itself.
  assert(
    a.interSpeciesCrossoverThreshold <= a.geneticCompatibilityThreshold,
    "interSpeciesCrossoverThreshold must be <= geneticCompatibilityThreshold",
  );
});

Deno.test("getDnaSharingPreset - returns the requested preset", () => {
  assertEquals(getDnaSharingPreset("default"), DEFAULT_DNA_SHARING_PRESET);
  assertEquals(
    getDnaSharingPreset("aggressive"),
    AGGRESSIVE_DNA_SHARING_PRESET,
  );
  // Unknown/undefined falls back to default.
  assertEquals(getDnaSharingPreset(undefined), DEFAULT_DNA_SHARING_PRESET);
});

Deno.test("createNeatConfig - default mode preserves existing knob defaults", () => {
  const config = createNeatConfig({});
  assertEquals(config.dnaSharingMode, "default");
  assertEquals(config.diversityBreedingRate, 0);
  assertEquals(config.interSpeciesCrossoverThreshold, 0.1);
  assertEquals(config.geneticCompatibilityThreshold, 0.3);
  assertEquals(config.compatibilityGating.enabled, true);
  assertEquals(config.compatibilityGating.power, 1.5);
  assertEquals(config.compatibilityGating.maxDraws, 3);
});

Deno.test("createNeatConfig - aggressive mode applies the aggressive preset", () => {
  const config = createNeatConfig({ dnaSharingMode: "aggressive" });
  assertEquals(config.dnaSharingMode, "aggressive");
  assertEquals(
    config.diversityBreedingRate,
    AGGRESSIVE_DNA_SHARING_PRESET.diversityBreedingRate,
  );
  assertEquals(
    config.interSpeciesCrossoverThreshold,
    AGGRESSIVE_DNA_SHARING_PRESET.interSpeciesCrossoverThreshold,
  );
  assertEquals(
    config.geneticCompatibilityThreshold,
    AGGRESSIVE_DNA_SHARING_PRESET.geneticCompatibilityThreshold,
  );
  assertEquals(
    config.compatibilityGating.enabled,
    AGGRESSIVE_DNA_SHARING_PRESET.compatibilityGating.enabled,
  );
  assertEquals(
    config.compatibilityGating.power,
    AGGRESSIVE_DNA_SHARING_PRESET.compatibilityGating.power,
  );
  assertEquals(
    config.compatibilityGating.maxDraws,
    AGGRESSIVE_DNA_SHARING_PRESET.compatibilityGating.maxDraws,
  );

  // Cross-field invariant must hold for the assembled config.
  assert(
    config.interSpeciesCrossoverThreshold <=
      config.geneticCompatibilityThreshold,
  );
});

Deno.test("createNeatConfig - explicit user values win over the preset", () => {
  const config = createNeatConfig({
    dnaSharingMode: "aggressive",
    diversityBreedingRate: 0.123,
    compatibilityGating: { power: 2.5 },
  });
  // User values win.
  assertEquals(config.diversityBreedingRate, 0.123);
  assertEquals(config.compatibilityGating.power, 2.5);
  // Unspecified gating fields still come from the aggressive preset.
  assertEquals(
    config.compatibilityGating.maxDraws,
    AGGRESSIVE_DNA_SHARING_PRESET.compatibilityGating.maxDraws,
  );
});

Deno.test("KnobTuningStrategy - aggressive prepare stamps tag on recipient", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 2 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });

  const strategy = new KnobTuningStrategy("aggressive");
  assertEquals(strategy.name, "KnobTuning(aggressive)");
  assertEquals(strategy.mode, "aggressive");

  await strategy.prepare(recipient, donor, { seed: 1, generations: 10 });

  const tag = recipient.tags?.find((t) => t.name === KNOB_TUNING_TAG_NAME);
  assert(tag, "recipient must carry a dnaSharingMode tag after prepare");
  assertEquals(tag?.value, "aggressive");
  assertEquals(readDnaSharingModeTag(recipient), "aggressive");
});

Deno.test("KnobTuningStrategy - prepare is idempotent (single tag, latest value wins)", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 2 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });

  await new KnobTuningStrategy("aggressive").prepare(recipient, donor, {});
  await new KnobTuningStrategy("default").prepare(recipient, donor, {});

  const stamps = (recipient.tags ?? []).filter(
    (t) => t.name === KNOB_TUNING_TAG_NAME,
  );
  assertEquals(stamps.length, 1, "exactly one dnaSharingMode tag must remain");
  assertEquals(stamps[0].value, "default", "latest stamp must win");
});

Deno.test("KnobTuningStrategy - donor is not mutated by prepare", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 2 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });
  const beforeTags = donor.tags ? [...donor.tags] : undefined;

  await new KnobTuningStrategy("aggressive").prepare(recipient, donor, {});

  // Donor must not gain the dnaSharingMode tag.
  const donorStamp = donor.tags?.find((t) => t.name === KNOB_TUNING_TAG_NAME);
  assertEquals(donorStamp, undefined, "donor must not be tagged");
  assertEquals(donor.tags, beforeTags, "donor.tags must be untouched");
});

Deno.test("readDnaSharingModeTag - returns undefined when no tag is set", () => {
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  assertEquals(readDnaSharingModeTag(c), undefined);
});
