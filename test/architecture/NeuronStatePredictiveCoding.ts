import { assertEquals } from "@std/assert";
import { NeuronState } from "../../src/architecture/CreatureState.ts";

Deno.test("NeuronState - PC fields are undefined by default", () => {
  const state = new NeuronState();
  assertEquals(state.prediction, undefined);
  assertEquals(state.predictionError, undefined);
  assertEquals(state.latentValue, undefined);
});

Deno.test("NeuronState - PC fields can be set and read", () => {
  const state = new NeuronState();
  state.prediction = 0.5;
  state.predictionError = 0.1;
  state.latentValue = 0.3;
  assertEquals(state.prediction, 0.5);
  assertEquals(state.predictionError, 0.1);
  assertEquals(state.latentValue, 0.3);
});

Deno.test("NeuronState - reset clears PC fields", () => {
  const state = new NeuronState();
  state.prediction = 0.5;
  state.predictionError = 0.1;
  state.latentValue = 0.3;
  state.reset();
  assertEquals(state.prediction, undefined);
  assertEquals(state.predictionError, undefined);
  assertEquals(state.latentValue, undefined);
});

Deno.test("NeuronState - PC fields do not affect existing behaviour", () => {
  const state = new NeuronState();
  // Verify the existing fields still work as expected
  assertEquals(state.count, 0);
  assertEquals(state.totalBias, 0);
  assertEquals(state.totalAdjustedBias, 0);
  assertEquals(state.hintValue, 0);
  assertEquals(state.maximumActivation, -Infinity);
  assertEquals(state.minimumActivation, Infinity);
  assertEquals(state.totalActivation, 0);
  assertEquals(state.totalErrorAbsolute, 0);

  // Set PC fields and verify existing fields are unaffected
  state.prediction = 1.0;
  state.predictionError = 0.5;
  state.latentValue = 0.8;
  assertEquals(state.count, 0);
  assertEquals(state.totalBias, 0);
});
