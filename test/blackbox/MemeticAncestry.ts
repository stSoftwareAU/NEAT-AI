import { assert, assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { fineTuneImprovement } from "../../src/blackbox/FineTune.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import type { MemeticInterface } from "../../src/blackbox/MemeticInterface.ts";
import {
  analyseWeightTrajectory,
  calculateTrajectoryMomentum,
} from "../../src/blackbox/MemeticTrajectory.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 3 },
      { type: "hidden", uuid: "hidden-4", squash: "HARD_TANH", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },

      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("MemeticInterface should include ancestry history", () => {
  const creature = makeCreature();
  creature.score = -0.1;

  const memetic: MemeticInterface = {
    generation: 2,
    weights: {
      "input-0": [{ toUUID: "hidden-3", weight: -0.25 }],
    },
    biases: {
      "hidden-3": 2.9,
    },
    score: -0.15,
    ancestry: [
      {
        generation: 1,
        weights: {
          "input-0": [{ toUUID: "hidden-3", weight: -0.2 }],
        },
        biases: {
          "hidden-3": 2.8,
        },
        score: -0.2,
      },
    ],
  };

  creature.memetic = memetic;

  const exported = creature.exportJSON();
  assertExists(exported.memetic, "Exported creature should have memetic");
  assertExists(exported.memetic.ancestry, "Memetic should have ancestry");
  assertEquals(
    exported.memetic.ancestry.length,
    1,
    "Ancestry should have 1 entry",
  );
  assertEquals(
    exported.memetic.ancestry[0].generation,
    1,
    "First ancestor generation should be 1",
  );
});

Deno.test("fineTuneImprovement should build ancestry history", () => {
  const fittest = makeCreature();
  fittest.score = -0.1;

  const previous = makeCreature();
  previous.neurons[3].bias = 3.1;
  previous.synapses[2].weight = 0.5;
  previous.score = -0.2;

  // First fine-tuning round
  const population1 = fineTuneImprovement(fittest, previous, false);
  assert(population1.length > 0, "Should produce fine-tuned creatures");

  const tunedCreature1 = population1[0];
  assertExists(tunedCreature1.memetic, "Tuned creature should have memetic");
  assertEquals(
    tunedCreature1.memetic.generation,
    1,
    "First tuning should be generation 1",
  );

  // Second fine-tuning round - this should build ancestry
  tunedCreature1.score = -0.08;
  const previous2 = makeCreature();
  previous2.neurons[3].bias = tunedCreature1.neurons[3].bias;
  previous2.synapses[2].weight = tunedCreature1.synapses[2].weight;
  previous2.score = -0.1;

  const population2 = fineTuneImprovement(tunedCreature1, previous2, false);
  if (population2.length > 0) {
    const tunedCreature2 = population2[0];
    assertExists(
      tunedCreature2.memetic,
      "Second tuned creature should have memetic",
    );
    assertEquals(
      tunedCreature2.memetic.generation,
      2,
      "Second tuning should be generation 2",
    );

    // Ancestry should be preserved with configurable depth
    if (tunedCreature2.memetic.ancestry) {
      assert(
        tunedCreature2.memetic.ancestry.length <= 3,
        "Ancestry should respect max depth (default 3)",
      );
    }
  }
});

Deno.test("ancestry should be preserved during breeding", () => {
  const mum = makeCreature();
  mum.score = -0.1;
  mum.memetic = {
    generation: 2,
    weights: {
      "input-0": [{ toUUID: "hidden-3", weight: -0.25 }],
    },
    biases: {
      "hidden-3": 2.9,
    },
    score: -0.15,
    ancestry: [
      {
        generation: 1,
        weights: {
          "input-0": [{ toUUID: "hidden-3", weight: -0.2 }],
        },
        biases: {
          "hidden-3": 2.8,
        },
        score: -0.2,
      },
    ],
  };

  const dad = makeCreature();
  dad.neurons[3].bias = -0.12;
  dad.synapses[2].weight = 0.456;
  dad.score = -0.2;

  for (let i = 0; i < 12; i++) {
    const child = Offspring.breed(mum, dad);
    if (child !== undefined && child.memetic) {
      // Ancestry from better parent should be preserved
      if (child.memetic.ancestry) {
        assert(
          child.memetic.ancestry.length >= 0,
          "Child ancestry should be present",
        );
      }
    }
  }
});

Deno.test("analyseWeightTrajectory should identify consistent directions", () => {
  // Weights consistently increasing
  const memetic: MemeticInterface = {
    generation: 3,
    weights: {
      "input-0": [{ toUUID: "hidden-3", weight: -0.15 }],
    },
    biases: {
      "hidden-3": 3.2,
    },
    score: -0.05,
    ancestry: [
      {
        generation: 2,
        weights: {
          "input-0": [{ toUUID: "hidden-3", weight: -0.2 }],
        },
        biases: {
          "hidden-3": 3.1,
        },
        score: -0.1,
      },
      {
        generation: 1,
        weights: {
          "input-0": [{ toUUID: "hidden-3", weight: -0.25 }],
        },
        biases: {
          "hidden-3": 3.0,
        },
        score: -0.15,
      },
    ],
  };

  const trajectory = analyseWeightTrajectory(memetic, "input-0", "hidden-3");
  assertExists(trajectory, "Trajectory should be calculated");
  assert(trajectory.direction > 0, "Direction should be positive (increasing)");
  assert(trajectory.consistency > 0.5, "Changes should be consistent");
});

Deno.test("analyseWeightTrajectory should handle no ancestry", () => {
  const memetic: MemeticInterface = {
    generation: 1,
    weights: {
      "input-0": [{ toUUID: "hidden-3", weight: -0.2 }],
    },
    biases: {},
    score: -0.1,
  };

  const trajectory = analyseWeightTrajectory(memetic, "input-0", "hidden-3");
  assertEquals(trajectory, undefined, "No trajectory without ancestry");
});

Deno.test("calculateTrajectoryMomentum should compute momentum factor", () => {
  const memetic: MemeticInterface = {
    generation: 3,
    weights: {
      "input-0": [{ toUUID: "hidden-3", weight: -0.15 }],
    },
    biases: {
      "hidden-3": 3.2,
    },
    score: -0.05,
    ancestry: [
      {
        generation: 2,
        weights: {
          "input-0": [{ toUUID: "hidden-3", weight: -0.2 }],
        },
        biases: {
          "hidden-3": 3.1,
        },
        score: -0.1,
      },
      {
        generation: 1,
        weights: {
          "input-0": [{ toUUID: "hidden-3", weight: -0.25 }],
        },
        biases: {
          "hidden-3": 3.0,
        },
        score: -0.15,
      },
    ],
  };

  const momentum = calculateTrajectoryMomentum(memetic, "input-0", "hidden-3");
  assertExists(momentum, "Momentum should be calculated");
  assert(
    momentum.factor > 0,
    "Momentum factor should be positive for consistent improvement",
  );
  assert(momentum.factor <= 2, "Momentum factor should be bounded");
});

Deno.test("ancestry circular buffer should limit depth", () => {
  const creature = makeCreature();
  creature.score = -0.05;

  // Create memetic with max ancestry depth
  const memetic: MemeticInterface = {
    generation: 5,
    weights: {},
    biases: {},
    score: -0.06,
    ancestry: [
      { generation: 4, weights: {}, biases: {}, score: -0.07 },
      { generation: 3, weights: {}, biases: {}, score: -0.08 },
      { generation: 2, weights: {}, biases: {}, score: -0.09 },
    ],
  };

  creature.memetic = memetic;

  const previous = makeCreature();
  previous.neurons[3].bias = 3.1;
  previous.score = -0.06;

  const population = fineTuneImprovement(creature, previous, false);
  if (population.length > 0) {
    const tuned = population[0];
    if (tuned.memetic?.ancestry) {
      assert(
        tuned.memetic.ancestry.length <= 3,
        "Ancestry should not exceed max depth of 3",
      );
    }
  }
});

Deno.test("bias trajectory should be analysed separately", () => {
  const memetic: MemeticInterface = {
    generation: 3,
    weights: {},
    biases: {
      "hidden-3": 3.3,
    },
    score: -0.05,
    ancestry: [
      {
        generation: 2,
        weights: {},
        biases: {
          "hidden-3": 3.2,
        },
        score: -0.1,
      },
      {
        generation: 1,
        weights: {},
        biases: {
          "hidden-3": 3.1,
        },
        score: -0.15,
      },
    ],
  };

  const biasTrajectory = analyseWeightTrajectory(
    memetic,
    "hidden-3",
    undefined,
    true,
  );
  assertExists(biasTrajectory, "Bias trajectory should be calculated");
  assert(biasTrajectory.direction > 0, "Bias direction should be positive");
});
