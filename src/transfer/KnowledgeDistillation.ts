/**
 * KnowledgeDistillation.ts — Knowledge distillation primitive (Issue #2494).
 *
 * Distinct from `CompactModuleGraft` (#2493): instead of moving Europa's
 * structure across, we move its **behaviour** across by giving production a
 * small new student pathway trained to imitate Europa on the probe dataset.
 * The student pathway captures the bits of Europa's behaviour that the
 * recipient most needs.
 *
 * Procedure:
 *
 *   1. Activate the donor (teacher) on the probe dataset and record output
 *      activations.
 *   2. Add a small student pathway in the recipient: hidden neurons (default
 *      8, capped at 64) wired to every input and every output with small
 *      seed weights.
 *   3. Freeze every pre-existing neuron and synapse so the existing topology
 *      is not disturbed.
 *   4. Train the student pathway against the teacher's outputs using the
 *      existing backprop machinery.
 *   5. Validate the resulting recipient and return it.
 *
 * Pre-existing neuron `uuid`s and biases are unchanged — verified by the
 * regression tests in `test/transfer/KnowledgeDistillation.ts`. This is the
 * same UUID stability invariant the rest of the pipeline relies on
 * (AGENTS.md).
 */

import { Creature } from "@creature";
import { addTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";
import type {
  DnaSharingPrepareOptions,
  DnaSharingStrategy,
} from "./DnaSharingStrategy.ts";

/** Default number of student hidden neurons to add. */
const DEFAULT_STUDENT_NEURONS = 8;
/** Hard cap on the student pathway size — keeps the diff and inference cost bounded. */
const MAX_STUDENT_NEURONS = 64;
/** Default backprop iterations per student-pathway training run. */
const DEFAULT_ITERATIONS = 50;
/** Default learning rate for student-pathway backprop. */
const DEFAULT_LEARNING_RATE = 0.05;
/** Default RNG seed when none is supplied. */
const DEFAULT_SEED = 42;
/**
 * Default activation function for student hidden neurons. TANH gives a
 * smooth gradient and a [-1, 1] range that pairs well with IDENTITY-style
 * outputs and also avoids the vanishing-gradient problems of LOGISTIC for
 * large probe inputs.
 */
const DEFAULT_STUDENT_SQUASH = "TANH";
/** Initial weight magnitude for input → student edges (small but non-zero). */
const STUDENT_INPUT_WEIGHT = 0.1;
/**
 * Initial weight magnitude for student → output edges. Kept small enough that
 * the student pathway is near-zero contribution at iteration zero — backprop
 * grows it as the student learns.
 */
const STUDENT_OUTPUT_WEIGHT = 0.001;

/** Captured teacher inputs/outputs for one probe pass. */
export interface TeacherCapture {
  inputs: Float32Array[];
  outputs: Float32Array[];
}

/** Options for {@link knowledgeDistillation}. */
export interface KnowledgeDistillationOptions {
  /** Probe dataset; the teacher's outputs on this dataset are the training target. */
  probe: DataRecordInterface[];
  /**
   * Number of student hidden neurons to add. Default
   * {@link DEFAULT_STUDENT_NEURONS}; clamped to [1, {@link MAX_STUDENT_NEURONS}].
   */
  studentNeurons?: number;
  /** Backprop iterations on the student pathway. Default {@link DEFAULT_ITERATIONS}. */
  iterations?: number;
  /** Learning rate for the student backprop. Default {@link DEFAULT_LEARNING_RATE}. */
  learningRate?: number;
  /** Deterministic RNG seed for student weight initialisation. */
  seed?: number;
  /** Activation function for the student hidden neurons. Default `TANH`. */
  squash?: string;
}

/**
 * Activate `teacher` on each `probe` sample and return the captured inputs
 * and outputs. The capture is reused for every student-pathway training step
 * so the teacher is never re-activated mid-training.
 */
export function captureTeacherActivations(
  teacher: Creature,
  probe: DataRecordInterface[],
): TeacherCapture {
  const inputs: Float32Array[] = [];
  const outputs: Float32Array[] = [];
  for (const sample of probe) {
    const inputCopy = new Float32Array(sample.input);
    const out = teacher.activate(inputCopy, false);
    inputs.push(inputCopy);
    outputs.push(new Float32Array(out));
  }
  return { inputs, outputs };
}

/**
 * Add a student pathway of `count` hidden neurons to `recipientExport`. Each
 * student neuron is wired from every input and to every output with small
 * seed weights so backprop has gradients to follow.
 *
 * Returns the new export plus the set of student neuron UUIDs (so the caller
 * can freeze every pre-existing neuron/synapse but leave the student
 * pathway trainable).
 */
export function addStudentPathway(
  recipientExport: CreatureExport,
  count: number,
  seed: number,
  squash: string = DEFAULT_STUDENT_SQUASH,
): { offspring: CreatureExport; studentUuids: Set<string> } {
  const rng = createSeededRng(seed);
  const offspringNeurons: NeuronExport[] = recipientExport.neurons.map((n) => ({
    ...n,
  }));
  const offspringSynapses: SynapseExport[] = recipientExport.synapses.map(
    (s) => ({ ...s }),
  );

  // Insert students before the first output neuron — keeps output indices
  // contiguous at the tail, matching the rest of the pipeline.
  let insertIndex = offspringNeurons.length;
  for (let i = offspringNeurons.length - 1; i >= 0; i--) {
    if (offspringNeurons[i].type === "output") insertIndex = i;
    else break;
  }

  const studentUuids = new Set<string>();
  const studentExports: NeuronExport[] = [];
  for (let i = 0; i < count; i++) {
    const uuid = `student-${seed}-${i}-${crypto.randomUUID()}`;
    studentUuids.add(uuid);
    const neuron: NeuronExport = {
      type: "hidden",
      uuid,
      squash,
      // Seeded random bias in [-0.1, 0.1] — small enough to be near-neutral
      // at initialisation, large enough to break symmetry between students.
      bias: (rng.random() - 0.5) * 0.2,
    };
    addTag(neuron, "approach", "knowledge-distillation");
    studentExports.push(neuron);
  }
  offspringNeurons.splice(insertIndex, 0, ...studentExports);

  const inputCount = recipientExport.input;
  const outputUuids = recipientExport.neurons
    .filter((n) => n.type === "output" && typeof n.uuid === "string")
    .map((n) => n.uuid as string);

  // Wire input → student. Small but non-zero so backprop has a starting
  // gradient signal.
  for (const studentUuid of studentUuids) {
    for (let i = 0; i < inputCount; i++) {
      offspringSynapses.push({
        fromUUID: `input-${i}`,
        toUUID: studentUuid,
        // Seeded random in [-STUDENT_INPUT_WEIGHT, +STUDENT_INPUT_WEIGHT].
        weight: (rng.random() - 0.5) * 2 * STUDENT_INPUT_WEIGHT,
      });
    }
  }

  // Wire student → output. Near-zero seed so the student pathway is roughly
  // score-neutral at iteration zero — training grows it as needed.
  for (const studentUuid of studentUuids) {
    for (const outUuid of outputUuids) {
      offspringSynapses.push({
        fromUUID: studentUuid,
        toUUID: outUuid,
        weight: (rng.random() - 0.5) * 2 * STUDENT_OUTPUT_WEIGHT,
      });
    }
  }

  const offspring: CreatureExport = {
    input: recipientExport.input,
    output: recipientExport.output,
    neurons: offspringNeurons,
    synapses: offspringSynapses,
    forwardOnly: recipientExport.forwardOnly,
  };
  return { offspring, studentUuids };
}

/**
 * Distil teacher behaviour into a clone of `recipient` by adding and
 * training a small student pathway. Returns the new Creature, or
 * `undefined` when input/output dims are incompatible or the resulting
 * topology fails {@link creatureValidate}.
 *
 * Pre-existing neuron `uuid`s and biases are preserved — every pre-existing
 * neuron and synapse is frozen for the duration of training.
 */
export function knowledgeDistillation(
  recipient: Creature,
  teacher: Creature,
  options: KnowledgeDistillationOptions,
): Creature | undefined {
  // Compatibility: teacher outputs are the training target, so output and
  // input dimensions must match.
  if (recipient.input !== teacher.input) return undefined;
  if (recipient.output !== teacher.output) return undefined;
  if (options.probe.length === 0) return undefined;

  const studentNeurons = clampStudentNeurons(
    options.studentNeurons ?? DEFAULT_STUDENT_NEURONS,
  );
  const iterations = Math.max(0, options.iterations ?? DEFAULT_ITERATIONS);
  const learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;
  const seed = options.seed ?? DEFAULT_SEED;
  const squash = options.squash ?? DEFAULT_STUDENT_SQUASH;

  // 1. Capture teacher outputs once — reused across every training step.
  const capture = captureTeacherActivations(teacher, options.probe);

  // 2. Build the offspring topology with the student pathway.
  const recipientExport = recipient.exportJSON();
  const { offspring: offspringExport, studentUuids } = addStudentPathway(
    recipientExport,
    studentNeurons,
    seed,
    squash,
  );

  let offspring: Creature;
  try {
    offspring = Creature.fromJSON(offspringExport);
    offspring.fix(
      offspringExport.forwardOnly ? { forwardOnly: true } : undefined,
    );
  } catch {
    return undefined;
  }

  // 3. Freeze every pre-existing neuron and every synapse that has no
  //    student endpoint — the student pathway is the only part we train.
  freezeNonStudent(offspring, studentUuids);

  // 4. Train the student pathway against the teacher's outputs.
  if (iterations > 0) {
    trainStudentPathway(offspring, capture, {
      iterations,
      learningRate,
      seed,
    });
  }

  // 5. Final validation. A failed graft is a no-op for the harness.
  try {
    if (offspringExport.forwardOnly) {
      creatureValidate(offspring, { forwardOnly: true });
    } else {
      creatureValidate(offspring);
    }
  } catch {
    return undefined;
  }
  return offspring;
}

/** Clamp the requested student count into [1, {@link MAX_STUDENT_NEURONS}]. */
function clampStudentNeurons(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_STUDENT_NEURONS;
  }
  return Math.min(MAX_STUDENT_NEURONS, Math.max(1, Math.floor(requested)));
}

/**
 * Freeze every neuron not in `studentUuids` and every synapse with no
 * student endpoint, so backprop only updates the student pathway.
 */
function freezeNonStudent(
  creature: Creature,
  studentUuids: Set<string>,
): void {
  // Map runtime indices to UUIDs once.
  const indexIsStudent = new Set<number>();
  for (const n of creature.neurons) {
    if (typeof n.uuid === "string" && studentUuids.has(n.uuid)) {
      if (typeof n.index === "number") indexIsStudent.add(n.index);
    }
  }

  for (const n of creature.neurons) {
    if (n.type === "input") continue; // Inputs have no bias to freeze.
    const isStudent = typeof n.uuid === "string" &&
      studentUuids.has(n.uuid);
    n.frozen = isStudent ? undefined : true;
  }

  for (const syn of creature.synapses) {
    const fromStudent = indexIsStudent.has(syn.from);
    const toStudent = indexIsStudent.has(syn.to);
    // A synapse is part of the student pathway if at least one endpoint is
    // a student neuron — input→student, student→student, student→output
    // are all trainable; existing→existing edges are frozen.
    syn.frozen = (fromStudent || toStudent) ? undefined : true;
  }
}

/**
 * Train `student` against the teacher capture using the existing backprop
 * machinery. Pre-existing neurons/synapses must already be frozen — only
 * student-pathway weights and biases will move.
 */
export function trainStudentPathway(
  student: Creature,
  capture: TeacherCapture,
  options: {
    iterations: number;
    learningRate: number;
    seed?: number;
  },
): void {
  if (capture.inputs.length === 0 || options.iterations <= 0) return;

  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: options.learningRate,
    plankConstant: 1e-7,
    maximumWeightAdjustmentScale: 1,
    maximumBiasAdjustmentScale: 1,
    disableRandomSamples: true,
    batchSize: Math.max(2, capture.inputs.length),
    learningRateStrategy: "fixed",
    trainingMutationRate: 1,
  });

  const json = exportJSONWithRuntimeIds(student);
  const sparseConfig = new SparseConfig(json, config);

  for (let iter = 0; iter < options.iterations; iter++) {
    for (let i = 0; i < capture.inputs.length; i++) {
      student.activateAndTrace(capture.inputs[i], false, sparseConfig);
      student.propagate(capture.outputs[i], config, sparseConfig);
    }
    student.applyLearnings(config, sparseConfig);
  }
}

/**
 * `DnaSharingStrategy` adapter for the bake-off harness.
 *
 * `prepare(recipient, teacher)` runs {@link knowledgeDistillation} and, on
 * success, mutates the recipient in place via `loadFrom`. On rejection
 * (incompatible dims or `creatureValidate` failure) the recipient is left
 * untouched.
 */
export class KnowledgeDistillationStrategy implements DnaSharingStrategy {
  readonly name = "KnowledgeDistillation";

  constructor(private readonly opts: KnowledgeDistillationOptions) {}

  prepare(
    recipient: Creature,
    donor: Creature,
    options: DnaSharingPrepareOptions,
  ): Promise<void> {
    const merged: KnowledgeDistillationOptions = {
      ...this.opts,
      seed: this.opts.seed ?? options.seed,
    };
    const distilled = knowledgeDistillation(recipient, donor, merged);
    if (distilled) {
      recipient.loadFrom(
        distilled.exportJSON(),
        false,
        "transfer:distillation",
      );
    }
    return Promise.resolve();
  }
}
