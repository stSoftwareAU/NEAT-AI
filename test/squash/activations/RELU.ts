import { assertEquals, assertThrows } from "@std/assert";
import { RELU } from "../../../src/methods/activations/types/RELU.ts";

Deno.test("RELU.derivative returns correct values", () => {
  const relu = new RELU();

  // Normal cases
  assertEquals(relu.derivative(5), 1);
  assertEquals(relu.derivative(0.1), 1);
  assertEquals(relu.derivative(0), 0);
  assertEquals(relu.derivative(-0.00001), 0);
  assertEquals(relu.derivative(-1000), 0);

  // Edge finite values
  assertEquals(relu.derivative(Number.MIN_VALUE), 1); // Still > 0
  assertEquals(relu.derivative(-Number.MIN_VALUE), 0); // Negative small

  // Large magnitude
  assertEquals(relu.derivative(Number.MAX_VALUE), 1);
  assertEquals(relu.derivative(-Number.MAX_VALUE), 0);
});

Deno.test("RELU.derivative throws for non-finite values", () => {
  const relu = new RELU();

  assertThrows(() => relu.derivative(NaN), "Non-finite input");
  assertThrows(() => relu.derivative(Infinity), "Non-finite input");
  assertThrows(() => relu.derivative(-Infinity), "Non-finite input");
});
