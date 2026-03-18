import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_EVOLVABLE_HYPERPARAMETERS,
  DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
} from "../../src/config/HyperparameterConfig.ts";
import {
  computeSpeciesDiversity,
  createDefaultHyperparameters,
  crossoverHyperparameters,
  mutateHyperparameters,
} from "../../src/NEAT/HyperparameterEvolution.ts";

const enabledConfig = {
  ...DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
  enabled: true,
};

Deno.test("createDefaultHyperparameters - returns defaults when disabled", () => {
  const hp = createDefaultHyperparameters(
    DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
  );
  assertEquals(hp.learningRate, DEFAULT_EVOLVABLE_HYPERPARAMETERS.learningRate);
  assertEquals(
    hp.addNeuronRate,
    DEFAULT_EVOLVABLE_HYPERPARAMETERS.addNeuronRate,
  );
  assertEquals(
    hp.addConnectionRate,
    DEFAULT_EVOLVABLE_HYPERPARAMETERS.addConnectionRate,
  );
});

Deno.test("createDefaultHyperparameters - adds variation when enabled", () => {
  // Generate multiple and check at least one differs
  const results = Array.from(
    { length: 20 },
    () => createDefaultHyperparameters(enabledConfig),
  );
  const uniqueLRs = new Set(results.map((r) => r.learningRate));
  // With random variation, we expect multiple distinct values
  assert(uniqueLRs.size > 1, "Expected variation in learning rates");
});

Deno.test("createDefaultHyperparameters - values within bounds", () => {
  for (let i = 0; i < 50; i++) {
    const hp = createDefaultHyperparameters(enabledConfig);
    assert(
      hp.learningRate >= enabledConfig.minLearningRate,
      `learningRate ${hp.learningRate} below min`,
    );
    assert(
      hp.learningRate <= enabledConfig.maxLearningRate,
      `learningRate ${hp.learningRate} above max`,
    );
    assert(hp.addNeuronRate >= 0, "addNeuronRate below 0");
    assert(hp.addNeuronRate <= 1, "addNeuronRate above 1");
    assert(hp.addConnectionRate >= 0, "addConnectionRate below 0");
    assert(hp.addConnectionRate <= 1, "addConnectionRate above 1");
    assert(
      hp.weightPerturbationScale >= enabledConfig.minWeightPerturbation,
      "weightPerturbationScale below min",
    );
    assert(
      hp.weightPerturbationScale <= enabledConfig.maxWeightPerturbation,
      "weightPerturbationScale above max",
    );
    assert(
      hp.l1RegularisationStrength >= 0,
      "l1RegularisationStrength below 0",
    );
    assert(
      hp.l1RegularisationStrength <= enabledConfig.maxRegularisationStrength,
      "l1RegularisationStrength above max",
    );
    assert(
      hp.l2RegularisationStrength >= 0,
      "l2RegularisationStrength below 0",
    );
    assert(
      hp.l2RegularisationStrength <= enabledConfig.maxRegularisationStrength,
      "l2RegularisationStrength above max",
    );
  }
});

Deno.test("mutateHyperparameters - produces different values", () => {
  const original = { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS };
  let anyDifferent = false;
  for (let i = 0; i < 50; i++) {
    const mutated = mutateHyperparameters(original, enabledConfig);
    if (mutated.learningRate !== original.learningRate) {
      anyDifferent = true;
      break;
    }
  }
  assert(anyDifferent, "Expected at least one mutation to differ");
});

Deno.test("mutateHyperparameters - values stay within bounds", () => {
  const hp = { ...DEFAULT_EVOLVABLE_HYPERPARAMETERS };
  for (let i = 0; i < 100; i++) {
    const mutated = mutateHyperparameters(hp, enabledConfig);
    assert(
      mutated.learningRate >= enabledConfig.minLearningRate,
      `learningRate ${mutated.learningRate} below min`,
    );
    assert(
      mutated.learningRate <= enabledConfig.maxLearningRate,
      `learningRate ${mutated.learningRate} above max`,
    );
    assert(mutated.addNeuronRate >= 0, "addNeuronRate below 0");
    assert(mutated.addNeuronRate <= 1, "addNeuronRate above 1");
    assert(mutated.addConnectionRate >= 0, "addConnectionRate below 0");
    assert(mutated.addConnectionRate <= 1, "addConnectionRate above 1");
    assert(
      mutated.weightPerturbationScale >= enabledConfig.minWeightPerturbation,
      "weightPerturbationScale below min",
    );
    assert(
      mutated.weightPerturbationScale <= enabledConfig.maxWeightPerturbation,
      "weightPerturbationScale above max",
    );
    assert(
      mutated.l1RegularisationStrength >= 0,
      "l1RegularisationStrength below 0",
    );
    assert(
      mutated.l1RegularisationStrength <=
        enabledConfig.maxRegularisationStrength,
      "l1RegularisationStrength above max",
    );
    assert(
      mutated.l2RegularisationStrength >= 0,
      "l2RegularisationStrength below 0",
    );
    assert(
      mutated.l2RegularisationStrength <=
        enabledConfig.maxRegularisationStrength,
      "l2RegularisationStrength above max",
    );
  }
});

Deno.test("crossoverHyperparameters - blends parent values", () => {
  const mother = {
    learningRate: 0.01,
    addNeuronRate: 0.1,
    addConnectionRate: 0.2,
    weightPerturbationScale: 1.0,
    l1RegularisationStrength: 0.05,
    l2RegularisationStrength: 0.08,
  };
  const father = {
    learningRate: 0.05,
    addNeuronRate: 0.3,
    addConnectionRate: 0.4,
    weightPerturbationScale: 1.5,
    l1RegularisationStrength: 0.01,
    l2RegularisationStrength: 0.02,
  };

  const child = crossoverHyperparameters(mother, father, enabledConfig);

  // Child values should be between parent values (blended)
  assert(
    child.learningRate >= Math.min(mother.learningRate, father.learningRate) -
        0.001,
    "learningRate below both parents",
  );
  assert(
    child.learningRate <= Math.max(mother.learningRate, father.learningRate) +
        0.001,
    "learningRate above both parents",
  );
});

Deno.test("crossoverHyperparameters - handles undefined parents", () => {
  const child1 = crossoverHyperparameters(undefined, undefined, enabledConfig);
  // Should produce values close to defaults
  assert(
    child1.learningRate >= enabledConfig.minLearningRate,
    "learningRate below min",
  );

  const mother = {
    learningRate: 0.05,
    addNeuronRate: 0.3,
    addConnectionRate: 0.4,
    weightPerturbationScale: 1.5,
    l1RegularisationStrength: 0.02,
    l2RegularisationStrength: 0.03,
  };
  const child2 = crossoverHyperparameters(mother, undefined, enabledConfig);
  // Should use mother values blended with defaults
  assert(Number.isFinite(child2.learningRate), "learningRate should be finite");
});

Deno.test("crossoverHyperparameters - child values within bounds", () => {
  const mother = {
    learningRate: enabledConfig.maxLearningRate,
    addNeuronRate: 1.0,
    addConnectionRate: 1.0,
    weightPerturbationScale: enabledConfig.maxWeightPerturbation,
    l1RegularisationStrength: enabledConfig.maxRegularisationStrength,
    l2RegularisationStrength: enabledConfig.maxRegularisationStrength,
  };
  const father = {
    learningRate: enabledConfig.minLearningRate,
    addNeuronRate: 0.0,
    addConnectionRate: 0.0,
    weightPerturbationScale: enabledConfig.minWeightPerturbation,
    l1RegularisationStrength: 0,
    l2RegularisationStrength: 0,
  };

  for (let i = 0; i < 50; i++) {
    const child = crossoverHyperparameters(mother, father, enabledConfig);
    assert(
      child.learningRate >= enabledConfig.minLearningRate,
      `learningRate ${child.learningRate} below min`,
    );
    assert(
      child.learningRate <= enabledConfig.maxLearningRate,
      `learningRate ${child.learningRate} above max`,
    );
    assert(child.addNeuronRate >= 0, "addNeuronRate below 0");
    assert(child.addNeuronRate <= 1, "addNeuronRate above 1");
  }
});

Deno.test("computeSpeciesDiversity - single species", () => {
  const diversity = computeSpeciesDiversity(1, 50);
  assertEquals(diversity, 1 / 50);
});

Deno.test("computeSpeciesDiversity - all unique species", () => {
  const diversity = computeSpeciesDiversity(50, 50);
  assertEquals(diversity, 1);
});

Deno.test("computeSpeciesDiversity - population of 1", () => {
  const diversity = computeSpeciesDiversity(1, 1);
  assertEquals(diversity, 1);
});

Deno.test("computeSpeciesDiversity - more species than population capped at 1", () => {
  const diversity = computeSpeciesDiversity(100, 50);
  assertEquals(diversity, 1);
});
