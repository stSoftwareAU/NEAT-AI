import { STEP } from "../../../src/methods/activations/types/STEP.ts";
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";

// =============================================================================
// Basic Tests (existing - kept for regression)
// =============================================================================

Deno.test("STEP.calculateError: no error (same output)", () => {
  const step = new STEP();
  const act = step.squash(1.0);
  const error = step.calculateError(act, act, 1.0);
  assertAlmostEquals(error, 0.0, 1e-10);
});

Deno.test("STEP.calculateError: target is 1, current is 0", () => {
  const step = new STEP();
  const act = step.squash(-1.0); // 0
  const target = step.squash(1.0); // 1
  const error = step.calculateError(act, target, -1.0);
  assert(error > 0);
  assert(Number.isFinite(error));
});

Deno.test("STEP.calculateError: target is 0, current is 1", () => {
  const step = new STEP();
  const act = step.squash(1.0); // 1
  const target = step.squash(-1.0); // 0
  const error = step.calculateError(act, target, 1.0);
  assert(error < 0);
  assert(Number.isFinite(error));
});

// =============================================================================
// Magnitude Tests - Verify EXACT error values (critical for discovery)
// =============================================================================

Deno.test("STEP.calculateError: magnitude when crossing from 0 to 1", () => {
  const step = new STEP();

  // currentValue=-1, activation=0, target=1
  // unSquash(1, -1) = 1 (hint not > 0), error = 1 - (-1) = 2
  const error1 = step.calculateError(0, 1, -1);
  assertAlmostEquals(
    error1,
    2.0,
    1e-10,
    "Error should be 2 when moving from -1 to threshold",
  );

  // currentValue=-5, activation=0, target=1
  // unSquash(1, -5) = 1, error = 1 - (-5) = 6
  const error2 = step.calculateError(0, 1, -5);
  assertAlmostEquals(
    error2,
    6.0,
    1e-10,
    "Error should be 6 when moving from -5 to threshold",
  );

  // currentValue=-0.1, activation=0, target=1
  // unSquash(1, -0.1) = 1, error = 1 - (-0.1) = 1.1
  const error3 = step.calculateError(0, 1, -0.1);
  assertAlmostEquals(
    error3,
    1.1,
    1e-10,
    "Error should be 1.1 when moving from -0.1 to threshold",
  );
});

Deno.test("STEP.calculateError: magnitude when crossing from 1 to 0", () => {
  const step = new STEP();

  // currentValue=1, activation=1, target=0
  // unSquash(0, 1) = 0 (hint not <= 0), error = 0 - 1 = -1
  const error1 = step.calculateError(1, 0, 1);
  assertAlmostEquals(
    error1,
    -1.0,
    1e-10,
    "Error should be -1 when moving from 1 to threshold",
  );

  // currentValue=5, activation=1, target=0
  // unSquash(0, 5) = 0, error = 0 - 5 = -5
  const error2 = step.calculateError(1, 0, 5);
  assertAlmostEquals(
    error2,
    -5.0,
    1e-10,
    "Error should be -5 when moving from 5 to threshold",
  );

  // currentValue=0.1, activation=1, target=0
  // unSquash(0, 0.1) = 0, error = 0 - 0.1 = -0.1
  const error3 = step.calculateError(1, 0, 0.1);
  assertAlmostEquals(
    error3,
    -0.1,
    1e-10,
    "Error should be -0.1 when moving from 0.1 to threshold",
  );
});

// =============================================================================
// Already Correct Tests - Error should be 0 when on correct side
// =============================================================================

Deno.test("STEP.calculateError: zero error when already on correct side (positive)", () => {
  const step = new STEP();

  // currentValue=2, activation=1, target=1 (already correct)
  // rawError = 1 - 1 = 0, should short-circuit and return 0
  const error1 = step.calculateError(1, 1, 2);
  assertAlmostEquals(
    error1,
    0.0,
    1e-10,
    "Error should be 0 when already at target activation",
  );

  // currentValue=0.001, activation=1, target=1 (just barely correct)
  const error2 = step.calculateError(1, 1, 0.001);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error should be 0 when barely on correct side",
  );

  // currentValue=100, activation=1, target=1 (far on correct side)
  const error3 = step.calculateError(1, 1, 100);
  assertAlmostEquals(
    error3,
    0.0,
    1e-10,
    "Error should be 0 when far on correct side",
  );
});

Deno.test("STEP.calculateError: zero error when already on correct side (negative)", () => {
  const step = new STEP();

  // currentValue=-2, activation=0, target=0 (already correct)
  const error1 = step.calculateError(0, 0, -2);
  assertAlmostEquals(
    error1,
    0.0,
    1e-10,
    "Error should be 0 when already at target activation",
  );

  // currentValue=-0.001, activation=0, target=0 (just barely correct)
  const error2 = step.calculateError(0, 0, -0.001);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error should be 0 when barely on correct side",
  );

  // currentValue=-100, activation=0, target=0 (far on correct side)
  const error3 = step.calculateError(0, 0, -100);
  assertAlmostEquals(
    error3,
    0.0,
    1e-10,
    "Error should be 0 when far on correct side",
  );
});

// =============================================================================
// Edge Cases - Threshold boundary (x = 0)
// =============================================================================

Deno.test("STEP.calculateError: at threshold (x=0)", () => {
  const step = new STEP();

  // At x=0, squash(0) = 0 (since 0 is NOT > 0)
  assertEquals(step.squash(0), 0, "squash(0) should be 0");

  // If target=1, we need to cross threshold
  // unSquash(1, 0) = 1 (hint=0 is not > 0), error = 1 - 0 = 1
  const error1 = step.calculateError(0, 1, 0);
  assertAlmostEquals(
    error1,
    1.0,
    1e-10,
    "Error at threshold wanting 1 should be 1",
  );

  // If target=0, we're already correct
  const error2 = step.calculateError(0, 0, 0);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error at threshold already at 0 should be 0",
  );
});

Deno.test("STEP.calculateError: just above threshold", () => {
  const step = new STEP();
  const epsilon = 0.0001;

  // Just above threshold: squash(epsilon) = 1
  assertEquals(step.squash(epsilon), 1, "squash(epsilon) should be 1");

  // If target=0, we need to cross down
  // unSquash(0, epsilon) = 0, error = 0 - epsilon = -epsilon
  const error = step.calculateError(1, 0, epsilon);
  assertAlmostEquals(
    error,
    -epsilon,
    1e-10,
    "Error just above threshold wanting 0 should be -epsilon",
  );
});

Deno.test("STEP.calculateError: just below threshold", () => {
  const step = new STEP();
  const epsilon = 0.0001;

  // Just below threshold: squash(-epsilon) = 0
  assertEquals(step.squash(-epsilon), 0, "squash(-epsilon) should be 0");

  // If target=1, we need to cross up
  // unSquash(1, -epsilon) = 1, error = 1 - (-epsilon) = 1 + epsilon
  const error = step.calculateError(0, 1, -epsilon);
  assertAlmostEquals(
    error,
    1 + epsilon,
    1e-10,
    "Error just below threshold wanting 1 should be 1+epsilon",
  );
});

// =============================================================================
// Extreme Values - Verify clamping and stability
// =============================================================================

Deno.test("STEP.calculateError: extreme positive currentValue", () => {
  const step = new STEP();

  // Very large positive value, need to go to 0
  // error = 0 - 1000 = -1000, but clamped to -100
  const error = step.calculateError(1, 0, 1000);
  assertAlmostEquals(
    error,
    -100,
    1e-10,
    "Error should be clamped to -100 for extreme values",
  );
});

Deno.test("STEP.calculateError: extreme negative currentValue", () => {
  const step = new STEP();

  // Very large negative value, need to go to 1
  // error = 1 - (-1000) = 1001, but clamped to 100
  const error = step.calculateError(0, 1, -1000);
  assertAlmostEquals(
    error,
    100,
    1e-10,
    "Error should be clamped to 100 for extreme values",
  );
});

// =============================================================================
// Consistency Property Tests
// =============================================================================

Deno.test("STEP.calculateError: error direction always pushes toward correct threshold", () => {
  const step = new STEP();

  // Test multiple values on wrong side of threshold
  const testCases = [
    { currentValue: -10, target: 1, expectedSign: 1 }, // Need to go up
    { currentValue: -1, target: 1, expectedSign: 1 },
    { currentValue: -0.01, target: 1, expectedSign: 1 },
    { currentValue: 10, target: 0, expectedSign: -1 }, // Need to go down
    { currentValue: 1, target: 0, expectedSign: -1 },
    { currentValue: 0.01, target: 0, expectedSign: -1 },
  ];

  for (const tc of testCases) {
    const currentAct = step.squash(tc.currentValue);
    const error = step.calculateError(currentAct, tc.target, tc.currentValue);

    assert(
      Math.sign(error) === tc.expectedSign,
      `For currentValue=${tc.currentValue}, target=${tc.target}: ` +
        `error=${error} should have sign ${tc.expectedSign}`,
    );
  }
});

Deno.test("STEP.calculateError: always finite", () => {
  const step = new STEP();

  const testValues = [
    0,
    0.001,
    -0.001,
    1,
    -1,
    10,
    -10,
    100,
    -100,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    1e10,
    -1e10,
  ];

  for (const val of testValues) {
    const act = step.squash(val);
    const error0 = step.calculateError(act, 0, val);
    const error1 = step.calculateError(act, 1, val);

    assert(
      Number.isFinite(error0),
      `Error should be finite for currentValue=${val}, target=0`,
    );
    assert(
      Number.isFinite(error1),
      `Error should be finite for currentValue=${val}, target=1`,
    );
  }
});
