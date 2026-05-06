/**
 * Issue #2530 — Benchmark specialist sub-population pipeline overhead
 * on a synthetic two-task fitness function.
 *
 * Measures the overhead of:
 *   - `seedSpecialistSpecies` partitioning a population into two
 *     specialist species, vs. standard `Genus.addCreature` speciation.
 *   - `routeFitness` per-generation routing of multi-objective
 *     sub-scores to specialist vs. generalist species.
 *   - `distillGeneralist` periodic ensemble distillation step using
 *     the OPD breed operator.
 *
 * The benchmark is deliberately small: two sub-tasks, four creatures,
 * two-step distillation. It validates that the pipeline's per-generation
 * overhead is negligible compared to the OPD distillation step (which
 * dominates wall-clock cost).
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/SpecialistVsMixed.ts
 */

import { Creature, type CreatureExport } from "../mod.ts";
import { Genus } from "@neat/Genus.ts";
import { SpecialistPipeline } from "@neat/SpecialistPipeline.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DEFAULT_OPD_CONFIG } from "@config/OpdConfig.ts";

function buildCreature(hiddenUuids: string[], biasOffset = 0): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUuids.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.05 + biasOffset,
  }));
  neurons.push({
    type: "output",
    uuid: `output-0-${hiddenUuids[0]}`,
    squash: "IDENTITY",
    bias: biasOffset,
  });
  const synapses: CreatureExport["synapses"] = [];
  for (let i = 0; i < 2; i++) {
    for (let h = 0; h < hiddenUuids.length; h++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: hiddenUuids[h],
        weight: 0.5 - (i + h) * 0.1 + biasOffset,
      });
    }
  }
  for (const h of hiddenUuids) {
    synapses.push({
      fromUUID: h,
      toUUID: `output-0-${hiddenUuids[0]}`,
      weight: 0.4 + biasOffset,
    });
  }
  const c = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons,
    synapses,
    forwardOnly: true,
  });
  CreatureUtil.makeUUID(c);
  return c;
}

function buildPopulation(): Creature[] {
  return [
    buildCreature(["a0-h0"], 0.01),
    buildCreature(["a1-h0"], 0.02),
    buildCreature(["b0-h0"], 0.03),
    buildCreature(["b1-h0"], 0.04),
  ];
}

const pipeline = new SpecialistPipeline({
  mode: "manual",
  subTaskIds: ["task-A", "task-B"],
  distillEveryN: 25,
});

Deno.bench("Genus.addCreature - standard speciation (baseline)", () => {
  const genus = new Genus();
  for (const c of buildPopulation()) genus.addCreature(c);
});

Deno.bench("SpecialistPipeline.seedSpecialistSpecies - two sub-tasks", () => {
  const genus = new Genus();
  pipeline.seedSpecialistSpecies(genus, buildPopulation());
});

const routingPopulation = buildPopulation();
const routingGenus = new Genus();
const routingSeeded = pipeline.seedSpecialistSpecies(
  routingGenus,
  routingPopulation,
);
const routingScores = { "task-A": 0.42, "task-B": 0.84 };

Deno.bench("SpecialistPipeline.routeFitness - per-creature routing", () => {
  for (const species of routingSeeded) {
    pipeline.routeFitness(species, routingScores, 0.5);
  }
});

Deno.bench("SpecialistPipeline.distillGeneralist - 2-teacher OPD breed", () => {
  const elites = [buildCreature(["a-h"], 0.01), buildCreature(["b-h"], 0.02)];
  pipeline.distillGeneralist(elites, {
    ...DEFAULT_OPD_CONFIG,
    breedRate: 1.0,
    teacherCount: 2,
    distillationSteps: 2,
    calibrationBatchSize: 4,
    learningRate: 0.05,
  });
});
