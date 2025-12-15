import { assertEquals, fail } from "@std/assert";
import {
  createNeatConfig,
  DEFAULT_DISCOVERY_MIN_CANDIDATES_PER_CATEGORY,
  MAX_ANALYSIS_TIMEOUT_MINUTES,
  MIN_ANALYSIS_TIMEOUT_MINUTES,
} from "../../src/config/NeatConfig.ts";
import { DEFAULT_RUST_FLUSH_BYTES } from "../../src/architecture/ErrorGuidedStructuralEvolution/constants.ts";
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

Deno.test("NeatConfig discoveryRustFlushBytes defaults", () => {
  const config = createNeatConfig({});
  assertEquals(config.discoveryRustFlushBytes, DEFAULT_RUST_FLUSH_BYTES);
});

Deno.test("NeatConfig discoveryRustFlushBytes validation - non-positive throws", () => {
  try {
    createNeatConfig({ discoveryRustFlushBytes: 0 });
    fail("Should throw for non-positive discoveryRustFlushBytes");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Discovery Rust Flush Bytes"),
      true,
      `Error should mention the field name: ${(e as Error).message}`,
    );
  }
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

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - valid at minimum bound", () => {
  const config = createNeatConfig({
    discoveryAnalysisTimeoutMinutes: MIN_ANALYSIS_TIMEOUT_MINUTES,
  });
  assertEquals(
    config.discoveryAnalysisTimeoutMinutes,
    MIN_ANALYSIS_TIMEOUT_MINUTES,
  );
});

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - valid at maximum bound", () => {
  const config = createNeatConfig({
    discoveryAnalysisTimeoutMinutes: MAX_ANALYSIS_TIMEOUT_MINUTES,
  });
  assertEquals(
    config.discoveryAnalysisTimeoutMinutes,
    MAX_ANALYSIS_TIMEOUT_MINUTES,
  );
});

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - valid within bounds", () => {
  const config = createNeatConfig({
    discoveryAnalysisTimeoutMinutes: 10,
  });
  assertEquals(config.discoveryAnalysisTimeoutMinutes, 10);
});

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - below minimum throws", () => {
  try {
    createNeatConfig({
      discoveryAnalysisTimeoutMinutes: 0.01, // Below 0.05 (3 seconds)
    });
    fail("Should throw for timeout below minimum");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes(String(MIN_ANALYSIS_TIMEOUT_MINUTES)),
      true,
      `Error should mention minimum bound: ${(e as Error).message}`,
    );
    assertEquals(
      (e as Error).message.includes(String(MAX_ANALYSIS_TIMEOUT_MINUTES)),
      true,
      `Error should mention maximum bound: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - above maximum throws", () => {
  try {
    createNeatConfig({
      discoveryAnalysisTimeoutMinutes: 61, // Above 60 (1 hour)
    });
    fail("Should throw for timeout above maximum");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes(String(MIN_ANALYSIS_TIMEOUT_MINUTES)),
      true,
      `Error should mention minimum bound: ${(e as Error).message}`,
    );
    assertEquals(
      (e as Error).message.includes(String(MAX_ANALYSIS_TIMEOUT_MINUTES)),
      true,
      `Error should mention maximum bound: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - zero throws", () => {
  try {
    createNeatConfig({
      discoveryAnalysisTimeoutMinutes: 0,
    });
    fail("Should throw for zero timeout");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Discovery Analysis Timeout Minutes"),
      true,
      `Error should mention the field name: ${(e as Error).message}`,
    );
  }
});

Deno.test("NeatConfig discoveryAnalysisTimeoutMinutes - negative throws", () => {
  try {
    createNeatConfig({
      discoveryAnalysisTimeoutMinutes: -5,
    });
    fail("Should throw for negative timeout");
  } catch (e) {
    assertEquals(
      (e as Error).message.includes("Discovery Analysis Timeout Minutes"),
      true,
      `Error should mention the field name: ${(e as Error).message}`,
    );
  }
});
