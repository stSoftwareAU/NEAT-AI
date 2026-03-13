import { assertEquals } from "@std/assert";
import { ErrorHelper } from "../../src/propagate/ErrorHelper.ts";

Deno.test("ErrorHelper.calculateClampedError - returns 0 for NaN", () => {
  assertEquals(ErrorHelper.calculateClampedError(NaN), 0);
});

Deno.test("ErrorHelper.calculateClampedError - returns 0 for Infinity", () => {
  assertEquals(ErrorHelper.calculateClampedError(Infinity), 0);
  assertEquals(ErrorHelper.calculateClampedError(-Infinity), 0);
});

Deno.test("ErrorHelper.calculateClampedError - passes through value within default range", () => {
  assertEquals(ErrorHelper.calculateClampedError(50), 50);
  assertEquals(ErrorHelper.calculateClampedError(-50), -50);
  assertEquals(ErrorHelper.calculateClampedError(0), 0);
  assertEquals(ErrorHelper.calculateClampedError(99.9), 99.9);
});

Deno.test("ErrorHelper.calculateClampedError - clamps positive overflow to maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(150), 100);
  assertEquals(ErrorHelper.calculateClampedError(1000), 100);
});

Deno.test("ErrorHelper.calculateClampedError - clamps negative overflow to -maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(-150), -100);
  assertEquals(ErrorHelper.calculateClampedError(-1000), -100);
});

Deno.test("ErrorHelper.calculateClampedError - exact boundary values", () => {
  assertEquals(ErrorHelper.calculateClampedError(100), 100);
  assertEquals(ErrorHelper.calculateClampedError(-100), -100);
});

Deno.test("ErrorHelper.calculateClampedError - custom maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(15, 10), 10);
  assertEquals(ErrorHelper.calculateClampedError(-15, 10), -10);
  assertEquals(ErrorHelper.calculateClampedError(5, 10), 5);
});

Deno.test("ErrorHelper.calculateClampedError - very small maxMagnitude", () => {
  assertEquals(ErrorHelper.calculateClampedError(0.5, 0.1), 0.1);
  assertEquals(ErrorHelper.calculateClampedError(-0.5, 0.1), -0.1);
  assertEquals(ErrorHelper.calculateClampedError(0.05, 0.1), 0.05);
});

Deno.test("ErrorHelper.calculateClampedError - zero error returns zero", () => {
  assertEquals(ErrorHelper.calculateClampedError(0), 0);
  assertEquals(ErrorHelper.calculateClampedError(0, 50), 0);
});
