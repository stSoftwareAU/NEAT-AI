/**
 * Tests for the training loop phase (Issue #2399).
 *
 * Exercises the loop by writing a tiny binary training file to a temp
 * directory, driving the orchestrator through `trainDir`, and asserting
 * on the structure of the returned {@link TrainingResult}.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { trainDir } from "@architecture/Training.ts";
import { Costs } from "@costs";

/** Write a sequence of XOR-shaped records to a binary file. */
function writeXorDataset(path: string, samples: number): void {
  const bytesPerRecord = (2 + 1) * 4; // 2 inputs + 1 output, Float32
  const buffer = new Uint8Array(bytesPerRecord * samples);
  const view = new Float32Array(buffer.buffer);

  for (let i = 0; i < samples; i++) {
    const a = i & 1;
    const b = (i >> 1) & 1;
    const y = a ^ b;
    view[i * 3 + 0] = a;
    view[i * 3 + 1] = b;
    view[i * 3 + 2] = y;
  }

  Deno.writeFileSync(path, buffer);
}

Deno.test("TrainingLoop - trainDir returns a well-formed result for a tiny dataset", () => {
  const dir = Deno.makeTempDirSync({ prefix: "training-loop-" });
  try {
    writeXorDataset(`${dir}/xor.bin`, 8);

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const result = trainDir(creature, dir, {
      iterations: 2,
      targetError: 0.01,
      disableRandomSamples: true,
    }, Costs.find("MSE"));

    assertEquals(typeof result.ID, "string");
    assert(result.ID.length <= 8);
    assert(result.iteration >= 1);
    assert(Number.isFinite(result.error));
    assert(result.trace !== undefined);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("TrainingLoop - trainDir stops when it reaches the target error", () => {
  const dir = Deno.makeTempDirSync({ prefix: "training-loop-" });
  try {
    writeXorDataset(`${dir}/xor.bin`, 4);

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    // Set a trivially-achievable target so termination fires quickly.
    const result = trainDir(creature, dir, {
      iterations: 50,
      targetError: 10,
      disableRandomSamples: true,
    }, Costs.find("MSE"));

    // With such a loose target, the loop must exit within the first
    // pass rather than running all 50 iterations.
    assert(result.iteration < 50);
    assert(result.error <= 10);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
