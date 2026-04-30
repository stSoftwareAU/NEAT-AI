/**
 * Tests for KnowledgeDistillation (Issue #2494).
 *
 * Knowledge distillation is the orthogonal-to-graft DNA-sharing primitive:
 * instead of transplanting Europa's structure into the production creature,
 * we add a small new student pathway in production and train it (using the
 * existing backprop machinery) to imitate Europa's outputs on a probe
 * dataset.
 *
 * The pre-existing topology must be left untouched — UUIDs and biases of
 * pre-existing neurons must not drift, per the AGENTS.md neuron UUID
 * stability invariant.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  captureTeacherActivations,
  knowledgeDistillation,
  KnowledgeDistillationStrategy,
} from "@transfer/KnowledgeDistillation.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Build a simple creature from raw neuron uuids and connection triples. */
function buildCreature(
  inputCount: number,
  hiddenUUIDs: string[],
  outputCount: number,
  connections: Array<{ from: string; to: string; weight: number }>,
  biases: Record<string, number> = {},
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "TANH",
    bias: biases[uuid] ?? 0.1,
  }));
  for (let i = 0; i < outputCount; i++) {
    const uuid = `output-${i}`;
    neurons.push({
      type: "output",
      uuid,
      squash: "IDENTITY",
      bias: biases[uuid] ?? 0,
    });
  }
  const synapses = connections.map((c) => ({
    fromUUID: c.from,
    toUUID: c.to,
    weight: c.weight,
  }));
  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };
  return Creature.fromJSON(json);
}

/**
 * Build a "Europa-style" teacher with a noticeable non-linear behaviour the
 * student pathway can learn to imitate.
 */
function createTeacher(): Creature {
  return buildCreature(
    2,
    ["t0", "t1", "t2"],
    1,
    [
      { from: "input-0", to: "t0", weight: 0.7 },
      { from: "input-1", to: "t0", weight: -0.3 },
      { from: "input-0", to: "t1", weight: -0.5 },
      { from: "input-1", to: "t1", weight: 0.6 },
      { from: "t0", to: "t2", weight: 0.4 },
      { from: "t1", to: "t2", weight: 0.5 },
      { from: "t2", to: "output-0", weight: 0.8 },
    ],
  );
}

/** Build a smaller "production-style" recipient with a different topology. */
function createRecipient(): Creature {
  return buildCreature(
    2,
    ["pA"],
    1,
    [
      { from: "input-0", to: "pA", weight: 0.2 },
      { from: "input-1", to: "pA", weight: 0.1 },
      { from: "pA", to: "output-0", weight: 0.3 },
    ],
  );
}

function buildProbe(): DataRecordInterface[] {
  const probe: DataRecordInterface[] = [];
  const points = [
    [0.1, 0.9],
    [0.4, 0.6],
    [0.5, 0.5],
    [0.7, 0.2],
    [0.9, 0.1],
    [0.2, 0.4],
    [0.6, 0.8],
    [0.3, 0.3],
  ];
  for (const [a, b] of points) {
    probe.push({
      input: new Float32Array([a, b]),
      // Output is a placeholder — distillation overrides with teacher output.
      output: new Float32Array([0]),
    });
  }
  return probe;
}

Deno.test("captureTeacherActivations - records one output row per probe sample", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const probe = buildProbe();

  const capture = captureTeacherActivations(teacher, probe);

  assertEquals(capture.outputs.length, probe.length);
  assertEquals(capture.inputs.length, probe.length);
  for (let i = 0; i < probe.length; i++) {
    assertEquals(capture.outputs[i].length, teacher.output);
    assertEquals(capture.inputs[i].length, teacher.input);
    for (const v of capture.outputs[i]) {
      assert(Number.isFinite(v), `teacher output must be finite, got ${v}`);
    }
  }
});

Deno.test("captureTeacherActivations - is deterministic for fixed teacher and probe", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const probe = buildProbe();

  const a = captureTeacherActivations(teacher, probe);
  const b = captureTeacherActivations(teacher, probe);

  for (let i = 0; i < probe.length; i++) {
    assertEquals(
      Array.from(a.outputs[i]),
      Array.from(b.outputs[i]),
      `teacher capture must be deterministic for sample ${i}`,
    );
  }
});

Deno.test("knowledgeDistillation - returns a distilled creature that passes creatureValidate", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const recipient = createRecipient();
  const probe = buildProbe();

  const distilled = knowledgeDistillation(recipient, teacher, {
    probe,
    studentNeurons: 4,
    iterations: 20,
    learningRate: 0.05,
    seed: 7,
  });

  assert(distilled, "knowledgeDistillation must produce a creature");
  creatureValidate(distilled);
});

Deno.test("knowledgeDistillation - adds a bounded student pathway", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const recipient = createRecipient();
  const before = recipient.neurons.length;
  const studentNeurons = 4;

  const distilled = knowledgeDistillation(recipient, teacher, {
    probe: buildProbe(),
    studentNeurons,
    iterations: 5,
    learningRate: 0.05,
    seed: 1,
  });
  assert(distilled);
  const after = distilled.neurons.length;
  assertEquals(
    after - before,
    studentNeurons,
    `expected exactly ${studentNeurons} new neurons, got ${after - before}`,
  );
});

Deno.test("knowledgeDistillation - clamps studentNeurons to the safety cap of 64", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const recipient = createRecipient();
  const before = recipient.neurons.length;

  const distilled = knowledgeDistillation(recipient, teacher, {
    probe: buildProbe(),
    studentNeurons: 1024,
    iterations: 1,
    learningRate: 0.05,
    seed: 1,
  });
  assert(distilled);
  const added = distilled.neurons.length - before;
  assert(added <= 64, `student pathway must be capped at 64, got ${added}`);
});

Deno.test("knowledgeDistillation - preserves pre-existing neuron UUIDs verbatim", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const recipient = createRecipient();
  const recipientUuidsBefore = new Set(
    recipient.exportJSON().neurons
      .map((n) => n.uuid)
      .filter((u): u is string => typeof u === "string"),
  );

  const distilled = knowledgeDistillation(recipient, teacher, {
    probe: buildProbe(),
    studentNeurons: 4,
    iterations: 5,
    learningRate: 0.05,
    seed: 1,
  });
  assert(distilled);
  const distilledUuids = new Set(
    distilled.exportJSON().neurons
      .map((n) => n.uuid)
      .filter((u): u is string => typeof u === "string"),
  );
  for (const u of recipientUuidsBefore) {
    assert(
      distilledUuids.has(u),
      `recipient UUID ${u} must survive distillation (UUID stability invariant)`,
    );
  }
});

Deno.test("knowledgeDistillation - leaves pre-existing biases unchanged", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const recipient = createRecipient();
  const beforeBiases = new Map<string, number>();
  for (const n of recipient.exportJSON().neurons) {
    if (typeof n.uuid === "string") beforeBiases.set(n.uuid, n.bias);
  }

  const distilled = knowledgeDistillation(recipient, teacher, {
    probe: buildProbe(),
    studentNeurons: 4,
    iterations: 20,
    learningRate: 0.1,
    seed: 1,
  });
  assert(distilled);
  for (const n of distilled.exportJSON().neurons) {
    if (typeof n.uuid === "string" && beforeBiases.has(n.uuid)) {
      assertEquals(
        n.bias,
        beforeBiases.get(n.uuid),
        `bias of pre-existing neuron ${n.uuid} must not change during distillation`,
      );
    }
  }
});

Deno.test("knowledgeDistillation - reduces teacher-student MSE on the probe", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  const recipient = createRecipient();
  const probe = buildProbe();
  const teacherCapture = captureTeacherActivations(teacher, probe);

  const initialDistilled = knowledgeDistillation(recipient, teacher, {
    probe,
    studentNeurons: 6,
    iterations: 0,
    learningRate: 0.05,
    seed: 3,
  });
  assert(initialDistilled);
  const initialMse = computeMse(initialDistilled, teacherCapture);

  const recipient2 = createRecipient();
  const trained = knowledgeDistillation(recipient2, teacher, {
    probe,
    studentNeurons: 6,
    iterations: 200,
    learningRate: 0.05,
    seed: 3,
  });
  assert(trained);
  const trainedMse = computeMse(trained, teacherCapture);

  assert(
    trainedMse < initialMse,
    `training must reduce teacher-student MSE: initial=${initialMse}, trained=${trainedMse}`,
  );
});

Deno.test("knowledgeDistillation - returns undefined when input/output dims do not match", async () => {
  await initWasmForTests();
  const teacher = createTeacher();
  // Recipient with 3 inputs, but teacher has 2 — incompatible.
  const recipient = buildCreature(
    3,
    ["pA"],
    1,
    [
      { from: "input-0", to: "pA", weight: 0.2 },
      { from: "input-1", to: "pA", weight: 0.1 },
      { from: "input-2", to: "pA", weight: 0.1 },
      { from: "pA", to: "output-0", weight: 0.3 },
    ],
  );
  const result = knowledgeDistillation(recipient, teacher, {
    probe: buildProbe(),
    studentNeurons: 4,
    iterations: 5,
    learningRate: 0.05,
    seed: 1,
  });
  assertEquals(
    result,
    undefined,
    "incompatible donor/recipient must be a graceful no-op",
  );
});

Deno.test(
  "KnowledgeDistillationStrategy - conforms to DnaSharingStrategy and adds a student pathway",
  async () => {
    await initWasmForTests();
    const recipient = createRecipient();
    const teacher = createTeacher();
    const before = recipient.neurons.length;

    const strategy = new KnowledgeDistillationStrategy({
      probe: buildProbe(),
      studentNeurons: 4,
      iterations: 5,
      learningRate: 0.05,
    });
    assertEquals(strategy.name, "KnowledgeDistillation");

    await strategy.prepare(recipient, teacher, { seed: 1, generations: 1 });
    assert(
      recipient.neurons.length > before,
      `recipient must grow after distillation (was ${before}, now ${recipient.neurons.length})`,
    );
    creatureValidate(recipient);
  },
);

Deno.test(
  "KnowledgeDistillationStrategy - is a no-op when distillation is rejected",
  async () => {
    await initWasmForTests();
    // 3-input recipient, 2-input teacher — incompatible.
    const recipient = buildCreature(
      3,
      ["pA"],
      1,
      [
        { from: "input-0", to: "pA", weight: 0.2 },
        { from: "input-1", to: "pA", weight: 0.1 },
        { from: "input-2", to: "pA", weight: 0.1 },
        { from: "pA", to: "output-0", weight: 0.3 },
      ],
    );
    const teacher = createTeacher();
    const before = recipient.neurons.length;
    const strategy = new KnowledgeDistillationStrategy({
      probe: buildProbe(),
      studentNeurons: 4,
      iterations: 1,
      learningRate: 0.05,
    });
    await strategy.prepare(recipient, teacher, { seed: 1, generations: 1 });
    assertEquals(
      recipient.neurons.length,
      before,
      "recipient must be unchanged when distillation is rejected",
    );
  },
);

Deno.test(
  "knowledgeDistillation - student pathway changes recipient outputs vs baseline",
  async () => {
    await initWasmForTests();
    const teacher = createTeacher();
    const recipient = createRecipient();
    const baselineOutputs: number[] = [];
    for (const sample of buildProbe()) {
      baselineOutputs.push(recipient.activate(sample.input, false)[0]);
    }

    const distilled = knowledgeDistillation(recipient, teacher, {
      probe: buildProbe(),
      studentNeurons: 6,
      iterations: 100,
      learningRate: 0.1,
      seed: 5,
    });
    assert(distilled);
    let differs = false;
    const probe = buildProbe();
    for (let i = 0; i < probe.length; i++) {
      const out = distilled.activate(probe[i].input, false)[0];
      if (Math.abs(out - baselineOutputs[i]) > 1e-6) {
        differs = true;
        break;
      }
    }
    assert(
      differs,
      "distilled creature outputs must differ from the unmodified recipient",
    );
    // And per the bias-preservation test, this must be due to the student
    // pathway only — the asserts in other tests guarantee no UUID/bias drift.
    assertNotEquals(distilled.neurons.length, recipient.neurons.length);
  },
);

/** Mean-squared-error between a creature's outputs and a teacher capture. */
function computeMse(
  creature: Creature,
  capture: { inputs: Float32Array[]; outputs: Float32Array[] },
): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < capture.inputs.length; i++) {
    const out = creature.activate(capture.inputs[i], false);
    for (let j = 0; j < out.length; j++) {
      const diff = out[j] - capture.outputs[i][j];
      total += diff * diff;
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}
