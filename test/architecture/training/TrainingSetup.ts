/**
 * Tests for the pre-training setup phase (Issue #2399).
 *
 * These tests exercise the setup module directly without driving the
 * whole training pipeline.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  dataFiles,
  fp,
  prepareTraining,
  resolveIterations,
  resolveTargetError,
  resolveTrainingSampleRate,
} from "@architecture/training/TrainingSetup.ts";

Deno.test("TrainingSetup - resolveTargetError clamps tiny/absent values", () => {
  assertEquals(resolveTargetError({}), 0.05);
  assertEquals(resolveTargetError({ targetError: 0.001 }), 0.001);
  // Clamped to a tiny positive floor
  assertEquals(resolveTargetError({ targetError: 0 }), 0.000_000_1);
  // Non-finite falls back to default
  assertEquals(resolveTargetError({ targetError: NaN }), 0.05);
});

Deno.test("TrainingSetup - resolveIterations guarantees at least one pass", () => {
  // Default (undefined) uses 2 passes.
  assertEquals(resolveIterations({}), 2);
  assertEquals(resolveIterations({ iterations: 10 }), 10);
  // Falsy iterations (0) trigger the default branch → 2.
  assertEquals(resolveIterations({ iterations: 0 }), 2);
  // Negative values are clamped up to 1.
  assertEquals(resolveIterations({ iterations: -5 }), 1);
});

Deno.test("TrainingSetup - resolveTrainingSampleRate clamps to (0,1]", () => {
  assertEquals(resolveTrainingSampleRate({}), 1);
  assertEquals(resolveTrainingSampleRate({ trainingSampleRate: 0.5 }), 0.5);
  assertEquals(resolveTrainingSampleRate({ trainingSampleRate: 5 }), 1);
  assertEquals(
    resolveTrainingSampleRate({ trainingSampleRate: 0 }),
    0.0001,
  );
});

Deno.test("TrainingSetup - fp formats 100% specially", () => {
  // Just verify the 100% branch and the non-100% branch both return strings.
  const full = fp(1);
  const half = fp(0.5);
  assert(full.includes("100%"));
  assert(half.includes("50.0%"));
});

Deno.test("TrainingSetup - dataFiles returns an empty list for empty dir", () => {
  const dir = Deno.makeTempDirSync({ prefix: "training-setup-" });
  try {
    const result = dataFiles(dir);
    assertEquals(result.files.length, 0);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("TrainingSetup - dataFiles finds .bin files only", () => {
  const dir = Deno.makeTempDirSync({ prefix: "training-setup-" });
  try {
    Deno.writeFileSync(`${dir}/a.bin`, new Uint8Array([1, 2, 3, 4]));
    Deno.writeFileSync(`${dir}/b.bin`, new Uint8Array([5, 6, 7, 8]));
    Deno.writeFileSync(`${dir}/ignore.txt`, new Uint8Array([0]));

    const result = dataFiles(dir, { disableRandomSamples: true });
    assertEquals(result.files.length, 2);
    // With disableRandomSamples we expect stable order.
    assert(result.files[0].endsWith("a.bin"));
    assert(result.files[1].endsWith("b.bin"));
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("TrainingSetup - prepareTraining allocates buffers and applies options", () => {
  const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
  const setup = prepareTraining(
    creature,
    {
      iterations: 7,
      targetError: 0.01,
      trainingSampleRate: 0.5,
      feedbackLoop: true,
      trainingTimeOutMinutes: 3,
    },
    "abcd1234",
  );

  assertEquals(setup.ID, "abcd1234");
  assertEquals(setup.iterations, 7);
  assertEquals(setup.targetError, 0.01);
  assertEquals(setup.trainingSampleRate, 0.5);
  assertEquals(setup.feedbackLoop, true);
  assertEquals(setup.trainingTimeOutMinutes, 3);
  // 3 inputs + 2 outputs * 4 bytes
  assertEquals(setup.BYTES_PER_RECORD, (3 + 2) * 4);
  assertEquals(setup.observationsBuffer.length, 3);
  assertEquals(setup.targetsBuffer.length, 2);
  assertEquals(setup.syntheticKeys, undefined);
  // bestCreatureJSON should match creature I/O counts.
  assertEquals(setup.bestCreatureJSON.input, 3);
  assertEquals(setup.bestCreatureJSON.output, 2);
});
