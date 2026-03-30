/**
 * Tests verifying CreatureUtil methods throw typed ValidationError
 * instead of generic Error for invalid creatures.
 *
 * Issue #1694
 */
import { assertIsError, assertThrows } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { ValidationError } from "@errors/ValidationError.ts";

Deno.test("CreatureUtil.makeUUID - throws ValidationError for invalid creature", () => {
  // deno-lint-ignore no-explicit-any
  const fake = {} as any;
  const err = assertThrows(() => CreatureUtil.makeUUID(fake));
  assertIsError(err, ValidationError);
});

Deno.test("CreatureUtil.getTopologyHash - throws ValidationError for invalid creature", () => {
  // deno-lint-ignore no-explicit-any
  const fake = {} as any;
  const err = assertThrows(() => CreatureUtil.getTopologyHash(fake));
  assertIsError(err, ValidationError);
});
