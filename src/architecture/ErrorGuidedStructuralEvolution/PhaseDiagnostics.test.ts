import { assertEquals } from "@std/assert";

import { PhaseDiagnostics } from "./PhaseDiagnostics.ts";

Deno.test("phase diagnostics tracks sequential and parallel phases", () => {
  const diag = new PhaseDiagnostics("initialisation");

  assertEquals(diag.getCurrentPhase(), "initialisation");
  assertEquals(diag.getActiveParallelPhases(), []);

  diag.enterPhase("analysis_loop");
  assertEquals(diag.getCurrentPhase(), "analysis_loop");

  const stopNeurons = diag.startParallelPhase("analyze_neurons");
  const stopSynapses = diag.startParallelPhase("analyze_helpful");

  assertEquals(diag.getActiveParallelPhases(), [
    "analyze_helpful",
    "analyze_neurons",
  ]);

  stopNeurons();
  assertEquals(diag.getActiveParallelPhases(), ["analyze_helpful"]);

  stopSynapses();
  assertEquals(diag.getActiveParallelPhases(), []);

  diag.enterPhase("cleanup");
  assertEquals(diag.getCurrentPhase(), "cleanup");
  assertEquals(diag.getActiveParallelPhases(), []);
});

Deno.test("phase diagnostics snapshot reports active phases", () => {
  const diag = new PhaseDiagnostics("initialisation");
  const stopSquash = diag.startParallelPhase("analyze_squash");
  const stopHarmful = diag.startParallelPhase("analyze_harmful");

  const snapshot = diag.snapshot();
  assertEquals(snapshot.currentPhase, "initialisation");
  assertEquals(snapshot.parallelPhases, [
    "analyze_harmful",
    "analyze_squash",
  ]);

  stopSquash();
  stopHarmful();

  const clearedSnapshot = diag.snapshot();
  assertEquals(clearedSnapshot.parallelPhases, []);
});
