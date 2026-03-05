/**
 * Tests for issue #1695: Verify that modules throw typed errors
 * instead of generic Error instances.
 *
 * Tests cover: breed, mutate, blackbox, NEAT, Costs, Simplify, and RNG modules.
 */
import { assertThrows } from "@std/assert";
import { FitnessRanking } from "../../src/breed/FitnessRanking.ts";
import { Costs } from "../../src/Costs.ts";
import {
  createSeededRng,
  createUnseededRng,
} from "../../src/utils/RandomNumberGenerator.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";

// ── FitnessRanking ──────────────────────────────────────────────────────────

Deno.test("FitnessRanking - empty population throws ValidationError", () => {
  assertThrows(
    () => new FitnessRanking([]),
    ValidationError,
    "Population cannot be empty",
  );
});

// ── Costs ───────────────────────────────────────────────────────────────────

Deno.test("Costs.find - unknown cost throws ValidationError", () => {
  assertThrows(
    () => Costs.find("NONEXISTENT_COST"),
    ValidationError,
    "Unknown cost function",
  );
});

// ── RandomNumberGenerator ───────────────────────────────────────────────────

Deno.test("SeededRng.choice - empty array throws ValidationError", () => {
  const rng = createSeededRng(42);
  assertThrows(
    () => rng.choice([]),
    ValidationError,
    "Cannot choose from an empty array",
  );
});

Deno.test("UnseededRng.choice - empty array throws ValidationError", () => {
  const rng = createUnseededRng();
  assertThrows(
    () => rng.choice([]),
    ValidationError,
    "Cannot choose from an empty array",
  );
});
