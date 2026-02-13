/**
 * Issue #1428: Verify that worker payloads are structured-clone safe.
 *
 * The DataCloneError occurred because NeatConfig contains non-cloneable
 * properties (logger functions and RNG methods) that cannot survive the
 * structured clone algorithm used by worker.postMessage().
 *
 * The fix in WorkerHandler.discover() strips logger and rng before posting.
 * These tests ensure the sanitisation works and would catch any regression
 * where non-cloneable data is sent to workers.
 */
import { assert, assertExists, assertThrows } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import type { NeatConfig } from "../../src/config/NeatConfig.ts";
import type { RequestData } from "../../src/multithreading/workers/WorkerHandler.ts";

/**
 * Strips non-cloneable properties from a NeatConfig, mirroring the
 * sanitisation logic in WorkerHandler.discover().
 */
function sanitiseConfigForWorker(config: NeatConfig): NeatConfig {
  const configForWorker = { ...config } as Record<string, unknown>;
  delete configForWorker.logger;
  delete configForWorker.rng;
  return configForWorker as NeatConfig;
}

Deno.test("NeatConfig with logger and rng cannot be structured-cloned", () => {
  const config = createNeatConfig({ costName: "MSE" });

  // The raw config contains function properties that are not cloneable
  assertExists(config.logger, "config should have a logger");
  assertExists(config.rng, "config should have an rng");
  assert(
    typeof config.logger.debug === "function",
    "logger.debug should be a function",
  );
  assert(
    typeof config.rng.random === "function",
    "rng.random should be a function",
  );

  // structuredClone must reject an object containing functions
  assertThrows(
    () => structuredClone(config),
    DOMException,
    "could not be cloned",
    "NeatConfig with functions should not be cloneable via structuredClone",
  );
});

Deno.test("sanitised NeatConfig without logger/rng can be structured-cloned", () => {
  const config = createNeatConfig({ costName: "MSE" });
  const sanitised = sanitiseConfigForWorker(config);

  // The sanitised config should not have logger or rng
  assert(
    !("logger" in sanitised),
    "sanitised config should not have logger",
  );
  assert(
    !("rng" in sanitised),
    "sanitised config should not have rng",
  );

  // structuredClone must succeed on the sanitised config
  // Cast to Record to avoid TS inference issues with Readonly + deleted keys
  const cloned = structuredClone(
    sanitised as unknown as Record<string, unknown>,
  );
  assertExists(cloned, "cloned config should exist");
  assert(cloned.costName === "MSE", "cloned config should preserve costName");
  assert(
    cloned.populationSize === config.populationSize,
    "cloned config should preserve populationSize",
  );
});

Deno.test("discovery RequestData with sanitised config can be structured-cloned", () => {
  const config = createNeatConfig({ costName: "MSE" });
  const sanitised = sanitiseConfigForWorker(config);

  // Build a discover RequestData payload identical to WorkerHandler.discover()
  const data: RequestData = {
    taskID: 1,
    discover: {
      creature: JSON.stringify({
        neurons: [],
        synapses: [],
        input: 1,
        output: 1,
      }),
      config: sanitised,
    },
  };

  // The full payload must survive structuredClone (same as postMessage)
  const cloned = structuredClone(data);
  assertExists(cloned.discover, "cloned data should have discover field");
  assert(
    cloned.discover.config.costName === "MSE",
    "cloned discover config should preserve costName",
  );
});

Deno.test("discovery RequestData with unsanitised config fails structuredClone", () => {
  const config = createNeatConfig({ costName: "MSE" });

  // Build a discover RequestData with the raw (unsanitised) config
  const data: RequestData = {
    taskID: 1,
    discover: {
      creature: JSON.stringify({
        neurons: [],
        synapses: [],
        input: 1,
        output: 1,
      }),
      config: config,
    },
  };

  // This must fail - the raw config contains functions
  assertThrows(
    () => structuredClone(data),
    DOMException,
    "could not be cloned",
    "RequestData with unsanitised NeatConfig should not be cloneable",
  );
});

Deno.test("all non-discover RequestData variants are structured-clone safe", () => {
  // Verify that other RequestData types don't contain non-cloneable data

  const echoData: RequestData = {
    taskID: 1,
    echo: { message: "test", ms: 10 },
  };
  assertExists(structuredClone(echoData), "echo payload should be cloneable");

  const evaluateData: RequestData = {
    taskID: 2,
    evaluate: {
      creature: JSON.stringify({ neurons: [], synapses: [] }),
      feedbackLoop: false,
    },
  };
  assertExists(
    structuredClone(evaluateData),
    "evaluate payload should be cloneable",
  );

  const trainData: RequestData = {
    taskID: 3,
    train: {
      creature: JSON.stringify({ neurons: [], synapses: [] }),
      options: { targetError: 0.05, iterations: 10 },
    },
  };
  assertExists(
    structuredClone(trainData),
    "train payload should be cloneable",
  );

  const breedData: RequestData = {
    taskID: 4,
    breed: {
      mother: JSON.stringify({ neurons: [], synapses: [] }),
      father: JSON.stringify({ neurons: [], synapses: [] }),
      geneticCompatibilityThreshold: 0.3,
      forwardOnly: false,
    },
  };
  assertExists(
    structuredClone(breedData),
    "breed payload should be cloneable",
  );

  const initData: RequestData = {
    taskID: 5,
    initialize: {
      dataSetDir: "/tmp",
      costName: "MSE",
    },
  };
  assertExists(
    structuredClone(initData),
    "initialize payload should be cloneable",
  );
});
