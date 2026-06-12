import { assertEquals, assertThrows } from "@std/assert";
import { DEFAULT_RANDOM_IMMIGRANTS_CONFIG } from "@config/RandomImmigrantsConfig.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("RandomImmigrantsConfig - defaults are applied and OFF by default", () => {
  const config = createNeatConfig({});
  assertEquals(config.randomImmigrants.enabled, false);
  assertEquals(
    config.randomImmigrants.enabled,
    DEFAULT_RANDOM_IMMIGRANTS_CONFIG.enabled,
  );
  assertEquals(
    config.randomImmigrants.injectionFraction,
    DEFAULT_RANDOM_IMMIGRANTS_CONFIG.injectionFraction,
  );
  assertEquals(
    config.randomImmigrants.triggerWindow,
    DEFAULT_RANDOM_IMMIGRANTS_CONFIG.triggerWindow,
  );
  assertEquals(
    config.randomImmigrants.cooldown,
    DEFAULT_RANDOM_IMMIGRANTS_CONFIG.cooldown,
  );
});

Deno.test("RandomImmigrantsConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    randomImmigrants: {
      enabled: true,
      injectionFraction: 0.25,
      triggerWindow: 3,
      cooldown: 7,
    },
  });
  assertEquals(config.randomImmigrants.enabled, true);
  assertEquals(config.randomImmigrants.injectionFraction, 0.25);
  assertEquals(config.randomImmigrants.triggerWindow, 3);
  assertEquals(config.randomImmigrants.cooldown, 7);
});

Deno.test("RandomImmigrantsConfig - partial overrides keep other defaults", () => {
  const config = createNeatConfig({ randomImmigrants: { enabled: true } });
  assertEquals(config.randomImmigrants.enabled, true);
  assertEquals(
    config.randomImmigrants.injectionFraction,
    DEFAULT_RANDOM_IMMIGRANTS_CONFIG.injectionFraction,
  );
  assertEquals(
    config.randomImmigrants.triggerWindow,
    DEFAULT_RANDOM_IMMIGRANTS_CONFIG.triggerWindow,
  );
});

Deno.test("RandomImmigrantsConfig - injectionFraction out of range is rejected", () => {
  assertThrows(() =>
    createNeatConfig({ randomImmigrants: { injectionFraction: 1.5 } })
  );
  assertThrows(() =>
    createNeatConfig({ randomImmigrants: { injectionFraction: -0.1 } })
  );
});

Deno.test("RandomImmigrantsConfig - triggerWindow must be a positive integer", () => {
  assertThrows(() =>
    createNeatConfig({ randomImmigrants: { triggerWindow: 0 } })
  );
  assertThrows(() =>
    createNeatConfig({ randomImmigrants: { triggerWindow: 2.5 } })
  );
});

Deno.test("RandomImmigrantsConfig - cooldown must be a non-negative integer", () => {
  // Zero cooldown is permitted (inject every generation while on plateau).
  const config = createNeatConfig({ randomImmigrants: { cooldown: 0 } });
  assertEquals(config.randomImmigrants.cooldown, 0);
  assertThrows(() => createNeatConfig({ randomImmigrants: { cooldown: -1 } }));
  assertThrows(() => createNeatConfig({ randomImmigrants: { cooldown: 1.5 } }));
});

Deno.test("RandomImmigrantsConfig - enabled with zero injectionFraction is rejected", () => {
  assertThrows(() =>
    createNeatConfig({
      randomImmigrants: { enabled: true, injectionFraction: 0 },
    })
  );
});
