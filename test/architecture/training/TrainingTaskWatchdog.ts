/**
 * Tests for the per-task wall-clock watchdog (Issue #3053).
 *
 * The per-task timeout is now evaluated on every sample rather than only
 * behind the 60s progress-log gate, so a task whose deadline has already
 * passed must abandon promptly instead of running the full iteration budget.
 *
 * These are "what" tests: they assert on the returned iteration count, not on
 * timing. A fixed past deadline (`hardDeadlineTS: 1`, i.e. 1970) drives the
 * timeout deterministically without any timing API (#2888 policy).
 */

import { assertEquals } from "@std/assert";
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
    view[i * 3 + 0] = a;
    view[i * 3 + 1] = b;
    view[i * 3 + 2] = a ^ b;
  }

  Deno.writeFileSync(path, buffer);
}

Deno.test("TrainingTaskWatchdog - an already-expired deadline stops on the first iteration", () => {
  const dir = Deno.makeTempDirSync({ prefix: "training-watchdog-" });
  try {
    writeXorDataset(`${dir}/xor.bin`, 8);

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const result = trainDir(creature, dir, {
      // Many iterations requested, target unreachable — only the watchdog
      // can stop the run early.
      iterations: 50,
      targetError: 0.000_000_1,
      disableRandomSamples: true,
      // Deadline already in the past (epoch ms 1 = 1970). With the timeout
      // check evaluated per-sample, training must abandon on the first
      // iteration rather than completing all 50.
      hardDeadlineTS: 1,
    }, Costs.find("MSE"));

    assertEquals(result.iteration, 1);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("TrainingTaskWatchdog - no deadline runs the full iteration budget", () => {
  const dir = Deno.makeTempDirSync({ prefix: "training-watchdog-" });
  try {
    writeXorDataset(`${dir}/xor.bin`, 8);

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const result = trainDir(creature, dir, {
      iterations: 5,
      targetError: 0.000_000_1,
      disableRandomSamples: true,
    }, Costs.find("MSE"));

    // Without a deadline the watchdog never trips, so the loop exhausts the
    // requested iterations (target is unreachable on XOR with this budget).
    assertEquals(result.iteration, 5);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
