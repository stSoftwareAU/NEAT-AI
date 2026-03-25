/**
 * Shared test helper for the "cripple and discover" testing pattern.
 *
 * This utility implements a reusable workflow for discovery scenario tests:
 * 1. Accept a valid "whole" creature representing the ideal state
 * 2. Record expected outputs from the whole creature
 * 3. Accept a "crippled" creature (degraded version)
 * 4. Validate the crippled creature
 * 5. Trace and record activations/errors on the crippled creature
 * 6. Run the discovery process and collect candidates
 * 7. Return results for assertions
 *
 * Uses Australian English throughout (e.g., behaviour, organisation).
 *
 * @module
 */

import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Creature } from "../../src/Creature.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
  type DiscoveryChangeType,
} from "../../src/discovery/DiscoveryCandidates.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { DiscoverRecord } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

/** A single input/output sample for deterministic testing. */
export interface TestSample {
  input: number[];
  expected: number[];
}

/** Configuration for a discovery scenario test run. */
export interface DiscoveryScenarioConfig {
  /** The whole (ideal) creature JSON definition. */
  wholeCreatureJSON: CreatureExport;

  /** The crippled (degraded) creature JSON definition. */
  crippledCreatureJSON: CreatureExport;

  /**
   * Deterministic test samples. Use explicit values for reproducibility.
   * Each sample has input and expected output arrays.
   */
  samples: TestSample[];

  /**
   * The discovery result from the Rust FFI (or a mock).
   * When provided, candidates are built from this result.
   */
  discoveryResult?: DiscoverResult;

  /**
   * Optional: the discovery change type(s) expected to be found.
   * Used by the convenience assertion helper.
   */
  expectedDiscoveryTypes?: DiscoveryChangeType[];
}

/** Results from running a discovery scenario. */
export interface DiscoveryScenarioResult {
  /** The validated whole creature instance. */
  wholeCreature: Creature;

  /** The validated crippled creature instance. */
  crippledCreature: Creature;

  /** Outputs from activating the whole creature with each sample. */
  wholeOutputs: Float32Array[];

  /** Outputs from activating the crippled creature with each sample. */
  crippledOutputs: Float32Array[];

  /**
   * Accumulated discovery record maps from tracing the crippled creature.
   * One map per sample, keyed by neuron ID.
   */
  recordMaps: Map<number, DiscoverRecord>[];

  /**
   * Discovery candidates built from the discovery result.
   * Empty if no discoveryResult was provided.
   */
  candidates: DiscoveryCandidate[];
}

/**
 * Create a SparseConfig that traces all neurons (100% sparse ratio).
 *
 * This configuration is used for discovery recording where every neuron
 * needs to be traced to capture complete error/activation data.
 */
export function traceAllConfig(creature: Creature): SparseConfig {
  const config = createBackPropagationConfig({
    sparseRatio: 1,
    disableRandomSamples: true,
    generations: 0,
  });
  return new SparseConfig(creature.exportJSON(), config);
}

/**
 * Run the full cripple-and-discover scenario.
 *
 * This is the main entry point for discovery scenario tests. It:
 * 1. Creates and validates both the whole and crippled creatures
 * 2. Activates the whole creature to record baseline outputs
 * 3. Traces and records the crippled creature to capture error data
 * 4. Optionally builds discovery candidates from a provided result
 *
 * @param config - The scenario configuration
 * @returns The scenario results for assertion
 */
export function runDiscoveryScenario(
  config: DiscoveryScenarioConfig,
): DiscoveryScenarioResult {
  // Step 1: Create and validate the whole creature
  const wholeCreature = Creature.fromJSON(config.wholeCreatureJSON);
  wholeCreature.validate();
  CreatureUtil.makeUUID(wholeCreature);

  // Step 2: Record expected outputs from the whole creature
  const wholeOutputs: Float32Array[] = [];
  for (const sample of config.samples) {
    const input = new Float32Array(sample.input);
    const output = wholeCreature.activate(input);
    wholeOutputs.push(output);
  }

  // Step 3: Create and validate the crippled creature
  const crippledCreature = Creature.fromJSON(config.crippledCreatureJSON);
  crippledCreature.validate();
  CreatureUtil.makeUUID(crippledCreature);

  // Step 4: Trace and record the crippled creature
  const sparseConfig = traceAllConfig(crippledCreature);
  const crippledOutputs: Float32Array[] = [];
  const recordMaps: Map<number, DiscoverRecord>[] = [];

  for (const sample of config.samples) {
    const input = new Float32Array(sample.input);
    const expected = new Float32Array(sample.expected);

    crippledCreature.activateAndTrace(input, false, sparseConfig);
    crippledOutputs.push(crippledCreature.activate(input));

    const discoverMap = crippledCreature.record(expected);
    recordMaps.push(discoverMap);
  }

  // Step 5: Build discovery candidates if a result was provided
  let candidates: DiscoveryCandidate[] = [];
  if (config.discoveryResult) {
    candidates = buildDiscoveryCandidates(
      crippledCreature,
      config.discoveryResult,
    );
  }

  return {
    wholeCreature,
    crippledCreature,
    wholeOutputs,
    crippledOutputs,
    recordMaps,
    candidates,
  };
}

/**
 * Assert that the crippled creature produces different (worse) outputs
 * compared to the whole creature for at least one sample.
 *
 * This confirms the cripple actually degraded performance.
 *
 * @param result - The scenario result to check
 * @param tolerance - Maximum difference to consider outputs "equal" (default 1e-10)
 */
export function assertCrippleDegraded(
  result: DiscoveryScenarioResult,
  tolerance = 1e-10,
): void {
  let hasDifference = false;

  for (let i = 0; i < result.wholeOutputs.length; i++) {
    const wholeOut = result.wholeOutputs[i];
    const crippledOut = result.crippledOutputs[i];

    for (let j = 0; j < wholeOut.length; j++) {
      if (Math.abs(wholeOut[j] - crippledOut[j]) > tolerance) {
        hasDifference = true;
        break;
      }
    }
    if (hasDifference) break;
  }

  assert(
    hasDifference,
    "Crippled creature should produce different outputs from the whole creature",
  );
}

/**
 * Assert that specific discovery change types were found in the candidates.
 *
 * @param candidates - The discovery candidates to search
 * @param expectedTypes - The change types expected to be present
 */
export function assertDiscoveryTypesFound(
  candidates: DiscoveryCandidate[],
  expectedTypes: DiscoveryChangeType[],
): void {
  const foundTypes = new Set(candidates.map((c) => c.change.type));

  for (const expectedType of expectedTypes) {
    assert(
      foundTypes.has(expectedType),
      `Expected discovery type "${expectedType}" not found in candidates. ` +
        `Found types: [${[...foundTypes].join(", ")}]`,
    );
  }
}

/**
 * Assert that the crippled creature has recorded errors for at least one neuron.
 *
 * This verifies the tracing and recording pipeline captured meaningful data.
 *
 * @param recordMaps - The record maps from the scenario result
 */
export function assertRecordingCaptured(
  recordMaps: Map<number, DiscoverRecord>[],
): void {
  let hasErrors = false;

  for (const recordMap of recordMaps) {
    for (const record of recordMap.values()) {
      if (record.errors.length > 0) {
        hasErrors = true;
        break;
      }
    }
    if (hasErrors) break;
  }

  assert(
    hasErrors,
    "Expected at least one neuron to have recorded errors during tracing",
  );
}

/**
 * Create a skip reason message for tests that fail due to NEAT-AI-Discovery limitations.
 *
 * Use this with Deno.test's `ignore` option to skip tests that depend on
 * discovery behaviour not yet supported by the Rust FFI extension.
 *
 * @param issueNumber - The NEAT-AI-Discovery GitHub issue number
 * @param description - Brief description of the limitation
 * @returns A formatted skip reason string
 *
 * @example
 * ```ts
 * Deno.test({
 *   name: "discovery finds missing synapse",
 *   ignore: true, // See: discoverySkipReason(42, "synapse discovery not yet implemented")
 *   fn() { ... },
 * });
 * ```
 */
export function discoverySkipReason(
  issueNumber: number,
  description: string,
): string {
  return `NEAT-AI-Discovery limitation: ${description} ` +
    `(see https://github.com/stSoftwareAU/NEAT-AI-Discovery/issues/${issueNumber})`;
}
