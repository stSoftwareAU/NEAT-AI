import { assertEquals, assertNotEquals } from "@std/assert";
import {
  DEFAULT_EVOLVABLE_HYPERPARAMETERS,
  DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
} from "../../src/config/HyperparameterConfig.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("HyperparameterEvolutionConfig - defaults are applied", () => {
  const config = createNeatConfig({});
  assertEquals(
    config.hyperparameterEvolution.enabled,
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.enabled,
  );
  assertEquals(
    config.hyperparameterEvolution.minLearningRate,
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.minLearningRate,
  );
  assertEquals(
    config.hyperparameterEvolution.maxLearningRate,
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.maxLearningRate,
  );
  assertEquals(
    config.hyperparameterEvolution.mutationStdDev,
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.mutationStdDev,
  );
});

Deno.test("HyperparameterEvolutionConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    hyperparameterEvolution: {
      enabled: true,
      minLearningRate: 0.001,
      maxLearningRate: 0.05,
      mutationStdDev: 0.2,
    },
  });
  assertEquals(config.hyperparameterEvolution.enabled, true);
  assertEquals(config.hyperparameterEvolution.minLearningRate, 0.001);
  assertEquals(config.hyperparameterEvolution.maxLearningRate, 0.05);
  assertEquals(config.hyperparameterEvolution.mutationStdDev, 0.2);
  // Non-overridden fields keep defaults
  assertEquals(
    config.hyperparameterEvolution.minWeightPerturbation,
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG.minWeightPerturbation,
  );
});

Deno.test("HyperparameterEvolutionConfig - string coercion for CLI", () => {
  const config = createNeatConfig({
    hyperparameterEvolution: {
      minLearningRate: "0.005" as unknown as number,
      maxLearningRate: "0.08" as unknown as number,
    },
  });
  assertEquals(config.hyperparameterEvolution.minLearningRate, 0.005);
  assertEquals(config.hyperparameterEvolution.maxLearningRate, 0.08);
});

Deno.test("Default evolvable hyperparameters have sensible values", () => {
  const hp = DEFAULT_EVOLVABLE_HYPERPARAMETERS;
  assertEquals(hp.learningRate, 0.01);
  assertEquals(hp.addNeuronRate, 0.1);
  assertEquals(hp.addConnectionRate, 0.2);
  assertEquals(hp.weightPerturbationScale, 1.0);
  assertEquals(hp.l1RegularisationStrength, 0);
  assertEquals(hp.l2RegularisationStrength, 0);
});

Deno.test("HyperparameterEvolutionConfig - disabled by default", () => {
  const config = createNeatConfig({});
  assertEquals(config.hyperparameterEvolution.enabled, false);
});

Deno.test("HyperparameterEvolutionConfig - bounds are consistent", () => {
  const config = createNeatConfig({
    hyperparameterEvolution: {
      enabled: true,
    },
  });
  const hp = config.hyperparameterEvolution;
  // minLearningRate must be less than maxLearningRate
  assertEquals(hp.minLearningRate < hp.maxLearningRate, true);
  // minWeightPerturbation must be less than maxWeightPerturbation
  assertEquals(hp.minWeightPerturbation < hp.maxWeightPerturbation, true);
});

Deno.test("Default hyperparameters are distinct object copies", () => {
  const a = { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS };
  const b = { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS };
  a.learningRate = 0.999;
  assertNotEquals(a.learningRate, b.learningRate);
});
