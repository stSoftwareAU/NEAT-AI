/**
 * OnPolicyDistillationBreed.ts - Multi-teacher distillation breeding operator
 * (Issue #2528).
 *
 * Inspired by DeepSeek V4's On-Policy Distillation (OPD) stage, this
 * operator produces an offspring by distilling the consensus output of
 * K elite teachers into a freshly-initialised student creature using
 * on-policy gradient descent on the teachers' soft outputs.
 *
 * Algorithm:
 *
 * 1. Pick a base teacher (the largest by hidden-neuron count, ties broken
 *    by earlier index) and clone its topology.
 * 2. Re-issue every hidden neuron UUID so the student carries fresh
 *    UUIDs and never mutates the teacher (UUID-stability invariant).
 * 3. Generate a small calibration batch of inputs (uniform in [-1, 1]).
 * 4. For each calibration sample, compute the consensus target:
 *      mean of every teacher's output, optionally tempered.
 * 5. Run `distillationSteps` backprop steps on the student against the
 *    consensus targets.
 * 6. Validate the offspring and return.
 *
 * K = 1 falls back to a clone-and-train path with a warning.
 * Disjoint topologies are tolerated — each teacher is queried via its
 * own forward pass, the consensus target is the per-output mean.
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { RequiredOpdConfig } from "@config/OpdConfig.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "@propagate/BackPropagation.ts";
import { buildOutgoingSynapsesMap } from "@propagate/sparse/CalculatePathsToOutput.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import {
  readCurrentGenerationFromCreature,
  readWarmupGenerationsFromCreature,
  writeSeedWarmupProgressTags,
} from "@architecture/CreatureFactory.ts";

/**
 * Result of an OPD breed call, returned from {@link onPolicyDistillationBreed}.
 *
 * `initialError` and `finalError` are the mean-squared error of the
 * student's output against the consensus target across the calibration
 * batch, measured before the first backprop step and after the last one
 * respectively. Tests assert that `finalError <= initialError`.
 */
export interface OpdBreedResult {
  /** The freshly-distilled offspring creature. */
  offspring: Creature;
  /** Number of teachers actually used (clamped by available parents). */
  teachersUsed: number;
  /** Mean MSE on the calibration batch before any distillation step. */
  initialError: number;
  /** Mean MSE on the calibration batch after the final distillation step. */
  finalError: number;
}

/**
 * Internal: build a CreatureExport that mirrors the donor's topology
 * but with every hidden neuron UUID re-issued.
 *
 * The student is structurally a clone of the donor — UUIDs are
 * regenerated so the student has its own identity and the donor's
 * neurons are never mutated by the distillation pass.
 */
function cloneTopologyWithFreshHiddenUuids(
  donor: CreatureExport,
): CreatureExport {
  const uuidMap = new Map<string, string>();
  const neurons: NeuronExport[] = donor.neurons.map((n) => {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      const fresh = crypto.randomUUID();
      uuidMap.set(n.uuid, fresh);
      return { ...n, uuid: fresh };
    }
    return { ...n };
  });
  const synapses: SynapseExport[] = donor.synapses.map((s) => {
    const fromUUID = s.fromUUID && uuidMap.has(s.fromUUID)
      ? uuidMap.get(s.fromUUID)
      : s.fromUUID;
    const toUUID = s.toUUID && uuidMap.has(s.toUUID)
      ? uuidMap.get(s.toUUID)
      : s.toUUID;
    return { ...s, fromUUID, toUUID };
  });
  return {
    input: donor.input,
    output: donor.output,
    forwardOnly: donor.forwardOnly,
    neurons,
    synapses,
  };
}

/**
 * Pick the index of the teacher with the most hidden neurons (the
 * "richest" topology). Ties are broken by earlier array position.
 */
function pickBaseTeacherIndex(teachers: Creature[]): number {
  let bestIdx = 0;
  let bestHidden = -1;
  for (let i = 0; i < teachers.length; i++) {
    const hidden = teachers[i].neurons.filter((n) => n.type === "hidden")
      .length;
    if (hidden > bestHidden) {
      bestHidden = hidden;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Compute the consensus target across teachers for a single input.
 *
 * The consensus is the per-output mean of every teacher's activation,
 * optionally divided by `temperature`. Higher temperature softens the
 * target, lower temperature sharpens it. `temperature = 1` is the
 * plain mean.
 */
function consensusTarget(
  teachers: Creature[],
  input: Float32Array,
  outputSize: number,
  temperature: number,
): Float32Array {
  const acc = new Float32Array(outputSize);
  for (const teacher of teachers) {
    const out = teacher.activate(input);
    for (let i = 0; i < outputSize; i++) {
      acc[i] += out[i];
    }
  }
  const inv = 1 / (teachers.length * temperature);
  for (let i = 0; i < outputSize; i++) {
    acc[i] *= inv;
  }
  return acc;
}

/**
 * Generate a single calibration input uniformly in [-1, 1].
 *
 * The OPD pass is deliberately on-policy in the architectural sense —
 * teachers and student see the same synthetic inputs, so the consensus
 * the student is matched against is grounded in identical data.
 */
function generateCalibrationInput(
  inputSize: number,
  rng: { random: () => number },
): Float32Array {
  const input = new Float32Array(inputSize);
  for (let i = 0; i < inputSize; i++) {
    input[i] = rng.random() * 2 - 1;
  }
  return input;
}

/**
 * Compute mean-squared error between `prediction` and `target`.
 */
function meanSquaredError(
  prediction: Float32Array,
  target: Float32Array,
): number {
  const n = Math.min(prediction.length, target.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const diff = prediction[i] - target[i];
    sum += diff * diff;
  }
  return sum / n;
}

/**
 * Evaluate the student's mean MSE against the precomputed consensus
 * targets across the entire calibration batch. Used for the
 * monotonic-improvement assertion in tests and for the breed result.
 */
function evaluateBatchError(
  student: Creature,
  inputs: Float32Array[],
  targets: Float32Array[],
): number {
  let total = 0;
  for (let i = 0; i < inputs.length; i++) {
    const out = student.activate(inputs[i]);
    total += meanSquaredError(out, targets[i]);
  }
  return inputs.length === 0 ? 0 : total / inputs.length;
}

function propagateSeedWarmupTagsFromTeachers(
  offspring: Creature,
  teachers: readonly Creature[],
): void {
  let warmupGenerations = 0;
  let currentGeneration = 0;
  for (const teacher of teachers) {
    warmupGenerations = Math.max(
      warmupGenerations,
      readWarmupGenerationsFromCreature(teacher),
    );
    currentGeneration = Math.max(
      currentGeneration,
      readCurrentGenerationFromCreature(teacher),
    );
  }
  if (warmupGenerations > 0) {
    writeSeedWarmupProgressTags(
      offspring,
      warmupGenerations,
      currentGeneration,
    );
  }
}

/**
 * On-Policy Distillation breeding operator.
 *
 * Produces a single offspring by distilling the consensus output of
 * `teachers` into a freshly-initialised student. Returns `undefined`
 * when the teachers cannot agree on a usable input/output shape, or
 * when the student fails structural validation.
 *
 * @param teachers - K elite parent creatures. Must share the same
 *   `input` and `output` dimensions. K = 1 falls back to clone-and-train
 *   with a warning.
 * @param config - OPD configuration — typically taken from
 *   {@link RequiredOpdConfig} via `NeatConfig.opd`.
 * @returns An {@link OpdBreedResult} with the offspring and per-batch
 *   error metrics, or `undefined` when distillation fails.
 */
export function onPolicyDistillationBreed(
  teachers: Creature[],
  config: RequiredOpdConfig,
): OpdBreedResult | undefined {
  if (teachers.length === 0) {
    getLogger().warn("[opd] cannot breed: no teachers supplied");
    return undefined;
  }

  // Validate consistent input/output dimensions across teachers.
  const inputSize = teachers[0].input;
  const outputSize = teachers[0].output;
  for (const t of teachers) {
    if (t.input !== inputSize || t.output !== outputSize) {
      getLogger().warn(
        `[opd] teachers have inconsistent shapes: expected ${inputSize}->${outputSize}, ` +
          `got ${t.input}->${t.output}`,
      );
      return undefined;
    }
  }

  const effectiveTeachers = teachers.slice(0, Math.max(1, config.teacherCount));

  if (effectiveTeachers.length === 1) {
    getLogger().warn(
      "[opd] only one teacher available — falling back to clone-and-train",
    );
  }

  const rng = getRandomNumberGenerator();

  // 1. Pick base teacher and clone its topology with fresh hidden UUIDs.
  const baseIdx = pickBaseTeacherIndex(effectiveTeachers);
  const baseTeacher = effectiveTeachers[baseIdx];
  const baseExport = baseTeacher.exportJSON();
  const studentExport = cloneTopologyWithFreshHiddenUuids(baseExport);

  let student: Creature;
  try {
    student = Creature.fromJSON(studentExport);
    student.fix();
    if (student.forwardOnly) {
      creatureValidate(student, { forwardOnly: true });
    } else {
      creatureValidate(student);
    }
  } catch (error) {
    getLogger().warn(
      `[opd] student topology failed to construct: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }

  // 2. Generate calibration batch and consensus targets up-front.
  const batchSize = Math.max(1, config.calibrationBatchSize);
  const inputs: Float32Array[] = new Array(batchSize);
  const targets: Float32Array[] = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    inputs[i] = generateCalibrationInput(inputSize, rng);
    targets[i] = consensusTarget(
      effectiveTeachers,
      inputs[i],
      outputSize,
      config.temperature,
    );
  }

  const initialError = evaluateBatchError(student, inputs, targets);

  // 3. Run N distillation steps. Each step traces forward, then
  //    backpropagates the consensus target through the student.
  const backpropConfig: BackPropagationConfig = createBackPropagationConfig({
    learningRate: config.learningRate,
    learningRateStrategy: "fixed",
    batchSize,
    disableRandomSamples: true,
  });
  const studentJsonForSparse = student.exportJSON();
  const outgoingMap = buildOutgoingSynapsesMap(studentJsonForSparse);
  const sparseConfig = new SparseConfig(
    studentJsonForSparse,
    backpropConfig,
    outgoingMap,
  );

  for (let step = 0; step < config.distillationSteps; step++) {
    for (let s = 0; s < batchSize; s++) {
      try {
        student.activateAndTrace(
          inputs[s],
          /*feedbackLoop*/ false,
          sparseConfig,
        );
        student.propagate(targets[s], backpropConfig, sparseConfig);
      } catch (error) {
        getLogger().warn(
          `[opd] distillation step ${step} sample ${s} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      }
    }
    student.applyLearnings(backpropConfig, sparseConfig);
  }

  const finalError = evaluateBatchError(student, inputs, targets);

  // 4. Establish the offspring's identity and confirm UUID stability.
  delete student.uuid;
  CreatureUtil.makeUUID(student);
  propagateSeedWarmupTagsFromTeachers(student, effectiveTeachers);

  return {
    offspring: student,
    teachersUsed: effectiveTeachers.length,
    initialError,
    finalError,
  };
}
