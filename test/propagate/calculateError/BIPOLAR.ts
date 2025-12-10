import { BIPOLAR } from "../../../src/methods/activations/types/BIPOLAR.ts";
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";

// =============================================================================
// Basic Tests (existing - kept for regression)
// =============================================================================

Deno.test("BIPOLAR.calculateError: perfect match", () => {
  const b = new BIPOLAR();
  const val = b.squash(0.7);
  const error = b.calculateError(val, val, 0.7);
  assertAlmostEquals(error, 0);
});

Deno.test("BIPOLAR.calculateError: mismatch positive to negative", () => {
  const b = new BIPOLAR();
  const act = b.squash(1.0); // 1
  const target = b.squash(-1); // -1
  const error = b.calculateError(act, target, 1.0);
  assert(error < 0);
  assert(Number.isFinite(error));
});

Deno.test("BIPOLAR.calculateError: mismatch negative to positive", () => {
  const b = new BIPOLAR();
  const act = b.squash(-0.5); // -1
  const target = b.squash(0.5); // +1
  const error = b.calculateError(act, target, -0.5);
  assert(error > 0);
  assert(Number.isFinite(error));
});

// =============================================================================
// Magnitude Tests - Verify EXACT error values (critical for discovery)
// =============================================================================

Deno.test("BIPOLAR.calculateError: magnitude when crossing from -1 to +1", () => {
  const bipolar = new BIPOLAR();

  // currentValue=-0.5, activation=-1, target=+1
  // unSquash(1, -0.5): sign mismatch, returns 1
  // error = 1 - (-0.5) = 1.5
  const error1 = bipolar.calculateError(-1, 1, -0.5);
  assertAlmostEquals(
    error1,
    1.5,
    1e-10,
    "Error should be 1.5 when moving from -0.5 to +1 region",
  );

  // currentValue=-5, activation=-1, target=+1
  // error = 1 - (-5) = 6
  const error2 = bipolar.calculateError(-1, 1, -5);
  assertAlmostEquals(
    error2,
    6.0,
    1e-10,
    "Error should be 6 when moving from -5 to +1 region",
  );

  // currentValue=-0.1, activation=-1, target=+1
  // error = 1 - (-0.1) = 1.1
  const error3 = bipolar.calculateError(-1, 1, -0.1);
  assertAlmostEquals(
    error3,
    1.1,
    1e-10,
    "Error should be 1.1 when moving from -0.1 to +1 region",
  );
});

Deno.test("BIPOLAR.calculateError: magnitude when crossing from +1 to -1", () => {
  const bipolar = new BIPOLAR();

  // currentValue=1, activation=+1, target=-1
  // unSquash(-1, 1): sign mismatch, returns -1
  // error = -1 - 1 = -2
  const error1 = bipolar.calculateError(1, -1, 1);
  assertAlmostEquals(
    error1,
    -2.0,
    1e-10,
    "Error should be -2 when moving from 1 to -1 region",
  );

  // currentValue=5, activation=+1, target=-1
  // error = -1 - 5 = -6
  const error2 = bipolar.calculateError(1, -1, 5);
  assertAlmostEquals(
    error2,
    -6.0,
    1e-10,
    "Error should be -6 when moving from 5 to -1 region",
  );

  // currentValue=0.1, activation=+1, target=-1
  // error = -1 - 0.1 = -1.1
  const error3 = bipolar.calculateError(1, -1, 0.1);
  assertAlmostEquals(
    error3,
    -1.1,
    1e-10,
    "Error should be -1.1 when moving from 0.1 to -1 region",
  );
});

// =============================================================================
// Already Correct Tests - Error should be 0 when on correct side
// =============================================================================

Deno.test("BIPOLAR.calculateError: zero error when already on correct side (positive)", () => {
  const bipolar = new BIPOLAR();

  // currentValue=2, activation=+1, target=+1 (already correct)
  const error1 = bipolar.calculateError(1, 1, 2);
  assertAlmostEquals(
    error1,
    0.0,
    1e-10,
    "Error should be 0 when already at target activation",
  );

  // currentValue=0.001, activation=+1, target=+1 (just barely correct)
  const error2 = bipolar.calculateError(1, 1, 0.001);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error should be 0 when barely on correct side",
  );

  // currentValue=100, activation=+1, target=+1 (far on correct side)
  const error3 = bipolar.calculateError(1, 1, 100);
  assertAlmostEquals(
    error3,
    0.0,
    1e-10,
    "Error should be 0 when far on correct side",
  );
});

Deno.test("BIPOLAR.calculateError: zero error when already on correct side (negative)", () => {
  const bipolar = new BIPOLAR();

  // currentValue=-2, activation=-1, target=-1 (already correct)
  const error1 = bipolar.calculateError(-1, -1, -2);
  assertAlmostEquals(
    error1,
    0.0,
    1e-10,
    "Error should be 0 when already at target activation",
  );

  // currentValue=-0.001, activation=-1, target=-1 (just barely correct)
  const error2 = bipolar.calculateError(-1, -1, -0.001);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error should be 0 when barely on correct side",
  );

  // currentValue=-100, activation=-1, target=-1 (far on correct side)
  const error3 = bipolar.calculateError(-1, -1, -100);
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

Deno.test("BIPOLAR.calculateError: at threshold (x=0)", () => {
  const bipolar = new BIPOLAR();

  // At x=0, squash(0) = -1 (since 0 is NOT > 0)
  assertEquals(bipolar.squash(0), -1, "squash(0) should be -1");

  // If target=+1, we need to cross threshold
  // unSquash(1, 0): |0| < 1e-10 but activation=1 >= 0, so return 1
  // error = 1 - 0 = 1
  const error1 = bipolar.calculateError(-1, 1, 0);
  assertAlmostEquals(
    error1,
    1.0,
    1e-10,
    "Error at threshold wanting +1 should be 1",
  );

  // If target=-1, we're already correct
  const error2 = bipolar.calculateError(-1, -1, 0);
  assertAlmostEquals(
    error2,
    0.0,
    1e-10,
    "Error at threshold already at -1 should be 0",
  );
});

Deno.test("BIPOLAR.calculateError: just above threshold", () => {
  const bipolar = new BIPOLAR();
  const epsilon = 0.0001;

  // Just above threshold: squash(epsilon) = +1
  assertEquals(bipolar.squash(epsilon), 1, "squash(epsilon) should be +1");

  // If target=-1, we need to cross down
  // unSquash(-1, epsilon): sign mismatch, returns -1
  // error = -1 - epsilon
  const error = bipolar.calculateError(1, -1, epsilon);
  assertAlmostEquals(
    error,
    -1 - epsilon,
    1e-10,
    "Error just above threshold wanting -1",
  );
});

Deno.test("BIPOLAR.calculateError: just below threshold", () => {
  const bipolar = new BIPOLAR();
  const epsilon = 0.0001;

  // Just below threshold: squash(-epsilon) = -1
  assertEquals(bipolar.squash(-epsilon), -1, "squash(-epsilon) should be -1");

  // If target=+1, we need to cross up
  // unSquash(1, -epsilon): sign mismatch, returns 1
  // error = 1 - (-epsilon) = 1 + epsilon
  const error = bipolar.calculateError(-1, 1, -epsilon);
  assertAlmostEquals(
    error,
    1 + epsilon,
    1e-10,
    "Error just below threshold wanting +1",
  );
});

// =============================================================================
// Extreme Values - Verify clamping and stability
// =============================================================================

Deno.test("BIPOLAR.calculateError: extreme positive currentValue", () => {
  const bipolar = new BIPOLAR();

  // Very large positive value, need to go to -1
  // error = -1 - 1000 = -1001, but clamped to -100
  const error = bipolar.calculateError(1, -1, 1000);
  assertAlmostEquals(
    error,
    -100,
    1e-10,
    "Error should be clamped to -100 for extreme values",
  );
});

Deno.test("BIPOLAR.calculateError: extreme negative currentValue", () => {
  const bipolar = new BIPOLAR();

  // Very large negative value, need to go to +1
  // error = 1 - (-1000) = 1001, but clamped to 100
  const error = bipolar.calculateError(-1, 1, -1000);
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

Deno.test("BIPOLAR.calculateError: error direction always pushes toward correct threshold", () => {
  const bipolar = new BIPOLAR();

  // Test multiple values on wrong side of threshold
  const testCases = [
    { currentValue: -10, target: 1, expectedSign: 1 }, // Need to go up
    { currentValue: -1, target: 1, expectedSign: 1 },
    { currentValue: -0.01, target: 1, expectedSign: 1 },
    { currentValue: 10, target: -1, expectedSign: -1 }, // Need to go down
    { currentValue: 1, target: -1, expectedSign: -1 },
    { currentValue: 0.01, target: -1, expectedSign: -1 },
  ];

  for (const tc of testCases) {
    const currentAct = bipolar.squash(tc.currentValue);
    const error = bipolar.calculateError(
      currentAct,
      tc.target,
      tc.currentValue,
    );

    assert(
      Math.sign(error) === tc.expectedSign,
      `For currentValue=${tc.currentValue}, target=${tc.target}: ` +
        `error=${error} should have sign ${tc.expectedSign}`,
    );
  }
});

Deno.test("BIPOLAR.calculateError: always finite", () => {
  const bipolar = new BIPOLAR();

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
    const act = bipolar.squash(val);
    const errorNeg = bipolar.calculateError(act, -1, val);
    const errorPos = bipolar.calculateError(act, 1, val);

    assert(
      Number.isFinite(errorNeg),
      `Error should be finite for currentValue=${val}, target=-1`,
    );
    assert(
      Number.isFinite(errorPos),
      `Error should be finite for currentValue=${val}, target=+1`,
    );
  }
});
