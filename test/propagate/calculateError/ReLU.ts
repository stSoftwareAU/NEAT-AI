import { assertEquals } from "@std/assert";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";

Deno.test("ReLU.calculateError: active region", () => {
  const relu = new ReLU();

  assertEquals(relu.calculateError(1.0, 1.0), 0.0);
  assertEquals(relu.calculateError(0.5, 1.0), 0.5);
  assertEquals(relu.calculateError(1.5, 1.0), -0.5);
});

Deno.test("ReLU.calculateError: inactive region", () => {
  const relu = new ReLU();

  assertEquals(relu.calculateError(0.0, 0.0), 0.0);
  assertEquals(relu.calculateError(0.0, 1.0), 1.0);
  assertEquals(relu.calculateError(0.0, 0.5), 0.5);
});

Deno.test("ReLU.calculateError: flat region with hint", () => {
  const relu = new ReLU();

  // currentActivation = 0 → from raw = -10
  // targetActivation = 1 → from raw = 1
  const error = relu.calculateError(0.0, 1.0, -10);
  assertEquals(error, 11.0);
});
