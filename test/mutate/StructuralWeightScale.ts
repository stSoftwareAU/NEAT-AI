/**
 * Issue #3970: identity-initialised structural mutation.
 *
 * `AddNeuron` wires its **outward** synapse with `structuralWeightScale`, so a
 * new neuron perturbs a tuned network by `eF(x)` rather than by a full
 * `[-0.5, +0.5]` kick. The inward synapse is deliberately left at full scale —
 * it only determines what the new neuron sees, and shrinking it would flatten
 * the gradient the new structure needs.
 *
 * The default (`1`) must be bit-identical to the historical behaviour.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport, Mutation } from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutator } from "@neat/Mutator.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/** One plank — the minimum magnitude `Synapse.randomWeight()` will emit. */
const PLANK = 0.000_000_1;

function seedCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: -0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.4 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: -0.3 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

/**
 * Runs one `AddNeuron` mutation and reports the weights of the synapses that
 * touch the neuron it inserted.
 */
function addNeuronWeights(
  scale: number | undefined,
): { inward: number[]; outward: number[] } {
  const creature = seedCreature();
  const before = new Set(creature.neurons.map((n) => n.uuid));

  const operator = scale === undefined
    ? new AddNeuron(creature)
    : new AddNeuron(creature, { structuralWeightScale: scale });
  assert(operator.mutate(), "AddNeuron should have changed the creature");

  const added = creature.neurons.find((n) =>
    n.type === "hidden" && !before.has(n.uuid)
  );
  assert(added !== undefined, "The inserted neuron should be findable");

  return {
    inward: creature.inwardConnections(added.index).map((s) => s.weight),
    outward: creature.outwardConnections(added.index).map((s) => s.weight),
  };
}

Deno.test("AddNeuron - structuralWeightScale 1 is identical to the default on a fixed seed", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(3970));
      const baseline = addNeuronWeights(undefined);

      setRandomNumberGenerator(createSeededRng(3970));
      const explicit = addNeuronWeights(1);

      assertEquals(
        explicit,
        baseline,
        "structuralWeightScale: 1 must reproduce the default weights exactly",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("AddNeuron - a reduced scale shrinks the outward synapse but not the inward one", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    const scale = 1e-4;
    try {
      setRandomNumberGenerator(createSeededRng(11));
      let sawFullScaleInward = false;
      for (let sample = 0; sample < 50; sample++) {
        const { inward, outward } = addNeuronWeights(scale);

        for (const weight of outward) {
          assert(
            Math.abs(weight) <= scale / 2 + PLANK,
            `Outward weight ${weight} should be within the reduced scale`,
          );
        }
        // The inward synapse keeps the full [-0.5, +0.5] draw, so across the
        // sample at least one lands well outside the reduced scale.
        if (inward.some((weight) => Math.abs(weight) > scale)) {
          sawFullScaleInward = true;
        }
      }
      assert(
        sawFullScaleInward,
        "The inward synapse must keep its full-scale random weight",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("AddNeuron - a reduced scale never produces an exactly-zero outward weight", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      // Far below one plank: every draw must still round to at least a plank,
      // because a zero outward weight would freeze the whole inward subtree.
      setRandomNumberGenerator(createSeededRng(7));
      for (let sample = 0; sample < 50; sample++) {
        const { outward } = addNeuronWeights(1e-12);
        assert(outward.length > 0, "The newborn must have an outward synapse");
        for (const weight of outward) {
          assert(
            Math.abs(weight) >= PLANK,
            `Outward weight ${weight} must be at least one plank`,
          );
        }
      }
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("AddConnection - structuralWeightScale bounds the new synapse, and 1 matches the default", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const weightsFor = (scale: number | undefined): number[] => {
        const creature = seedCreature();
        const operator = scale === undefined
          ? new AddConnection(creature)
          : new AddConnection(creature, { structuralWeightScale: scale });
        assert(operator.mutate(), "AddConnection should add a synapse");
        return creature.synapses.map((s) => s.weight);
      };

      setRandomNumberGenerator(createSeededRng(42));
      const baseline = weightsFor(undefined);
      setRandomNumberGenerator(createSeededRng(42));
      assertEquals(
        weightsFor(1),
        baseline,
        "structuralWeightScale: 1 must reproduce the default weights exactly",
      );

      const scale = 1e-4;
      setRandomNumberGenerator(createSeededRng(42));
      const scaled = weightsFor(scale);
      const added = scaled.filter((weight) => !baseline.includes(weight));
      assertEquals(added.length, 1, "Exactly one synapse should be new");
      assert(
        Math.abs(added[0]) <= scale / 2 + PLANK &&
          Math.abs(added[0]) >= PLANK,
        `New synapse weight ${added[0]} should be scaled but non-zero`,
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("AddNeuron - rejects an invalid structuralWeightScale", () => {
  const creature = seedCreature();
  let threw = false;
  try {
    new AddNeuron(creature, { structuralWeightScale: 0 });
  } catch (error) {
    threw = true;
    assert(
      (error as Error).message.includes("structuralWeightScale"),
      `Unexpected error: ${(error as Error).message}`,
    );
  }
  assert(threw, "A zero weight scale must be rejected loudly");
});

Deno.test("Mutator - default config is bit-identical to an explicit scale of 1 on a fixed seed", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const run = (options: Record<string, number>): string => {
        // `createNeatConfig` installs the run RNG itself, so the seed goes
        // through the config rather than through the global setter.
        const config = createNeatConfig({
          mutation: Mutation.FFW,
          seed: 3970,
          ...options,
        });
        const mutator = new Mutator(config);
        const population = [seedCreature()];
        for (let generation = 0; generation < 20; generation++) {
          mutator.mutate(population);
        }
        return JSON.stringify(population[0].exportJSON());
      };

      const baseline = run({});
      const explicit = run({
        structuralWeightScale: 1,
        structuralNewbornGraceRounds: 0,
      });
      assertEquals(
        explicit,
        baseline,
        "The documented defaults must reproduce the current build exactly",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

/**
 * The behavioural point of the issue: a reduced outward scale makes the
 * offspring a near-identity variant of its parent, so it scores level with the
 * parent instead of being knocked off a tuned optimum.
 */
Deno.test("AddNeuron - a reduced scale leaves the parent's outputs nearly unchanged", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const samples: Float32Array[] = [];
      for (let i = 0; i < 20; i++) {
        samples.push(new Float32Array([i / 20, 1 - i / 20]));
      }

      const parent = seedCreature();
      const expected = samples.map((row) =>
        Array.from(parent.activate(row, false))
      );

      /** Mean absolute output deviation from the parent over 30 offspring. */
      const meanDeviation = (scale: number): number => {
        setRandomNumberGenerator(createSeededRng(3970));
        let total = 0;
        let count = 0;
        for (let offspring = 0; offspring < 30; offspring++) {
          const child = seedCreature();
          new AddNeuron(child, { structuralWeightScale: scale }).mutate();
          samples.forEach((row, index) => {
            const actual = child.activate(row, false);
            for (let output = 0; output < actual.length; output++) {
              total += Math.abs(actual[output] - expected[index][output]);
              count++;
            }
          });
        }
        return total / count;
      };

      const full = meanDeviation(1);
      const reduced = meanDeviation(1e-4);
      assert(
        reduced * 100 < full,
        `A 1e-4 scale should perturb the parent far less than full scale: ` +
          `${reduced} vs ${full}`,
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

/**
 * Regression: a forward-only creature strips the fallback self-loop the
 * operator sometimes creates, after which `neuron.fix()` re-adds an outward
 * synapse at full scale. Before Issue #3970 enforced the scale as a
 * post-condition, offspring 197 of this seed left the newborn wired at 0.173
 * under a requested scale of 2.7e-5.
 */
Deno.test("AddNeuron - the repair path cannot leave a full-scale outward synapse", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    const scale = 2.7e-5;
    try {
      setRandomNumberGenerator(createSeededRng(3970));
      for (let offspring = 0; offspring < 200; offspring++) {
        const { outward } = addNeuronWeights(scale);
        assert(outward.length > 0, "The newborn must have an outward synapse");
        for (const weight of outward) {
          assert(
            Math.abs(weight) <= scale / 2 + PLANK,
            `Offspring ${offspring} kept an over-scale outward weight ${weight}`,
          );
          assert(
            Math.abs(weight) >= PLANK,
            `Offspring ${offspring} outward weight ${weight} is below a plank`,
          );
        }
      }
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});
