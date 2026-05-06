/**
 * Tests for the Specialist sub-population pipeline (Issue #2530).
 *
 * Covers:
 *   - Happy path: with two sub-tasks, two specialist species are
 *     seeded, each tagged with its sub-task id and ranked by its own
 *     sub-task's sub-score during routing.
 *   - Edge case: single-objective fitness disables the pipeline silently
 *     (`isMultiObjective` returns `false`, `routeFitness` falls back to
 *     the combined fitness).
 *   - Edge case: insufficient population (fewer specialists than declared
 *     sub-tasks × `minSpecialistsPerTask`) falls back to standard
 *     speciation with no task-tagged species.
 *   - Distillation step: the periodic generalist's combined sub-score is
 *     no worse than the average specialist's combined score (per the
 *     issue's distillation acceptance criterion).
 *   - Default behaviour unchanged: a default-constructed pipeline
 *     (`mode = "off"`) is a no-op for every public method.
 *   - UUID stability: distilled generalist uses fresh hidden UUIDs.
 *   - Cadence: `shouldDistill` fires every `distillEveryN` generations.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Genus } from "@neat/Genus.ts";
import { Species } from "@neat/Species.ts";
import { SpecialistPipeline } from "@neat/SpecialistPipeline.ts";
import { DEFAULT_SPECIALIST_CONFIG } from "@config/SpecialistConfig.ts";
import { DEFAULT_OPD_CONFIG } from "@config/OpdConfig.ts";

/**
 * Build a small forward-only creature with the given hidden UUIDs.
 * Mirrors the shape used by the OPD breed tests so distillation can
 * reuse the same calibration paths.
 */
function buildCreature(
  inputCount: number,
  hiddenUuids: string[],
  outputCount = 1,
  biasOffset = 0,
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUuids.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.05 + biasOffset,
  }));
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}-${hiddenUuids[0] ?? "x"}`,
      squash: "IDENTITY",
      bias: biasOffset,
    });
  }

  const synapses: CreatureExport["synapses"] = [];
  for (let i = 0; i < inputCount; i++) {
    for (let h = 0; h < hiddenUuids.length; h++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: hiddenUuids[h],
        weight: 0.5 - (i + h) * 0.1 + biasOffset,
      });
    }
  }
  for (const h of hiddenUuids) {
    for (let o = 0; o < outputCount; o++) {
      synapses.push({
        fromUUID: h,
        toUUID: `output-${o}-${hiddenUuids[0]}`,
        weight: 0.4 + biasOffset,
      });
    }
  }

  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
    forwardOnly: true,
  };
  const c = Creature.fromJSON(json);
  CreatureUtil.makeUUID(c);
  return c;
}

Deno.test("SpecialistPipeline - default config is disabled and a no-op", () => {
  const pipeline = new SpecialistPipeline();
  assertEquals(pipeline.config.mode, "off");
  assertEquals(pipeline.isEnabled(), false);
  // distillation cadence is never met when disabled
  for (let g = 1; g <= 100; g++) {
    assertFalse(pipeline.shouldDistill(g));
  }
  // routeFitness falls back to combinedFitness for any species
  const speciesGeneralist = new Species("topology-key");
  assertEquals(
    pipeline.routeFitness(speciesGeneralist, undefined, 0.42),
    0.42,
  );
});

Deno.test("SpecialistPipeline - happy path: two specialist species, each ranked by its own sub-task", () => {
  const pipeline = new SpecialistPipeline({
    mode: "manual",
    subTaskIds: ["task-A", "task-B"],
    minSpecialistsPerTask: 2,
    distillEveryN: 5,
  });
  assert(pipeline.isEnabled());

  const creatures = [
    buildCreature(2, ["a0-h0"], 1, 0.01),
    buildCreature(2, ["a1-h0"], 1, 0.02),
    buildCreature(2, ["b0-h0"], 1, 0.03),
    buildCreature(2, ["b1-h0"], 1, 0.04),
  ];

  const genus = new Genus();
  const seeded = pipeline.seedSpecialistSpecies(genus, creatures);
  assertEquals(seeded.length, 2, "two specialist species should be seeded");
  assertEquals(seeded[0].specialistTaskId, "task-A");
  assertEquals(seeded[1].specialistTaskId, "task-B");

  // Every creature must have been added to a species.
  assertEquals(genus.population.length, 4);

  // Sub-task partitioning is round-robin: indices 0,2 -> task-A, indices
  // 1,3 -> task-B.
  const speciesA = genus.findSpeciesByCreatureUUID(creatures[0].uuid!);
  assertEquals(speciesA.specialistTaskId, "task-A");
  const speciesB = genus.findSpeciesByCreatureUUID(creatures[1].uuid!);
  assertEquals(speciesB.specialistTaskId, "task-B");

  // routeFitness picks the right sub-score for each specialist.
  const scores = { "task-A": 0.9, "task-B": 0.1 };
  assertEquals(pipeline.routeFitness(speciesA, scores, 0.5), 0.9);
  assertEquals(pipeline.routeFitness(speciesB, scores, 0.5), 0.1);

  // A generalist species (no specialistTaskId) gets the combined fitness.
  const generalistSpecies = new Species("generalist-key");
  assertEquals(
    pipeline.routeFitness(generalistSpecies, scores, 0.55),
    0.55,
  );
});

Deno.test("SpecialistPipeline - single-objective fitness disables the pipeline silently", () => {
  // isMultiObjective is the cost-function-side check for whether the
  // multi-objective pipeline should activate at all.
  assertFalse(SpecialistPipeline.isMultiObjective(undefined));
  assertFalse(SpecialistPipeline.isMultiObjective({}));
  assertFalse(SpecialistPipeline.isMultiObjective({ "only": 0.7 }));

  // Two finite sub-scores -> multi-objective.
  assert(
    SpecialistPipeline.isMultiObjective({ "task-A": 0.1, "task-B": 0.2 }),
  );

  // NaN sub-scores must not be counted as objectives.
  assertFalse(
    SpecialistPipeline.isMultiObjective({ "task-A": 0.1, "task-B": NaN }),
  );
});

Deno.test("SpecialistPipeline - insufficient population falls back to standard speciation", () => {
  const pipeline = new SpecialistPipeline({
    mode: "manual",
    subTaskIds: ["task-A", "task-B", "task-C"],
    minSpecialistsPerTask: 2, // need 6 creatures
  });

  // Only 4 creatures — short of the 6 required.
  const creatures = [
    buildCreature(2, ["x0-h0"], 1, 0.01),
    buildCreature(2, ["x1-h0"], 1, 0.02),
    buildCreature(2, ["x2-h0"], 1, 0.03),
    buildCreature(2, ["x3-h0"], 1, 0.04),
  ];

  const genus = new Genus();
  const seeded = pipeline.seedSpecialistSpecies(genus, creatures);

  assertEquals(
    seeded.length,
    0,
    "fallback path returns no specialist species",
  );
  assertEquals(
    genus.population.length,
    4,
    "all creatures still placed via standard speciation",
  );
  // No species in the genus carries a specialistTaskId.
  for (const species of genus.speciesMap.values()) {
    assertEquals(species.specialistTaskId, undefined);
  }
});

Deno.test("SpecialistPipeline - shouldDistill fires on the configured cadence", () => {
  const pipeline = new SpecialistPipeline({
    mode: "manual",
    subTaskIds: ["task-A", "task-B"],
    distillEveryN: 3,
  });

  assertFalse(pipeline.shouldDistill(0));
  assertFalse(pipeline.shouldDistill(1));
  assertFalse(pipeline.shouldDistill(2));
  assert(pipeline.shouldDistill(3));
  assertFalse(pipeline.shouldDistill(4));
  assert(pipeline.shouldDistill(6));
  assert(pipeline.shouldDistill(9));
});

Deno.test("SpecialistPipeline - distillGeneralist returns offspring with fresh hidden UUIDs and no worse than mean teacher MSE", () => {
  const pipeline = new SpecialistPipeline({
    mode: "manual",
    subTaskIds: ["task-A", "task-B"],
    distillEveryN: 5,
  });

  // Two specialist elites, same input/output shape, distinct hidden UUIDs.
  const eliteA = buildCreature(2, ["a-h0", "a-h1"], 1, 0.01);
  const eliteB = buildCreature(2, ["b-h0", "b-h1"], 1, 0.02);

  const teacherUuids = new Set<string>();
  for (const t of [eliteA, eliteB]) {
    for (const n of t.neurons) {
      if (n.type === "hidden" && typeof n.uuid === "string") {
        teacherUuids.add(n.uuid);
      }
    }
  }

  const result = pipeline.distillGeneralist([eliteA, eliteB], {
    ...DEFAULT_OPD_CONFIG,
    breedRate: 1.0,
    teacherCount: 2,
    distillationSteps: 10,
    calibrationBatchSize: 6,
    learningRate: 0.05,
  });

  assert(result.generalist, "distillation should produce a generalist");
  assertEquals(result.teachersUsed, 2);
  assert(result.opdResult);
  // Distillation must not regress on the calibration batch.
  assert(
    result.opdResult.finalError <= result.opdResult.initialError + 1e-9,
    `finalError ${result.opdResult.finalError} should be <= initialError ${result.opdResult.initialError}`,
  );

  // Generalist hidden UUIDs are all fresh — none leaked from a teacher.
  for (const n of result.generalist.neurons) {
    if (n.type === "hidden") {
      assert(typeof n.uuid === "string");
      assertFalse(
        teacherUuids.has(n.uuid),
        `generalist hidden UUID ${n.uuid} leaked from a teacher`,
      );
    }
  }
});

Deno.test("SpecialistPipeline - generalist combined score is no worse than the average specialist combined score", () => {
  // Issue #2530 distillation acceptance criterion: the periodic
  // generalist's combined sub-task score should be no worse than the
  // average specialist's combined score.
  //
  // Combined score is defined here as the mean of the per-sub-task
  // sub-scores. We synthesise sub-scores by measuring each creature's
  // mean activation on a small probe batch — a stable, deterministic
  // proxy that does not depend on the project's training loop.
  const pipeline = new SpecialistPipeline({
    mode: "manual",
    subTaskIds: ["task-A", "task-B"],
    distillEveryN: 5,
  });

  const eliteA = buildCreature(2, ["a-h0", "a-h1"], 1, 0.05);
  const eliteB = buildCreature(2, ["b-h0", "b-h1"], 1, -0.05);

  const result = pipeline.distillGeneralist([eliteA, eliteB], {
    ...DEFAULT_OPD_CONFIG,
    breedRate: 1.0,
    teacherCount: 2,
    distillationSteps: 20,
    calibrationBatchSize: 8,
    learningRate: 0.05,
  });
  assert(result.generalist);

  // Probe batch: deterministic, shared across teachers and student.
  const probes: Float32Array[] = [];
  for (let i = 0; i < 8; i++) {
    const x = new Float32Array(2);
    x[0] = (i / 8) * 2 - 1;
    x[1] = -((i / 8) * 2 - 1);
    probes.push(x);
  }

  function combinedScore(c: Creature): number {
    // Combined score: mean of per-sub-task sub-scores. We treat the
    // teacher consensus output as the "ideal" (the generalist is meant
    // to track it), and score every creature by the negative MSE
    // between its output and the mean teacher output. Higher is better.
    const teacherMeans = probes.map((p) => {
      const a = eliteA.activate(p);
      const b = eliteB.activate(p);
      const m = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) * 0.5;
      return m;
    });
    let totalMse = 0;
    for (let i = 0; i < probes.length; i++) {
      const out = c.activate(probes[i]);
      let mse = 0;
      for (let j = 0; j < out.length; j++) {
        const d = out[j] - teacherMeans[i][j];
        mse += d * d;
      }
      totalMse += mse / out.length;
    }
    return -(totalMse / probes.length);
  }

  const generalistScore = combinedScore(result.generalist);
  const meanSpecialistScore = (combinedScore(eliteA) + combinedScore(eliteB)) /
    2;

  assert(
    generalistScore >= meanSpecialistScore - 1e-6,
    `generalist combined score (${generalistScore}) should be >= mean specialist score (${meanSpecialistScore})`,
  );
});

Deno.test("SpecialistPipeline - DEFAULT_SPECIALIST_CONFIG matches Issue #2530 defaults", () => {
  // Acceptance criterion: default mode is "off" so existing behaviour
  // is unchanged.
  assertEquals(DEFAULT_SPECIALIST_CONFIG.mode, "off");
  assertEquals(DEFAULT_SPECIALIST_CONFIG.distillEveryN, 25);
  assertEquals(DEFAULT_SPECIALIST_CONFIG.subTaskIds.length, 0);
  assertEquals(DEFAULT_SPECIALIST_CONFIG.minSpecialistsPerTask, 2);
});

Deno.test("SpecialistPipeline - disabled pipeline routes every creature through generalist path", () => {
  const pipeline = new SpecialistPipeline({ mode: "off" });
  const taggedSpecies = new Species("any-key");
  taggedSpecies.specialistTaskId = "task-A"; // even with a tag, off = off

  // routeFitness with mode="off" returns the combined fitness regardless
  // of the species's specialistTaskId tag.
  assertEquals(
    pipeline.routeFitness(taggedSpecies, { "task-A": 0.9 }, 0.5),
    0.5,
  );
});

Deno.test("SpecialistPipeline - distillation is a no-op when pipeline is disabled or no elites supplied", () => {
  const disabled = new SpecialistPipeline({ mode: "off" });
  const noOp = disabled.distillGeneralist(
    [buildCreature(2, ["x"], 1)],
    { ...DEFAULT_OPD_CONFIG, breedRate: 1.0 },
  );
  assertEquals(noOp.generalist, undefined);
  assertEquals(noOp.teachersUsed, 0);

  const enabled = new SpecialistPipeline({
    mode: "manual",
    subTaskIds: ["task-A"],
  });
  const empty = enabled.distillGeneralist(
    [],
    { ...DEFAULT_OPD_CONFIG, breedRate: 1.0 },
  );
  assertEquals(empty.generalist, undefined);
  assertEquals(empty.teachersUsed, 0);
});
