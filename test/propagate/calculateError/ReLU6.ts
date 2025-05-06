import { assert, assertAlmostEquals } from "@std/assert";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";

Deno.test("ReLU6.calculateError: in active zone", () => {
  const relu6 = new ReLU6();
  const act = relu6.squash(3.0);
  const target = relu6.squash(4.0);
  const error = relu6.calculateError(act, target, 3.0);

  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("ReLU6.calculateError: lower flat zone", () => {
  const relu6 = new ReLU6();
  const act = relu6.squash(-5.0); // 0
  const target = relu6.squash(1.0); // 1
  const error = relu6.calculateError(act, target, -5.0);

  assert(Number.isFinite(error));
  assert(error > 0);
});

Deno.test("ReLU6.calculateError: upper flat zone", () => {
  const relu6 = new ReLU6();
  const act = relu6.squash(10.0); // 6
  const target = relu6.squash(5.0); // 5
  const error = relu6.calculateError(act, target, 10.0);

  assert(Number.isFinite(error));
  assert(error < 0);
});

Deno.test("ReLU6.calculateError: perfect match", () => {
  const relu6 = new ReLU6();
  const val = relu6.squash(5.5);
  const error = relu6.calculateError(val, val, 5.5);

  assertAlmostEquals(error, 0, 1e-10);
});
