import { assertEquals, fail } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY,
} from "../../src/config/NeatConfig.ts";
import { Selection } from "../../mod.ts";

Deno.test("NeatConfig debug", () => {
  const config = createNeatConfig({ debug: true });
  assertEquals(config.debug, true);
  const config2 = createNeatConfig({ debug: false });
  assertEquals(config2.debug, false);
});

Deno.test("NeatConfig mutationAmount", () => {
  try {
    createNeatConfig({ mutationAmount: -2 });
    fail("Should not reach here");
  } // deno-lint-ignore no-empty
  catch (_e) {
  }
});

Deno.test("NeatConfig selection", () => {
  const config = createNeatConfig({
    selection: Selection.FITNESS_PROPORTIONATE,
  });
  assertEquals(config.selection, Selection.FITNESS_PROPORTIONATE);
});

Deno.test("NeatConfig verbose", () => {
  const config = createNeatConfig({ verbose: true });
  assertEquals(config.verbose, true);
});

Deno.test("NeatConfig discoveryMinCandidatesPerCategory defaults", () => {
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

Deno.test("NeatConfig discoveryMinCandidatesPerCategory partial override", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      removeLowImpact: 10,
    },
  });
  // Custom value should be used
  assertEquals(
    config.discoveryMinCandidatesPerCategory.removeLowImpact,
    10,
  );
  // Other values should use defaults
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
});

Deno.test("NeatConfig discoveryMinCandidatesPerCategory full override", () => {
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

Deno.test("NeatConfig discoveryMinCandidatesPerCategory validation - negative addNeurons", () => {
  try {
    createNeatConfig({
      discoveryMinCandidatesPerCategory: {
        addNeurons: -1,
      },
    });
    fail("Should throw for negative addNeurons");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("addNeurons"),
      true,
      `Error should mention addNeurons: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfig discoveryMinCandidatesPerCategory validation - negative removeLowImpact", () => {
  try {
    createNeatConfig({
      discoveryMinCandidatesPerCategory: {
        removeLowImpact: -5,
      },
    });
    fail("Should throw for negative removeLowImpact");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("removeLowImpact"),
      true,
      `Error should mention removeLowImpact: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfig discoveryMinCandidatesPerCategory allows zero values", () => {
  const config = createNeatConfig({
    discoveryMinCandidatesPerCategory: {
      addNeurons: 0,
      removeLowImpact: 0,
    },
  });
  assertEquals(config.discoveryMinCandidatesPerCategory.addNeurons, 0);
  assertEquals(config.discoveryMinCandidatesPerCategory.removeLowImpact, 0);
});
