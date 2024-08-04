import { MIN_STEP, quantumAdjust } from "../../src/blackbox/FineTune.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("quantumAdjust - forward only mode, example case", () => {
  const currentBest = -0.008;
  const previousBest = -0.003;
  const diff = currentBest - previousBest;
  const forwardOnly = true;

  const result = quantumAdjust(currentBest, previousBest, forwardOnly).value;

  const maxExpected = -0.008 - MIN_STEP;
  const minExpected = -0.008 + (diff * 2);

  assert(result >= minExpected, `${result} < ${minExpected}`);
  assert(result <= maxExpected, `${result} > ${maxExpected}`);
});

Deno.test("quantumAdjust - forward only mode", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const diff = currentBest - previousBest;
  const forwardOnly = true;

  const result = quantumAdjust(currentBest, previousBest, forwardOnly);

  const minExpected = currentBest + MIN_STEP;
  const maxExpected = currentBest + (diff * 2);

  assert(result.value >= minExpected, `${result} < ${minExpected}`);
  assert(result.value <= maxExpected, `${result} > ${maxExpected}`);
});

Deno.test("quantumAdjust - randomize mode", () => {
  const currentBest = 1.0;
  const previousBest = 0.5;
  const diff = currentBest - previousBest;
  const forwardOnly = false;

  const result = quantumAdjust(currentBest, previousBest, forwardOnly);

  const minExpected = currentBest + (diff * -1);
  const maxExpected = currentBest + (diff * 2);

  assert(result.value >= minExpected, `${result} < ${minExpected}`);
  assert(result.value <= maxExpected, `${result} > ${maxExpected}`);
});

Deno.test("quantumAdjust - no adjustment needed", () => {
  const currentBest = 1.0;
  const previousBest = 1.0;
  const forwardOnly = true;

  const result = quantumAdjust(currentBest, previousBest, forwardOnly);

  assertEquals(result.value, currentBest);
});

Deno.test("quantumAdjust - less than minimum step", () => {
  const currentBest = 1.0;
  const previousBest = 1.0 + MIN_STEP / 2;
  const forwardOnly = true;

  const result = quantumAdjust(currentBest, previousBest, forwardOnly);

  assertEquals(result.value, currentBest);
});

Deno.test("quantumAdjust - ensure minimum step difference", () => {
  const currentBest = 1.0;
  const previousBest = 1.0 + MIN_STEP;
  const diff = currentBest - previousBest;
  const forwardOnly = true;

  const result = quantumAdjust(currentBest, previousBest, forwardOnly).value;

  const minExpected = currentBest - MIN_STEP;
  const maxExpected = currentBest - diff * 2;

  assert(result !== currentBest, `${result} should not equal ${currentBest}`);
  assert(
    Math.abs(result - currentBest) >= MIN_STEP - 0.000_000_05,
    `${result} is not at least one ${MIN_STEP} different ${
      result - currentBest
    } from ${currentBest}`,
  );
  assert(
    result <= minExpected,
    `result ${result} should be at least one MIN_STEP from currentBest ${currentBest}, but is less than ${minExpected}`,
  );
  assert(
    result <= maxExpected,
    `${result} should not be more than twice the difference ${diff} from ${currentBest}`,
  );
});
