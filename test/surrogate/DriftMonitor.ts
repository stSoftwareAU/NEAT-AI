/**
 * The signed-bias drift monitor (Issue #3933).
 *
 * The distinction the monitor exists for: **symmetric error is ordinary
 * noise; persistent one-directional bias is the false-optimum signature.** A
 * monitor that trips on the first is useless, and one that misses the second
 * lets the search converge onto an optimum of the model.
 *
 * The GRQ case is the hard one and is tested explicitly: a bias of 1e-04 on
 * scores around 0.36 is invisible to any aggregate accuracy metric and is ten
 * times the 1e-05 improvements the lineage selects on.
 */

import { assert, assertEquals } from "@std/assert";
import { SignedBiasDriftMonitor } from "@surrogate/DriftMonitor.ts";
import { resolveSurrogateUncertaintyConfig } from "@config/SurrogateUncertaintyConfig.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";

const CONFIG = resolveSurrogateUncertaintyConfig({
  driftGenerations: 3,
  driftBiasRatio: 0.5,
  driftMinSamples: 8,
});

Deno.test("drift monitor — symmetric noise never disables the surrogate", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  const rng = createSeededRng(3933);
  for (let generation = 1; generation <= 40; generation++) {
    for (let i = 0; i < 20; i++) {
      const exact = 0.36 + (rng.random() - 0.5) * 0.01;
      // Error of the same magnitude as the GRQ bias below, but with no
      // direction to it.
      monitor.record(exact + (rng.random() - 0.5) * 2e-4, exact);
    }
    monitor.closeGeneration(generation);
  }
  assertEquals(monitor.escalated, false);
  assert(Math.abs(monitor.runBiasRatio ?? 1) < 0.5);
});

Deno.test("drift monitor — a 1e-04 one-directional bias disables the surrogate", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  const rng = createSeededRng(3933);
  let disabledAt: number | null = null;
  for (let generation = 1; generation <= 10; generation++) {
    for (let i = 0; i < 20; i++) {
      const exact = 0.36 + (rng.random() - 0.5) * 0.01;
      // Consistently optimistic by 1e-04 with 5e-05 of noise on top: well
      // inside the model's own validation error, and fatal.
      monitor.record(exact + 1e-4 + (rng.random() - 0.5) * 5e-5, exact);
    }
    const reading = monitor.closeGeneration(generation);
    if (reading.escalated && disabledAt === null) disabledAt = generation;
  }
  assertEquals(monitor.escalated, true);
  assertEquals(disabledAt, 3);
  assertEquals(monitor.escalatedGeneration, 3);
  assert((monitor.runSignedBias ?? 0) > 0);
});

Deno.test("drift monitor — a bias that changes direction is not a trend", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  for (let generation = 1; generation <= 12; generation++) {
    const direction = generation % 2 === 0 ? 1 : -1;
    for (let i = 0; i < 20; i++) {
      monitor.record(0.5 + direction * 1e-3, 0.5);
    }
    monitor.closeGeneration(generation);
  }
  assertEquals(monitor.escalated, false);
});

Deno.test("drift monitor — too few residuals is undecidable, never a pass", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  for (let i = 0; i < 4; i++) monitor.record(0.6, 0.5);
  const reading = monitor.closeGeneration(1);
  assertEquals(reading.biasRatio, null);
  assertEquals(reading.streak, 0);
  assertEquals(monitor.escalated, false);
  // The signed bias is still reported — it is the ratio that is undecidable.
  assert(reading.signedBias > 0);
});

Deno.test("drift monitor — an undecidable generation does not reset a streak", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  for (let i = 0; i < 20; i++) monitor.record(0.61, 0.6);
  assertEquals(monitor.closeGeneration(1).streak, 1);
  for (let i = 0; i < 3; i++) monitor.record(0.61, 0.6);
  assertEquals(monitor.closeGeneration(2).streak, 1);
  for (let i = 0; i < 20; i++) monitor.record(0.61, 0.6);
  assertEquals(monitor.closeGeneration(3).streak, 2);
});

Deno.test("drift monitor — a non-finite score teaches it nothing", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  for (let i = 0; i < 20; i++) monitor.record(0.5, -Infinity);
  const reading = monitor.closeGeneration(1);
  assertEquals(reading.samples, 0);
  assertEquals(monitor.runResiduals, 0);
});

Deno.test("drift monitor — the escalation line names the cause and the remedy", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  let line: string | undefined;
  for (let generation = 1; generation <= 3; generation++) {
    for (let i = 0; i < 20; i++) monitor.record(0.62, 0.6);
    line = monitor.describe(monitor.closeGeneration(generation));
  }
  assert(line !== undefined);
  assert(line.includes("DISABLED"), line);
  assert(line.includes("false-optimum"), line);
});

Deno.test("drift monitor — reset clears the escalation for a new run", () => {
  const monitor = new SignedBiasDriftMonitor(CONFIG);
  for (let generation = 1; generation <= 3; generation++) {
    for (let i = 0; i < 20; i++) monitor.record(0.62, 0.6);
    monitor.closeGeneration(generation);
  }
  assertEquals(monitor.escalated, true);
  monitor.reset();
  assertEquals(monitor.escalated, false);
  assertEquals(monitor.runResiduals, 0);
  assertEquals(monitor.lastGeneration, undefined);
});
