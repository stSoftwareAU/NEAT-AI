import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG } from "../../src/config/HyperparameterConfig.ts";

/** Helper: create a breedable parent creature with a hidden neuron. */
function createParent(
  hiddenUUID: string,
  squash: string,
  bias: number,
  weight: number,
  score: number,
): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: hiddenUUID, squash, bias },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUUID, weight },
      { fromUUID: "input-1", toUUID: hiddenUUID, weight: weight * 0.5 },
      { fromUUID: hiddenUUID, toUUID: "output-0", weight: weight * 0.8 },
      { fromUUID: hiddenUUID, toUUID: "output-1", weight: weight * 0.3 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

Deno.test("Hyperparameter serialisation - export and import preserves values", () => {
  const creature = new Creature(2, 1);
  creature.hyperparameters = {
    learningRate: 0.05,
    addNeuronRate: 0.15,
    addConnectionRate: 0.25,
    weightPerturbationScale: 1.3,
    l1RegularisationStrength: 0.02,
    l2RegularisationStrength: 0.04,
  };

  const exported = creature.exportJSON();
  assert(exported.hyperparameters, "Exported JSON should have hyperparameters");
  assertEquals(exported.hyperparameters!.learningRate, 0.05);
  assertEquals(exported.hyperparameters!.addNeuronRate, 0.15);

  const imported = Creature.fromJSON(exported);
  assert(
    imported.hyperparameters,
    "Imported creature should have hyperparameters",
  );
  assertEquals(imported.hyperparameters!.learningRate, 0.05);
  assertEquals(imported.hyperparameters!.addNeuronRate, 0.15);
  assertEquals(imported.hyperparameters!.addConnectionRate, 0.25);
  assertEquals(imported.hyperparameters!.weightPerturbationScale, 1.3);
  assertEquals(imported.hyperparameters!.l1RegularisationStrength, 0.02);
  assertEquals(imported.hyperparameters!.l2RegularisationStrength, 0.04);
});

Deno.test("Hyperparameter serialisation - absent when not set", () => {
  const creature = new Creature(2, 1);
  const exported = creature.exportJSON();
  assertEquals(exported.hyperparameters, undefined);
});

Deno.test("Hyperparameter shallow clone preserves values", () => {
  const creature = new Creature(2, 1);
  creature.hyperparameters = {
    learningRate: 0.03,
    addNeuronRate: 0.2,
    addConnectionRate: 0.3,
    weightPerturbationScale: 1.1,
    l1RegularisationStrength: 0.01,
    l2RegularisationStrength: 0.02,
  };

  const clone = creature.shallowClone();
  assert(clone.hyperparameters, "Clone should have hyperparameters");
  assertEquals(clone.hyperparameters!.learningRate, 0.03);
  assertEquals(clone.hyperparameters!.addNeuronRate, 0.2);

  // Ensure it's a separate copy
  clone.hyperparameters!.learningRate = 0.999;
  assertEquals(
    creature.hyperparameters.learningRate,
    0.03,
    "Original should not be affected by clone modification",
  );
});

Deno.test("Hyperparameter crossover inheritance during breeding", () => {
  const mum = createParent("hidden-mum", "LOGISTIC", 0.9, 0.5, -0.1);
  mum.hyperparameters = {
    learningRate: 0.02,
    addNeuronRate: 0.15,
    addConnectionRate: 0.25,
    weightPerturbationScale: 1.2,
    l1RegularisationStrength: 0.03,
    l2RegularisationStrength: 0.05,
  };

  const dad = createParent("hidden-dad", "TANH", 0.7, 0.6, -0.2);
  dad.hyperparameters = {
    learningRate: 0.08,
    addNeuronRate: 0.3,
    addConnectionRate: 0.5,
    weightPerturbationScale: 1.8,
    l1RegularisationStrength: 0.06,
    l2RegularisationStrength: 0.09,
  };

  const hpConfig = {
    ...DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG,
    enabled: true,
  };

  let child: Creature | undefined;
  for (let i = 0; i < 50; i++) {
    child = Offspring.breed(mum, dad, {
      hyperparameterEvolution: hpConfig,
    });
    if (child) break;
  }

  assert(child, "Offspring should be produced");
  assert(child!.hyperparameters, "Offspring should inherit hyperparameters");

  const hp = child!.hyperparameters!;
  assert(
    hp.learningRate! >= hpConfig.minLearningRate,
    `learningRate ${hp.learningRate} below min`,
  );
  assert(
    hp.learningRate! <= hpConfig.maxLearningRate,
    `learningRate ${hp.learningRate} above max`,
  );
  assert(Number.isFinite(hp.addNeuronRate), "addNeuronRate should be finite");
  assert(
    Number.isFinite(hp.weightPerturbationScale),
    "weightPerturbationScale should be finite",
  );
});

Deno.test("Hyperparameters inherited when evolution disabled but parents have them", () => {
  const mum = createParent("hidden-mum2", "LOGISTIC", 0.9, 0.5, -0.1);
  mum.hyperparameters = {
    learningRate: 0.02,
    addNeuronRate: 0.15,
    addConnectionRate: 0.25,
    weightPerturbationScale: 1.2,
    l1RegularisationStrength: 0.03,
    l2RegularisationStrength: 0.05,
  };

  const dad = createParent("hidden-dad2", "TANH", 0.7, 0.6, -0.2);

  // Evolution disabled, but mum has hyperparameters
  let child: Creature | undefined;
  for (let i = 0; i < 50; i++) {
    child = Offspring.breed(mum, dad);
    if (child) break;
  }

  assert(child, "Offspring should be produced");
  assert(
    child!.hyperparameters,
    "Offspring should inherit mother's hyperparameters even when evolution disabled",
  );
  assertEquals(child!.hyperparameters!.learningRate, 0.02);
});
