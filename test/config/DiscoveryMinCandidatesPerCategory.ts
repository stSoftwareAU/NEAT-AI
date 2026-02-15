import { assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY } from "../../src/config/NeatConfig.ts";

Deno.test("DiscoveryMinCandidatesPerCategory - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.discoveryMinCandidatesPerCategory.addNeurons,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addNeurons,
  );
  assertEquals(
    config.discoveryMinCandidatesPerCategory.addSynapses,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addSynapses,
  );
  assertEquals(
    config.discoveryMinCandidatesPerCategory.changeSquash,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.changeSquash,
  );
  assertEquals(
    config.discoveryMinCandidatesPerCategory.removeLowImpact,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.removeLowImpact,
  );
});

Deno.test("DiscoveryMinCandidatesPerCategory - default values are sensible", () => {
  assertEquals(DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addNeurons, 1);
  assertEquals(DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addSynapses, 1);
  assertEquals(DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.changeSquash, 1);
  assertEquals(
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.removeLowImpact,
    3,
  );
});

Deno.test("DiscoveryMinCandidatesPerCategory - custom values override defaults", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 5,
      addSynapses: 3,
      changeSquash: 2,
      removeLowImpact: 10,
    },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 5);
  assertEquals(config.discoveryMinCandidatesPerCategory.addSynapses, 3);
  assertEquals(config.discoveryMinCandidatesPerCategory.changeSquash, 2);
  assertEquals(config.discoveryMinCandidatesPerCategory.removeLowImpact, 10);
});

Deno.test("DiscoveryMinCandidatesPerCategory - partial overrides keep other defaults", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      removeLowImpact: 7,
    },
  });
  assertEquals(
    config.discoveryMinCandidatesPerCategory.addNeurons,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addNeurons,
  );
  assertEquals(
    config.discoveryMinCandidatesPerCategory.addSynapses,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.addSynapses,
  );
  assertEquals(
    config.discoveryMinCandidatesPerCategory.changeSquash,
    DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY.changeSquash,
  );
  assertEquals(config.discoveryMinCandidatesPerCategory.removeLowImpact, 7);
});

Deno.test("DiscoveryMinCandidatesPerCategory - string values are parsed from CLI", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: "4" as unknown as number,
      addSynapses: "6" as unknown as number,
      changeSquash: "2" as unknown as number,
      removeLowImpact: "8" as unknown as number,
    },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 4);
  assertEquals(config.discoveryMinCandidatesPerCategory.addSynapses, 6);
  assertEquals(config.discoveryMinCandidatesPerCategory.changeSquash, 2);
  assertEquals(config.discoveryMinCandidatesPerCategory.removeLowImpact, 8);
});

Deno.test("DiscoveryMinCandidatesPerCategory - zero values are allowed", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      addSynapses: 0,
      changeSquash: 0,
      removeLowImpact: 0,
    },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 0);
  assertEquals(config.discoveryMinCandidatesPerCategory.addSynapses, 0);
  assertEquals(config.discoveryMinCandidatesPerCategory.changeSquash, 0);
  assertEquals(config.discoveryMinCandidatesPerCategory.removeLowImpact, 0);
});

Deno.test("DiscoveryMinCandidatesPerCategory - Required type fills all fields", () => {
  const config = createNeatConfig({});
  const cats = config.discoveryMinCandidatesPerCategory;
  // All fields should be defined (not undefined) in the Required type
  assertEquals(typeof cats.addNeurons, "number");
  assertEquals(typeof cats.addSynapses, "number");
  assertEquals(typeof cats.changeSquash, "number");
  assertEquals(typeof cats.removeLowImpact, "number");
});
