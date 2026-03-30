/**
 * Tests verifying Fitness throws typed ValidationError
 * instead of generic Error for invalid worker response.
 *
 * Issue #1694
 */
import { assertIsError } from "@std/assert";
import { Fitness } from "@architecture/Fitness.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { Creature } from "../../src/Creature.ts";

Deno.test("Fitness calculate - throws ValidationError for invalid worker response", async () => {
  const creature = new Creature(2, 1);
  creature.score = undefined;

  // Create a mock worker that returns an invalid response
  const mockWorker = {
    evaluate: () => Promise.resolve({ evaluate: undefined }),
  };

  const fitness = new Fitness(
    // deno-lint-ignore no-explicit-any
    [mockWorker as any],
    0,
    false,
  );

  try {
    await fitness.calculate([creature]);
    throw new Error("Should have thrown");
  } catch (err) {
    assertIsError(err, ValidationError);
  }
});
