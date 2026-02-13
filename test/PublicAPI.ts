/**
 * Issue #1401: Verify the public API surface exported from mod.ts.
 *
 * This test ensures every symbol documented in docs/API_REFERENCE.md is
 * actually exported and usable. It exercises real code (constructors,
 * static methods, constants) rather than grepping documentation text.
 */
import { assert, assertEquals } from "@std/assert";

import {
  Costs,
  createConsoleLogger,
  createSeededRng,
  createUnseededRng,
  Creature,
  CreatureUtil,
  CRISPR,
  DEFAULT_PLATEAU_DETECTION,
  fetchWasmForWorkers,
  formatErrorDelta,
  formatPercentWithSignificantDigits,
  getLogger,
  getRandomNumberGenerator,
  Mutation,
  PlateauDetector,
  randomConnectMissing,
  Selection,
  setLogger,
  setRandomNumberGenerator,
  SILENT_LOGGER,
  Upgrade,
  upgradeTwo,
} from "../mod.ts";

import type {
  CostInterface,
  CreatureExport,
  Logger,
  LogLevel,
  NeatOptions,
  NeuronExport,
  RandomNumberGenerator,
  RequiredPlateauDetectionConfig,
  SynapseExport,
} from "../mod.ts";

Deno.test("Public API: Creature constructor creates valid network", () => {
  const creature = new Creature(2, 1);
  assertEquals(creature.input, 2);
  assertEquals(creature.output, 1);
  assert(creature.neurons.length > 0, "Should have neurons");
  assert(creature.synapses.length > 0, "Should have synapses");
});

Deno.test("Public API: Creature.fromJSON round-trips", () => {
  const original = new Creature(3, 2);
  const json: CreatureExport = original.exportJSON();
  assertEquals(json.input, 3);
  assertEquals(json.output, 2);
  assert(Array.isArray(json.neurons), "Should have neurons array");
  assert(Array.isArray(json.synapses), "Should have synapses array");

  const restored = Creature.fromJSON(json);
  assertEquals(restored.input, 3);
  assertEquals(restored.output, 2);
});

Deno.test("Public API: Creature.activate produces output", () => {
  const creature = new Creature(2, 1);
  const input = new Float32Array([0.5, 0.5]);
  const output = creature.activate(input);
  assertEquals(output.length, 1, "Should produce one output");
  assert(isFinite(output[0]), "Output should be finite");
});

Deno.test("Public API: CreatureUtil is exported", () => {
  assert(CreatureUtil !== undefined);
});

Deno.test("Public API: CRISPR constructor works", () => {
  const creature = new Creature(2, 1);
  const crispr = new CRISPR(creature);
  assert(crispr !== undefined);
});

Deno.test("Public API: Costs.find returns built-in cost functions", () => {
  const costNames = ["MSE", "MAE", "MAPE", "MSLE", "CROSS_ENTROPY", "HINGE"];
  for (const name of costNames) {
    const cost: CostInterface = Costs.find(name);
    assertEquals(cost.getName(), name);
  }
});

Deno.test("Public API: Costs.getAvailableCosts lists all built-in costs", () => {
  const available = Costs.getAvailableCosts();
  assert(available.length >= 6, "Should have at least 6 built-in costs");
  assert(available.includes("MSE"));
  assert(available.includes("CROSS_ENTROPY"));
});

Deno.test("Public API: Selection strategies are exported", () => {
  assertEquals(Selection.FITNESS_PROPORTIONATE.name, "FITNESS_PROPORTIONATE");
  assertEquals(Selection.POWER.name, "POWER");
  assertEquals(Selection.POWER.power, 4);
  assertEquals(Selection.TOURNAMENT.name, "TOURNAMENT");
  assertEquals(Selection.TOURNAMENT.size, 5);
});

Deno.test("Public API: Mutation types are exported", () => {
  assertEquals(Mutation.ADD_NODE.name, "ADD_NODE");
  assertEquals(Mutation.SUB_NODE.name, "SUB_NODE");
  assertEquals(Mutation.ADD_CONN.name, "ADD_CONN");
  assertEquals(Mutation.MOD_WEIGHT.name, "MOD_WEIGHT");
  assertEquals(Mutation.MOD_BIAS.name, "MOD_BIAS");
  assertEquals(Mutation.MOD_SQUASH.name, "MOD_SQUASH");
  assert(Array.isArray(Mutation.FFW), "FFW should be an array of mutations");
  assert(Array.isArray(Mutation.ALL), "ALL should be an array of mutations");
  assert(
    Mutation.ALL.length > Mutation.FFW.length,
    "ALL should include more mutations than FFW",
  );
});

Deno.test("Public API: PlateauDetector works with defaults", () => {
  const config: RequiredPlateauDetectionConfig = DEFAULT_PLATEAU_DETECTION;
  assertEquals(config.windowSize, 10);
  assertEquals(config.enabled, false);

  const detector = new PlateauDetector({
    ...config,
    enabled: true,
  });
  detector.recordFitness(-1.0);
  detector.recordFitness(-0.9);
  assert(typeof detector.isOnPlateau() === "boolean");
  assert(typeof detector.getMutationMultiplier() === "number");
});

Deno.test("Public API: Logger API is functional", () => {
  const logger: Logger = getLogger();
  assert(logger !== undefined);
  assert(typeof logger.info === "function");
  assert(typeof logger.warn === "function");
  assert(typeof logger.error === "function");
  assert(typeof logger.debug === "function");

  // SILENT_LOGGER should not throw
  SILENT_LOGGER.info("test");
  SILENT_LOGGER.warn("test");
  SILENT_LOGGER.error("test");
  SILENT_LOGGER.debug("test");

  const customLogger = createConsoleLogger("warn" as LogLevel);
  assert(customLogger !== undefined);

  // Restore default
  setLogger(createConsoleLogger("info"));
});

Deno.test("Public API: RandomNumberGenerator is functional", () => {
  const rng: RandomNumberGenerator = getRandomNumberGenerator();
  assert(typeof rng.random === "function");
  const val = rng.random();
  assert(val >= 0 && val < 1, "random() should return [0, 1)");

  // Seeded RNG is deterministic
  const seeded1 = createSeededRng(42);
  const seeded2 = createSeededRng(42);
  assertEquals(seeded1.random(), seeded2.random());
  assertEquals(seeded1.seeded, true);

  // Unseeded RNG
  const unseeded = createUnseededRng();
  assertEquals(unseeded.seeded, false);

  // Restore
  setRandomNumberGenerator(createUnseededRng());
});

Deno.test("Public API: Upgrade class is exported", () => {
  assert(Upgrade !== undefined);
  assert(typeof Upgrade.correct === "function");
});

Deno.test("Public API: upgradeTwo function is exported", () => {
  assert(typeof upgradeTwo === "function");
});

Deno.test("Public API: randomConnectMissing is exported", () => {
  assert(typeof randomConnectMissing === "function");
});

Deno.test("Public API: Discovery formatting utilities are exported", () => {
  assert(typeof formatErrorDelta === "function");
  assert(typeof formatPercentWithSignificantDigits === "function");

  // Exercise the functions with real data
  const delta = formatErrorDelta(0.05);
  assert(typeof delta === "string");
});

Deno.test("Public API: fetchWasmForWorkers is exported", () => {
  assert(typeof fetchWasmForWorkers === "function");
});

Deno.test("Public API: NeatOptions type supports key fields", () => {
  // Verify NeatOptions type is usable with key configuration
  const options: NeatOptions = {
    costName: "MSE",
    populationSize: 100,
    iterations: 500,
    mutationRate: 0.3,
    elitism: 0.2,
    threads: 1,
    targetError: 0.01,
  };

  assertEquals(options.costName, "MSE");
  assertEquals(options.populationSize, 100);
});

Deno.test("Public API: CreatureExport type has expected shape", () => {
  const creature = new Creature(2, 1);
  const json: CreatureExport = creature.exportJSON();

  // Verify the export shape matches the documented interface
  assert(typeof json.input === "number");
  assert(typeof json.output === "number");
  assert(Array.isArray(json.neurons));
  assert(Array.isArray(json.synapses));

  // Check neuron shape
  const neuron: NeuronExport = json.neurons[0];
  assert(typeof neuron.uuid === "string");
  assert(typeof neuron.type === "string");
  assert(typeof neuron.bias === "number");

  // Check synapse shape
  if (json.synapses.length > 0) {
    const synapse: SynapseExport = json.synapses[0];
    assert(typeof synapse.fromUUID === "string");
    assert(typeof synapse.toUUID === "string");
    assert(typeof synapse.weight === "number");
  }
});
