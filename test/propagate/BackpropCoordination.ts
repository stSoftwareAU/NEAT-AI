import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { coordinateBackpropUpdates } from "../../src/propagate/BackpropCoordination.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test(
  "coordinateBackpropUpdates - no changes passes through",
  () => {
    const result = coordinateBackpropUpdates(
      0.5, // currentBias
      0.5, // candidateBias (unchanged)
      [0.3, -0.2], // currentWeights
      [0.3, -0.2], // candidateWeights (unchanged)
      [1.0, 1.0], // activations
      0.2, // reductionFactor
    );
    assertEquals(result.bias, 0.5);
    assertEquals(result.weights, [0.3, -0.2]);
  },
);

Deno.test(
  "coordinateBackpropUpdates - bias-only change passes through",
  () => {
    const result = coordinateBackpropUpdates(
      0.5,
      0.7, // bias changed
      [0.3],
      [0.3], // weights unchanged
      [1.0], // activations
      0.2,
    );
    assertEquals(result.bias, 0.7, "Bias-only change should pass through");
    assertEquals(result.weights, [0.3]);
  },
);

Deno.test(
  "coordinateBackpropUpdates - weight-only change passes through",
  () => {
    const result = coordinateBackpropUpdates(
      0.5,
      0.5, // bias unchanged
      [0.3],
      [0.5], // weight changed
      [1.0], // activations
      0.2,
    );
    assertEquals(result.bias, 0.5);
    assertEquals(
      result.weights,
      [0.5],
      "Weight-only change should pass through",
    );
  },
);

Deno.test(
  "coordinateBackpropUpdates - aligned changes pass through unchanged",
  () => {
    // Bias +0.3, net weight effect = +0.5 (same direction as bias)
    const result = coordinateBackpropUpdates(
      1.0,
      1.3, // bias +0.3
      [0.5, 0.2],
      [0.8, 0.4], // weights +0.3 and +0.2
      [1.0, 1.0], // all activations positive
      0.2,
    );
    assertEquals(result.bias, 1.3, "Aligned bias should pass through");
    assertEquals(
      result.weights,
      [0.8, 0.4],
      "Aligned weights should pass through",
    );
  },
);

Deno.test(
  "coordinateBackpropUpdates - negative activation flips effect direction",
  () => {
    // Bias +0.5, weight delta -0.5 but activation is -1.0
    // Net weight effect = (-0.5) * (-1.0) = +0.5 (aligned with bias!)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [0.5],
      [0.0], // weight -0.5
      [-1.0], // negative activation flips effect
      0.2,
    );

    // Both should pass through (aligned when accounting for activation)
    assertEquals(result.bias, 1.5);
    assertEquals(result.weights, [0.0]);
  },
);

Deno.test(
  "coordinateBackpropUpdates - equal opposing effects triggers coordination",
  () => {
    // Bias +0.5, weight delta -0.5, activation 1.0
    // Net effect = -0.5 (perfect opposition, ratio 1.0 >= 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [0.5],
      [0.0], // weight -0.5
      [1.0], // activation
      0.2,
    );

    // Both sides reduced: bias 1.0 + 0.5 * 0.2 = 1.1
    assertAlmostEquals(result.bias, 1.1, 1e-10);
    // Weight also reduced: 0.5 + (-0.5) * 0.2 = 0.4
    assertAlmostEquals(result.weights[0], 0.4, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - reduces both sides with near-perfect cancellation",
  () => {
    // Bias +0.96, weight effect = -1.0 (ratio 0.96/1.0 = 0.96 >= 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.96, // bias +0.96 (smaller opposing effect)
      [1.0],
      [0.0], // weight -1.0 (larger)
      [1.0], // activation
      0.2,
    );

    // Bias reduced: 1.0 + 0.96 * 0.2 = 1.192
    assertAlmostEquals(result.bias, 1.192, 1e-10);
    // Weight also reduced: 1.0 + (-1.0) * 0.2 = 0.8
    assertAlmostEquals(result.weights[0], 0.8, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - reduces both sides when weights are smaller",
  () => {
    // Bias -1.0, weight effect = +0.97 (ratio 0.97/1.0 = 0.97 >= 0.95)
    const result = coordinateBackpropUpdates(
      2.0,
      1.0, // bias -1.0 (larger)
      [0.5],
      [1.47], // weight +0.97, activation 1.0, effect = +0.97
      [1.0], // activation
      0.2,
    );

    // Bias reduced: 2.0 + (-1.0) * 0.2 = 1.8
    assertAlmostEquals(result.bias, 1.8, 1e-10);
    // Weight reduced: 0.5 + 0.97 * 0.2 = 0.694
    assertAlmostEquals(result.weights[0], 0.694, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - skips coordination when ratio below threshold",
  () => {
    // Bias +0.5, weight effect = -1.0 (ratio 0.5/1.0 = 0.5, well below 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [1.0],
      [0.0], // weight -1.0
      [1.0], // activation
      0.2,
    );

    // Both should pass through (ratio below threshold)
    assertEquals(result.bias, 1.5);
    assertEquals(result.weights, [0.0]);
  },
);

Deno.test(
  "coordinateBackpropUpdates - skips when opposing effects are unequal",
  () => {
    // Bias +0.5, weight effect = -0.6 (ratio 0.5/0.6 = 0.83, below 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5,
      [0.8, 0.5],
      [0.5, 0.2], // weights -0.3 and -0.3, effect = -0.6
      [1.0, 1.0],
      0.2,
    );

    // Both should pass through (ratio 0.83 < 0.95)
    assertEquals(result.bias, 1.5);
    assertEquals(result.weights, [0.5, 0.2]);
  },
);

Deno.test(
  "coordinateBackpropUpdates - configurable reduction factor",
  () => {
    // With reductionFactor 0.5, both sides keep 50%
    // Bias +0.5, weight effect = -0.5 (ratio 1.0 >= 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [0.5],
      [0.0], // weight -0.5
      [1.0], // activation
      0.5,
    );

    // Bias reduced: 1.0 + 0.5 * 0.5 = 1.25
    assertAlmostEquals(result.bias, 1.25, 1e-10);
    // Weight reduced: 0.5 + (-0.5) * 0.5 = 0.25
    assertAlmostEquals(result.weights[0], 0.25, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - zero reduction factor eliminates both changes",
  () => {
    // Ratio 1.0 (equal opposing), reductionFactor 0
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [0.5],
      [0.0], // weight -0.5
      [1.0], // activation
      0.0, // eliminate both
    );

    // Both deltas zeroed: stays at originals
    assertAlmostEquals(result.bias, 1.0, 1e-10);
    assertAlmostEquals(result.weights[0], 0.5, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - full reduction factor (1.0) preserves everything",
  () => {
    // Ratio 1.0, reductionFactor 1.0
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [0.5],
      [0.0], // weight -0.5
      [1.0], // activation
      1.0, // keep everything
    );

    // Both pass through (reduction factor 1.0 = no reduction)
    assertAlmostEquals(result.bias, 1.5, 1e-10);
    assertAlmostEquals(result.weights[0], 0.0, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - unchanged weights in mixed array preserved",
  () => {
    // Bias -1.0, weight effects +0.3, 0.0, +0.67 = net +0.97
    // Ratio 0.97/1.0 = 0.97 >= 0.95 (triggers coordination)
    const result = coordinateBackpropUpdates(
      2.0,
      1.0, // bias -1.0
      [0.5, 0.3, 0.1],
      [0.8, 0.3, 0.77], // +0.3, 0.0, +0.67
      [1.0, 1.0, 1.0], // activations
      0.2,
    );

    // Bias reduced: 2.0 + (-1.0) * 0.2 = 1.8
    assertAlmostEquals(result.bias, 1.8, 1e-10);
    // Unchanged weight [1] should remain unchanged
    assertEquals(result.weights[1], 0.3);
    // Changed weights should be reduced
    assertAlmostEquals(result.weights[0], 0.5 + 0.3 * 0.2, 1e-10); // 0.56
    assertAlmostEquals(result.weights[2], 0.1 + 0.67 * 0.2, 1e-10); // 0.234
  },
);

Deno.test(
  "coordinateBackpropUpdates - empty weights array with bias change",
  () => {
    const result = coordinateBackpropUpdates(
      0.5,
      0.8,
      [],
      [],
      [], // empty activations
      0.2,
    );
    assertEquals(
      result.bias,
      0.8,
      "Bias should pass through with empty weights",
    );
    assertEquals(result.weights.length, 0);
  },
);

Deno.test(
  "coordinateBackpropUpdates - all results are finite",
  () => {
    const result = coordinateBackpropUpdates(
      0.5,
      0.7,
      [0.0, -0.5, 1.0],
      [0.1, -0.3, 0.8],
      [1.0, 0.5, -0.3], // activations
      0.2,
    );
    assert(Number.isFinite(result.bias), "Bias should be finite");
    for (const w of result.weights) {
      assert(Number.isFinite(w), `Weight should be finite: ${w}`);
    }
  },
);

Deno.test(
  "coordinateBackpropUpdates - exactly at threshold triggers coordination",
  () => {
    // Bias +0.95, weight effect = -1.0 (ratio 0.95/1.0 = 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.95, // bias +0.95 (smaller)
      [1.0],
      [0.0], // weight -1.0 (larger effect)
      [1.0], // activation
      0.2,
    );

    // Should trigger coordination: both reduced
    // Bias: 1.0 + 0.95 * 0.2 = 1.19
    assertAlmostEquals(result.bias, 1.19, 1e-10);
    // Weight: 1.0 + (-1.0) * 0.2 = 0.8
    assertAlmostEquals(result.weights[0], 0.8, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - just below threshold skips coordination",
  () => {
    // Bias +0.94, weight effect = -1.0 (ratio 0.94/1.0 = 0.94 < 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.94, // bias +0.94 (smaller)
      [1.0],
      [0.0], // weight -1.0 (larger effect)
      [1.0], // activation
      0.2,
    );

    // Should NOT trigger coordination: pass through
    assertAlmostEquals(result.bias, 1.94, 1e-10);
    assertEquals(result.weights, [0.0]);
  },
);

Deno.test(
  "coordinateBackpropUpdates - activation magnitude scales effect correctly",
  () => {
    // Bias +0.5, weight delta -2.0, but activation is only 0.25
    // Net weight effect = (-2.0) * 0.25 = -0.5 (opposing, ratio 1.0 >= 0.95)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [1.0],
      [-1.0], // weight delta = -2.0
      [0.25], // small activation scales effect down
      0.2,
    );

    // Should trigger coordination (equal opposing effects)
    // Bias: 1.0 + 0.5 * 0.2 = 1.1
    assertAlmostEquals(result.bias, 1.1, 1e-10);
    // Weight: 1.0 + (-2.0) * 0.2 = 0.6
    assertAlmostEquals(result.weights[0], 0.6, 1e-10);
  },
);

Deno.test(
  "coordinateBackpropUpdates - zero activation means no weight effect",
  () => {
    // Bias +0.5, weight delta -1.0, but activation is 0
    // Net weight effect = 0 (no opposing effect)
    const result = coordinateBackpropUpdates(
      1.0,
      1.5, // bias +0.5
      [1.0],
      [0.0], // weight delta = -1.0
      [0.0], // zero activation
      0.2,
    );

    // Net weight effect is 0, so no opposing — pass through
    assertEquals(result.bias, 1.5);
    assertEquals(result.weights, [0.0]);
  },
);
