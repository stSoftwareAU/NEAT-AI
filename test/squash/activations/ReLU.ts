import { assertEquals, assertThrows } from "@std/assert";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";

Deno.test("RELU.derivative returns correct values", () => {
  const relu = new ReLU();

  assertEquals(relu.derivative(5), 1);
  assertEquals(relu.derivative(0.00001), 1);
  assertEquals(relu.derivative(Number.MIN_VALUE), 1); // Still positive

  assertEquals(relu.derivative(0), 0);
  assertEquals(relu.derivative(-0.00001), 0);
  assertEquals(relu.derivative(-5), 0);
  assertEquals(relu.derivative(-Number.MIN_VALUE), 0);

  assertEquals(relu.derivative(Number.MAX_VALUE), 1);
  assertEquals(relu.derivative(-Number.MAX_VALUE), 0);
});

Deno.test("RELU.derivative throws on non-finite input", () => {
  const relu = new ReLU();

  assertThrows(() => relu.derivative(NaN), "Non-finite");
  assertThrows(() => relu.derivative(Infinity), "Non-finite");
  assertThrows(() => relu.derivative(-Infinity), "Non-finite");
});

Deno.test("RELU.unSquash handles positive activation", () => {
  const relu = new ReLU();

  assertEquals(relu.unSquash(5), 5);
  assertEquals(relu.unSquash(0.0001), 0.0001);
  assertEquals(relu.unSquash(Number.MAX_VALUE), Number.MAX_VALUE);
});

Deno.test("RELU.unSquash uses finite hint if activation is 0", () => {
  const relu = new ReLU();

  assertEquals(relu.unSquash(0, 5), 5);
  assertEquals(relu.unSquash(0, -2), -2); // Even if it's negative
  assertEquals(relu.unSquash(0, 0), 0);
  assertEquals(relu.unSquash(0, Number.MIN_VALUE), Number.MIN_VALUE);
});

Deno.test("RELU.unSquash returns 0 if no hint or non-finite hint", () => {
  const relu = new ReLU();

  assertEquals(relu.unSquash(0), 0);
  assertEquals(relu.unSquash(0, NaN), 0);
  assertEquals(relu.unSquash(0, Infinity), 0);
  assertEquals(relu.unSquash(0, -Infinity), 0);
});

Deno.test("RELU.unSquash validates activation range", () => {
  const relu = new ReLU();

  // Valid range checks
  assertEquals(relu.unSquash(0.5, 1), 0.5);
  assertEquals(relu.unSquash(0, -1), -1);

  // Invalid activation should trigger validation error
  assertThrows(() => relu.unSquash(-1, 5), "ReLU");
});
