/**
 * Unit tests for adaptive tournament size calculation.
 *
 * Issue #2218: Verifies that tournament selection sizing scales correctly
 * with population size, returns valid positive integers, handles boundary
 * conditions, and follows expected scaling behaviour.
 */
import { assert, assertEquals } from "@std/assert";
import { calculateAdaptiveTournamentSize } from "@breed/AdaptiveTournamentSize.ts";

// ── Varying population sizes ────────────────────────────────────────

Deno.test(
  "AdaptiveTournamentSize: returns expected sizes across population range",
  () => {
    const expectations: [number, number][] = [
      // [populationSize, expectedResult]
      // Formula: max(3, min(floor(sqrt(pop)), floor(pop * 0.1)))
      [1, 1], // edge: single creature
      [2, 2], // edge: pair
      [3, 3], // minimum tournament size kicks in
      [10, 3], // sqrt(10)=3, 10%=1 → min=1, max(3,1)=3
      [30, 3], // sqrt(30)≈5, 10%=3 → min=3, max(3,3)=3
      [50, 5], // sqrt(50)≈7, 10%=5 → min=5, max(3,5)=5
      [100, 10], // sqrt(100)=10, 10%=10 → min=10, max(3,10)=10
      [400, 20], // sqrt(400)=20, 10%=40 → min=20, max(3,20)=20
    ];

    for (const [popSize, expected] of expectations) {
      assertEquals(
        calculateAdaptiveTournamentSize(popSize),
        expected,
        `Population ${popSize} should yield tournament size ${expected}`,
      );
    }
  },
);

// ── Boundary conditions ─────────────────────────────────────────────

Deno.test(
  "AdaptiveTournamentSize: single-member population returns 1",
  () => {
    assertEquals(
      calculateAdaptiveTournamentSize(1),
      1,
      "A single creature cannot have a tournament larger than itself",
    );
  },
);

Deno.test(
  "AdaptiveTournamentSize: two-member population returns 2",
  () => {
    assertEquals(
      calculateAdaptiveTournamentSize(2),
      2,
      "Two creatures should use both for selection",
    );
  },
);

Deno.test(
  "AdaptiveTournamentSize: population of 3 returns minimum of 3",
  () => {
    assertEquals(calculateAdaptiveTournamentSize(3), 3);
  },
);

Deno.test(
  "AdaptiveTournamentSize: very large population",
  () => {
    const size = calculateAdaptiveTournamentSize(100_000);
    // sqrt(100000) ≈ 316, 10% = 10000 → min = 316
    assertEquals(size, 316);
  },
);

// ── Always a valid positive integer ─────────────────────────────────

Deno.test(
  "AdaptiveTournamentSize: always returns a positive integer",
  () => {
    const testSizes = [
      1,
      2,
      3,
      4,
      5,
      7,
      10,
      15,
      20,
      50,
      99,
      100,
      101,
      256,
      500,
      999,
      1000,
      2500,
      5000,
      10_000,
    ];

    for (const popSize of testSizes) {
      const result = calculateAdaptiveTournamentSize(popSize);

      assert(
        Number.isInteger(result),
        `Result ${result} for population ${popSize} is not an integer`,
      );
      assert(
        result > 0,
        `Result ${result} for population ${popSize} is not positive`,
      );
    }
  },
);

Deno.test(
  "AdaptiveTournamentSize: never exceeds population size",
  () => {
    for (let pop = 1; pop <= 50; pop++) {
      const size = calculateAdaptiveTournamentSize(pop);
      assert(
        size <= pop,
        `Tournament size ${size} exceeds population ${pop}`,
      );
    }
  },
);

// ── Scales appropriately ────────────────────────────────────────────

Deno.test(
  "AdaptiveTournamentSize: monotonically non-decreasing",
  () => {
    let previous = 0;
    for (let pop = 1; pop <= 5000; pop += 50) {
      const current = calculateAdaptiveTournamentSize(pop);
      assert(
        current >= previous,
        `Size decreased from ${previous} to ${current} at population ${pop}`,
      );
      previous = current;
    }
  },
);

Deno.test(
  "AdaptiveTournamentSize: larger populations produce equal or larger tournaments",
  () => {
    const pairs: [number, number][] = [
      [10, 100],
      [100, 1000],
      [50, 500],
      [200, 2000],
    ];

    for (const [small, large] of pairs) {
      const sizeSmall = calculateAdaptiveTournamentSize(small);
      const sizeLarge = calculateAdaptiveTournamentSize(large);
      assert(
        sizeLarge >= sizeSmall,
        `Population ${large} (size=${sizeLarge}) should have >= ` +
          `tournament than ${small} (size=${sizeSmall})`,
      );
    }
  },
);

Deno.test(
  "AdaptiveTournamentSize: coverage percentage stays reasonable",
  () => {
    // For populations above 100, tournament size should be between 1% and 15%
    const testPops = [100, 200, 500, 1000, 5000, 10_000];

    for (const pop of testPops) {
      const size = calculateAdaptiveTournamentSize(pop);
      const pct = (size / pop) * 100;
      assert(
        pct >= 1 && pct <= 15,
        `Coverage ${
          pct.toFixed(2)
        }% for population ${pop} is outside 1-15% range`,
      );
    }
  },
);

// ── Formula verification ────────────────────────────────────────────

Deno.test(
  "AdaptiveTournamentSize: matches formula max(3, min(sqrt, 10%))",
  () => {
    // Verify the formula for populations above the edge-case threshold
    for (let pop = 3; pop <= 2000; pop += 7) {
      const actual = calculateAdaptiveTournamentSize(pop);
      const sqrtSize = Math.floor(Math.sqrt(pop));
      const pctSize = Math.floor(pop * 0.1);
      const expected = Math.max(3, Math.min(sqrtSize, pctSize));

      assertEquals(
        actual,
        expected,
        `Population ${pop}: expected ${expected}, got ${actual}`,
      );
    }
  },
);
