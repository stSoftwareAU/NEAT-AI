/**
 * NeatConfigValidation.ts - Cross-field validation for NEAT configuration.
 *
 * Extracted from NeatConfig.ts (Issue #1599) to keep the configuration
 * factory under 500 lines and validation logic focused.
 */

import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { getLogger } from "@utils/Logger.ts";
import type { NeatArguments } from "@config/NeatArguments.ts";

/**
 * Validates cross-field relationships in the NEAT configuration.
 *
 * This validation runs after all individual fields have been parsed
 * and their ranges validated. It catches combinations that are
 * individually valid but mutually inconsistent.
 */
export function validateNeatConfig(config: NeatArguments): void {
  // Issue #1614: elitism must be strictly less than populationSize
  if (config.elitism >= config.populationSize) {
    throw new ConfigurationError(
      `elitism must be less than populationSize. ` +
        `elitism: ${config.elitism}, populationSize: ${config.populationSize}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Cross-field validation for memory monitoring config
  if (config.memory.criticalThreshold < config.memory.warningThreshold) {
    throw new ConfigurationError(
      `Memory criticalThreshold must be >= warningThreshold. ` +
        `criticalThreshold: ${config.memory.criticalThreshold}, ` +
        `warningThreshold: ${config.memory.warningThreshold}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Cross-field validation for worker thread cap config
  if (config.workerThreadCap.maxMemoryMB > 0) {
    const estimatedUsage = config.threads *
      config.workerThreadCap.estimatedMemoryPerWorkerMB;
    if (estimatedUsage > config.workerThreadCap.maxMemoryMB) {
      getLogger().warn(
        `[NEAT-AI] Warning: threads (${config.threads}) * estimatedMemoryPerWorkerMB ` +
          `(${config.workerThreadCap.estimatedMemoryPerWorkerMB}) = ${estimatedUsage} MB ` +
          `exceeds maxMemoryMB (${config.workerThreadCap.maxMemoryMB})`,
      );
    }
  }

  // Cross-field validation for quantum step config
  if (config.quantumStep.maxStep < config.quantumStep.minStep) {
    throw new ConfigurationError(
      `Quantum step maxStep must be >= minStep. ` +
        `maxStep: ${config.quantumStep.maxStep}, minStep: ${config.quantumStep.minStep}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Cross-field validation for fine-tune population config
  if (
    config.fineTunePopulation.maxPopulationFraction <
      config.fineTunePopulation.minPopulationFraction
  ) {
    throw new ConfigurationError(
      `Fine-tune population maxPopulationFraction must be >= minPopulationFraction. ` +
        `maxPopulationFraction: ${config.fineTunePopulation.maxPopulationFraction}, ` +
        `minPopulationFraction: ${config.fineTunePopulation.minPopulationFraction}`,
      "CROSS_FIELD_VALIDATION",
    );
  }
  if (
    config.fineTunePopulation.basePopulationFraction <
      config.fineTunePopulation.minPopulationFraction
  ) {
    throw new ConfigurationError(
      `Fine-tune population basePopulationFraction must be >= minPopulationFraction. ` +
        `basePopulationFraction: ${config.fineTunePopulation.basePopulationFraction}, ` +
        `minPopulationFraction: ${config.fineTunePopulation.minPopulationFraction}`,
      "CROSS_FIELD_VALIDATION",
    );
  }
  if (
    config.fineTunePopulation.basePopulationFraction >
      config.fineTunePopulation.maxPopulationFraction
  ) {
    throw new ConfigurationError(
      `Fine-tune population basePopulationFraction must be <= maxPopulationFraction. ` +
        `basePopulationFraction: ${config.fineTunePopulation.basePopulationFraction}, ` +
        `maxPopulationFraction: ${config.fineTunePopulation.maxPopulationFraction}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Cross-field validation for disk space config (Issue #1703)
  if (
    config.discoveryDiskSpace.criticalFreeDiskMB >
      config.discoveryDiskSpace.minFreeDiskMB
  ) {
    throw new ConfigurationError(
      `Disk space criticalFreeDiskMB must be <= minFreeDiskMB. ` +
        `criticalFreeDiskMB: ${config.discoveryDiskSpace.criticalFreeDiskMB}, ` +
        `minFreeDiskMB: ${config.discoveryDiskSpace.minFreeDiskMB}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Issue #2175: Inter-species crossover threshold must not exceed genetic compatibility threshold
  if (
    config.interSpeciesCrossoverThreshold >
      config.geneticCompatibilityThreshold
  ) {
    throw new ConfigurationError(
      `interSpeciesCrossoverThreshold must be <= geneticCompatibilityThreshold. ` +
        `interSpeciesCrossoverThreshold: ${config.interSpeciesCrossoverThreshold}, ` +
        `geneticCompatibilityThreshold: ${config.geneticCompatibilityThreshold}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Issue #2199: MCMC cross-field validation — minTemperature must not exceed initialTemperature
  if (config.mcmc.minTemperature > config.mcmc.initialTemperature) {
    throw new ConfigurationError(
      `MCMC minTemperature must be <= initialTemperature. ` +
        `minTemperature: ${config.mcmc.minTemperature}, ` +
        `initialTemperature: ${config.mcmc.initialTemperature}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Feedback loop validation
  if (config.feedbackLoop === true && config.disableRandomSamples === false) {
    throw new ConfigurationError(
      "Feedback Loop, Disable Random Samples must be set together",
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Adaptive mutation threshold ordering
  const adaptiveThresholds = config.adaptiveMutationThresholds;
  if (
    adaptiveThresholds.large <= adaptiveThresholds.medium
  ) {
    throw new ConfigurationError(
      `Adaptive mutation large threshold must be greater than medium threshold. ` +
        `Large: ${adaptiveThresholds.large}, Medium: ${adaptiveThresholds.medium}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Plateau detection rate ordering
  const plateauDetection = config.plateauDetection;
  if (
    plateauDetection.rapidImprovementRate <=
      plateauDetection.minImprovementRate
  ) {
    throw new ConfigurationError(
      `Plateau detection rapidImprovementRate must be greater than minImprovementRate. ` +
        `rapidImprovementRate: ${plateauDetection.rapidImprovementRate}, minImprovementRate: ${plateauDetection.minImprovementRate}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Issue #1620: Output range constraint validation
  for (let i = 0; i < config.outputRanges.length; i++) {
    const range = config.outputRanges[i];
    if (range.max < range.min) {
      throw new ConfigurationError(
        `Output range [${i}]: max must be >= min. ` +
          `min: ${range.min}, max: ${range.max}`,
        "CROSS_FIELD_VALIDATION",
      );
    }
    if (range.penaltyWeight < 0) {
      throw new ConfigurationError(
        `Output range [${i}]: penaltyWeight must be >= 0. ` +
          `penaltyWeight: ${range.penaltyWeight}`,
        "CROSS_FIELD_VALIDATION",
      );
    }
  }

  // Issue #2199: MCMC cross-field validation
  if (config.mcmc.minTemperature > config.mcmc.initialTemperature) {
    throw new ConfigurationError(
      `MCMC minTemperature must be <= initialTemperature. ` +
        `minTemperature: ${config.mcmc.minTemperature}, ` +
        `initialTemperature: ${config.mcmc.initialTemperature}`,
      "CROSS_FIELD_VALIDATION",
    );
  }

  // Discovery focus neuron UUID validation
  if (!Array.isArray(config.discoveryFocusNeuronUUIDs)) {
    throw new ConfigurationError(
      "Discovery focus neuron UUIDs must be an array when provided.",
      "INVALID_TYPE",
    );
  }
  for (const uuid of config.discoveryFocusNeuronUUIDs) {
    if (typeof uuid !== "number" || !Number.isInteger(uuid)) {
      throw new ConfigurationError(
        `Discovery focus neuron IDs must be integers, found: ${String(uuid)}`,
        "INVALID_TYPE",
      );
    }
  }
}
