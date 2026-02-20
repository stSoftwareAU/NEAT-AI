import { assertEquals } from "@std/assert";
import type { PredictionNodeState } from "../../src/architecture/PredictionNodeState.ts";

Deno.test("PredictionNodeState - can create and read state", () => {
  const state: PredictionNodeState = {
    prediction: 0.5,
    error: 0.1,
    latent: 0.3,
  };
  assertEquals(state.prediction, 0.5);
  assertEquals(state.error, 0.1);
  assertEquals(state.latent, 0.3);
});

Deno.test("PredictionNodeState - supports zero values", () => {
  const state: PredictionNodeState = {
    prediction: 0,
    error: 0,
    latent: 0,
  };
  assertEquals(state.prediction, 0);
  assertEquals(state.error, 0);
  assertEquals(state.latent, 0);
});

Deno.test("PredictionNodeState - supports negative values", () => {
  const state: PredictionNodeState = {
    prediction: -0.5,
    error: -0.3,
    latent: -0.7,
  };
  assertEquals(state.prediction, -0.5);
  assertEquals(state.error, -0.3);
  assertEquals(state.latent, -0.7);
});
