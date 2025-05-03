import { assertEquals, assertThrows } from "@std/assert";
import { LeakyReLU } from "../../../src/methods/activations/types/LeakyReLU.ts";

Deno.test("LeakyReLU.derivative returns correct values", () => {
  const leaky = new LeakyReLU();

  assertEquals(leaky.derivative(5), 1);
  assertEquals(leaky.derivative(0), 1);
  assertEquals(leaky.derivative(-0.0001), 0.01);
  assertEquals(leaky.derivative(-1000), 0.01);
  assertEquals(leaky.derivative(Number.MAX_VALUE), 1);
  assertEquals(leaky.derivative(-Number.MAX_VALUE), 0.01);
});

Deno.test("LeakyReLU.derivative throws for non-finite input", () => {
  const leaky = new LeakyReLU();

  assertThrows(() => leaky.derivative(NaN), "Non-finite");
  assertThrows(() => leaky.derivative(Infinity), "Non-finite");
  assertThrows(() => leaky.derivative(-Infinity), "Non-finite");
});

Deno.test("LeakyReLU.unSquash returns expected inverses", () => {
  const leaky = new LeakyReLU();

  assertEquals(leaky.unSquash(10), 10);
  assertEquals(leaky.unSquash(0), 0);
  assertEquals(leaky.unSquash(-1), -100); // because α = 0.01
  assertEquals(leaky.unSquash(-0.5), -50);
});

Deno.test("LeakyReLU.unSquash validates range", () => {
  const leaky = new LeakyReLU();

  assertThrows(() => leaky.unSquash(NaN, 0), "LeakyReLU");
  assertThrows(() => leaky.unSquash(Infinity, 0), "LeakyReLU");
  assertThrows(() => leaky.unSquash(-Infinity, 0), "LeakyReLU");
});
