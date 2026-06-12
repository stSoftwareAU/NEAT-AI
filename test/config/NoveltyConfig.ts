import { assertEquals, assertThrows } from "@std/assert";
import { DEFAULT_NOVELTY_CONFIG } from "@config/NoveltyConfig.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

Deno.test("NoveltyConfig - defaults are applied and OFF by default", () => {
  const config = createNeatConfig({});
  assertEquals(config.novelty.enabled, false);
  assertEquals(config.novelty.enabled, DEFAULT_NOVELTY_CONFIG.enabled);
  assertEquals(config.novelty.weight, DEFAULT_NOVELTY_CONFIG.weight);
  assertEquals(config.novelty.neighbours, DEFAULT_NOVELTY_CONFIG.neighbours);
  assertEquals(
    config.novelty.archiveLimit,
    DEFAULT_NOVELTY_CONFIG.archiveLimit,
  );
  assertEquals(
    config.novelty.addThreshold,
    DEFAULT_NOVELTY_CONFIG.addThreshold,
  );
  assertEquals(
    config.novelty.behaviourTag,
    DEFAULT_NOVELTY_CONFIG.behaviourTag,
  );
});

Deno.test("NoveltyConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    novelty: {
      enabled: true,
      weight: 0.25,
      neighbours: 7,
      archiveLimit: 100,
      addThreshold: 0.5,
      behaviourTag: "phenotype",
    },
  });
  assertEquals(config.novelty.enabled, true);
  assertEquals(config.novelty.weight, 0.25);
  assertEquals(config.novelty.neighbours, 7);
  assertEquals(config.novelty.archiveLimit, 100);
  assertEquals(config.novelty.addThreshold, 0.5);
  assertEquals(config.novelty.behaviourTag, "phenotype");
});

Deno.test("NoveltyConfig - partial overrides keep other defaults", () => {
  const config = createNeatConfig({ novelty: { enabled: true } });
  assertEquals(config.novelty.enabled, true);
  assertEquals(config.novelty.weight, DEFAULT_NOVELTY_CONFIG.weight);
  assertEquals(
    config.novelty.behaviourTag,
    DEFAULT_NOVELTY_CONFIG.behaviourTag,
  );
});

Deno.test("NoveltyConfig - weight out of range is rejected", () => {
  assertThrows(() => createNeatConfig({ novelty: { weight: 1.5 } }));
  assertThrows(() => createNeatConfig({ novelty: { weight: -0.1 } }));
});

Deno.test("NoveltyConfig - neighbours must be a positive integer", () => {
  assertThrows(() => createNeatConfig({ novelty: { neighbours: 0 } }));
  assertThrows(() => createNeatConfig({ novelty: { neighbours: 1.5 } }));
});

Deno.test("NoveltyConfig - empty behaviourTag falls back to the default", () => {
  const config = createNeatConfig({ novelty: { behaviourTag: "" } });
  assertEquals(
    config.novelty.behaviourTag,
    DEFAULT_NOVELTY_CONFIG.behaviourTag,
  );
});
