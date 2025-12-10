import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";

// =============================================================================
// Basic Tests (existing - kept for regression)
// =============================================================================

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

// =============================================================================
// Magnitude Tests - Verify EXACT error values (critical for discovery)
// =============================================================================

Deno.test("ReLU6.calculateError: magnitude in active zone", () => {
  const relu6 = new ReLU6();

  // In active zone (0 < x < 6), error = targetActivation - currentValue
  // currentValue=3, target=4, error = 4 - 3 = 1
  const error1 = relu6.calculateError(3, 4, 3);
  assertAlmostEquals(
    error1,
    1.0,
    1e-10,
    "Error should be 1 when moving from 3 to 4",
  );

  // currentValue=2, target=5, error = 5 - 2 = 3
  const error2 = relu6.calculateError(2, 5, 2);
  assertAlmostEquals(
    error2,
    3.0,
    1e-10,
    "Error should be 3 when moving from 2 to 5",
  );

  // currentValue=4, target=1, error = 1 - 4 = -3
  const error3 = relu6.calculateError(4, 1, 4);
  assertAlmostEquals(
    error3,
    -3.0,
    1e-10,
    "Error should be -3 when moving from 4 to 1",
  );
});

Deno.test("ReLU6.calculateError: magnitude from lower flat zone", () => {
  const relu6 = new ReLU6();

  // currentValue=-5, activation=0, target=3
  // unSquash(3, -5) = 3, error = 3 - (-5) = 8
  const error1 = relu6.calculateError(0, 3, -5);
  assertAlmostEquals(
    error1,
    8.0,
    1e-10,
    "Error should be 8 when moving from -5 to target 3",
  );

  // currentValue=-1, activation=0, target=2
  // unSquash(2, -1) = 2, error = 2 - (-1) = 3
  const error2 = relu6.calculateError(0, 2, -1);
  assertAlmostEquals(
    error2,
    3.0,
    1e-10,
    "Error should be 3 when moving from -1 to target 2",
  );

  // currentValue=-0.1, activation=0, target=1
  // unSquash(1, -0.1) = 1, error = 1 - (-0.1) = 1.1
  const error3 = relu6.calculateError(0, 1, -0.1);
  assertAlmostEquals(
    error3,
    1.1,
    1e-10,
    "Error should be 1.1 when moving from -0.1 to target 1",
  );
});

Deno.test("ReLU6.calculateError: magnitude from upper flat zone", () => {
  const relu6 = new ReLU6();

  // currentValue=10, activation=6, target=5
  // unSquash(5, 10) = 5, error = 5 - 10 = -5
  const error1 = relu6.calculateError(6, 5, 10);
  assertAlmostEquals(
    error1,
    -5.0,
    1e-10,
    "Error should be -5 when moving from 10 to target 5",
  );

  // currentValue=8, activation=6, target=3
  // unSquash(3, 8) = 3, error = 3 - 8 = -5
  const error2 = relu6.calculateError(6, 3, 8);
  assertAlmostEquals(
    error2,
    -5.0,
    1e-10,
    "Error should be -5 when moving from 8 to target 3",
  );

  // currentValue=6.1, activation=6, target=4
  // unSquash(4, 6.1) = 4, error = 4 - 6.1 = -2.1
  const error3 = relu6.calculateError(6, 4, 6.1);
  assertAlmostEquals(
    error3,
    -2.1,
    1e-10,
    "Error should be -2.1 when moving from 6.1 to target 4",
  );
});

// =============================================================================
// Already Correct Tests - Error should be 0 when on correct side of flat region
// =============================================================================

Deno.test("ReLU6.calculateError: zero error when already on correct side (lower)", () => {
  const relu6 = new ReLU6();

  // currentValue=-5, activation=0, target=0 (already in lower flat zone)
  // unSquash(0, -5) = -5 (hint < 0), error = -5 - (-5) = 0
  const error1 = relu6.calculateError(0, 0, -5);
  assertAlmostEquals(
    error1,
    0.0,
    1e-10,
    "Error should be 0 when already at target activation",
  );

  // currentValue=-100, activation=0, target=0
  const error2 = relu6.calculateError(0, 0, -100);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error should be 0 when far in lower flat zone",
  );
});

Deno.test("ReLU6.calculateError: zero error when already on correct side (upper)", () => {
  const relu6 = new ReLU6();

  // currentValue=10, activation=6, target=6 (already in upper flat zone)
  // unSquash(6, 10) = 10 (hint > 6), error = 10 - 10 = 0
  const error1 = relu6.calculateError(6, 6, 10);
  assertAlmostEquals(
    error1,
    0.0,
    1e-10,
    "Error should be 0 when already at target activation",
  );

  // currentValue=100, activation=6, target=6
  const error2 = relu6.calculateError(6, 6, 100);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error should be 0 when far in upper flat zone",
  );
});

// =============================================================================
// Edge Cases - Boundary transitions
// =============================================================================

Deno.test("ReLU6.calculateError: at lower boundary (x=0)", () => {
  const relu6 = new ReLU6();

  assertEquals(relu6.squash(0), 0, "squash(0) should be 0");

  // At boundary, going up
  // unSquash(3, 0) = 3, error = 3 - 0 = 3
  const error1 = relu6.calculateError(0, 3, 0);
  assertAlmostEquals(
    error1,
    3.0,
    1e-10,
    "Error at lower boundary wanting 3 should be 3",
  );
});

Deno.test("ReLU6.calculateError: at upper boundary (x=6)", () => {
  const relu6 = new ReLU6();

  assertEquals(relu6.squash(6), 6, "squash(6) should be 6");

  // At boundary, going down
  // unSquash(3, 6) = 3, error = 3 - 6 = -3
  const error1 = relu6.calculateError(6, 3, 6);
  assertAlmostEquals(
    error1,
    -3.0,
    1e-10,
    "Error at upper boundary wanting 3 should be -3",
  );
});

Deno.test("ReLU6.calculateError: crossing from lower to upper flat zone", () => {
  const relu6 = new ReLU6();

  // currentValue=-5, activation=0, target=6
  // unSquash(6, -5): since hint=-5 is not > 6, returns 6
  // error = 6 - (-5) = 11
  const error = relu6.calculateError(0, 6, -5);
  assertAlmostEquals(
    error,
    11.0,
    1e-10,
    "Error crossing from lower to upper should be 11",
  );
});

Deno.test("ReLU6.calculateError: crossing from upper to lower flat zone", () => {
  const relu6 = new ReLU6();

  // currentValue=10, activation=6, target=0
  // unSquash(0, 10): since hint=10 is not < 0, returns 0
  // error = 0 - 10 = -10
  const error = relu6.calculateError(6, 0, 10);
  assertAlmostEquals(
    error,
    -10.0,
    1e-10,
    "Error crossing from upper to lower should be -10",
  );
});

// =============================================================================
// Extreme Values - Verify clamping and stability
// =============================================================================

Deno.test("ReLU6.calculateError: extreme positive currentValue", () => {
  const relu6 = new ReLU6();

  // Very large positive value in upper flat zone, target in active zone
  // error = 3 - 1000 = -997, but clamped to -100
  const error = relu6.calculateError(6, 3, 1000);
  assertAlmostEquals(
    error,
    -100,
    1e-10,
    "Error should be clamped to -100 for extreme values",
  );
});

Deno.test("ReLU6.calculateError: extreme negative currentValue", () => {
  const relu6 = new ReLU6();

  // Very large negative value in lower flat zone, target in active zone
  // error = 3 - (-1000) = 1003, but clamped to 100
  const error = relu6.calculateError(0, 3, -1000);
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

Deno.test("ReLU6.calculateError: error direction always pushes toward target", () => {
  const relu6 = new ReLU6();

  const testCases = [
    // From lower flat zone
    { currentValue: -10, target: 3, expectedSign: 1 },
    { currentValue: -1, target: 3, expectedSign: 1 },
    // From active zone
    { currentValue: 2, target: 4, expectedSign: 1 },
    { currentValue: 4, target: 2, expectedSign: -1 },
    // From upper flat zone
    { currentValue: 10, target: 3, expectedSign: -1 },
    { currentValue: 8, target: 3, expectedSign: -1 },
  ];

  for (const tc of testCases) {
    const currentAct = relu6.squash(tc.currentValue);
    const error = relu6.calculateError(currentAct, tc.target, tc.currentValue);

    assert(
      Math.sign(error) === tc.expectedSign,
      `For currentValue=${tc.currentValue}, target=${tc.target}: ` +
        `error=${error} should have sign ${tc.expectedSign}`,
    );
  }
});

Deno.test("ReLU6.calculateError: always finite", () => {
  const relu6 = new ReLU6();

  const testValues = [
    -100,
    -10,
    -1,
    -0.001,
    0,
    0.001,
    1,
    3,
    5.999,
    6,
    6.001,
    10,
    100,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  ];

  const targetValues = [0, 1, 3, 5, 6];

  for (const val of testValues) {
    for (const target of targetValues) {
      const act = relu6.squash(val);
      const error = relu6.calculateError(act, target, val);

      assert(
        Number.isFinite(error),
        `Error should be finite for currentValue=${val}, target=${target}`,
      );
    }
  }
});
